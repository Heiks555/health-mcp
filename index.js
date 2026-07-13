const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { createHealthProvider } = require('./services/healthProvider');
const {
  analyzeHealthData,
  chatWithHealthContext,
  validateChatMessages,
} = require('./services/claudeProxy');
const { checkAndConsume, secondsUntilNextUtcDay } = require('./services/rateLimiter');

let McpServer;
let StreamableHTTPServerTransport;

try {
  McpServer = require('@modelcontextprotocol/sdk/server/mcp.js').McpServer;
} catch (e) {
  try {
    McpServer = require(path.join(__dirname, 'node_modules', '@modelcontextprotocol', 'sdk', 'dist', 'cjs', 'server', 'mcp.js')).McpServer;
  } catch (err2) {
    console.error('Failed to load McpServer:', err2 && err2.message ? err2.message : err2);
    process.exit(1);
  }
}

try {
  StreamableHTTPServerTransport = require('@modelcontextprotocol/sdk/server/streamableHttp.js').StreamableHTTPServerTransport;
} catch (e) {
  try {
    StreamableHTTPServerTransport = require(path.join(__dirname, 'node_modules', '@modelcontextprotocol', 'sdk', 'dist', 'cjs', 'server', 'streamableHttp.js')).StreamableHTTPServerTransport;
  } catch (err2) {
    console.error('Failed to load StreamableHTTPServerTransport:', err2 && err2.message ? err2.message : err2);
    process.exit(1);
  }
}

// Registers all tools on a fresh McpServer instance.
// Called per-request because the SDK requires a new transport (and server) for each
// stateless request — reusing a stateless transport throws an error after the first call.
function createServer() {
  const server = new McpServer({ name: 'health-mcp', version: '1.0.0' });
  const healthProvider = createHealthProvider();

  server.registerTool('get_health_status', {
    title: 'Get Health Status',
    description: 'Returns live health status from Open Wearables or mock fallback data',
  }, async () => {
    const data = await healthProvider.getHealthStatus();
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  });

  server.registerTool('get_sleep_data', {
    title: 'Get Sleep Data',
    description: 'Returns sleep data from Open Wearables or mock fallback data',
  }, async () => {
    const data = await healthProvider.getSleepData();
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  });

  server.registerTool('get_activity_data', {
    title: 'Get Activity Data',
    description: 'Returns activity data from Open Wearables or mock fallback data',
  }, async () => {
    const data = await healthProvider.getActivityData();
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  });

  server.registerTool('get_nutrition_data', {
    title: 'Get Nutrition Data',
    description: 'Returns mock nutrition data (Open Wearables does not provide nutrition data)',
  }, async () => {
    const data = await healthProvider.getNutritionData();
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  });

  server.registerTool('get_weekly_summary', {
    title: 'Get Weekly Summary',
    description: 'Returns a weekly summary with sleep, activity, and nutrition data',
  }, async () => {
    const data = await healthProvider.getWeeklySummary();
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  });

  return server;
}

const port = process.env.PORT ? Number(process.env.PORT) : 3000;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept, Mcp-Session-Id, Authorization, X-Suund-App-Key, X-Suund-User-Id',
};

const MAX_JSON_BODY_BYTES = 200 * 1024;

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function readJsonBody(req, maxBytes = MAX_JSON_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(Object.assign(new Error('Payload too large'), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (err) {
        reject(Object.assign(new Error('Invalid JSON body'), { statusCode: 400 }));
      }
    });
    req.on('error', reject);
  });
}

// App-level gate, not real auth: stops random internet traffic from hitting a
// Claude-backed endpoint, nothing more. Real per-user auth comes later.
function hasValidAppKey(req) {
  const expected = process.env.SUUND_APP_KEY;
  if (!expected) return false;

  const provided = req.headers['x-suund-app-key'];
  if (typeof provided !== 'string' || provided.length === 0) return false;

  const expectedBuf = Buffer.from(expected);
  const providedBuf = Buffer.from(provided);
  if (expectedBuf.length !== providedBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, providedBuf);
}

// Per-user identifier for rate limiting. The app must generate and persist a stable
// anonymous id (e.g. a UUID in SecureStore) and send it on every request — there's no
// real user account yet to key off of.
function getCallerId(req) {
  const id = req.headers['x-suund-user-id'];
  if (typeof id === 'string' && id.trim().length > 0 && id.length <= 200) {
    return id.trim();
  }
  return null;
}

async function handleAnalyze(req, res) {
  if (!hasValidAppKey(req)) {
    sendJson(res, 401, { error: 'Unauthorized' });
    return;
  }

  const callerId = getCallerId(req);
  if (!callerId) {
    sendJson(res, 400, { error: 'Missing X-Suund-User-Id header' });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('ANTHROPIC_API_KEY is not set');
    sendJson(res, 500, { error: 'Server misconfigured' });
    return;
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    sendJson(res, err.statusCode || 400, { error: err.message });
    return;
  }

  const healthData = body && typeof body.healthData === 'object' ? body.healthData : null;

  const rateLimit = checkAndConsume(callerId);
  if (!rateLimit.allowed) {
    res.setHeader('Retry-After', String(secondsUntilNextUtcDay()));
    sendJson(res, 429, { error: 'Rate limit exceeded', limit: rateLimit.limit, remaining: 0 });
    return;
  }

  try {
    const analysis = await analyzeHealthData({ apiKey, healthData });
    sendJson(res, 200, analysis);
  } catch (err) {
    console.error('Claude analyze error:', err.message);
    sendJson(res, 502, { error: 'Claude API request failed' });
  }
}

async function handleChat(req, res) {
  if (!hasValidAppKey(req)) {
    sendJson(res, 401, { error: 'Unauthorized' });
    return;
  }

  const callerId = getCallerId(req);
  if (!callerId) {
    sendJson(res, 400, { error: 'Missing X-Suund-User-Id header' });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('ANTHROPIC_API_KEY is not set');
    sendJson(res, 500, { error: 'Server misconfigured' });
    return;
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    sendJson(res, err.statusCode || 400, { error: err.message });
    return;
  }

  const validation = validateChatMessages(body && body.messages);
  if (!validation.valid) {
    sendJson(res, 400, { error: validation.error });
    return;
  }

  const healthData = body && typeof body.healthData === 'object' ? body.healthData : null;

  const rateLimit = checkAndConsume(callerId);
  if (!rateLimit.allowed) {
    res.setHeader('Retry-After', String(secondsUntilNextUtcDay()));
    sendJson(res, 429, { error: 'Rate limit exceeded', limit: rateLimit.limit, remaining: 0 });
    return;
  }

  try {
    const result = await chatWithHealthContext({ apiKey, healthData, messages: body.messages });
    sendJson(res, 200, result);
  } catch (err) {
    console.error('Claude chat error:', err.message);
    sendJson(res, 502, { error: 'Claude API request failed' });
  }
}

const httpServer = http.createServer(async (req, res) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(200, CORS_HEADERS);
    res.end();
    return;
  }

  // Health check for Railway / load balancers
  if (req.method === 'GET' && (req.url === '/health' || req.url === '/')) {
    res.writeHead(200, { 'Content-Type': 'application/json', ...CORS_HEADERS });
    res.end(JSON.stringify({ status: 'ok', server: 'health-mcp', version: '1.0.0' }));
    return;
  }

  Object.entries(CORS_HEADERS).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method === 'POST' && req.url === '/api/analyze') {
    await handleAnalyze(req, res);
    return;
  }

  if (req.method === 'POST' && req.url === '/api/chat') {
    await handleChat(req, res);
    return;
  }

  try {
    // A fresh server+transport pair is required per request in stateless mode.
    // The SDK's WebStandardStreamableHTTPServerTransport throws if reused after
    // the first request when sessionIdGenerator is undefined.
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    const server = createServer();
    await server.connect(transport);

    await transport.handleRequest(req, res);

    res.on('close', () => { server.close().catch(() => {}); });
  } catch (err) {
    console.error('Request error:', err && err.message ? err.message : err);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null }));
    }
  }
});

httpServer.listen(port, () => {
  console.log(`✓ health-mcp listening on port ${port} (Streamable HTTP, stateless per-request)`);
});

const shutdown = async () => {
  console.log('Shutting down...');
  httpServer.close(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
