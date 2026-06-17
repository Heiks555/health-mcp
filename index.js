// Minimal MCP server exposing a single tool `get_health_status`.
// Uses the high-level McpServer API and the Streamable HTTP transport (Node-compatible).
const http = require('http');

const path = require('path');
let McpServer;
let StreamableHTTPServerTransport;
try {
  // Try high-level server module first
  const serverModule = require('@modelcontextprotocol/sdk/server');
  McpServer = serverModule.McpServer;
} catch (e) {
  // ignore; we'll try the fallback below
}
if (!McpServer) {
  try {
    McpServer = require(path.join(__dirname, 'node_modules', '@modelcontextprotocol', 'sdk', 'dist', 'cjs', 'server', 'mcp.js')).McpServer;
  } catch (err2) {
    console.error('Failed to load McpServer:', err2 && err2.message ? err2.message : err2);
    process.exit(1);
  }
}

try {
  // Preferred subpath
  StreamableHTTPServerTransport = require('@modelcontextprotocol/sdk/server/streamableHttp').StreamableHTTPServerTransport;
} catch (e) {
  try {
    StreamableHTTPServerTransport = require(path.join(__dirname, 'node_modules', '@modelcontextprotocol', 'sdk', 'dist', 'cjs', 'server', 'streamableHttp.js')).StreamableHTTPServerTransport;
  } catch (err2) {
    console.error('Failed to load StreamableHTTPServerTransport:', err2 && err2.message ? err2.message : err2);
    process.exit(1);
  }
}

// Create McpServer instance
const server = new McpServer({ name: 'health-mcp', version: '1.0.0' });

// Register the get_health_status tool BEFORE connecting transport
// This ensures the tools capability is properly set up
server.registerTool('get_health_status', {
  title: 'Get Health Status',
  description: 'Returns a simple health message indicating the MCP server is running'
}, (extra) => {
  return {
    content: [
      {
        type: 'text',
        text: 'MCP server is working!'
      }
    ]
  };
});

console.log('✓ Tool "get_health_status" registered');

// Helper function to generate realistic mock sleep data
function generateSleepData() {
  const duration = Math.floor(Math.random() * 2) + 7; // 7-8 hours
  const deepSleep = Math.floor(Math.random() * 10) + 15; // 15-25%
  const rem = Math.floor(Math.random() * 5) + 20; // 20-25%
  const hvr = Math.floor(Math.random() * 30) + 50; // 50-80 ms
  
  return {
    duration_hours: duration,
    deep_sleep_percentage: deepSleep,
    rem_percentage: rem,
    hrv_ms: hvr
  };
}

// Helper function to generate realistic mock activity data
function generateActivityData() {
  const steps = Math.floor(Math.random() * 7000) + 8000; // 8000-15000 steps
  const calories = Math.floor(Math.random() * 300) + 300; // 300-600 calories
  const activeMinutes = Math.floor(Math.random() * 30) + 30; // 30-60 minutes
  
  return {
    steps,
    calories_burned: calories,
    active_minutes: activeMinutes
  };
}

// Helper function to generate realistic mock nutrition data
function generateNutritionData() {
  const calories = Math.floor(Math.random() * 500) + 2000; // 2000-2500 calories
  const protein = Math.floor(Math.random() * 50) + 100; // 100-150g
  const carbs = Math.floor(Math.random() * 100) + 200; // 200-300g
  const fat = Math.floor(Math.random() * 40) + 60; // 60-100g
  const water = (Math.random() * 1 + 2).toFixed(2); // 2-3 liters
  
  return {
    calories,
    protein_grams: protein,
    carbs_grams: carbs,
    fat_grams: fat,
    water_liters: parseFloat(water)
  };
}

// Register get_sleep_data tool
server.registerTool('get_sleep_data', {
  title: 'Get Sleep Data',
  description: 'Returns mock sleep data including duration, deep sleep %, REM %, and HRV'
}, (extra) => {
  const sleepData = generateSleepData();
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(sleepData, null, 2)
      }
    ]
  };
});

console.log('✓ Tool "get_sleep_data" registered');

// Register get_activity_data tool
server.registerTool('get_activity_data', {
  title: 'Get Activity Data',
  description: 'Returns mock activity data including steps, calories burned, and active minutes'
}, (extra) => {
  const activityData = generateActivityData();
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(activityData, null, 2)
      }
    ]
  };
});

console.log('✓ Tool "get_activity_data" registered');

// Register get_nutrition_data tool
server.registerTool('get_nutrition_data', {
  title: 'Get Nutrition Data',
  description: 'Returns mock nutrition data including calories, macros, and water intake'
}, (extra) => {
  const nutritionData = generateNutritionData();
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(nutritionData, null, 2)
      }
    ]
  };
});

console.log('✓ Tool "get_nutrition_data" registered');

// Register get_weekly_summary tool
server.registerTool('get_weekly_summary', {
  title: 'Get Weekly Summary',
  description: 'Returns all health data (sleep, activity, nutrition) for the last 7 days'
}, (extra) => {
  const weeklyData = [];
  const today = new Date();
  
  for (let i = 6; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    
    weeklyData.push({
      date: date.toISOString().split('T')[0],
      sleep: generateSleepData(),
      activity: generateActivityData(),
      nutrition: generateNutritionData()
    });
  }
  
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(weeklyData, null, 2)
      }
    ]
  };
});

console.log('✓ Tool "get_weekly_summary" registered');

// Expose an HTTP endpoint that delegates to the Streamable HTTP transport
const port = process.env.PORT ? Number(process.env.PORT) : 3000;
const transport = new StreamableHTTPServerTransport({
  sessionIdGenerator: undefined
});

(async () => {
  // Attach the transport to the McpServer
  await server.connect(transport);
  console.log('✓ Transport connected to server');
  
  // Verify server capabilities
  const caps = server.server.getCapabilities();
  console.log('✓ Server capabilities:', Object.keys(caps).filter(k => caps[k]));

  const httpServer = http.createServer(async (req, res) => {
    try {
      await transport.handleRequest(req, res);
    } catch (err) {
      console.error('Error handling request:', err && err.message ? err.message : err);
      res.statusCode = 500;
      res.end('Internal Server Error');
    }
  });

  httpServer.listen(port, () => {
    console.log(`✓ MCP server listening on http://localhost:${port}/ (Streamable HTTP)`);
    console.log('  Tool "get_health_status" is available via MCP protocol');
  });

  // Graceful shutdown
  const shutdown = async () => {
    console.log('Shutting down...');
    try {
      await server.close();
    } catch (e) { }
    httpServer.close(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
})();
