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

describe("task inbox + sync flow", () => {
  beforeEach(() => {
    initDb(":memory:");
  });

  afterEach(() => {
    closeDb();
  });

  it("adds a task with derived beban_kerja and sheet fixed fields", () => {
    const { task, duplicateWarning } = addTask({
      tanggal: "2026-10-23",
      task: "Fix auth middleware",
      tingkat_kesulitan: "Sedang",
      sumber: "Cursor",
    });

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
  });

  it("warns on likely duplicates but still inserts", () => {
    addTask({
      tanggal: "2026-10-23",
      task: "Same work",
      tingkat_kesulitan: "Mudah",
      sumber: "Claude",
    });
    const second = addTask({
      tanggal: "2026-10-23",
      task: "Same work",
      tingkat_kesulitan: "Sulit",
      sumber: "Cursor",
    });
    expect(second.duplicateWarning).toMatch(/duplikat/i);
    expect(listTasks().length).toBe(2);
  });

  it("lists with filters and supports full sync flow", () => {
    const a = addTask({
      tanggal: "2026-09-17",
      task: "Bootstrap MCP",
      tingkat_kesulitan: "Sangat Mudah",
      sumber: "Cursor",
    }).task;
    const b = addTask({
      tanggal: "2026-10-01",
      task: "Wire sheets",
      tingkat_kesulitan: "Sulit",
      sumber: "Claude",
    }).task;
    addTask({
      tanggal: "2026-10-02",
      task: "Other AI",
      tingkat_kesulitan: "Mudah",
      sumber: "ChatGPT",
    });

    expect(listTasks({ synced: false }).length).toBe(3);
    expect(listTasks({ sumber: "Claude" }).map((t) => t.id)).toEqual([b.id]);
    expect(listTasks({ from: "2026-10-01", to: "2026-10-01" }).map((t) => t.id)).toEqual([
      b.id,
    ]);

    const pending = listTasks({ synced: false });
    const ids = pending.map((t) => t.id);
    const synced = markSynced(ids);
    expect(synced.notFound).toEqual([]);
    expect(synced.updated.every((t) => t.synced)).toBe(true);
    expect(listTasks({ synced: false }).length).toBe(0);
    expect(listTasks({ synced: true }).length).toBe(3);

    expect(() => updateTask(a.id, { task: "nope" })).toThrow(ValidationError);
    expect(() => deleteTask(a.id)).toThrow(ValidationError);

    // idempotent re-mark
    const again = markSynced([a.id]);
    expect(again.alreadySynced).toContain(a.id);
  });

  it("allows update/delete only while unsynced", () => {
    const { task } = addTask({
      tanggal: "2026-10-23",
      task: "Draft",
      tingkat_kesulitan: "Mudah",
      sumber: "Cursor",
    });
    const updated = updateTask(task.id, {
      tingkat_kesulitan: "Sangat Sulit",
      progress: 50,
      status: "In Progress",
    });
    expect(updated.beban_kerja).toBe(5);
    expect(updated.progress).toBe(50);
    expect(updated.status).toBe("In Progress");

    expect(deleteTask(task.id)).toEqual({ id: task.id, deleted: true });
    expect(listTasks().length).toBe(0);
  });

  it("bulk add enforces max 50", () => {
    expect(() =>
      addTasks(
        Array.from({ length: 51 }, (_, i) => ({
          tanggal: "2026-10-23",
          task: `Task ${i}`,
          tingkat_kesulitan: "Mudah" as const,
          sumber: "Cursor",
        })),
      ),
    ).toThrow(/50/);
  });
});
