import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  namedBootstrapEntries,
  parseBootstrapKeys,
  runBootstrap,
} from "../src/bootstrap.js";
import {
  addTask,
  closeDb,
  deleteTask,
  getDb,
  initDb,
  listTasks,
  markSynced,
  migrateSchema,
  updateTask,
} from "../src/db.js";
import { hashApiKey } from "../src/keys.js";
import {
  createApiKey,
  createUser,
  resolveAuthUser,
} from "../src/users.js";
import { ValidationError } from "../src/validation.js";
import { makeArifin, makeUser } from "./helpers.js";

describe("multi-user isolation + admin", () => {
  beforeEach(() => {
    initDb(":memory:");
  });
  afterEach(() => {
    closeDb();
  });

  it("attributes tasks to the key owner (nama/role), not caller input", () => {
    const { actor } = makeUser({ nama: "Alza", role: "Frontend" });
    const { task } = addTask(
      {
        tanggal: "2026-10-23",
        task: "UI polish",
        tingkat_kesulitan: "Mudah",
        sumber: "Cursor",
      },
      actor,
    );
    expect(task.nama_anggota).toBe("Alza");
    expect(task.role).toBe("Frontend");
    expect(task.user_id).toBe(actor.id);
  });

  it("isolates list/update/delete between non-admin users", () => {
    const arifin = makeArifin();
    const alza = makeUser({ nama: "Alza", role: "Frontend" });

    const aTask = addTask(
      {
        tanggal: "2026-10-23",
        task: "Backend work",
        tingkat_kesulitan: "Sedang",
        sumber: "Cursor",
      },
      arifin.actor,
    ).task;
    const zTask = addTask(
      {
        tanggal: "2026-10-23",
        task: "Frontend work",
        tingkat_kesulitan: "Mudah",
        sumber: "Claude",
      },
      alza.actor,
    ).task;

    expect(listTasks({}, arifin.actor).map((t) => t.id)).toEqual([aTask.id]);
    expect(listTasks({}, alza.actor).map((t) => t.id)).toEqual([zTask.id]);

    expect(() => updateTask(aTask.id, { task: "hacked" }, alza.actor)).toThrow(
      ValidationError,
    );
    expect(() => deleteTask(aTask.id, alza.actor)).toThrow(ValidationError);

    // Owner can still update
    const updated = updateTask(zTask.id, { progress: 40 }, alza.actor);
    expect(updated.progress).toBe(40);
  });

  it("admin lists across users and can filter by nama_anggota", () => {
    const arifin = makeArifin();
    const alza = makeUser({ nama: "Alza", role: "Frontend" });
    const dori = makeUser({ nama: "Dori", role: "Sync", isAdmin: true });

    addTask(
      {
        tanggal: "2026-10-23",
        task: "A",
        tingkat_kesulitan: "Mudah",
        sumber: "Cursor",
      },
      arifin.actor,
    );
    addTask(
      {
        tanggal: "2026-10-23",
        task: "B",
        tingkat_kesulitan: "Mudah",
        sumber: "Cursor",
      },
      alza.actor,
    );

    const all = listTasks({ synced: false }, dori.actor);
    expect(all.length).toBe(2);
    expect(all.map((t) => t.nama_anggota).sort()).toEqual(["Alza", "Arifin"]);
    expect(all.every((t) => typeof t.role === "string")).toBe(true);

    const onlyAlza = listTasks({ nama_anggota: "Alza" }, dori.actor);
    expect(onlyAlza.length).toBe(1);
    expect(onlyAlza[0]!.nama_anggota).toBe("Alza");
  });

  it("blocks non-admin from mark_synced", () => {
    const { actor } = makeArifin();
    const { task } = addTask(
      {
        tanggal: "2026-10-23",
        task: "Work",
        tingkat_kesulitan: "Mudah",
        sumber: "Cursor",
      },
      actor,
    );
    expect(() => markSynced([task.id], actor)).toThrow(/admin/i);
  });
});

describe("legacy task migration → Arifin", () => {
  afterEach(() => {
    closeDb();
  });

  it("backfills existing tasks without user_id to Arifin/Backend", () => {
    // Simulate a pre-multi-user DB: create tasks table only, insert a row, then remigrate.
    initDb(":memory:");
    const database = getDb();

    // Insert a legacy-shaped row by clearing user_id after migration created Arifin.
    const legacyId = "legacy-task-1";
    const ts = new Date().toISOString();
    database
      .prepare(
        `INSERT INTO tasks (
          id, user_id, tanggal, task, tingkat_kesulitan, beban_kerja, progress, status,
          tiket_url, blocker, sumber, synced, synced_at, created_at, updated_at
        ) VALUES (?, NULL, ?, ?, ?, ?, 100, 'Done', '-', '-', ?, 0, NULL, ?, ?)`,
      )
      .run(
        legacyId,
        "2026-10-01",
        "Old task",
        "Sedang",
        3,
        "Cursor",
        ts,
        ts,
      );

    migrateSchema(database);

    const row = database
      .prepare(
        `SELECT t.*, u.nama, u.role FROM tasks t JOIN users u ON u.id = t.user_id WHERE t.id = ?`,
      )
      .get(legacyId) as { nama: string; role: string; user_id: string };
    expect(row.nama).toBe("Arifin");
    expect(row.role).toBe("Backend");
    expect(row.user_id).toBeTruthy();
  });
});

describe("bootstrap keys (backward compatible)", () => {
  beforeEach(() => {
    initDb(":memory:");
  });
  afterEach(() => {
    closeDb();
    delete process.env.DAILY_LOG_MCP_KEY_ARIFIN;
    delete process.env.DAILY_LOG_MCP_KEY_DORI;
    delete process.env.DAILY_LOG_MCP_KEY_DOCUMIND_DEVOPS;
    delete process.env.MCP_BOOTSTRAP_KEYS;
    delete process.env.MCP_API_KEY;
  });

  it("parses MCP_BOOTSTRAP_KEYS without exposing secrets in errors for shape", () => {
    const entries = parseBootstrapKeys(
      "secret-a|Arifin|Backend|0,secret-b|Dori|Sync|1",
    );
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      nama: "Arifin",
      role: "Backend",
      isAdmin: false,
    });
    expect(entries[1]).toMatchObject({
      nama: "Dori",
      role: "Sync",
      isAdmin: true,
    });
  });

  it("maps named ops env keys to Arifin / Dori admin / DevOps admin", () => {
    const entries = namedBootstrapEntries({
      DAILY_LOG_MCP_KEY_ARIFIN: "k-arifin",
      DAILY_LOG_MCP_KEY_DORI: "k-dori",
      DAILY_LOG_MCP_KEY_DOCUMIND_DEVOPS: "k-ops",
    } as NodeJS.ProcessEnv);
    expect(entries.map((e) => e.nama)).toEqual(["Arifin", "Dori", "DevOps"]);
    expect(entries.map((e) => e.isAdmin)).toEqual([false, true, true]);
  });

  it("bootstraps hashed keys idempotently and keeps existing tokens working", () => {
    process.env.DAILY_LOG_MCP_KEY_ARIFIN = "deployed-arifin-token";
    process.env.DAILY_LOG_MCP_KEY_DORI = "deployed-dori-token";
    process.env.DAILY_LOG_MCP_KEY_DOCUMIND_DEVOPS = "deployed-ops-token";

    const first = runBootstrap();
    expect(first.inserted).toBe(3);
    expect(first.activeKeys).toBe(3);

    const second = runBootstrap();
    expect(second.inserted).toBe(0);
    expect(second.skipped).toBe(3);

    const arifin = resolveAuthUser("deployed-arifin-token");
    const dori = resolveAuthUser("deployed-dori-token");
    const ops = resolveAuthUser("deployed-ops-token");
    expect(arifin).toMatchObject({
      nama: "Arifin",
      role: "Backend",
      isAdmin: false,
    });
    expect(dori).toMatchObject({ nama: "Dori", role: "Sync", isAdmin: true });
    expect(ops).toMatchObject({ nama: "DevOps", role: "Ops", isAdmin: true });

    // Only hashes stored
    const hashes = getDb()
      .prepare("SELECT key_hash FROM api_keys")
      .all() as Array<{ key_hash: string }>;
    expect(hashes.map((h) => h.key_hash).sort()).toEqual(
      [
        hashApiKey("deployed-arifin-token"),
        hashApiKey("deployed-dori-token"),
        hashApiKey("deployed-ops-token"),
      ].sort(),
    );
  });

  it("legacy MCP_API_KEY bootstraps as Arifin when DB empty", () => {
    process.env.MCP_API_KEY = "legacy-one,legacy-two";
    const result = runBootstrap();
    expect(result.usedLegacyMcpApiKey).toBe(true);
    expect(result.inserted).toBe(2);
    expect(resolveAuthUser("legacy-one")?.nama).toBe("Arifin");
    expect(resolveAuthUser("legacy-two")?.isAdmin).toBe(false);
  });
});

describe("Alza seed path (CLI primitives)", () => {
  beforeEach(() => initDb(":memory:"));
  afterEach(() => closeDb());

  it("can create Alza Frontend non-admin and issue a key", () => {
    const user = createUser({ nama: "Alza", role: "Frontend", isAdmin: false });
    expect(user.is_admin).toBe(0);
    const { rawKey } = createApiKey({
      userId: user.id,
      label: "alza-claude",
    });
    const auth = resolveAuthUser(rawKey);
    expect(auth).toMatchObject({
      nama: "Alza",
      role: "Frontend",
      isAdmin: false,
    });
  });
});
