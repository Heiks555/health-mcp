const http = require('http');
const path = require('path');
const { createHealthProvider } = require('./services/healthProvider');

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
  'Access-Control-Allow-Headers': 'Content-Type, Accept, Mcp-Session-Id, Authorization',
};

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
