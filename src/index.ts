#!/usr/bin/env node
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { requireApiKey } from "./auth.js";
import { ensureAuthConfigured, runBootstrap } from "./bootstrap.js";
import { closeDb, getDatabasePath, initDb } from "./db.js";
import { createMcpServer } from "./server.js";

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";

function main(): void {
  const dbPath = getDatabasePath();
  initDb(dbPath);
  console.log(`SQLite ready at ${dbPath}`);

  const bootstrap = runBootstrap();
  ensureAuthConfigured(bootstrap);

  // Bind 0.0.0.0 for Docker/Coolify; skip localhost-only DNS rebinding defaults.
  const app = createMcpExpressApp({ host: HOST });

  app.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  app.post("/mcp", requireApiKey, async (req, res) => {
    const actor = req.authUser;
    if (!actor) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    const server = createMcpServer(actor);
    try {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      res.on("close", () => {
        void transport.close();
        void server.close();
      });
    } catch (error) {
      console.error("Error handling MCP request:", error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  });

  app.get("/mcp", requireApiKey, (_req, res) => {
    res.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed." },
      id: null,
    });
  });

  app.delete("/mcp", requireApiKey, (_req, res) => {
    res.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed." },
      id: null,
    });
  });

  const httpServer = app.listen(PORT, HOST, (error?: Error) => {
    if (error) {
      console.error("Failed to start server:", error);
      process.exit(1);
    }
    console.log(
      `daily-log-mcp listening on http://${HOST}:${PORT} (POST /mcp, GET /health)`,
    );
  });

  const shutdown = () => {
    console.log("Shutting down...");
    httpServer.close(() => {
      closeDb();
      process.exit(0);
    });
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main();
