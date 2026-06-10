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
