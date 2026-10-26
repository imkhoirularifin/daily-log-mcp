import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import {
  FIXED_YESTERDAY,
  LEGACY_DEFAULT_USER,
  type AddTaskInput,
  type AuthUser,
  type Difficulty,
  type TaskOutput,
  type TaskRow,
  type TaskStatus,
} from "./types.js";
import { mapWorkload, toDisplayDate, ValidationError } from "./validation.js";

export interface ListFilters {
  from?: string; // ISO
  to?: string; // ISO
  synced?: boolean;
  sumber?: string;
  /** Admin-only: filter by user nama (case-insensitive). */
  nama_anggota?: string;
  /** Admin-only: filter by user id. */
  user_id?: string;
}

export interface AddResult {
  task: TaskOutput;
  duplicateWarning?: string;
}

let db: DatabaseSync | null = null;

const BASE_TASKS_SQL = `
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY NOT NULL,
  tanggal TEXT NOT NULL,
  task TEXT NOT NULL,
  tingkat_kesulitan TEXT NOT NULL,
  beban_kerja INTEGER NOT NULL,
  progress INTEGER NOT NULL DEFAULT 100,
  status TEXT NOT NULL DEFAULT 'Done',
  tiket_url TEXT NOT NULL DEFAULT '-',
  blocker TEXT NOT NULL DEFAULT '-',
  sumber TEXT NOT NULL,
  synced INTEGER NOT NULL DEFAULT 0,
  synced_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tasks_tanggal ON tasks(tanggal);
CREATE INDEX IF NOT EXISTS idx_tasks_synced ON tasks(synced);
CREATE INDEX IF NOT EXISTS idx_tasks_sumber ON tasks(sumber);
CREATE INDEX IF NOT EXISTS idx_tasks_tanggal_task ON tasks(tanggal, task);
`;

const USERS_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY NOT NULL,
  nama TEXT NOT NULL UNIQUE COLLATE NOCASE,
  role TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  key_hash TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revoked_at TEXT,
  last_used_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash ON api_keys(key_hash);
`;

function tableColumns(database: DatabaseSync, table: string): Set<string> {
  const rows = database
    .prepare(`PRAGMA table_info(${table})`)
    .all() as unknown as Array<{ name: string }>;
  return new Set(rows.map((r) => r.name));
}

function nowIso(): string {
  return new Date().toISOString();
}

/** Ensure legacy Arifin user exists; return its id. Idempotent. */
export function ensureLegacyDefaultUserId(database: DatabaseSync): string {
  const existing = database
    .prepare("SELECT id FROM users WHERE lower(nama) = lower(?) LIMIT 1")
    .get(LEGACY_DEFAULT_USER.nama) as { id: string } | undefined;
  if (existing) return existing.id;

  const id = randomUUID();
  database
    .prepare(
      `INSERT INTO users (id, nama, role, is_admin, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      LEGACY_DEFAULT_USER.nama,
      LEGACY_DEFAULT_USER.role,
      LEGACY_DEFAULT_USER.isAdmin ? 1 : 0,
      nowIso(),
    );
  return id;
}

/**
 * Idempotent schema migrations:
 * - users + api_keys tables
 * - tasks.user_id column + backfill to Arifin
 */
export function migrateSchema(database: DatabaseSync): void {
  database.exec(BASE_TASKS_SQL);
  database.exec(USERS_SQL);

  const cols = tableColumns(database, "tasks");
  if (!cols.has("user_id")) {
    database.exec("ALTER TABLE tasks ADD COLUMN user_id TEXT");
  }

  const arifinId = ensureLegacyDefaultUserId(database);
  database
    .prepare("UPDATE tasks SET user_id = ? WHERE user_id IS NULL OR user_id = ''")
    .run(arifinId);

  database.exec(
    "CREATE INDEX IF NOT EXISTS idx_tasks_user_id ON tasks(user_id)",
  );
}

export function getDatabasePath(): string {
  return process.env.DATABASE_PATH?.trim() || "/data/daily-log.db";
}

export function openDatabase(path = getDatabasePath()): DatabaseSync {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }
  const database = new DatabaseSync(path);
  database.exec("PRAGMA journal_mode = WAL;");
  database.exec("PRAGMA foreign_keys = ON;");
  migrateSchema(database);
  return database;
}

export function initDb(path = getDatabasePath()): DatabaseSync {
  if (db) {
    db.close();
    db = null;
  }
  db = openDatabase(path);
  return db;
}

export function getDb(): DatabaseSync {
  if (!db) {
    throw new Error("Database belum diinisialisasi. Panggil initDb() dulu.");
  }
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

type TaskJoinRow = TaskRow & { nama_anggota: string; user_role: string };

function rowToOutput(row: TaskJoinRow): TaskOutput {
  return {
    id: row.id,
    user_id: row.user_id,
    tanggal: toDisplayDate(row.tanggal),
    task: row.task,
    tingkat_kesulitan: row.tingkat_kesulitan,
    beban_kerja: row.beban_kerja,
    progress: row.progress,
    status: row.status,
    tiket_url: row.tiket_url,
    blocker: row.blocker,
    sumber: row.sumber,
    synced: row.synced === 1,
    synced_at: row.synced_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    nama_anggota: row.nama_anggota,
    role: row.user_role,
    yesterday: FIXED_YESTERDAY,
  };
}

const TASK_SELECT = `
  SELECT t.*, u.nama AS nama_anggota, u.role AS user_role
  FROM tasks t
  JOIN users u ON u.id = t.user_id
`;

function getTaskById(id: string): TaskJoinRow | undefined {
  const row = getDb()
    .prepare(`${TASK_SELECT} WHERE t.id = ?`)
    .get(id);
  return row as unknown as TaskJoinRow | undefined;
}

function findDuplicate(
  userId: string,
  tanggalIso: string,
  taskText: string,
): TaskJoinRow | undefined {
  const row = getDb()
    .prepare(
      `${TASK_SELECT} WHERE t.user_id = ? AND t.tanggal = ? AND lower(t.task) = lower(?) LIMIT 1`,
    )
    .get(userId, tanggalIso, taskText);
  return row as unknown as TaskJoinRow | undefined;
}

function assertCanAccessTask(actor: AuthUser, row: TaskJoinRow): void {
  if (actor.isAdmin) return;
  if (row.user_id !== actor.id) {
    throw new ValidationError(
      `Task tidak ditemukan atau bukan milik Anda: id=${row.id}`,
    );
  }
}

export function addTask(input: AddTaskInput, actor: AuthUser): AddResult {
  const id = randomUUID();
  const ts = nowIso();
  const beban = mapWorkload(input.tingkat_kesulitan);
  const progress = input.progress ?? 100;
  const status = input.status ?? "Done";
  const tiket_url = input.tiket_url ?? "-";
  const blocker = input.blocker ?? "-";

  const dup = findDuplicate(actor.id, input.tanggal, input.task);
  const duplicateWarning = dup
    ? `Peringatan: kemungkinan duplikat — sudah ada task dengan tanggal yang sama dan teks task yang sama (id=${dup.id}). Task tetap disimpan.`
    : undefined;

  getDb()
    .prepare(
      `INSERT INTO tasks (
        id, user_id, tanggal, task, tingkat_kesulitan, beban_kerja, progress, status,
        tiket_url, blocker, sumber, synced, synced_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?)`,
    )
    .run(
      id,
      actor.id,
      input.tanggal,
      input.task,
      input.tingkat_kesulitan,
      beban,
      progress,
      status,
      tiket_url,
      blocker,
      input.sumber,
      ts,
      ts,
    );

  const row = getTaskById(id);
  if (!row) {
    throw new Error("Gagal membaca task yang baru disimpan.");
  }
  return { task: rowToOutput(row), duplicateWarning };
}

export function addTasks(
  inputs: AddTaskInput[],
  actor: AuthUser,
): {
  tasks: TaskOutput[];
  warnings: string[];
} {
  if (inputs.length === 0) {
    throw new ValidationError("Daftar tasks kosong. Kirim minimal 1 task.");
  }
  if (inputs.length > 50) {
    throw new ValidationError(
      `Maksimal 50 task per bulk (dikirim ${inputs.length}). Pecah menjadi beberapa panggilan add_tasks.`,
    );
  }

  const tasks: TaskOutput[] = [];
  const warnings: string[] = [];
  const database = getDb();
  database.exec("BEGIN");
  try {
    for (const input of inputs) {
      const result = addTask(input, actor);
      tasks.push(result.task);
      if (result.duplicateWarning) {
        warnings.push(`[${result.task.id}] ${result.duplicateWarning}`);
      }
    }
    database.exec("COMMIT");
  } catch (err) {
    database.exec("ROLLBACK");
    throw err;
  }
  return { tasks, warnings };
}

export function listTasks(
  filters: ListFilters = {},
  actor: AuthUser,
): TaskOutput[] {
  const clauses: string[] = [];
  const params: (string | number)[] = [];

  if (!actor.isAdmin) {
    clauses.push("t.user_id = ?");
    params.push(actor.id);
  } else {
    if (filters.user_id) {
      clauses.push("t.user_id = ?");
      params.push(filters.user_id);
    }
    if (filters.nama_anggota) {
      clauses.push("lower(u.nama) = lower(?)");
      params.push(filters.nama_anggota.trim());
    }
  }

  if (filters.from) {
    clauses.push("t.tanggal >= ?");
    params.push(filters.from);
  }
  if (filters.to) {
    clauses.push("t.tanggal <= ?");
    params.push(filters.to);
  }
  if (filters.synced !== undefined) {
    clauses.push("t.synced = ?");
    params.push(filters.synced ? 1 : 0);
  }
  if (filters.sumber) {
    clauses.push("t.sumber = ?");
    params.push(filters.sumber);
  }

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = getDb()
    .prepare(
      `${TASK_SELECT} ${where} ORDER BY t.tanggal ASC, t.created_at ASC`,
    )
    .all(...params) as unknown as TaskJoinRow[];

  return rows.map(rowToOutput);
}

export interface UpdateTaskPatch {
  tanggal?: string; // ISO
  task?: string;
  tingkat_kesulitan?: Difficulty;
  progress?: number;
  status?: TaskStatus;
  tiket_url?: string;
  blocker?: string;
  sumber?: string;
}

export function updateTask(
  id: string,
  patch: UpdateTaskPatch,
  actor: AuthUser,
): TaskOutput {
  const existing = getTaskById(id);
  if (!existing) {
    throw new ValidationError(`Task tidak ditemukan: id=${id}`);
  }
  assertCanAccessTask(actor, existing);
  if (existing.synced === 1) {
    throw new ValidationError(
      `Task ${id} sudah di-sync ke Google Sheets (synced_at=${existing.synced_at}). Tidak bisa diubah. Tambahkan task baru jika perlu koreksi.`,
    );
  }

  const next = {
    tanggal: patch.tanggal ?? existing.tanggal,
    task: patch.task ?? existing.task,
    tingkat_kesulitan: patch.tingkat_kesulitan ?? existing.tingkat_kesulitan,
    progress: patch.progress ?? existing.progress,
    status: patch.status ?? existing.status,
    tiket_url: patch.tiket_url ?? existing.tiket_url,
    blocker: patch.blocker ?? existing.blocker,
    sumber: patch.sumber ?? existing.sumber,
  };
  const beban = mapWorkload(next.tingkat_kesulitan);
  const ts = nowIso();

  getDb()
    .prepare(
      `UPDATE tasks SET
        tanggal = ?, task = ?, tingkat_kesulitan = ?, beban_kerja = ?,
        progress = ?, status = ?, tiket_url = ?, blocker = ?, sumber = ?,
        updated_at = ?
      WHERE id = ?`,
    )
    .run(
      next.tanggal,
      next.task,
      next.tingkat_kesulitan,
      beban,
      next.progress,
      next.status,
      next.tiket_url,
      next.blocker,
      next.sumber,
      ts,
      id,
    );

  const row = getTaskById(id);
  if (!row) {
    throw new Error("Gagal membaca task setelah update.");
  }
  return rowToOutput(row);
}

export function deleteTask(
  id: string,
  actor: AuthUser,
): { id: string; deleted: true } {
  const existing = getTaskById(id);
  if (!existing) {
    throw new ValidationError(`Task tidak ditemukan: id=${id}`);
  }
  assertCanAccessTask(actor, existing);
  if (existing.synced === 1) {
    throw new ValidationError(
      `Task ${id} sudah di-sync. Tidak bisa dihapus dari inbox.`,
    );
  }
  getDb().prepare("DELETE FROM tasks WHERE id = ?").run(id);
  return { id, deleted: true };
}

export interface DeleteUnsyncedFilters {
  /** Explicit task UUIDs to consider. */
  ids?: string[];
  from?: string; // ISO
  to?: string; // ISO
  sumber?: string;
  /** Admin-only: filter by user nama (case-insensitive). */
  nama_anggota?: string;
  /** When true, report what would happen without deleting. */
  dry_run?: boolean;
}

export interface DeleteUnsyncedRefused {
  id: string;
  reason: string;
}

export interface DeleteUnsyncedResult {
  dry_run: boolean;
  deleted_count: number;
  deleted: TaskOutput[];
  refused: DeleteUnsyncedRefused[];
}

function hasDeleteUnsyncedFilter(filters: DeleteUnsyncedFilters): boolean {
  return Boolean(
    (filters.ids && filters.ids.length > 0) ||
      filters.from ||
      filters.to ||
      filters.sumber ||
      filters.nama_anggota,
  );
}

function taskMatchesRangeAndSumber(
  row: TaskJoinRow,
  filters: DeleteUnsyncedFilters,
): boolean {
  if (filters.from && row.tanggal < filters.from) return false;
  if (filters.to && row.tanggal > filters.to) return false;
  if (filters.sumber && row.sumber !== filters.sumber) return false;
  if (
    filters.nama_anggota &&
    row.nama_anggota.toLowerCase() !== filters.nama_anggota.trim().toLowerCase()
  ) {
    return false;
  }
  return true;
}

/**
 * Bulk-delete unsynced tasks matching at least one filter.
 * Partial success: eligible (synced=false + accessible) tasks are deleted;
 * synced / missing / not-owned ids are reported in `refused` with reasons.
 * Consistent with `delete_task` messages for synced and ownership failures.
 */
export function deleteUnsyncedTasks(
  filters: DeleteUnsyncedFilters,
  actor: AuthUser,
): DeleteUnsyncedResult {
  if (!hasDeleteUnsyncedFilter(filters)) {
    throw new ValidationError(
      "Minimal satu filter wajib: ids, from, to, sumber, atau nama_anggota. Tidak boleh menghapus semua task tanpa filter.",
    );
  }
  if (filters.nama_anggota && !actor.isAdmin) {
    throw new ValidationError(
      "Filter nama_anggota hanya untuk API key admin.",
    );
  }

  const dryRun = Boolean(filters.dry_run);
  const deleted: TaskOutput[] = [];
  const refused: DeleteUnsyncedRefused[] = [];
  const seen = new Set<string>();

  const consider = (row: TaskJoinRow | undefined, idHint: string): void => {
    if (!row) {
      refused.push({
        id: idHint,
        reason: `Task tidak ditemukan: id=${idHint}`,
      });
      return;
    }
    if (seen.has(row.id)) return;
    seen.add(row.id);

    if (!actor.isAdmin && row.user_id !== actor.id) {
      refused.push({
        id: row.id,
        reason: `Task tidak ditemukan atau bukan milik Anda: id=${row.id}`,
      });
      return;
    }
    if (row.synced === 1) {
      refused.push({
        id: row.id,
        reason: `Task ${row.id} sudah di-sync. Tidak bisa dihapus dari inbox.`,
      });
      return;
    }

    deleted.push(rowToOutput(row));
  };

  if (filters.ids && filters.ids.length > 0) {
    const uniqueIds = [
      ...new Set(filters.ids.map((i) => i.trim()).filter(Boolean)),
    ];
    if (!uniqueIds.length) {
      throw new ValidationError(
        "ids wajib berisi minimal 1 UUID non-kosong jika dikirim.",
      );
    }
    for (const id of uniqueIds) {
      const row = getTaskById(id);
      if (row && !taskMatchesRangeAndSumber(row, filters)) {
        refused.push({
          id,
          reason: `Task ${id} tidak cocok dengan filter from/to/sumber/nama_anggota yang dikirim.`,
        });
        continue;
      }
      consider(row, id);
    }
  } else {
    // Same scoping/filter semantics as list_tasks (without synced filter),
    // then refuse any synced matches so callers see why they were skipped.
    const listed = listTasks(
      {
        from: filters.from,
        to: filters.to,
        sumber: filters.sumber,
        nama_anggota: filters.nama_anggota,
      },
      actor,
    );
    for (const task of listed) {
      const row = getTaskById(task.id);
      consider(row, task.id);
    }
  }

  if (!dryRun && deleted.length > 0) {
    const database = getDb();
    database.exec("BEGIN");
    try {
      const stmt = database.prepare("DELETE FROM tasks WHERE id = ?");
      for (const task of deleted) {
        stmt.run(task.id);
      }
      database.exec("COMMIT");
    } catch (err) {
      database.exec("ROLLBACK");
      throw err;
    }
  }

  return {
    dry_run: dryRun,
    deleted_count: deleted.length,
    deleted,
    refused,
  };
}

export function markSynced(
  ids: string[],
  actor: AuthUser,
): {
  updated: TaskOutput[];
  notFound: string[];
  alreadySynced: string[];
} {
  if (!actor.isAdmin) {
    throw new ValidationError(
      "mark_synced hanya boleh dipanggil dengan API key admin (sheet-sync).",
    );
  }
  if (!ids.length) {
    throw new ValidationError("ids wajib diisi (minimal 1 id).");
  }
  const unique = [...new Set(ids.map((i) => i.trim()).filter(Boolean))];
  if (!unique.length) {
    throw new ValidationError("ids wajib diisi (minimal 1 id).");
  }

  const updated: TaskOutput[] = [];
  const notFound: string[] = [];
  const alreadySynced: string[] = [];
  const ts = nowIso();
  const database = getDb();

  database.exec("BEGIN");
  try {
    for (const id of unique) {
      const existing = getTaskById(id);
      if (!existing) {
        notFound.push(id);
        continue;
      }
      if (existing.synced === 1) {
        alreadySynced.push(id);
        updated.push(rowToOutput(existing));
        continue;
      }
      database
        .prepare(
          `UPDATE tasks SET synced = 1, synced_at = ?, updated_at = ? WHERE id = ?`,
        )
        .run(ts, ts, id);
      const row = getTaskById(id);
      if (row) updated.push(rowToOutput(row));
    }
    database.exec("COMMIT");
  } catch (err) {
    database.exec("ROLLBACK");
    throw err;
  }

  return { updated, notFound, alreadySynced };
}
