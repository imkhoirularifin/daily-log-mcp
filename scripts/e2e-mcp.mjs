#!/usr/bin/env node
/**
 * End-to-end smoke: initialize + tools/call add_task, list_tasks, mark_synced
 * against a running daily-log-mcp server.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const base = process.env.MCP_URL || "http://127.0.0.1:3847/mcp";
const token = process.env.MCP_API_KEY || "e2e-key-alpha";

async function callTool(client, name, args) {
  const result = await client.callTool({ name, arguments: args });
  const text = result.content?.map((c) => ("text" in c ? c.text : "")).join("\n") ?? "";
  console.log(`\n=== ${name} ===`);
  console.log(text);
  if (result.isError) {
    throw new Error(`Tool ${name} returned isError`);
  }
  return JSON.parse(text);
}

async function main() {
  // 401 check
  const unauthorized = await fetch(base, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "e2e", version: "0" },
      },
    }),
  });
  if (unauthorized.status !== 401) {
    throw new Error(`Expected 401 without auth, got ${unauthorized.status}`);
  }
  console.log("OK: 401 without Authorization");

  const transport = new StreamableHTTPClientTransport(new URL(base), {
    requestInit: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  });
  const client = new Client({ name: "e2e-smoke", version: "1.0.0" });
  await client.connect(transport);

  const tools = await client.listTools();
  console.log(
    "OK: tools =",
    tools.tools.map((t) => t.name).join(", "),
  );

  const added = await callTool(client, "add_task", {
    tanggal: "23/10/2026",
    task: "E2E smoke: implement daily-log-mcp",
    tingkat_kesulitan: "Sedang",
    sumber: "e2e-script",
  });
  if (!added.ok || added.task.beban_kerja !== 3) {
    throw new Error("add_task failed or wrong beban_kerja");
  }

  const listed = await callTool(client, "list_tasks", { synced: false, sumber: "e2e-script" });
  if (!listed.tasks?.some((t) => t.id === added.task.id)) {
    throw new Error("list_tasks missing new task");
  }

  const synced = await callTool(client, "mark_synced", { ids: [added.task.id] });
  if (!synced.updated?.some((t) => t.id === added.task.id && t.synced === true)) {
    throw new Error("mark_synced failed");
  }

  const pending = await callTool(client, "list_tasks", { synced: false, sumber: "e2e-script" });
  if (pending.tasks?.some((t) => t.id === added.task.id)) {
    throw new Error("task still pending after mark_synced");
  }

  console.log("\nE2E PASSED");
  await client.close();
}

main().catch((err) => {
  console.error("E2E FAILED", err);
  process.exit(1);
});
