export const DIFFICULTY_LEVELS = [
  "Sangat Mudah",
  "Mudah",
  "Sedang",
  "Sulit",
  "Sangat Sulit",
] as const;

export type Difficulty = (typeof DIFFICULTY_LEVELS)[number];

export const WORKLOAD_BY_DIFFICULTY: Record<Difficulty, number> = {
  "Sangat Mudah": 1,
  Mudah: 2,
  Sedang: 3,
  Sulit: 4,
  "Sangat Sulit": 5,
};

export const TASK_STATUSES = ["Done", "In Progress", "To Do", "Review"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

/** Earliest allowed work date: 17/09/2026 */
export const MIN_DATE_ISO = "2026-09-17";
export const MIN_DATE_DISPLAY = "17/09/2026";

/** Fixed sheet column that callers never set. */
export const FIXED_YESTERDAY = "-";

/** Default identity used when migrating legacy single-user data. */
export const LEGACY_DEFAULT_USER = {
  nama: "Arifin",
  role: "Backend",
  isAdmin: false,
} as const;

export interface UserRow {
  id: string;
  nama: string;
  role: string;
  is_admin: number; // 0 | 1
  created_at: string;
}

export interface ApiKeyRow {
  id: string;
  user_id: string;
  key_hash: string;
  label: string;
  created_at: string;
  revoked_at: string | null;
  last_used_at: string | null;
}

export interface AuthUser {
  id: string;
  nama: string;
  role: string;
  isAdmin: boolean;
  apiKeyId: string;
}

export interface TaskRow {
  id: string;
  user_id: string;
  tanggal: string; // ISO YYYY-MM-DD
  task: string;
  tingkat_kesulitan: Difficulty;
  beban_kerja: number;
  progress: number;
  status: TaskStatus;
  tiket_url: string;
  blocker: string;
  sumber: string;
  synced: number; // 0 | 1 in SQLite
  synced_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TaskOutput {
  id: string;
  user_id: string;
  tanggal: string; // DD/MM/YYYY
  task: string;
  tingkat_kesulitan: Difficulty;
  beban_kerja: number;
  progress: number;
  status: TaskStatus;
  tiket_url: string;
  blocker: string;
  sumber: string;
  synced: boolean;
  synced_at: string | null;
  created_at: string;
  updated_at: string;
  nama_anggota: string;
  role: string;
  yesterday: string;
}

export interface AddTaskInput {
  tanggal: string;
  task: string;
  tingkat_kesulitan: Difficulty;
  progress?: number;
  status?: TaskStatus;
  tiket_url?: string;
  blocker?: string;
  sumber: string;
}
