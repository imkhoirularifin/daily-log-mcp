# daily-log-mcp

Small production MCP server that lets AI assistants (Claude, Cursor, ChatGPT, etc.) record **Arifin’s daily backend work tasks** into a central SQLite inbox. Another assistant later lists pending (`synced=false`) rows, copies them into a Google Sheets daily log, and calls `mark_synced`.

- **Transport:** Streamable HTTP at `POST /mcp` (stateless)
- **Health:** public `GET /health` → `{ "status": "ok" }`
- **Auth:** `Authorization: Bearer <token>` must match `MCP_API_KEY` (comma-separated list supported)
- **Runtime:** Node 22 + TypeScript + official `@modelcontextprotocol/sdk` + `node:sqlite`

## Tools

| Tool | Purpose |
|------|---------|
| `get_guidelines` | Filling rules (date format, difficulty→workload, defaults, sync flow) |
| `add_task` | Add one task |
| `add_tasks` | Bulk add (max 50) |
| `list_tasks` | Filter by date range / synced / sumber; ordered by tanggal, created_at |
| `update_task` | Edit only while `synced=false` |
| `delete_task` | Delete only while `synced=false` |
| `mark_synced` | Mark ids as written to the sheet |

Fixed sheet fields exposed on every list/add output: `nama_anggota=Arifin`, `role=Backend`, `yesterday=-`. Dates use **DD/MM/YYYY**; storage is ISO. Earliest allowed date: **17/09/2026**.

## Environment variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `MCP_API_KEY` | **yes** | — | One or more Bearer tokens, comma-separated |
| `DATABASE_PATH` | no | `/data/daily-log.db` | SQLite file path (auto-created + migrated) |
| `PORT` | no | `3000` | HTTP port |
| `HOST` | no | `0.0.0.0` | Bind address |

Copy `.env.example` → `.env` and set real keys before running.

## Run locally

```bash
npm ci
cp .env.example .env
# edit MCP_API_KEY and optionally DATABASE_PATH=./data/daily-log.db
export $(grep -v '^#' .env | xargs)
mkdir -p data
npm run build
npm start
# or: npm run dev
```

```bash
curl -s http://127.0.0.1:3000/health
# {"status":"ok"}
```

```bash
npm test
```

## Docker / Coolify

```bash
# local compose
cp .env.example .env   # set MCP_API_KEY
docker compose up --build -d
curl -s http://127.0.0.1:3000/health
```

**Coolify (dev):**

1. Create a new resource from this repo (Dockerfile).
2. Set env: `MCP_API_KEY` (required), optionally `PORT` / `DATABASE_PATH`.
3. Persist `/data` with a volume (compose already defines `daily-log-data`).
4. Expose port `3000` (or map `PORT`). Healthcheck path: `/health`.
5. After deploy, point MCP clients at `https://<your-host>/mcp` with the Bearer header.

Image is multi-stage, runs as non-root `app` (uid 1001), and uses a named volume for SQLite.

## Client configuration

Replace `https://daily-log.example.com` and the key with your Coolify URL / token.

### Cursor (`.cursor/mcp.json`)

```json
{
  "mcpServers": {
    "daily-log": {
      "url": "https://daily-log.example.com/mcp",
      "headers": {
        "Authorization": "Bearer change-me-cursor-key"
      }
    }
  }
}
```

### Claude Desktop / Claude Code

Claude Desktop remote MCP (HTTP) — add under MCP servers (format may vary by app version):

```json
{
  "mcpServers": {
    "daily-log": {
      "type": "http",
      "url": "https://daily-log.example.com/mcp",
      "headers": {
        "Authorization": "Bearer change-me-claude-key"
      }
    }
  }
}
```

### Generic MCP client (Streamable HTTP)

```bash
# Initialize
curl -sS https://daily-log.example.com/mcp \
  -H "Authorization: Bearer change-me-cursor-key" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"curl","version":"0.0.1"}}}'

# tools/list (stateless: include initialize handshake per client docs, or use an MCP SDK client)
```

Prefer an official MCP SDK client over raw curl for multi-step sessions. Auth without a valid Bearer token returns **401**.

## Typical AI workflow

1. Coding assistant: `get_guidelines` → `add_task` / `add_tasks` with `sumber` set to its name.
2. Sheet assistant: `list_tasks` with `synced=false` → write rows to Google Sheets → `mark_synced` with those ids.

## License

MIT
