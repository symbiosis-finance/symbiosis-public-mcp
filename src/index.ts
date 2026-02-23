import { createServer } from "./server.js";
import { initRpcService } from "./services/rpc-service.js";

// Load .env if present (for PRIVATE_KEY etc.)
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ quiet: true });

// Start RPC validation service in background
initRpcService();

const transport = process.env.MCP_TRANSPORT ?? "stdio";

if (transport === "http") {
  const { default: express } = await import("express");
  const { StreamableHTTPServerTransport } = await import(
    "@modelcontextprotocol/sdk/server/streamableHttp.js"
  );

  const app = express();
  app.use(express.json());

  // CORS
  app.use((_req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, DELETE");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept, Authorization, Mcp-Session-Id");
    res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");
    if (_req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
  });

  // Stateless: each request gets its own server/transport
  app.post("/mcp", async (req, res) => {
    const server = createServer();
    const t = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless
    });
    res.on("close", () => {
      t.close().catch(() => {});
      server.close().catch(() => {});
    });
    await server.connect(t);
    await t.handleRequest(req, res, req.body);
  });

  // Handle GET and DELETE for SSE sessions (required by protocol)
  app.get("/mcp", async (_req, res) => {
    res.status(405).json({ error: "Method not allowed. Use POST for MCP requests." });
  });

  app.delete("/mcp", async (_req, res) => {
    res.status(405).json({ error: "Method not allowed. Stateless mode — no sessions to delete." });
  });

  // Health check
  app.get("/health", (_req, res) => {
    res.json({ status: "ok", server: "symbiosis-mcp", version: "1.0.0" });
  });

  const port = parseInt(process.env.PORT ?? "3000", 10);
  const host = process.env.HOST ?? "0.0.0.0";
  app.listen(port, host, () => {
    console.log(`Symbiosis MCP server (HTTP) listening on http://${host}:${port}/mcp`);
  });
} else {
  // stdio transport
  const { StdioServerTransport } = await import(
    "@modelcontextprotocol/sdk/server/stdio.js"
  );
  const server = createServer();
  const t = new StdioServerTransport();
  await server.connect(t);
  console.error("Symbiosis MCP server (stdio) running");
}
