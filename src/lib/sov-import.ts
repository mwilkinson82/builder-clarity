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
        resolve({
          matrix,
          hasHeader: matrix[0] ? looksLikeHeader(matrix[0]) : false,
          source: "csv",
        });
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
  const matrix = raw
    .map((r) => (r ?? []).map(stringify))
    .filter((r) => r.some((c) => c.trim() !== ""));
  return {
    matrix,
    hasHeader: matrix[0] ? looksLikeHeader(matrix[0]) : false,
    source: "xlsx",
    sheetName,
  };
}

export function parsePaste(text: string): ParsedSheet {
  const lines = text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .filter((l) => l.trim() !== "");
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
  (
    pdfjs as unknown as { GlobalWorkerOptions: { workerSrc: string } }
  ).GlobalWorkerOptions.workerSrc = workerUrl;

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
    if (items.length === 0) {
      pages.push({ rowsRich: [], rowsCells: [] });
      continue;
    }

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
        if (it.x - prevEnd > gapThreshold) {
          cells.push(cur);
          cur = it.text;
        } else {
          cur += " " + it.text;
        }
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
      const window = rowsRich
        .slice(i, Math.min(i + 4, rowsRich.length))
        .map((r) => r.map((it) => it.text).join(" "))
        .join(" ");
      if (
        /SCHEDULED\s*VALUE/i.test(window) &&
        /(BALANCE\s*TO\s*FINISH|COMPLETED\s*AND\s*STORED)/i.test(window)
      ) {
        headerStartIdx = i;
        break;
      }
    }
    if (headerStartIdx === -1) continue;
    isAia = true;

    const headerItems = rowsRich
      .slice(headerStartIdx, Math.min(headerStartIdx + 4, rowsRich.length))
      .flat();
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
        let best = "desc";
        let bestDist = Infinity;
        for (const k of Object.keys(anchors)) {
          const a = anchors[k];
          if (a == null) continue;
          const d = Math.abs(it.x + it.w / 2 - a);
          if (d < bestDist) {
            bestDist = d;
            best = k;
          }
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
    const header = [
      "Description",
      "Scheduled Value",
      "Completed & Stored to Date",
      "Balance to Finish",
    ];
    return { matrix: [header, ...aiaRows], hasHeader: true, source: "pdf" };
  }

  // -------- Generic fallback (non-AIA PDFs) --------
  const allRows: string[][] = [];
  for (const pg of pages)
    for (const r of pg.rowsCells) if (r.some((c) => c !== "")) allRows.push(r);
  const matrix = allRows.filter((row) => {
    if (row.length < 2) return false;
    const hasText = row.some((c) => /[A-Za-z]/.test(c) && parseNumber(c) === null);
    const hasNum = row.some((c) => parseNumber(c) !== null);
    return hasText && hasNum;
  });
  return { matrix, hasHeader: matrix[0] ? looksLikeHeader(matrix[0]) : false, source: "pdf" };
}

// ---------------- Column mapping ----------------

export type FieldKey =
  "cost_code" | "bucket" | "original_budget" | "actual_to_date" | "ftc" | "sort_order" | "ignore";

export interface ColumnMap {
  [columnIndex: number]: FieldKey;
}

const HEADER_HINTS: Record<Exclude<FieldKey, "ignore">, RegExp[]> = {
  cost_code: [
    /cost\s*code/i,
    /csi\s*code/i,
    /costcode/i,
    /job\s*cost/i,
    /phase\s*code/i,
    /cost\s*type/i,
    /^code$/i,
    /^item\s*no/i,
    /^line\s*no/i,
    /^#$/i,
  ],
  bucket: [
    /bucket/i,
    /category/i,
    /division/i,
    /trade/i,
    /scope/i,
    /^title$/i,
    /description/i,
    /^item$/i,
    /^name$/i,
  ],
  original_budget: [
    /builder\s*cost/i,
    /estimated?\s*cost/i,
    /budgeted\s*cost/i,
    /scheduled\s*value/i,
    /original/i,
    /^budget$/i,
    /contract\s*amount/i,
    /sov\s*amount/i,
    /^amount$/i,
    /^value$/i,
  ],
  actual_to_date: [
    /completed\s*and\s*stored/i,
    /actual/i,
    /to[\s_-]?date/i,
    /spent/i,
    /paid/i,
    /billed/i,
    /incurred/i,
  ],
  ftc: [
    /balance\s*to\s*finish/i,
    /ftc/i,
    /forecast\s*to\s*complete/i,
    /remaining/i,
    /etc\b/i,
    /to\s*complete/i,
  ],
  sort_order: [/^order$/i, /sort/i, /^no\.?$/i],
};

const findHeaderIndex = (headerRow: string[], patterns: RegExp[], ncols: number) => {
  for (let i = 0; i < ncols; i++) {
    const cell = (headerRow[i] ?? "").trim();
    if (patterns.some((re) => re.test(cell))) return i;
  }
  return -1;
};

const isDivisionColumnHeader = (value: string) =>
  /^(?:csi\s*)?(?:div|division)(?:\s*(?:#|no\.?|number|code))?$/i.test(value.trim());

const rowHasDivisionLabel = (value: string) =>
  /\b(?:csi\s*)?(?:div|division)\.?\s*\d{1,2}\b/i.test(value);

const DESCRIPTION_BUCKET_HEADERS = [
  /description/i,
  /^title$/i,
  /^item$/i,
  /^name$/i,
  /scope/i,
  /bucket/i,
  /category/i,
  /trade/i,
  /section/i,
];

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
    const findHeader = (patterns: RegExp[]) => findHeaderIndex(headerRow, patterns, ncols);

    // BuilderTrend/estimate exports commonly contain cost-code line items with
    // "Builder Cost" as the construction-cost basis and "Client Price" as the
    // marked-up owner price. Prefer those explicit columns before the generic
    // fallback has a chance to mistake Quantity or Unit Cost for the budget.
    const estimateCostCode = findHeader([/^cost\s*code$/i]);
    const estimateTitle = findHeader([/^title$/i, /^description$/i]);
    const estimateBudget = findHeader([/^builder\s*cost$/i, /^estimated?\s*cost$/i]);
    if (estimateCostCode >= 0 && estimateBudget >= 0) {
      tryAssign(estimateCostCode, "cost_code");
      if (estimateTitle >= 0) tryAssign(estimateTitle, "bucket");
      tryAssign(estimateBudget, "original_budget");
    }

    // CSI exports often put a division column before the actual description.
    // Treat the description/title as the SOV bucket so "DIV 09 Furnishings"
    // becomes section context, not the thing we bill against.
    const descriptionBucket = findHeader(DESCRIPTION_BUCKET_HEADERS);
    const descriptionBudget = findHeader(HEADER_HINTS.original_budget);
    if (descriptionBucket >= 0 && descriptionBudget >= 0) {
      tryAssign(descriptionBucket, "bucket");
      tryAssign(descriptionBudget, "original_budget");
    }

    for (let i = 0; i < ncols; i++) {
      const cell = (headerRow[i] ?? "").trim();
      for (const [field, patterns] of Object.entries(HEADER_HINTS) as [
        Exclude<FieldKey, "ignore">,
        RegExp[],
      ][]) {
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
      if (!isNumericCol(i)) {
        tryAssign(i, "bucket");
        break;
      }
    }
  }
  if (!Object.values(out).includes("original_budget")) {
    for (let i = 0; i < ncols; i++) {
      if (out[i] !== undefined) continue;
      if (isNumericCol(i)) {
        tryAssign(i, "original_budget");
        break;
      }
    }
  }

  for (let i = 0; i < ncols; i++) if (out[i] === undefined) out[i] = "ignore";
  return out;
}

export function parseNumber(s: string): number | null {
  if (s == null) return null;
  const cleaned = String(s)
    .replace(/[$,\s]/g, "")
    .replace(/[()]/g, "");
  if (cleaned === "" || cleaned === "-") return null;
  const isNeg = String(s).trim().startsWith("(") && String(s).trim().endsWith(")");
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return isNeg ? -n : n;
}

const splitCostCodeLabel = (value: string): { code: string; label: string } | null => {
  const trimmed = value.trim();
  const match = trimmed.match(/^([A-Za-z]?\d[\w.-]*)\s+(.+)$/);
  if (!match) return null;
  return { code: match[1].trim(), label: match[2].trim() };
};

const isCsiDivisionHeaderRow = (
  rowText: string,
  bucket: string,
  budgetRaw: string,
  budgetParsed: number | null,
) => {
  const text = `${rowText} ${bucket}`.replace(/\s+/g, " ").trim();
  const hasDivisionLabel = rowHasDivisionLabel(text);
  if (!hasDivisionLabel) return false;

  const hasChildLineCount = /\b\d+\s+lines?\b/i.test(text);
  return hasChildLineCount || budgetRaw === "" || budgetParsed == null || budgetParsed <= 0;
};

export function missingRequiredMappings(map: ColumnMap): string[] {
  const fields = Object.values(map);
  const missing: string[] = [];
  if (!fields.includes("bucket")) missing.push("Bucket name");
  if (!fields.includes("original_budget")) missing.push("Original budget");
  return missing;
}

export interface BucketImportRow {
  cost_code: string;
  bucket: string;
  original_budget: number;
  actual_to_date: number;
  ftc: number;
  actual_to_date_provided: boolean;
  ftc_provided: boolean;
  sort_order: number;
  valid: boolean;
  reason?: string;
}

export interface AmountColumnChoice {
  columnIndex: number;
  label: string;
  total: number;
  sampleCount: number;
  recommended: boolean;
  basis: "cost" | "sell" | "unit" | "unknown";
  note: string;
}

export interface ColumnMappingSuggestion {
  columnIndex: number;
  label: string;
  field: FieldKey;
  confidence: "high" | "medium" | "low";
  reasons: string[];
  samples: string[];
}

export interface SkippedRowSummary {
  reason: string;
  count: number;
  examples: string[];
}

export interface SovIntakeAnalysis {
  profile: string;
  confidence: "high" | "medium" | "low";
  rawRows: number;
  importRows: number;
  mergedRows: number;
  totalBudget: number;
  selectedBudgetColumn: number | null;
  amountChoices: AmountColumnChoice[];
  columnSuggestions: ColumnMappingSuggestion[];
  skippedRowReasons: SkippedRowSummary[];
  warnings: string[];
}

export function applyMapping(
  matrix: Matrix,
  hasHeader: boolean,
  map: ColumnMap,
): BucketImportRow[] {
  const rows = hasHeader ? matrix.slice(1) : matrix;
  const headerRow = hasHeader ? (matrix[0] ?? []) : [];
  const ncols = Math.max(0, ...matrix.map((r) => r.length));
  const fieldIndex = (field: Exclude<FieldKey, "ignore">): number | null => {
    const idx = Object.entries(map).find(([, f]) => f === field)?.[0];
    return idx == null ? null : Number(idx);
  };
  const costCodeIndex = fieldIndex("cost_code");
  const bucketIndex = fieldIndex("bucket");
  const costCodeHeader = costCodeIndex == null ? "" : (headerRow[costCodeIndex] ?? "");
  const bucketHeader = bucketIndex == null ? "" : (headerRow[bucketIndex] ?? "");
  const costCodeIsDivisionOnly = hasHeader && isDivisionColumnHeader(costCodeHeader);
  const bucketIsDivisionOnly = hasHeader && isDivisionColumnHeader(bucketHeader);
  const descriptionFallbackIndex = hasHeader
    ? findHeaderIndex(headerRow, DESCRIPTION_BUCKET_HEADERS, ncols)
    : -1;
  const out: BucketImportRow[] = [];
  let auto = 1;
  for (const r of rows) {
    const get = (field: Exclude<FieldKey, "ignore">): string => {
      const idx = fieldIndex(field);
      return idx == null ? "" : (r[idx] ?? "");
    };
    const costCodeRaw = costCodeIsDivisionOnly ? "" : get("cost_code").trim();
    const codeParts = splitCostCodeLabel(costCodeRaw);
    const costCode = codeParts?.code ?? costCodeRaw;
    const bucketRaw =
      bucketIsDivisionOnly &&
      descriptionFallbackIndex >= 0 &&
      descriptionFallbackIndex !== bucketIndex
        ? (r[descriptionFallbackIndex] ?? "").trim()
        : get("bucket").trim();
    const bucket = codeParts?.label || bucketRaw;
    const budgetRaw = get("original_budget").trim();
    const actualRaw = get("actual_to_date").trim();
    const ftcRaw = get("ftc").trim();
    const budgetParsed = parseNumber(budgetRaw);
    const actualParsed = parseNumber(actualRaw);
    const ftcParsed = parseNumber(ftcRaw);
    const budget = budgetParsed ?? 0;
    const actualProvided = actualRaw !== "" && actualParsed !== null;
    const ftcProvided = ftcRaw !== "" && ftcParsed !== null;
    const actual = actualParsed ?? 0;
    const ftc = ftcParsed ?? Math.max(0, budget - actual);
    const orderRaw = parseNumber(get("sort_order"));
    const sort = orderRaw == null ? auto : Math.round(orderRaw);
    auto += 1;
    let valid = true;
    let reason: string | undefined;
    const rowText = r.join(" ");
    if (!bucket) {
      valid = false;
      reason = "Missing bucket name";
    } else if (isCsiDivisionHeaderRow(rowText, bucket, budgetRaw, budgetParsed)) {
      valid = false;
      reason = "CSI division header";
    } else if (/^(grand\s*)?total\b|^subtotal\b|^summary\b/i.test(bucket)) {
      valid = false;
      reason = "Total or summary row";
    } else if (budgetRaw !== "" && budgetParsed === null) {
      valid = false;
      reason = "Malformed original budget";
    } else if (actualRaw !== "" && actualParsed === null) {
      valid = false;
      reason = "Malformed actual to date";
    } else if (ftcRaw !== "" && ftcParsed === null) {
      valid = false;
      reason = "Malformed forecast to complete";
    } else if (budget <= 0) {
      valid = false;
      reason = "Original budget is required";
    } else if (actual < 0 || ftc < 0) {
      valid = false;
      reason = "Amounts cannot be negative";
    }
    out.push({
      cost_code: costCode,
      bucket: bucket || "(unnamed)",
      original_budget: budget,
      actual_to_date: actual,
      ftc,
      actual_to_date_provided: actualProvided,
      ftc_provided: ftcProvided,
      sort_order: sort,
      valid,
      reason,
    });
  }
  return consolidateBucketRows(out);
}

function consolidateBucketRows(rows: BucketImportRow[]): BucketImportRow[] {
  const consolidated: BucketImportRow[] = [];
  const byKey = new Map<string, { row: BucketImportRow; count: number }>();

  const makeKey = (row: BucketImportRow) => {
    const codeKey = row.cost_code.trim().toLowerCase();
    if (codeKey) return `code:${codeKey}`;
    return `bucket:${row.bucket.trim().toLowerCase()}`;
  };

  for (const row of rows) {
    if (!row.valid) {
      consolidated.push(row);
      continue;
    }

    const key = makeKey(row);
    const existing = byKey.get(key);
    if (!existing) {
      const clone = { ...row };
      byKey.set(key, { row: clone, count: 1 });
      consolidated.push(clone);
      continue;
    }

    existing.row.original_budget += row.original_budget;
    existing.row.actual_to_date += row.actual_to_date;
    existing.row.ftc += row.ftc;
    existing.row.actual_to_date_provided =
      existing.row.actual_to_date_provided || row.actual_to_date_provided;
    existing.row.ftc_provided = existing.row.ftc_provided || row.ftc_provided;
    existing.count += 1;
    existing.row.reason = `Merged ${existing.count} estimate lines.`;
  }

  return consolidated;
}

const sampleColumnValues = (
  matrix: Matrix,
  hasHeader: boolean,
  columnIndex: number,
  limit = 4,
): string[] => {
  const samples: string[] = [];
  const seen = new Set<string>();
  for (const row of matrix.slice(hasHeader ? 1 : 0)) {
    const value = (row[columnIndex] ?? "").replace(/\s+/g, " ").trim();
    if (!value || seen.has(value.toLowerCase())) continue;
    samples.push(value);
    seen.add(value.toLowerCase());
    if (samples.length >= limit) break;
  }
  return samples;
};

const countNumericSamples = (matrix: Matrix, hasHeader: boolean, columnIndex: number) => {
  let numeric = 0;
  let total = 0;
  for (const row of matrix.slice(hasHeader ? 1 : 0)) {
    const parsed = parseNumber(row[columnIndex] ?? "");
    if (parsed == null) continue;
    numeric += 1;
    total += parsed;
  }
  return { numeric, total };
};

export function explainColumnMapping(
  matrix: Matrix,
  hasHeader: boolean,
  map: ColumnMap,
): ColumnMappingSuggestion[] {
  if (matrix.length === 0) return [];
  const ncols = Math.max(...matrix.map((row) => row.length));
  const header = hasHeader ? (matrix[0] ?? []) : [];
  const suggestions: ColumnMappingSuggestion[] = [];

  for (let columnIndex = 0; columnIndex < ncols; columnIndex++) {
    const label =
      hasHeader && (header[columnIndex] ?? "").trim()
        ? (header[columnIndex] ?? "").trim()
        : `Column ${columnIndex + 1}`;
    const field = map[columnIndex] ?? "ignore";
    const samples = sampleColumnValues(matrix, hasHeader, columnIndex);
    const sampleText = samples.join(" ");
    const headerMatches =
      field !== "ignore" && HEADER_HINTS[field]?.some((pattern) => pattern.test(label));
    const numericStats = countNumericSamples(matrix, hasHeader, columnIndex);
    const reasons: string[] = [];
    let score = 0;

    if (headerMatches) {
      reasons.push(`Header matches ${field.replace(/_/g, " ")} language.`);
      score += 2;
    }

    if (field === "cost_code") {
      const codeLikeSamples = samples.filter(
        (sample) => /^[A-Za-z]?\d[\w.-]*$/.test(sample) || splitCostCodeLabel(sample),
      ).length;
      if (codeLikeSamples > 0) {
        reasons.push("Samples look like SOV or cost-code line numbers.");
        score += 1;
      }
      if (rowHasDivisionLabel(sampleText)) {
        reasons.push("DIV/Division section rows will be treated as headers, not billable lines.");
        score += 1;
      }
    }

    if (field === "bucket") {
      const textSamples = samples.filter(
        (sample) => /[A-Za-z]/.test(sample) && parseNumber(sample) == null,
      ).length;
      if (textSamples > 0) {
        reasons.push("Samples read like SOV descriptions or bucket names.");
        score += 1;
      }
      if (/title|description|scope|trade|category/i.test(label)) {
        reasons.push("Header points to the description users will bill against.");
        score += 1;
      }
    }

    if (field === "original_budget" || field === "actual_to_date" || field === "ftc") {
      if (numericStats.numeric > 0) {
        reasons.push(
          `${numericStats.numeric} numeric value${
            numericStats.numeric === 1 ? "" : "s"
          } found; sample total ${numericStats.total.toLocaleString()}.`,
        );
        score += 1;
      }
      if (field === "original_budget" && /builder\s*cost|budget|scheduled\s*value/i.test(label)) {
        reasons.push("Header looks like the SOV budget basis.");
        score += 1;
      }
    }

    if (field === "ignore") {
      if (rowHasDivisionLabel(sampleText) || isDivisionColumnHeader(label)) {
        reasons.push("Looks like CSI division context, not a billable SOV line item.");
        score += 2;
      } else if (
        numericStats.numeric > 0 &&
        /qty|quantity|unit|rate|%|margin|markup/i.test(label)
      ) {
        reasons.push("Looks like quantity, unit, percent, or markup support data.");
        score += 1;
      } else {
        reasons.push("Ignored unless you manually map it below.");
      }
    }

    if (reasons.length === 0) {
      reasons.push("Mapped from surrounding column context; confirm before importing.");
    }

    suggestions.push({
      columnIndex,
      label,
      field,
      confidence: score >= 3 ? "high" : score >= 2 ? "medium" : "low",
      reasons,
      samples,
    });
  }

  return suggestions;
}

const summarizeSkippedRows = (rows: BucketImportRow[]): SkippedRowSummary[] => {
  const byReason = new Map<string, SkippedRowSummary>();
  for (const row of rows) {
    if (row.valid) continue;
    const reason = row.reason ?? "Skipped row";
    const current = byReason.get(reason) ?? { reason, count: 0, examples: [] };
    current.count += 1;
    const example = [row.cost_code, row.bucket].filter(Boolean).join(" / ");
    if (example && current.examples.length < 3) current.examples.push(example);
    byReason.set(reason, current);
  }
  return Array.from(byReason.values()).sort((a, b) => b.count - a.count);
};

export function analyzeSovIntake(
  matrix: Matrix,
  hasHeader: boolean,
  map: ColumnMap,
): SovIntakeAnalysis {
  const rows = applyMapping(matrix, hasHeader, map);
  const validRows = rows.filter((r) => r.valid);
  const header = hasHeader ? (matrix[0] ?? []) : [];
  const headerText = header.join(" ").toLowerCase();
  const selectedBudgetEntry = Object.entries(map).find(([, field]) => field === "original_budget");
  const selectedBudgetColumn = selectedBudgetEntry ? Number(selectedBudgetEntry[0]) : null;
  const selectedBudgetLabel =
    selectedBudgetColumn == null ? "" : (header[selectedBudgetColumn] ?? "").trim();

  const amountChoices = detectAmountColumns(matrix, hasHeader, selectedBudgetColumn);
  const warnings: string[] = [];
  const mergedRows = validRows.filter((row) => row.reason?.startsWith("Merged ")).length;
  const skippedDivisionHeaders = rows.filter((row) => row.reason === "CSI division header").length;

  let profile = "Generic spreadsheet";
  let confidence: SovIntakeAnalysis["confidence"] = "medium";
  if (/builder\s*cost/i.test(headerText) && /client\s*price/i.test(headerText)) {
    profile = "Builder estimate export";
    confidence = "high";
  } else if (/scheduled\s*value/i.test(headerText) && /balance\s*to\s*finish/i.test(headerText)) {
    profile = "AIA/SOV pay application";
    confidence = "high";
  } else if (/actual/i.test(headerText) && /budget/i.test(headerText)) {
    profile = "Budget vs actual export";
    confidence = "medium";
  } else if (!hasHeader) {
    profile = "Headerless spreadsheet";
    confidence = "low";
  }

  if (!Object.values(map).includes("cost_code")) {
    warnings.push("No cost-code column is mapped. Future imports will match by bucket name only.");
  }
  if (/client\s*price|unit\s*price|markup|profit/i.test(selectedBudgetLabel)) {
    warnings.push(
      `${selectedBudgetLabel} looks like a sell-price or markup column. Use a cost column unless this project is intentionally budgeted at client value.`,
    );
  }
  if (/unit\s*cost/i.test(selectedBudgetLabel) && amountChoices.some((c) => c.basis === "cost")) {
    warnings.push("A cost-total column exists. Unit Cost is usually not the SOV budget.");
  }
  if (
    amountChoices.some((c) => c.basis === "sell") &&
    amountChoices.some((c) => c.basis === "cost")
  ) {
    warnings.push(
      "Both cost and client-price columns were found. Confirm the SOV should use cost.",
    );
  }
  if (mergedRows > 0) {
    warnings.push(`${mergedRows} cost-code buckets were built by merging repeated estimate lines.`);
  }
  if (skippedDivisionHeaders > 0) {
    warnings.push(
      `${skippedDivisionHeaders} CSI division header row${
        skippedDivisionHeaders === 1 ? "" : "s"
      } skipped. Only billable SOV line items will import.`,
    );
  }
  if (validRows.length === 0) {
    warnings.push("No importable rows were found. Check the column mapping before importing.");
  }

  return {
    profile,
    confidence,
    rawRows: Math.max(0, matrix.length - (hasHeader ? 1 : 0)),
    importRows: validRows.length,
    mergedRows,
    totalBudget: validRows.reduce((sum, row) => sum + row.original_budget, 0),
    selectedBudgetColumn,
    amountChoices,
    columnSuggestions: explainColumnMapping(matrix, hasHeader, map),
    skippedRowReasons: summarizeSkippedRows(rows),
    warnings,
  };
}

function detectAmountColumns(
  matrix: Matrix,
  hasHeader: boolean,
  selectedBudgetColumn: number | null,
): AmountColumnChoice[] {
  if (matrix.length === 0) return [];
  const ncols = Math.max(...matrix.map((row) => row.length));
  const header = hasHeader ? (matrix[0] ?? []) : [];
  const sampleRows = matrix.slice(hasHeader ? 1 : 0);
  const choices: AmountColumnChoice[] = [];

  for (let i = 0; i < ncols; i++) {
    const label = (header[i] ?? `Column ${i + 1}`).trim() || `Column ${i + 1}`;
    const lower = label.toLowerCase();
    if (/%|margin|markup|profit|quantity|qty|rate/i.test(lower)) continue;

    let sampleCount = 0;
    let total = 0;
    for (const row of sampleRows) {
      const parsed = parseNumber(row[i] ?? "");
      if (parsed == null) continue;
      sampleCount += 1;
      total += parsed;
    }
    if (sampleCount < Math.max(3, Math.ceil(sampleRows.length * 0.3))) continue;
    if (Math.abs(total) <= 0) continue;

    let basis: AmountColumnChoice["basis"] = "unknown";
    let note = "Possible dollar column.";
    if (/builder\s*cost|estimated?\s*cost|budgeted\s*cost|scheduled\s*value|budget/i.test(lower)) {
      basis = "cost";
      note = "Best fit for the cost budget.";
    } else if (/client\s*price|contract|revenue|sell|sales|price/i.test(lower)) {
      basis = "sell";
      note = "Likely owner/client value, not cost.";
    } else if (/unit\s*cost|unit\s*price/i.test(lower)) {
      basis = "unit";
      note = "Unit amount; use only if quantities are already one.";
    }

    choices.push({
      columnIndex: i,
      label,
      total,
      sampleCount,
      recommended: i === selectedBudgetColumn || basis === "cost",
      basis,
      note,
    });
  }

  return choices.sort((a, b) => {
    if (a.columnIndex === selectedBudgetColumn) return -1;
    if (b.columnIndex === selectedBudgetColumn) return 1;
    const rank = { cost: 0, unknown: 1, unit: 2, sell: 3 };
    return rank[a.basis] - rank[b.basis] || b.sampleCount - a.sampleCount;
  });
}
