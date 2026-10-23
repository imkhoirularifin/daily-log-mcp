import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addTask,
  addTasks,
  closeDb,
  deleteTask,
  initDb,
  listTasks,
  markSynced,
  updateTask,
} from "../src/db.js";
import { ValidationError } from "../src/validation.js";
import { makeArifin, makeUser } from "./helpers.js";

describe("task inbox + sync flow", () => {
  beforeEach(() => {
    initDb(":memory:");
  });

  afterEach(() => {
    closeDb();
  });

  it("adds a task with derived beban_kerja and sheet fields from user", () => {
    const { actor } = makeArifin();
    const { task, duplicateWarning } = addTask(
      {
        tanggal: "2026-10-23",
        task: "Fix auth middleware",
        tingkat_kesulitan: "Sedang",
        sumber: "Cursor",
      },
      actor,
    );

    expect(duplicateWarning).toBeUndefined();
    expect(task.beban_kerja).toBe(3);
    expect(task.progress).toBe(100);
    expect(task.status).toBe("Done");
    expect(task.tiket_url).toBe("-");
    expect(task.blocker).toBe("-");
    expect(task.synced).toBe(false);
    expect(task.tanggal).toBe("23/10/2026");
    expect(task.nama_anggota).toBe("Arifin");
    expect(task.role).toBe("Backend");
    expect(task.yesterday).toBe("-");
    expect(task.user_id).toBe(actor.id);
  });

  it("warns on likely duplicates but still inserts", () => {
    const { actor } = makeArifin();
    addTask(
      {
        tanggal: "2026-10-23",
        task: "Same work",
        tingkat_kesulitan: "Mudah",
        sumber: "Claude",
      },
      actor,
    );
    const second = addTask(
      {
        tanggal: "2026-10-23",
        task: "Same work",
        tingkat_kesulitan: "Sulit",
        sumber: "Cursor",
      },
      actor,
    );
    expect(second.duplicateWarning).toMatch(/duplikat/i);
    expect(listTasks({}, actor).length).toBe(2);
  });

  it("lists with filters and supports full sync flow (admin)", () => {
    const { actor } = makeArifin();
    const { actor: admin } = makeUser({
      nama: "Dori",
      role: "Sync",
      isAdmin: true,
    });

    const a = addTask(
      {
        tanggal: "2026-09-17",
        task: "Bootstrap MCP",
        tingkat_kesulitan: "Sangat Mudah",
        sumber: "Cursor",
      },
      actor,
    ).task;
    const b = addTask(
      {
        tanggal: "2026-10-01",
        task: "Wire sheets",
        tingkat_kesulitan: "Sulit",
        sumber: "Claude",
      },
      actor,
    ).task;
    addTask(
      {
        tanggal: "2026-10-02",
        task: "Other AI",
        tingkat_kesulitan: "Mudah",
        sumber: "ChatGPT",
      },
      actor,
    );

    expect(listTasks({ synced: false }, admin).length).toBe(3);
    expect(listTasks({ sumber: "Claude" }, admin).map((t) => t.id)).toEqual([
      b.id,
    ]);
    expect(
      listTasks({ from: "2026-10-01", to: "2026-10-01" }, admin).map((t) => t.id),
    ).toEqual([b.id]);

    const pending = listTasks({ synced: false }, admin);
    const ids = pending.map((t) => t.id);
    const synced = markSynced(ids, admin);
    expect(synced.notFound).toEqual([]);
    expect(synced.updated.every((t) => t.synced)).toBe(true);
    expect(listTasks({ synced: false }, admin).length).toBe(0);
    expect(listTasks({ synced: true }, admin).length).toBe(3);

    expect(() => updateTask(a.id, { task: "nope" }, actor)).toThrow(
      ValidationError,
    );
    expect(() => deleteTask(a.id, actor)).toThrow(ValidationError);

    const again = markSynced([a.id], admin);
    expect(again.alreadySynced).toContain(a.id);
  });

  it("allows update/delete only while unsynced", () => {
    const { actor } = makeArifin();
    const { task } = addTask(
      {
        tanggal: "2026-10-23",
        task: "Draft",
        tingkat_kesulitan: "Mudah",
        sumber: "Cursor",
      },
      actor,
    );
    const updated = updateTask(
      task.id,
      {
        tingkat_kesulitan: "Sangat Sulit",
        progress: 50,
        status: "In Progress",
      },
      actor,
    );
    expect(updated.beban_kerja).toBe(5);
    expect(updated.progress).toBe(50);
    expect(updated.status).toBe("In Progress");

    expect(deleteTask(task.id, actor)).toEqual({ id: task.id, deleted: true });
    expect(listTasks({}, actor).length).toBe(0);
  });

  it("bulk add enforces max 50", () => {
    const { actor } = makeArifin();
    expect(() =>
      addTasks(
        Array.from({ length: 51 }, (_, i) => ({
          tanggal: "2026-10-23",
          task: `Task ${i}`,
          tingkat_kesulitan: "Mudah" as const,
          sumber: "Cursor",
        })),
        actor,
      ),
    ).toThrow(/50/);
  });
});
