import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Server } from "node:http";
import { requireApiKey } from "../src/auth.js";
import { runBootstrap } from "../src/bootstrap.js";
import { closeDb, initDb } from "../src/db.js";
import { createMcpServer } from "../src/server.js";

describe("HTTP auth + health", () => {
  let server: Server;
  let baseUrl: string;
  const prevEnv: Record<string, string | undefined> = {};

  beforeAll(async () => {
    for (const k of [
      "MCP_API_KEY",
      "DAILY_LOG_MCP_KEY_ARIFIN",
      "DAILY_LOG_MCP_KEY_DORI",
      "DAILY_LOG_MCP_KEY_DOCUMIND_DEVOPS",
      "MCP_BOOTSTRAP_KEYS",
    ]) {
      prevEnv[k] = process.env[k];
      delete process.env[k];
    }
    process.env.DAILY_LOG_MCP_KEY_ARIFIN = "test-key-one";
    process.env.DAILY_LOG_MCP_KEY_DORI = "test-key-two";

    initDb(":memory:");
    runBootstrap();

    const app = createMcpExpressApp({ host: "127.0.0.1" });
    app.get("/health", (_req, res) => {
      res.status(200).json({ status: "ok" });
    });
    app.post("/mcp", requireApiKey, async (req, res) => {
      const actor = req.authUser!;
      const mcp = createMcpServer(actor);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      await mcp.connect(transport);
      await transport.handleRequest(req, res, req.body);
      res.on("close", () => {
        void transport.close();
        void mcp.close();
      });
    });

    await new Promise<void>((resolve) => {
      server = app.listen(0, "127.0.0.1", () => resolve());
    });
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("no port");
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    closeDb();
    for (const [k, v] of Object.entries(prevEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("GET /health is public", async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("rejects /mcp without a valid Bearer token", async () => {
    const noAuth = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "test", version: "0" },
        },
      }),
    });
    expect(noAuth.status).toBe(401);

    const bad = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: "Bearer wrong",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "test", version: "0" },
        },
      }),
    });
    expect(bad.status).toBe(401);
  });

  it("accepts /mcp with a bootstrapped key", async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        Authorization: "Bearer test-key-two",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "test", version: "0" },
        },
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toMatch(/serverInfo|daily-log-mcp|protocolVersion/);
  });
});
