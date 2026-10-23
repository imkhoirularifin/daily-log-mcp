import { randomUUID } from "node:crypto";
import { getDb } from "./db.js";
import { generateApiKey, hashApiKey } from "./keys.js";
import type { ApiKeyRow, AuthUser, UserRow } from "./types.js";
import { ValidationError } from "./validation.js";

function nowIso(): string {
  return new Date().toISOString();
}

export function listUsers(): Array<{
  id: string;
  nama: string;
  role: string;
  isAdmin: boolean;
  created_at: string;
}> {
  const rows = getDb()
    .prepare("SELECT * FROM users ORDER BY nama COLLATE NOCASE ASC")
    .all() as unknown as UserRow[];
  return rows.map((r) => ({
    id: r.id,
    nama: r.nama,
    role: r.role,
    isAdmin: r.is_admin === 1,
    created_at: r.created_at,
  }));
}

export function findUserByNama(nama: string): UserRow | undefined {
  const row = getDb()
    .prepare("SELECT * FROM users WHERE lower(nama) = lower(?) LIMIT 1")
    .get(nama.trim());
  return row as unknown as UserRow | undefined;
}

export function findUserById(id: string): UserRow | undefined {
  const row = getDb().prepare("SELECT * FROM users WHERE id = ?").get(id);
  return row as unknown as UserRow | undefined;
}

export function ensureUser(opts: {
  nama: string;
  role: string;
  isAdmin?: boolean;
}): UserRow {
  const nama = opts.nama.trim();
  const role = opts.role.trim();
  if (!nama) throw new ValidationError("nama wajib diisi.");
  if (!role) throw new ValidationError("role wajib diisi.");

  const existing = findUserByNama(nama);
  if (existing) {
    // Keep existing admin/role unless caller is creating a brand-new user.
    return existing;
  }

  const id = randomUUID();
  const ts = nowIso();
  getDb()
    .prepare(
      `INSERT INTO users (id, nama, role, is_admin, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(id, nama, role, opts.isAdmin ? 1 : 0, ts);

  const row = findUserById(id);
  if (!row) throw new Error("Gagal membaca user yang baru dibuat.");
  return row;
}

export function createUser(opts: {
  nama: string;
  role: string;
  isAdmin?: boolean;
}): UserRow {
  const nama = opts.nama.trim();
  const role = opts.role.trim();
  if (!nama) throw new ValidationError("nama wajib diisi.");
  if (!role) throw new ValidationError("role wajib diisi.");

  if (findUserByNama(nama)) {
    throw new ValidationError(`User dengan nama "${nama}" sudah ada.`);
  }

  const id = randomUUID();
  const ts = nowIso();
  getDb()
    .prepare(
      `INSERT INTO users (id, nama, role, is_admin, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(id, nama, role, opts.isAdmin ? 1 : 0, ts);

  const row = findUserById(id);
  if (!row) throw new Error("Gagal membaca user yang baru dibuat.");
  return row;
}

export function createApiKey(opts: {
  userId: string;
  label: string;
  rawKey?: string;
}): { key: ApiKeyRow; rawKey: string } {
  const label = opts.label.trim();
  if (!label) throw new ValidationError("label wajib diisi.");

  const user = findUserById(opts.userId);
  if (!user) throw new ValidationError(`User tidak ditemukan: id=${opts.userId}`);

  const rawKey = opts.rawKey ?? generateApiKey();
  const keyHash = hashApiKey(rawKey);
  const existing = getDb()
    .prepare("SELECT id FROM api_keys WHERE key_hash = ?")
    .get(keyHash);
  if (existing) {
    throw new ValidationError("API key hash sudah ada (duplikat).");
  }

  const id = randomUUID();
  const ts = nowIso();
  getDb()
    .prepare(
      `INSERT INTO api_keys (id, user_id, key_hash, label, created_at, revoked_at, last_used_at)
       VALUES (?, ?, ?, ?, ?, NULL, NULL)`,
    )
    .run(id, opts.userId, keyHash, label, ts);

  const row = getDb()
    .prepare("SELECT * FROM api_keys WHERE id = ?")
    .get(id) as unknown as ApiKeyRow | undefined;
  if (!row) throw new Error("Gagal membaca API key yang baru dibuat.");
  return { key: row, rawKey };
}

/** Idempotent: insert key hash if missing; ensure user exists. Returns whether a new key row was inserted. */
export function bootstrapApiKey(opts: {
  rawKey: string;
  nama: string;
  role: string;
  isAdmin: boolean;
  label: string;
}): { inserted: boolean; user: UserRow } {
  const rawKey = opts.rawKey.trim();
  if (!rawKey) {
    throw new ValidationError("bootstrap key kosong.");
  }
  const keyHash = hashApiKey(rawKey);
  const existingKey = getDb()
    .prepare("SELECT * FROM api_keys WHERE key_hash = ?")
    .get(keyHash) as unknown as ApiKeyRow | undefined;

  if (existingKey) {
    const user = findUserById(existingKey.user_id);
    if (!user) throw new Error("API key merujuk user yang tidak ada.");
    return { inserted: false, user };
  }

  let user = findUserByNama(opts.nama);
  if (!user) {
    user = ensureUser({
      nama: opts.nama,
      role: opts.role,
      isAdmin: opts.isAdmin,
    });
  } else if (opts.isAdmin && user.is_admin !== 1) {
    // Promote to admin if bootstrap says admin (idempotent upgrade for sync keys).
    getDb()
      .prepare("UPDATE users SET is_admin = 1 WHERE id = ?")
      .run(user.id);
    user = findUserById(user.id)!;
  }

  createApiKey({
    userId: user.id,
    label: opts.label,
    rawKey,
  });
  return { inserted: true, user };
}

export function revokeApiKey(keyId: string): ApiKeyRow {
  const row = getDb()
    .prepare("SELECT * FROM api_keys WHERE id = ?")
    .get(keyId) as unknown as ApiKeyRow | undefined;
  if (!row) throw new ValidationError(`API key tidak ditemukan: id=${keyId}`);
  if (row.revoked_at) return row;

  const ts = nowIso();
  getDb()
    .prepare("UPDATE api_keys SET revoked_at = ? WHERE id = ?")
    .run(ts, keyId);
  const updated = getDb()
    .prepare("SELECT * FROM api_keys WHERE id = ?")
    .get(keyId) as unknown as ApiKeyRow;
  return updated;
}

export function listApiKeys(userId?: string): Array<{
  id: string;
  user_id: string;
  user_nama: string;
  label: string;
  created_at: string;
  revoked_at: string | null;
  last_used_at: string | null;
  active: boolean;
}> {
  const sql = userId
    ? `SELECT k.*, u.nama AS user_nama FROM api_keys k
       JOIN users u ON u.id = k.user_id
       WHERE k.user_id = ?
       ORDER BY k.created_at ASC`
    : `SELECT k.*, u.nama AS user_nama FROM api_keys k
       JOIN users u ON u.id = k.user_id
       ORDER BY u.nama COLLATE NOCASE ASC, k.created_at ASC`;
  const rows = (
    userId ? getDb().prepare(sql).all(userId) : getDb().prepare(sql).all()
  ) as unknown as Array<ApiKeyRow & { user_nama: string }>;

  return rows.map((r) => ({
    id: r.id,
    user_id: r.user_id,
    user_nama: r.user_nama,
    label: r.label,
    created_at: r.created_at,
    revoked_at: r.revoked_at,
    last_used_at: r.last_used_at,
    active: !r.revoked_at,
  }));
}

export function countActiveApiKeys(): number {
  const row = getDb()
    .prepare("SELECT COUNT(*) AS c FROM api_keys WHERE revoked_at IS NULL")
    .get() as { c: number };
  return Number(row.c);
}

/**
 * Resolve Bearer token → AuthUser. Updates last_used_at.
 * Returns null if unknown or revoked.
 */
export function resolveAuthUser(rawKey: string): AuthUser | null {
  if (!rawKey) return null;
  const keyHash = hashApiKey(rawKey);
  const row = getDb()
    .prepare(
      `SELECT k.id AS key_id, k.revoked_at, u.id AS user_id, u.nama, u.role, u.is_admin
       FROM api_keys k
       JOIN users u ON u.id = k.user_id
       WHERE k.key_hash = ?
       LIMIT 1`,
    )
    .get(keyHash) as
    | {
        key_id: string;
        revoked_at: string | null;
        user_id: string;
        nama: string;
        role: string;
        is_admin: number;
      }
    | undefined;

  if (!row || row.revoked_at) return null;

  // Touch last_used without failing the request if update errors.
  try {
    getDb()
      .prepare("UPDATE api_keys SET last_used_at = ? WHERE id = ?")
      .run(nowIso(), row.key_id);
  } catch {
    // ignore
  }

  return {
    id: row.user_id,
    nama: row.nama,
    role: row.role,
    isAdmin: row.is_admin === 1,
    apiKeyId: row.key_id,
  };
}
