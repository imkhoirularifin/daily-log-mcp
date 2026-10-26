import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addTask,
  closeDb,
  deleteUnsyncedTasks,
  initDb,
  listTasks,
  markSynced,
} from "../src/db.js";
import { getGuidelinesText } from "../src/guidelines.js";
import { ValidationError } from "../src/validation.js";
import { makeArifin, makeUser } from "./helpers.js";

describe("delete_unsynced_tasks", () => {
  beforeEach(() => {
    initDb(":memory:");
  });

  afterEach(() => {
    closeDb();
  });

  it("rejects calls with no filter (no wipe-all)", () => {
    const { actor } = makeArifin();
    expect(() => deleteUnsyncedTasks({}, actor)).toThrow(/filter/i);
    expect(() => deleteUnsyncedTasks({ dry_run: true }, actor)).toThrow(
      /filter/i,
    );
  });

  it("deletes eligible unsynced by ids and refuses synced ones (partial)", () => {
    const { actor } = makeArifin();
    const { actor: admin } = makeUser({
      nama: "Dori",
      role: "Sync",
      isAdmin: true,
    });

    const keepSynced = addTask(
      {
        tanggal: "2026-10-23",
        task: "Already on sheet",
        tingkat_kesulitan: "Mudah",
        sumber: "Cursor",
      },
      actor,
    ).task;
    const dropA = addTask(
      {
        tanggal: "2026-10-23",
        task: "Mistake A",
        tingkat_kesulitan: "Mudah",
        sumber: "Cursor",
      },
      actor,
    ).task;
    const dropB = addTask(
      {
        tanggal: "2026-10-24",
        task: "Mistake B",
        tingkat_kesulitan: "Sedang",
        sumber: "Cursor",
      },
      actor,
    ).task;

    markSynced([keepSynced.id], admin);

    const result = deleteUnsyncedTasks(
      { ids: [keepSynced.id, dropA.id, dropB.id, "missing-id"] },
      actor,
    );

    expect(result.dry_run).toBe(false);
    expect(result.deleted_count).toBe(2);
    expect(result.deleted.map((t) => t.id).sort()).toEqual(
      [dropA.id, dropB.id].sort(),
    );
    expect(result.refused).toEqual(
      expect.arrayContaining([
        {
          id: keepSynced.id,
          reason: expect.stringMatching(/sudah di-sync/i),
        },
        {
          id: "missing-id",
          reason: expect.stringMatching(/tidak ditemukan/i),
        },
      ]),
    );
    expect(listTasks({}, actor).map((t) => t.id)).toEqual([keepSynced.id]);
  });

  it("dry_run previews without deleting", () => {
    const { actor } = makeArifin();
    const { task } = addTask(
      {
        tanggal: "2026-10-23",
        task: "Preview me",
        tingkat_kesulitan: "Mudah",
        sumber: "Claude",
      },
      actor,
    );

    const preview = deleteUnsyncedTasks(
      { sumber: "Claude", dry_run: true },
      actor,
    );
    expect(preview.dry_run).toBe(true);
    expect(preview.deleted_count).toBe(1);
    expect(preview.deleted[0]!.id).toBe(task.id);
    expect(listTasks({}, actor).length).toBe(1);

    const real = deleteUnsyncedTasks({ sumber: "Claude" }, actor);
    expect(real.dry_run).toBe(false);
    expect(real.deleted_count).toBe(1);
    expect(listTasks({}, actor).length).toBe(0);
  });

  it("filters by from/to like list_tasks and skips synced matches as refused", () => {
    const { actor } = makeArifin();
    const { actor: admin } = makeUser({
      nama: "Dori",
      role: "Sync",
      isAdmin: true,
    });

    const early = addTask(
      {
        tanggal: "2026-09-17",
        task: "Early",
        tingkat_kesulitan: "Mudah",
        sumber: "Cursor",
      },
      actor,
    ).task;
    const mid = addTask(
      {
        tanggal: "2026-10-01",
        task: "Mid unsynced",
        tingkat_kesulitan: "Mudah",
        sumber: "Cursor",
      },
      actor,
    ).task;
    const midSynced = addTask(
      {
        tanggal: "2026-10-01",
        task: "Mid synced",
        tingkat_kesulitan: "Mudah",
        sumber: "Cursor",
      },
      actor,
    ).task;
    markSynced([midSynced.id], admin);

    const result = deleteUnsyncedTasks(
      { from: "2026-10-01", to: "2026-10-01" },
      actor,
    );
    expect(result.deleted.map((t) => t.id)).toEqual([mid.id]);
    expect(result.refused).toEqual([
      {
        id: midSynced.id,
        reason: expect.stringMatching(/sudah di-sync/i),
      },
    ]);
    expect(listTasks({}, actor).map((t) => t.id).sort()).toEqual(
      [early.id, midSynced.id].sort(),
    );
  });

  it("non-admin cannot delete another user's tasks; admin can", () => {
    const arifin = makeArifin();
    const alza = makeUser({ nama: "Alza", role: "Frontend" });
    const dori = makeUser({ nama: "Dori", role: "Sync", isAdmin: true });

    const aTask = addTask(
      {
        tanggal: "2026-10-23",
        task: "Backend",
        tingkat_kesulitan: "Sedang",
        sumber: "Cursor",
      },
      arifin.actor,
    ).task;
    const zTask = addTask(
      {
        tanggal: "2026-10-23",
        task: "Frontend",
        tingkat_kesulitan: "Mudah",
        sumber: "Claude",
      },
      alza.actor,
    ).task;

    const stolen = deleteUnsyncedTasks({ ids: [aTask.id] }, alza.actor);
    expect(stolen.deleted_count).toBe(0);
    expect(stolen.refused[0]).toMatchObject({
      id: aTask.id,
      reason: expect.stringMatching(/bukan milik Anda/i),
    });
    expect(listTasks({}, arifin.actor).length).toBe(1);

    expect(() =>
      deleteUnsyncedTasks({ nama_anggota: "Arifin" }, alza.actor),
    ).toThrow(/admin/i);

    const asAdmin = deleteUnsyncedTasks(
      { nama_anggota: "Arifin", sumber: "Cursor" },
      dori.actor,
    );
    expect(asAdmin.deleted.map((t) => t.id)).toEqual([aTask.id]);
    expect(listTasks({}, alza.actor).map((t) => t.id)).toEqual([zTask.id]);
  });

  it("documents the tool in get_guidelines", () => {
    expect(getGuidelinesText()).toMatch(/delete_unsynced_tasks/);
    expect(getGuidelinesText()).toMatch(/dry_run/);
  });
});
