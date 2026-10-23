import {
  DIFFICULTY_LEVELS,
  MIN_DATE_DISPLAY,
  MIN_DATE_ISO,
  TASK_STATUSES,
  WORKLOAD_BY_DIFFICULTY,
  type Difficulty,
  type TaskStatus,
} from "./types.js";

const DATE_RE = /^(\d{2})\/(\d{2})\/(\d{4})$/;

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

/** Parse DD/MM/YYYY → ISO YYYY-MM-DD. Rejects invalid calendars and dates before 17/09/2026. */
export function parseDisplayDate(input: string): string {
  if (typeof input !== "string" || !input.trim()) {
    throw new ValidationError(
      `tanggal wajib diisi dalam format DD/MM/YYYY (contoh: ${MIN_DATE_DISPLAY}).`,
    );
  }
  const trimmed = input.trim();
  const match = DATE_RE.exec(trimmed);
  if (!match) {
    throw new ValidationError(
      `Format tanggal tidak valid: "${trimmed}". Gunakan DD/MM/YYYY (contoh: ${MIN_DATE_DISPLAY}).`,
    );
  }
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);

  if (month < 1 || month > 12) {
    throw new ValidationError(`Bulan tidak valid (${month}) pada tanggal "${trimmed}".`);
  }
  if (day < 1 || day > 31) {
    throw new ValidationError(`Hari tidak valid (${day}) pada tanggal "${trimmed}".`);
  }

  const iso = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const probe = new Date(`${iso}T00:00:00.000Z`);
  if (
    Number.isNaN(probe.getTime()) ||
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() + 1 !== month ||
    probe.getUTCDate() !== day
  ) {
    throw new ValidationError(`Tanggal kalender tidak valid: "${trimmed}".`);
  }

  if (iso < MIN_DATE_ISO) {
    throw new ValidationError(
      `Tanggal "${trimmed}" ditolak. Pencatatan dimulai ${MIN_DATE_DISPLAY}; tidak boleh sebelum tanggal tersebut.`,
    );
  }

  return iso;
}

/** ISO YYYY-MM-DD → DD/MM/YYYY */
export function toDisplayDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) {
    throw new ValidationError(`ISO date tidak valid: "${iso}".`);
  }
  return `${d}/${m}/${y}`;
}

export function mapWorkload(difficulty: Difficulty): number {
  return WORKLOAD_BY_DIFFICULTY[difficulty];
}

export function parseDifficulty(value: unknown): Difficulty {
  if (typeof value !== "string" || !DIFFICULTY_LEVELS.includes(value as Difficulty)) {
    throw new ValidationError(
      `tingkat_kesulitan wajib salah satu dari: ${DIFFICULTY_LEVELS.map((d) => `"${d}"`).join(", ")}.`,
    );
  }
  return value as Difficulty;
}

export function parseStatus(value: unknown, fallback: TaskStatus = "Done"): TaskStatus {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  if (typeof value !== "string" || !TASK_STATUSES.includes(value as TaskStatus)) {
    throw new ValidationError(
      `status wajib salah satu dari: ${TASK_STATUSES.map((s) => `"${s}"`).join(", ")}.`,
    );
  }
  return value as TaskStatus;
}

export function parseProgress(value: unknown, fallback = 100): number {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n > 100) {
    throw new ValidationError("progress harus bilangan bulat 0–100.");
  }
  return n;
}

export function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new ValidationError(`${field} wajib diisi (string non-kosong).`);
  }
  return value.trim();
}

export function optionalString(value: unknown, fallback: string): string {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  if (typeof value !== "string") {
    throw new ValidationError(`Nilai harus string.`);
  }
  return value.trim() || fallback;
}

export function parseOptionalBool(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  throw new ValidationError(`Nilai boolean tidak valid: ${String(value)}.`);
}
