import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  addTask,
  addTasks,
  deleteTask,
  listTasks,
  markSynced,
  updateTask,
} from "./db.js";
import { getGuidelinesText } from "./guidelines.js";
import { DIFFICULTY_LEVELS, TASK_STATUSES } from "./types.js";
import {
  optionalString,
  parseDifficulty,
  parseDisplayDate,
  parseOptionalBool,
  parseProgress,
  parseStatus,
  requireNonEmptyString,
  ValidationError,
} from "./validation.js";

function textResult(payload: unknown, isError = false) {
  return {
    content: [
      {
        type: "text" as const,
        text:
          typeof payload === "string"
            ? payload
            : JSON.stringify(payload, null, 2),
      },
    ],
    isError,
  };
}

function handleError(err: unknown) {
  if (err instanceof ValidationError) {
    return textResult({ error: "validation_error", message: err.message }, true);
  }
  const message = err instanceof Error ? err.message : String(err);
  return textResult({ error: "internal_error", message }, true);
}

const difficultySchema = z.enum(DIFFICULTY_LEVELS);
const statusSchema = z.enum(TASK_STATUSES);

function normalizeAddInput(raw: {
  tanggal: string;
  task: string;
  tingkat_kesulitan: string;
  progress?: number;
  status?: string;
  tiket_url?: string;
  blocker?: string;
  sumber: string;
}) {
  return {
    tanggal: parseDisplayDate(raw.tanggal),
    task: requireNonEmptyString(raw.task, "task"),
    tingkat_kesulitan: parseDifficulty(raw.tingkat_kesulitan),
    progress: parseProgress(raw.progress, 100),
    status: parseStatus(raw.status, "Done"),
    tiket_url: optionalString(raw.tiket_url, "-"),
    blocker: optionalString(raw.blocker, "-"),
    sumber: requireNonEmptyString(raw.sumber, "sumber"),
  };
}

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "daily-log-mcp",
    version: "1.0.0",
  });

  server.registerTool(
    "get_guidelines",
    {
      title: "Get guidelines",
      description:
        "Kembalikan pedoman pengisian daily log (aturan baris, format tanggal DD/MM/YYYY, mapping kesulitan→beban kerja, default progress/status/tiket/blocker, dan alur sync ke Google Sheets). Panggil ini sebelum menambah task jika belum familiar dengan aturan.",
      inputSchema: {},
    },
    async () => textResult({ guidelines: getGuidelinesText() }),
  );

  server.registerTool(
    "add_task",
    {
      title: "Add single task",
      description:
        "Tambah SATU task kerja harian Arifin (Backend) ke inbox. Wajib: tanggal (DD/MM/YYYY hari pekerjaan dikerjakan, min 17/09/2026), task (teks), tingkat_kesulitan (Sangat Mudah|Mudah|Sedang|Sulit|Sangat Sulit), sumber (nama AI). beban_kerja dihitung otomatis 1–5. Default: progress=100, status=Done, tiket_url=\"-\", blocker=\"-\". Jika tanggal+task sama dengan yang sudah ada, tetap disimpan dengan peringatan duplikat.",
      inputSchema: {
        tanggal: z
          .string()
          .describe("Tanggal pekerjaan dalam DD/MM/YYYY, contoh 23/10/2026"),
        task: z.string().describe("Deskripsi singkat satu pekerjaan (satu baris = satu task)"),
        tingkat_kesulitan: difficultySchema.describe(
          "Tingkat kesulitan: Sangat Mudah, Mudah, Sedang, Sulit, Sangat Sulit",
        ),
        sumber: z
          .string()
          .describe('AI/client yang menambah, contoh "Cursor" atau "Claude Desktop"'),
        progress: z
          .number()
          .int()
          .min(0)
          .max(100)
          .optional()
          .describe("0–100, default 100"),
        status: statusSchema
          .optional()
          .describe('Done | In Progress | To Do | Review, default "Done"'),
        tiket_url: z
          .string()
          .optional()
          .describe('URL tiket atau "-", default "-"'),
        blocker: z
          .string()
          .optional()
          .describe('Blocker atau "-", default "-"'),
      },
    },
    async (args) => {
      try {
        const input = normalizeAddInput(args);
        const result = addTask(input);
        return textResult({
          ok: true,
          task: result.task,
          warning: result.duplicateWarning ?? null,
        });
      } catch (err) {
        return handleError(err);
      }
    },
  );

  server.registerTool(
    "add_tasks",
    {
      title: "Add tasks (bulk)",
      description:
        "Tambah banyak task sekaligus (maksimal 50). Setiap item mengikuti aturan add_task yang sama. Gunakan untuk mencatat beberapa pekerjaan dalam satu sesi.",
      inputSchema: {
        tasks: z
          .array(
            z.object({
              tanggal: z.string().describe("DD/MM/YYYY"),
              task: z.string(),
              tingkat_kesulitan: difficultySchema,
              sumber: z.string(),
              progress: z.number().int().min(0).max(100).optional(),
              status: statusSchema.optional(),
              tiket_url: z.string().optional(),
              blocker: z.string().optional(),
            }),
          )
          .min(1)
          .max(50)
          .describe("Array task, 1–50 item"),
      },
    },
    async ({ tasks }) => {
      try {
        const inputs = tasks.map((t) => normalizeAddInput(t));
        const result = addTasks(inputs);
        return textResult({
          ok: true,
          count: result.tasks.length,
          tasks: result.tasks,
          warnings: result.warnings,
        });
      } catch (err) {
        return handleError(err);
      }
    },
  );

  server.registerTool(
    "list_tasks",
    {
      title: "List tasks",
      description:
        "List task dari inbox, diurutkan tanggal lalu created_at. Filter opsional: from/to (DD/MM/YYYY), synced (true/false), sumber. Output sudah lengkap untuk baris sheet (nama_anggota=Arifin, role=Backend, yesterday=\"-\", beban_kerja). Untuk sync sheet, pakai synced=false.",
      inputSchema: {
        from: z
          .string()
          .optional()
          .describe("Filter tanggal awal DD/MM/YYYY (inklusif)"),
        to: z
          .string()
          .optional()
          .describe("Filter tanggal akhir DD/MM/YYYY (inklusif)"),
        synced: z
          .boolean()
          .optional()
          .describe("true = sudah sync, false = pending sync"),
        sumber: z.string().optional().describe("Filter sumber AI"),
      },
    },
    async (args) => {
      try {
        const filters = {
          from: args.from ? parseDisplayDate(args.from) : undefined,
          to: args.to ? parseDisplayDate(args.to) : undefined,
          synced: parseOptionalBool(args.synced),
          sumber: args.sumber ? requireNonEmptyString(args.sumber, "sumber") : undefined,
        };
        const tasks = listTasks(filters);
        return textResult({ ok: true, count: tasks.length, tasks });
      } catch (err) {
        return handleError(err);
      }
    },
  );

  server.registerTool(
    "update_task",
    {
      title: "Update task",
      description:
        "Update field task yang BELUM di-sync. Task yang sudah synced ditolak. Field yang tidak dikirim tetap. beban_kerja dihitung ulang jika tingkat_kesulitan berubah.",
      inputSchema: {
        id: z.string().describe("UUID task"),
        tanggal: z.string().optional().describe("DD/MM/YYYY"),
        task: z.string().optional(),
        tingkat_kesulitan: difficultySchema.optional(),
        progress: z.number().int().min(0).max(100).optional(),
        status: statusSchema.optional(),
        tiket_url: z.string().optional(),
        blocker: z.string().optional(),
        sumber: z.string().optional(),
      },
    },
    async (args) => {
      try {
        const id = requireNonEmptyString(args.id, "id");
        const patch: Parameters<typeof updateTask>[1] = {};
        if (args.tanggal !== undefined) patch.tanggal = parseDisplayDate(args.tanggal);
        if (args.task !== undefined) patch.task = requireNonEmptyString(args.task, "task");
        if (args.tingkat_kesulitan !== undefined) {
          patch.tingkat_kesulitan = parseDifficulty(args.tingkat_kesulitan);
        }
        if (args.progress !== undefined) patch.progress = parseProgress(args.progress);
        if (args.status !== undefined) patch.status = parseStatus(args.status);
        if (args.tiket_url !== undefined) patch.tiket_url = optionalString(args.tiket_url, "-");
        if (args.blocker !== undefined) patch.blocker = optionalString(args.blocker, "-");
        if (args.sumber !== undefined) {
          patch.sumber = requireNonEmptyString(args.sumber, "sumber");
        }
        const task = updateTask(id, patch);
        return textResult({ ok: true, task });
      } catch (err) {
        return handleError(err);
      }
    },
  );

  server.registerTool(
    "delete_task",
    {
      title: "Delete task",
      description:
        "Hapus task yang BELUM di-sync. Task yang sudah synced ditolak (sudah ada di sheet).",
      inputSchema: {
        id: z.string().describe("UUID task yang akan dihapus"),
      },
    },
    async ({ id }) => {
      try {
        const result = deleteTask(requireNonEmptyString(id, "id"));
        return textResult({ ok: true, ...result });
      } catch (err) {
        return handleError(err);
      }
    },
  );

  server.registerTool(
    "mark_synced",
    {
      title: "Mark tasks synced",
      description:
        "Tandai daftar task sebagai sudah disalin ke Google Sheets (synced=true, set synced_at). Panggil SETELAH berhasil menulis baris ke sheet. Id yang tidak ditemukan dilaporkan di notFound; yang sudah synced sebelumnya di alreadySynced (idempotent).",
      inputSchema: {
        ids: z
          .array(z.string())
          .min(1)
          .describe("Daftar UUID task yang baru saja ditulis ke sheet"),
      },
    },
    async ({ ids }) => {
      try {
        const result = markSynced(ids);
        return textResult({
          ok: true,
          updated_count: result.updated.length,
          updated: result.updated,
          notFound: result.notFound,
          alreadySynced: result.alreadySynced,
        });
      } catch (err) {
        return handleError(err);
      }
    },
  );

  return server;
}
