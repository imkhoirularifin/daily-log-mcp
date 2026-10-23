import {
  DIFFICULTY_LEVELS,
  FIXED_SHEET_VALUES,
  MIN_DATE_DISPLAY,
  WORKLOAD_BY_DIFFICULTY,
} from "./types.js";

export function getGuidelinesText(): string {
  const difficultyLines = DIFFICULTY_LEVELS.map(
    (d) => `  - "${d}" → beban_kerja ${WORKLOAD_BY_DIFFICULTY[d]}`,
  ).join("\n");

  return [
    "# Pedoman pengisian Daily Log (Arifin / Backend)",
    "",
    "## Alur kerja",
    "1. AI yang membantu coding memanggil `add_task` / `add_tasks` untuk mencatat pekerjaan ke inbox MCP ini.",
    "2. AI lain (atau cron) memanggil `list_tasks` dengan `synced=false`, menyalin baris ke Google Sheets daily log, lalu `mark_synced` dengan daftar id.",
    "3. Task yang sudah synced tidak bisa diubah/dihapus lewat `update_task` / `delete_task`.",
    "",
    "## Aturan baris (sheet)",
    "- Satu baris = satu task (jangan gabungkan beberapa pekerjaan dalam satu task).",
    `- Tanggal (tanggal) = hari pekerjaan dikerjakan, format DD/MM/YYYY.`,
    `- Pencatatan dimulai ${MIN_DATE_DISPLAY}. Tanggal sebelum itu ditolak.`,
    `- nama_anggota tetap "${FIXED_SHEET_VALUES.nama_anggota}".`,
    `- role tetap "${FIXED_SHEET_VALUES.role}".`,
    `- yesterday (kolom fixed) selalu "${FIXED_SHEET_VALUES.yesterday}" — jangan isi dari caller.`,
    "",
    "## tingkat_kesulitan → beban_kerja (otomatis, jangan di-set caller)",
    difficultyLines,
    "",
    "## Default jika tidak diisi",
    "- progress = 100",
    '- status = "Done"',
    '- tiket_url = "-"',
    '- blocker = "-"',
    "",
    "## status yang diizinkan",
    '- "Done", "In Progress", "To Do", "Review"',
    "",
    "## sumber",
    "Wajib: nama AI/client yang menambahkan (contoh: \"Claude Desktop\", \"Cursor\", \"ChatGPT\").",
    "",
    "## Duplikat",
    "Jika tanggal + teks task sama dengan yang sudah ada, server memberi peringatan tetapi tetap menyimpan.",
    "",
    "## Tips untuk AI sheet-sync",
    "- Filter `synced=false` lalu tulis ke sheet dengan kolom lengkap dari output `list_tasks` (termasuk nama_anggota, role, yesterday, beban_kerja).",
    "- Setelah sukses tulis sheet, panggil `mark_synced` dengan semua id yang baru disalin.",
  ].join("\n");
}
