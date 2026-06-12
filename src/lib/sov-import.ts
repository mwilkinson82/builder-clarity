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

// ---------------- PDF parsing ----------------
// Extracts text items with x/y coordinates, clusters them into rows by y,
// then splits each row into columns by detecting x-gaps. Works for digital
// (text-based) PDFs like AIA G702/G703 SOVs and most QuickBooks/Excel exports.
// Scanned/image-only PDFs will return an empty matrix.

export async function parsePdf(file: File): Promise<ParsedSheet> {
  const pdfjs = await import("pdfjs-dist");
  const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  (pdfjs as unknown as { GlobalWorkerOptions: { workerSrc: string } }).GlobalWorkerOptions.workerSrc = workerUrl;

  const buf = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: buf }).promise;

  type Item = { x: number; y: number; w: number; text: string };
  type PageData = { rowsRich: Item[][]; rowsCells: string[][] };
  const pages: PageData[] = [];

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const items: Item[] = [];
    for (const it of content.items as Array<{ str: string; transform: number[]; width: number }>) {
      const text = (it.str ?? "").trim();
      if (!text) continue;
      items.push({ x: it.transform[4], y: it.transform[5], w: it.width ?? 0, text });
    }
    if (items.length === 0) { pages.push({ rowsRich: [], rowsCells: [] }); continue; }

    items.sort((a, b) => b.y - a.y || a.x - b.x);
    const rowTol = 3;
    const rowsRich: Item[][] = [];
    for (const it of items) {
      const last = rowsRich[rowsRich.length - 1];
      if (last && Math.abs(last[0].y - it.y) <= rowTol) last.push(it);
      else rowsRich.push([it]);
    }
    for (const r of rowsRich) r.sort((a, b) => a.x - b.x);

    const gapThreshold = 12;
    const rowsCells: string[][] = [];
    for (const r of rowsRich) {
      const cells: string[] = [];
      let cur = r[0].text;
      let prevEnd = r[0].x + r[0].w;
      for (let i = 1; i < r.length; i++) {
        const it = r[i];
        if (it.x - prevEnd > gapThreshold) { cells.push(cur); cur = it.text; }
        else { cur += " " + it.text; }
        prevEnd = it.x + it.w;
      }
      cells.push(cur);
      rowsCells.push(cells.map((c) => c.trim()));
    }
    pages.push({ rowsRich, rowsCells });
  }

  // -------- AIA G703 detection --------
  // Header row(s) on a continuation sheet contain "SCHEDULED VALUE" plus
  // "BALANCE TO FINISH" or "COMPLETED AND STORED". When found, parse only
  // those pages using header x-positions as column anchors. The cover page
  // (G702 summary block) is ignored.
  const aiaRows: string[][] = [];
  let isAia = false;
  const HEADER_LABELS = [
    { key: "item", re: /ITEM\s*NO/i },
    { key: "desc", re: /DESCRIPTION\s*OF\s*WORK|BUDGET\s*CODE/i },
    { key: "sched", re: /SCHEDULED\s*VALUE/i },
    { key: "g", re: /COMPLETED\s*AND\s*STORED|TOTAL\s*COMPLETED/i },
    { key: "h", re: /BALANCE\s*TO\s*FINISH/i },
  ] as const;

  for (const { rowsRich } of pages) {
    let headerStartIdx = -1;
    for (let i = 0; i < rowsRich.length; i++) {
      const window = rowsRich.slice(i, Math.min(i + 4, rowsRich.length))
        .map((r) => r.map((it) => it.text).join(" ")).join(" ");
      if (/SCHEDULED\s*VALUE/i.test(window) && /(BALANCE\s*TO\s*FINISH|COMPLETED\s*AND\s*STORED)/i.test(window)) {
        headerStartIdx = i;
        break;
      }
    }
    if (headerStartIdx === -1) continue;
    isAia = true;

    const headerItems = rowsRich.slice(headerStartIdx, Math.min(headerStartIdx + 4, rowsRich.length)).flat();
    const findAnchor = (re: RegExp): number | null => {
      for (let i = 0; i < headerItems.length; i++) {
        let phrase = headerItems[i].text;
        const xStart = headerItems[i].x;
        let xEnd = headerItems[i].x + headerItems[i].w;
        if (re.test(phrase)) return (xStart + xEnd) / 2;
        for (let j = i + 1; j < Math.min(i + 6, headerItems.length); j++) {
          phrase += " " + headerItems[j].text;
          xEnd = headerItems[j].x + headerItems[j].w;
          if (re.test(phrase)) return (xStart + xEnd) / 2;
        }
      }
      return null;
    };
    const anchors: Record<string, number | null> = {};
    for (const { key, re } of HEADER_LABELS) anchors[key] = findAnchor(re);
    if (anchors.sched == null || anchors.desc == null || anchors.g == null) continue;

    const headerEndIdx = Math.min(headerStartIdx + 3, rowsRich.length - 1);
    const headerY = rowsRich[headerStartIdx][0].y;
    for (let i = headerEndIdx + 1; i < rowsRich.length; i++) {
      const r = rowsRich[i];
      if (!r.length) continue;
      if (r[0].y >= headerY - 2) continue;

      const cols: Record<string, string[]> = { item: [], desc: [], sched: [], g: [], h: [] };
      for (const it of r) {
        let best = "desc"; let bestDist = Infinity;
        for (const k of Object.keys(anchors)) {
          const a = anchors[k];
          if (a == null) continue;
          const d = Math.abs(it.x + it.w / 2 - a);
          if (d < bestDist) { bestDist = d; best = k; }
        }
        cols[best].push(it.text);
      }
      const desc = cols.desc.join(" ").trim();
      const sched = cols.sched.join(" ").trim();
      const gVal = cols.g.join(" ").trim();
      const hVal = cols.h.join(" ").trim();

      if (!desc) continue;
      if (/^(GRAND\s*)?TOTALS?:?$/i.test(desc)) continue;
      if (parseNumber(sched) == null) continue;

      aiaRows.push([desc, sched, gVal, hVal]);
    }
  }

  if (isAia && aiaRows.length > 0) {
    const header = ["Description", "Scheduled Value", "Completed & Stored to Date", "Balance to Finish"];
    return { matrix: [header, ...aiaRows], hasHeader: true, source: "pdf" };
  }

  // -------- Generic fallback (non-AIA PDFs) --------
  const allRows: string[][] = [];
  for (const pg of pages) for (const r of pg.rowsCells) if (r.some((c) => c !== "")) allRows.push(r);
  const matrix = allRows.filter((row) => {
    if (row.length < 2) return false;
    const hasText = row.some((c) => /[A-Za-z]/.test(c) && parseNumber(c) === null);
    const hasNum = row.some((c) => parseNumber(c) !== null);
    return hasText && hasNum;
  });
  return { matrix, hasHeader: matrix[0] ? looksLikeHeader(matrix[0]) : false, source: "pdf" };
}



// ---------------- Column mapping ----------------

export type FieldKey = "bucket" | "original_budget" | "actual_to_date" | "ftc" | "sort_order" | "ignore";

export interface ColumnMap {
  [columnIndex: number]: FieldKey;
}

const HEADER_HINTS: Record<Exclude<FieldKey, "ignore">, RegExp[]> = {
  bucket: [/bucket/i, /category/i, /division/i, /trade/i, /scope/i, /description/i, /^item$/i, /^name$/i],
  original_budget: [/scheduled\s*value/i, /original/i, /^budget$/i, /contract\s*amount/i, /sov\s*amount/i, /amount/i, /total/i],
  actual_to_date: [/completed\s*and\s*stored/i, /actual/i, /to[\s_-]?date/i, /spent/i, /paid/i, /billed/i, /incurred/i],
  ftc: [/balance\s*to\s*finish/i, /ftc/i, /forecast\s*to\s*complete/i, /remaining/i, /etc\b/i, /to\s*complete/i],
  sort_order: [/^#$/i, /^order$/i, /sort/i, /^no\.?$/i, /^item\s*no/i, /line/i],
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
