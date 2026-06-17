const http = require('http');
const path = require('path');

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

function generateSleepData() {
  const duration = Math.floor(Math.random() * 2) + 7;
  const deepSleep = Math.floor(Math.random() * 10) + 15;
  const rem = Math.floor(Math.random() * 5) + 20;
  const hrv = Math.floor(Math.random() * 30) + 50;
  return { duration_hours: duration, deep_sleep_percentage: deepSleep, rem_percentage: rem, hrv_ms: hrv };
}

function generateActivityData() {
  const steps = Math.floor(Math.random() * 7000) + 8000;
  const calories = Math.floor(Math.random() * 300) + 300;
  const activeMinutes = Math.floor(Math.random() * 30) + 30;
  return { steps, calories_burned: calories, active_minutes: activeMinutes };
}

function generateNutritionData() {
  const calories = Math.floor(Math.random() * 500) + 2000;
  const protein = Math.floor(Math.random() * 50) + 100;
  const carbs = Math.floor(Math.random() * 100) + 200;
  const fat = Math.floor(Math.random() * 40) + 60;
  const water = parseFloat((Math.random() * 1 + 2).toFixed(2));
  return { calories, protein_grams: protein, carbs_grams: carbs, fat_grams: fat, water_liters: water };
}

// Registers all tools on a fresh McpServer instance.
// Called per-request because the SDK requires a new transport (and server) for each
// stateless request — reusing a stateless transport throws an error after the first call.
function createServer() {
  const server = new McpServer({ name: 'health-mcp', version: '1.0.0' });

  server.registerTool('get_health_status', {
    title: 'Get Health Status',
    description: 'Returns a simple health message indicating the MCP server is running',
  }, () => ({ content: [{ type: 'text', text: 'MCP server is working!' }] }));

  server.registerTool('get_sleep_data', {
    title: 'Get Sleep Data',
    description: 'Returns mock sleep data including duration, deep sleep %, REM %, and HRV',
  }, () => ({ content: [{ type: 'text', text: JSON.stringify(generateSleepData(), null, 2) }] }));

  server.registerTool('get_activity_data', {
    title: 'Get Activity Data',
    description: 'Returns mock activity data including steps, calories burned, and active minutes',
  }, () => ({ content: [{ type: 'text', text: JSON.stringify(generateActivityData(), null, 2) }] }));

  server.registerTool('get_nutrition_data', {
    title: 'Get Nutrition Data',
    description: 'Returns mock nutrition data including calories, macros, and water intake',
  }, () => ({ content: [{ type: 'text', text: JSON.stringify(generateNutritionData(), null, 2) }] }));

  server.registerTool('get_weekly_summary', {
    title: 'Get Weekly Summary',
    description: 'Returns all health data (sleep, activity, nutrition) for the last 7 days',
  }, () => {
    const today = new Date();
    const weeklyData = [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      weeklyData.push({
        date: date.toISOString().split('T')[0],
        sleep: generateSleepData(),
        activity: generateActivityData(),
        nutrition: generateNutritionData(),
      });
    }
    return { content: [{ type: 'text', text: JSON.stringify(weeklyData, null, 2) }] };
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
