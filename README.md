# daily-log-mcp

Small production MCP server that lets AI assistants (Claude, Cursor, ChatGPT, etc.) record **team daily work tasks** into a central SQLite inbox. Each API key belongs to a user (`nama` + `role`); identity comes from the Bearer token. Another assistant (Dori, admin key) later lists pending (`synced=false`) rows across users, copies them into a Google Sheets daily log, and calls `mark_synced`.

- **Transport:** Streamable HTTP at `POST /mcp` (stateless)
- **Health:** public `GET /health` → `{ "status": "ok" }`
- **Auth:** `Authorization: Bearer <token>` resolved against hashed `api_keys` in SQLite (never log raw keys)
- **Runtime:** Node 22 + TypeScript + official `@modelcontextprotocol/sdk` + `node:sqlite`

## Tools

| Tool | Purpose |
|------|---------|
| `get_guidelines` | Filling rules (date format, difficulty→workload, defaults, multi-user sync flow) |
| `add_task` | Add one task (nama/role from API key user) |
| `add_tasks` | Bulk add (max 50) |
| `list_tasks` | Own tasks (non-admin) or all users (admin); filter by date / synced / sumber / `nama_anggota` (admin) |
| `update_task` | Edit only while `synced=false` (own tasks unless admin) |
| `delete_task` | Delete only while `synced=false` (own tasks unless admin) |
| `mark_synced` | **Admin only** — mark ids as written to the sheet |

Every list/add output includes `nama_anggota`, `role` (from the task owner), and `yesterday=-`. Dates use **DD/MM/YYYY**; storage is ISO. Earliest allowed date: **17/09/2026**.

## Environment variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DAILY_LOG_MCP_KEY_ARIFIN` | recommended | — | Bootstrap Arifin / Backend / non-admin (hashed on startup) |
| `DAILY_LOG_MCP_KEY_DORI` | recommended | — | Bootstrap Dori / Sync / **admin** (sheet sync) |
| `DAILY_LOG_MCP_KEY_DOCUMIND_DEVOPS` | recommended | — | Bootstrap DevOps / Ops / **admin** |
| `MCP_BOOTSTRAP_KEYS` | optional | — | Extra `key\|nama\|role\|admin` entries (comma-separated) |
| `MCP_API_KEY` | legacy | — | Only if DB has no keys and named/bootstrap unset; all → Arifin non-admin |
| `DATABASE_PATH` | no | `/data/daily-log.db` | SQLite file path (auto-created + migrated) |
| `PORT` | no | `3000` | HTTP port |
| `HOST` | no | `0.0.0.0` | Bind address |

Copy `.env.example` → `.env` and set real keys before running. After the first successful bootstrap, keys live in the DB; you can keep the bootstrap env vars set (idempotent) or manage keys only via the CLI.

### Bootstrap mapping (deployed keys)

| Ops key name | User `nama` | `role` | Admin? |
|--------------|-------------|--------|--------|
| `DAILY_LOG_MCP_KEY_ARIFIN` | Arifin | Backend | no |
| `DAILY_LOG_MCP_KEY_DORI` | Dori | Sync | **yes** |
| `DAILY_LOG_MCP_KEY_DOCUMIND_DEVOPS` | DevOps | Ops | **yes** |

Put the **same raw token values** currently in `MCP_API_KEY` into these three env vars on Coolify. Existing clients keep using the same Bearer tokens; the server hashes them once and links them to users. Existing tasks are attributed to **Arifin (Backend)** by migration.

## Run locally

```bash
npm ci
cp .env.example .env
# edit DAILY_LOG_MCP_KEY_* (or MCP_BOOTSTRAP_KEYS) and optionally DATABASE_PATH
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

## User & API key management (CLI)

Run inside the container (or locally with `DATABASE_PATH` pointing at the same DB). New keys are printed **once**.

```bash
# Add a teammate
node dist/cli.js user add --nama Alza --role Frontend

# Issue a key (copy api_key into the client's Authorization header)
node dist/cli.js key create --user Alza --label alza-claude

# List users / keys (hashes never shown)
node dist/cli.js user list
node dist/cli.js key list
node dist/cli.js key list --user Alza

# Revoke
node dist/cli.js key revoke --id <key-uuid>
```

### Seed user Alza (Frontend, non-admin)

```bash
# Coolify / Docker
docker compose exec daily-log-mcp node dist/cli.js user add --nama Alza --role Frontend
docker compose exec daily-log-mcp node dist/cli.js key create --user Alza --label alza-claude

# Or against a local DB
DATABASE_PATH=./data/daily-log.db node dist/cli.js user add --nama Alza --role Frontend
DATABASE_PATH=./data/daily-log.db node dist/cli.js key create --user Alza --label alza-claude
```

Give Alza’s client the printed `api_key` as `Authorization: Bearer …`. Do not commit or log the value.

Admin users: `node dist/cli.js user add --nama Someone --role Ops --admin`.

## Docker / Coolify

```bash
# local compose
cp .env.example .env   # set DAILY_LOG_MCP_KEY_* 
docker compose up --build -d
curl -s http://127.0.0.1:3000/health
```

**Coolify (dev) — multi-user migration:**

1. Deploy this version from the PR/branch (or after merge to `main`).
2. Set env (same secret values as today in `MCP_API_KEY`):
   - `DAILY_LOG_MCP_KEY_ARIFIN`
   - `DAILY_LOG_MCP_KEY_DORI`
   - `DAILY_LOG_MCP_KEY_DOCUMIND_DEVOPS`
3. Persist `/data` (compose volume `daily-log-data`). Migration adds `users` / `api_keys` and backfills `tasks.user_id` → Arifin.
4. Optionally remove legacy `MCP_API_KEY` after confirming clients still authenticate.
5. Expose port `3000`. Healthcheck: `/health`.
6. Point MCP clients at `https://<your-host>/mcp` with their existing Bearer headers (no client change required for the three bootstrapped keys).

Image is multi-stage, runs as non-root `app` (uid 999), and uses a named volume for SQLite.

## Client configuration

Replace `https://daily-log.example.com` and the key with your Coolify URL / **per-user** token.

### Cursor (`.cursor/mcp.json`)

```json
{
  "mcpServers": {
    "daily-log": {
      "url": "https://daily-log.example.com/mcp",
      "headers": {
        "Authorization": "Bearer <user-api-key>"
      }
    }
  }
}
```

### Claude Desktop / Claude Code

```json
{
  "mcpServers": {
    "daily-log": {
      "type": "http",
      "url": "https://daily-log.example.com/mcp",
      "headers": {
        "Authorization": "Bearer <user-api-key>"
      }
    }
  }
}
```

### Generic MCP client (Streamable HTTP)

```bash
curl -sS https://daily-log.example.com/mcp \
  -H "Authorization: Bearer <user-api-key>" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"curl","version":"0.0.1"}}}'
```

Prefer an official MCP SDK client over raw curl for multi-step sessions. Auth without a valid Bearer token returns **401**.

## Typical AI workflow

1. Coding assistant (user key): `get_guidelines` → `add_task` / `add_tasks` with `sumber` set to its name.
2. Sheet assistant (Dori admin key): `list_tasks` with `synced=false` (optionally `nama_anggota`) → write rows to Google Sheets → `mark_synced` with those ids.

## License

MIT
