// Client-side parsers for Schedule of Values imports.
// CSV (PapaParse), Excel .xlsx (SheetJS), and tab-separated paste.
// All three produce the same shape: a 2D array of strings ("matrix")
// + a default header guess. Mapping happens in the UI.

import Papa from "papaparse";
import * as XLSX from "xlsx";

export type Matrix = string[][];

export interface ParsedSheet {
  matrix: Matrix;
  hasHeader: boolean;
  source: "csv" | "xlsx" | "paste" | "pdf";
  sheetName?: string;
}


const stringify = (v: unknown): string => {
  if (v == null) return "";
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  return String(v);
};

const looksLikeHeader = (row: string[]): boolean => {
  if (row.length === 0) return false;
  let nonNumeric = 0;
  for (const cell of row) {
    const c = cell.trim();
    if (!c) continue;
    const cleaned = c.replace(/[$,\s]/g, "");
    if (cleaned === "" || Number.isNaN(Number(cleaned))) nonNumeric += 1;
  }
  return nonNumeric >= Math.max(1, Math.floor(row.length / 2));
};

export async function parseCsv(file: File): Promise<ParsedSheet> {
  return new Promise((resolve, reject) => {
    Papa.parse<string[]>(file, {
      complete: (res) => {
        const matrix = (res.data as unknown[][])
          .map((r) => (r as unknown[]).map(stringify))
          .filter((r) => r.some((c) => c.trim() !== ""));
        resolve({ matrix, hasHeader: matrix[0] ? looksLikeHeader(matrix[0]) : false, source: "csv" });
      },
      error: (err) => reject(err),
    });
  });
}

export async function parseXlsx(file: File): Promise<ParsedSheet> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const raw = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false });
  const matrix = raw.map((r) => (r ?? []).map(stringify)).filter((r) => r.some((c) => c.trim() !== ""));
  return {
    matrix,
    hasHeader: matrix[0] ? looksLikeHeader(matrix[0]) : false,
    source: "xlsx",
    sheetName,
  };
}

export function parsePaste(text: string): ParsedSheet {
  const lines = text.replace(/\r\n?/g, "\n").split("\n").filter((l) => l.trim() !== "");
  const delim = lines[0]?.includes("\t") ? "\t" : lines[0]?.includes(",") ? "," : "\t";
  const matrix = lines.map((l) => l.split(delim).map((c) => c.trim()));
  return { matrix, hasHeader: matrix[0] ? looksLikeHeader(matrix[0]) : false, source: "paste" };
}

// ---------------- Column mapping ----------------

export type FieldKey = "bucket" | "original_budget" | "actual_to_date" | "ftc" | "sort_order" | "ignore";

export interface ColumnMap {
  [columnIndex: number]: FieldKey;
}

const HEADER_HINTS: Record<Exclude<FieldKey, "ignore">, RegExp[]> = {
  bucket: [/bucket/i, /category/i, /division/i, /trade/i, /scope/i, /description/i, /item/i, /^name$/i],
  original_budget: [/original/i, /^budget$/i, /contract\s*amount/i, /sov\s*amount/i, /amount/i, /total/i],
  actual_to_date: [/actual/i, /to[\s_-]?date/i, /spent/i, /paid/i, /billed/i, /incurred/i],
  ftc: [/ftc/i, /forecast\s*to\s*complete/i, /remaining/i, /etc\b/i, /to\s*complete/i],
  sort_order: [/^#$/i, /^order$/i, /sort/i, /^no\.?$/i, /line/i],
};

export function guessColumnMap(matrix: Matrix, hasHeader: boolean): ColumnMap {
  const out: ColumnMap = {};
  if (matrix.length === 0) return out;
  const ncols = Math.max(...matrix.map((r) => r.length));
  const headerRow = hasHeader ? matrix[0] : [];

  const tryAssign = (idx: number, field: Exclude<FieldKey, "ignore">) => {
    if (out[idx] !== undefined) return;
    if (Object.values(out).includes(field)) return;
    out[idx] = field;
  };

  if (hasHeader) {
    for (let i = 0; i < ncols; i++) {
      const cell = (headerRow[i] ?? "").trim();
      for (const [field, patterns] of Object.entries(HEADER_HINTS) as [Exclude<FieldKey, "ignore">, RegExp[]][]) {
        if (patterns.some((re) => re.test(cell))) {
          tryAssign(i, field);
          break;
        }
      }
    }
  }

  // Fallbacks: first text column = bucket, first numeric column without assignment = budget
  const sampleRows = matrix.slice(hasHeader ? 1 : 0, hasHeader ? 6 : 5);
  const isNumericCol = (i: number) => {
    const vals = sampleRows.map((r) => parseNumber(r[i] ?? ""));
    return vals.filter((v) => v !== null).length >= Math.ceil(sampleRows.length / 2);
  };
  if (!Object.values(out).includes("bucket")) {
    for (let i = 0; i < ncols; i++) {
      if (out[i] !== undefined) continue;
      if (!isNumericCol(i)) { tryAssign(i, "bucket"); break; }
    }
  }
  if (!Object.values(out).includes("original_budget")) {
    for (let i = 0; i < ncols; i++) {
      if (out[i] !== undefined) continue;
      if (isNumericCol(i)) { tryAssign(i, "original_budget"); break; }
    }
  }

  for (let i = 0; i < ncols; i++) if (out[i] === undefined) out[i] = "ignore";
  return out;
}

export function parseNumber(s: string): number | null {
  if (s == null) return null;
  const cleaned = String(s).replace(/[$,\s]/g, "").replace(/[()]/g, "");
  if (cleaned === "" || cleaned === "-") return null;
  const isNeg = String(s).trim().startsWith("(") && String(s).trim().endsWith(")");
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return isNeg ? -n : n;
}

export interface BucketImportRow {
  bucket: string;
  original_budget: number;
  actual_to_date: number;
  ftc: number;
  sort_order: number;
  valid: boolean;
  reason?: string;
}

export function applyMapping(
  matrix: Matrix,
  hasHeader: boolean,
  map: ColumnMap,
): BucketImportRow[] {
  const rows = hasHeader ? matrix.slice(1) : matrix;
  const out: BucketImportRow[] = [];
  let auto = 1;
  for (const r of rows) {
    const get = (field: Exclude<FieldKey, "ignore">): string => {
      const idx = Object.entries(map).find(([, f]) => f === field)?.[0];
      return idx == null ? "" : r[Number(idx)] ?? "";
    };
    const bucket = get("bucket").trim();
    const budget = parseNumber(get("original_budget")) ?? 0;
    const actual = parseNumber(get("actual_to_date")) ?? 0;
    const ftc = parseNumber(get("ftc")) ?? 0;
    const orderRaw = parseNumber(get("sort_order"));
    const sort = orderRaw == null ? auto : Math.round(orderRaw);
    auto += 1;
    let valid = true;
    let reason: string | undefined;
    if (!bucket) { valid = false; reason = "Missing bucket name"; }
    else if (budget === 0 && actual === 0 && ftc === 0) {
      valid = false; reason = "All amounts are zero";
    }
    out.push({
      bucket: bucket || "(unnamed)",
      original_budget: budget,
      actual_to_date: actual,
      ftc: ftc || Math.max(0, budget - actual),
      sort_order: sort,
      valid,
      reason,
    });
  }
  return out;
}
