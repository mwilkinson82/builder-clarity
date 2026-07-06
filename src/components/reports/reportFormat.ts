// Pure formatting/export helpers shared across the Reports suite (WIP schedule,
// job cost, and the billing/retainage reports that follow). No JSX here — kept
// as a plain module so every report downloads CSV and quotes cells the same way.
import { downloadTextFile } from "@/lib/download-file";

// Trigger a client-side file download from an in-memory string. Delegates to
// the shared safe download path (delayed blob-URL revoke — synchronous revoke
// cancels the download in Safari/iOS).
export function downloadText(filename: string, content: string, type: string) {
  downloadTextFile(filename, content, type);
}

// Quote a CSV cell only when it needs it, so numbers stay bare for spreadsheets.
export function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

// Bare dollars-and-cents for CSV — no symbol or grouping, so it imports as a
// number, not text.
export function money2(value: number): string {
  return value.toFixed(2);
}
