import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Server } from "node:http";
import { requireApiKey } from "../src/auth.js";
import { closeDb, initDb } from "../src/db.js";
import { createMcpServer } from "../src/server.js";

describe("HTTP auth + health", () => {
  let server: Server;
  let baseUrl: string;
  const prevKey = process.env.MCP_API_KEY;

  beforeAll(async () => {
    process.env.MCP_API_KEY = "test-key-one,test-key-two";
    initDb(":memory:");

    const app = createMcpExpressApp({ host: "127.0.0.1" });
    app.get("/health", (_req, res) => {
      res.status(200).json({ status: "ok" });
    });
    app.post("/mcp", requireApiKey, async (req, res) => {
      const mcp = createMcpServer();
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
    if (prevKey === undefined) delete process.env.MCP_API_KEY;
    else process.env.MCP_API_KEY = prevKey;
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

  it("accepts /mcp with a valid key", async () => {
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
