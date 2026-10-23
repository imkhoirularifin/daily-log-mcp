import { bootstrapApiKey, countActiveApiKeys } from "./users.js";

export interface BootstrapEntry {
  rawKey: string;
  nama: string;
  role: string;
  isAdmin: boolean;
  label: string;
}

/**
 * Parse MCP_BOOTSTRAP_KEYS.
 * Format (comma-separated entries):
 *   <key>|<nama>|<role>|<admin>
 * where admin is 1/0/true/false/admin/user.
 *
 * Example:
 *   sk-dori|Dori|Sync|1,sk-arifin|Arifin|Backend|0,sk-ops|DevOps|Ops|1
 *
 * Never log raw key values.
 */
export function parseBootstrapKeys(
  envValue = process.env.MCP_BOOTSTRAP_KEYS,
): BootstrapEntry[] {
  if (!envValue || !envValue.trim()) return [];

  const entries: BootstrapEntry[] = [];
  for (const part of envValue.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const bits = trimmed.split("|").map((s) => s.trim());
    if (bits.length !== 4) {
      throw new Error(
        `MCP_BOOTSTRAP_KEYS entry must be key|nama|role|admin (got ${bits.length} fields). Do not log key values.`,
      );
    }
    const [rawKey, nama, role, adminRaw] = bits as [
      string,
      string,
      string,
      string,
    ];
    if (!rawKey || !nama || !role) {
      throw new Error(
        "MCP_BOOTSTRAP_KEYS entry has empty key/nama/role. Do not log key values.",
      );
    }
    entries.push({
      rawKey,
      nama,
      role,
      isAdmin: parseAdminFlag(adminRaw),
      label: `bootstrap:${nama}`,
    });
  }
  return entries;
}

function parseAdminFlag(raw: string): boolean {
  const v = raw.trim().toLowerCase();
  if (["1", "true", "yes", "admin"].includes(v)) return true;
  if (["0", "false", "no", "user"].includes(v)) return false;
  throw new Error(
    `MCP_BOOTSTRAP_KEYS admin flag must be 1/0/true/false/admin/user (got "${raw}").`,
  );
}

/**
 * Named env vars matching the ops key file. Applied when set.
 * - DAILY_LOG_MCP_KEY_ARIFIN → Arifin / Backend / non-admin
 * - DAILY_LOG_MCP_KEY_DORI → Dori / Sync / admin (sheet sync)
 * - DAILY_LOG_MCP_KEY_DOCUMIND_DEVOPS → DevOps / Ops / admin
 */
export function namedBootstrapEntries(
  env: NodeJS.ProcessEnv = process.env,
): BootstrapEntry[] {
  const specs: Array<{
    envName: string;
    nama: string;
    role: string;
    isAdmin: boolean;
    label: string;
  }> = [
    {
      envName: "DAILY_LOG_MCP_KEY_ARIFIN",
      nama: "Arifin",
      role: "Backend",
      isAdmin: false,
      label: "bootstrap:Arifin",
    },
    {
      envName: "DAILY_LOG_MCP_KEY_DORI",
      nama: "Dori",
      role: "Sync",
      isAdmin: true,
      label: "bootstrap:Dori",
    },
    {
      envName: "DAILY_LOG_MCP_KEY_DOCUMIND_DEVOPS",
      nama: "DevOps",
      role: "Ops",
      isAdmin: true,
      label: "bootstrap:DevOps",
    },
  ];

  const out: BootstrapEntry[] = [];
  for (const spec of specs) {
    const raw = env[spec.envName]?.trim();
    if (!raw) continue;
    out.push({
      rawKey: raw,
      nama: spec.nama,
      role: spec.role,
      isAdmin: spec.isAdmin,
      label: spec.label,
    });
  }
  return out;
}

/**
 * Legacy MCP_API_KEY (comma-separated) — only used when the DB still has
 * zero active keys AND no named/bootstrap entries were provided.
 * All keys map to Arifin/Backend non-admin so existing single-user deploys
 * keep working; ops should migrate to named keys / MCP_BOOTSTRAP_KEYS so
 * Dori can be admin.
 */
export function legacyMcpApiKeyEntries(
  envValue = process.env.MCP_API_KEY,
): BootstrapEntry[] {
  if (!envValue || !envValue.trim()) return [];
  return envValue
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean)
    .map((rawKey, i) => ({
      rawKey,
      nama: "Arifin",
      role: "Backend",
      isAdmin: false,
      label: `bootstrap:MCP_API_KEY#${i + 1}`,
    }));
}

export interface BootstrapResult {
  inserted: number;
  skipped: number;
  activeKeys: number;
  usedLegacyMcpApiKey: boolean;
}

/**
 * Apply bootstrap entries idempotently (by key hash). Prefer named env vars
 * and MCP_BOOTSTRAP_KEYS; fall back to MCP_API_KEY only if the DB has no
 * active keys yet.
 */
export function runBootstrap(
  env: NodeJS.ProcessEnv = process.env,
): BootstrapResult {
  let entries = [...namedBootstrapEntries(env), ...parseBootstrapKeys(env.MCP_BOOTSTRAP_KEYS)];
  let usedLegacyMcpApiKey = false;

  if (entries.length === 0 && countActiveApiKeys() === 0) {
    entries = legacyMcpApiKeyEntries(env.MCP_API_KEY);
    usedLegacyMcpApiKey = entries.length > 0;
  }

  let inserted = 0;
  let skipped = 0;
  for (const entry of entries) {
    const result = bootstrapApiKey(entry);
    if (result.inserted) inserted += 1;
    else skipped += 1;
  }

  return {
    inserted,
    skipped,
    activeKeys: countActiveApiKeys(),
    usedLegacyMcpApiKey,
  };
}

export function ensureAuthConfigured(result: BootstrapResult): void {
  if (result.activeKeys === 0) {
    console.error(
      "FATAL: No active API keys in the database. Set DAILY_LOG_MCP_KEY_ARIFIN / DAILY_LOG_MCP_KEY_DORI / DAILY_LOG_MCP_KEY_DOCUMIND_DEVOPS, or MCP_BOOTSTRAP_KEYS (key|nama|role|admin), or MCP_API_KEY for legacy single-user bootstrap. Then restart (or use the CLI to create keys).",
    );
    process.exit(1);
  }
  if (result.usedLegacyMcpApiKey) {
    console.warn(
      "WARN: Bootstrapped keys from MCP_API_KEY as Arifin/Backend (non-admin). Prefer named DAILY_LOG_MCP_KEY_* or MCP_BOOTSTRAP_KEYS so the Dori sync key is admin.",
    );
  }
  if (result.inserted > 0) {
    console.log(
      `Bootstrap: stored ${result.inserted} new API key hash(es) (${result.skipped} already present). Active keys: ${result.activeKeys}.`,
    );
  }
}
