import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import {
  FIXED_SHEET_VALUES,
  type AddTaskInput,
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
}

export interface AddResult {
  task: TaskOutput;
  duplicateWarning?: string;
}

let db: DatabaseSync | null = null;

const MIGRATION_SQL = `
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
  database.exec(MIGRATION_SQL);
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

function nowIso(): string {
  return new Date().toISOString();
}

function rowToOutput(row: TaskRow): TaskOutput {
  return {
    id: row.id,
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
    nama_anggota: FIXED_SHEET_VALUES.nama_anggota,
    role: FIXED_SHEET_VALUES.role,
    yesterday: FIXED_SHEET_VALUES.yesterday,
  };
}

function getTaskById(id: string): TaskRow | undefined {
  const row = getDb().prepare("SELECT * FROM tasks WHERE id = ?").get(id);
  return row as unknown as TaskRow | undefined;
}

function findDuplicate(tanggalIso: string, taskText: string): TaskRow | undefined {
  const row = getDb()
    .prepare(
      "SELECT * FROM tasks WHERE tanggal = ? AND lower(task) = lower(?) LIMIT 1",
    )
    .get(tanggalIso, taskText);
  return row as unknown as TaskRow | undefined;
}

export function addTask(input: AddTaskInput): AddResult {
  const id = randomUUID();
  const ts = nowIso();
  const beban = mapWorkload(input.tingkat_kesulitan);
  const progress = input.progress ?? 100;
  const status = input.status ?? "Done";
  const tiket_url = input.tiket_url ?? "-";
  const blocker = input.blocker ?? "-";

  const dup = findDuplicate(input.tanggal, input.task);
  const duplicateWarning = dup
    ? `Peringatan: kemungkinan duplikat — sudah ada task dengan tanggal yang sama dan teks task yang sama (id=${dup.id}). Task tetap disimpan.`
    : undefined;

  getDb()
    .prepare(
      `INSERT INTO tasks (
        id, tanggal, task, tingkat_kesulitan, beban_kerja, progress, status,
        tiket_url, blocker, sumber, synced, synced_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?)`,
    )
    .run(
      id,
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

export function addTasks(inputs: AddTaskInput[]): {
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
      const result = addTask(input);
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

export function listTasks(filters: ListFilters = {}): TaskOutput[] {
  const clauses: string[] = [];
  const params: (string | number)[] = [];

  if (filters.from) {
    clauses.push("tanggal >= ?");
    params.push(filters.from);
  }
  if (filters.to) {
    clauses.push("tanggal <= ?");
    params.push(filters.to);
  }
  if (filters.synced !== undefined) {
    clauses.push("synced = ?");
    params.push(filters.synced ? 1 : 0);
  }
  if (filters.sumber) {
    clauses.push("sumber = ?");
    params.push(filters.sumber);
  }

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = getDb()
    .prepare(
      `SELECT * FROM tasks ${where} ORDER BY tanggal ASC, created_at ASC`,
    )
    .all(...params) as unknown as TaskRow[];

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

export function updateTask(id: string, patch: UpdateTaskPatch): TaskOutput {
  const existing = getTaskById(id);
  if (!existing) {
    throw new ValidationError(`Task tidak ditemukan: id=${id}`);
  }
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

export function deleteTask(id: string): { id: string; deleted: true } {
  const existing = getTaskById(id);
  if (!existing) {
    throw new ValidationError(`Task tidak ditemukan: id=${id}`);
  }
  if (existing.synced === 1) {
    throw new ValidationError(
      `Task ${id} sudah di-sync. Tidak bisa dihapus dari inbox.`,
    );
  }
  getDb().prepare("DELETE FROM tasks WHERE id = ?").run(id);
  return { id, deleted: true };
}

export function markSynced(ids: string[]): {
  updated: TaskOutput[];
  notFound: string[];
  alreadySynced: string[];
} {
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
