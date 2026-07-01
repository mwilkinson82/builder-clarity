export type ImportMatrix = string[][];
export type ImportSource = "csv" | "xlsx" | "paste";

export type ImportIssueLevel = "info" | "warning" | "error";

export interface ImportIssue {
  level: ImportIssueLevel;
  message: string;
}

export interface CostLibraryImportRow {
  rowNumber: number;
  valid: boolean;
  issues: ImportIssue[];
  csi_division: string;
  csi_code: string;
  category: string;
  description: string;
  unit: string;
  material_cost_cents: number;
  labor_cost_cents: number;
  crew_size: number | null;
  productivity_per_hour: number | null;
  keywords: string[];
}

export interface EstimateLineImportRow {
  rowNumber: number;
  valid: boolean;
  issues: ImportIssue[];
  csi_division: string;
  cost_code: string;
  scope_group: string;
  description: string;
  unit: string;
  quantity: number;
  material_unit_cost_cents: number;
  labor_unit_cost_cents: number;
  notes: string;
}

const HEADER_ALIASES = {
  csiDivision: ["csi division", "division", "div", "csi div", "trade division", "division code"],
  csiCode: ["csi code", "csi", "csi/code", "masterformat", "master format"],
  costCode: ["cost code", "code", "phase code", "costcode", "cost_code", "item code"],
  category: ["category", "trade", "type", "cost type", "class"],
  description: [
    "description",
    "item",
    "item description",
    "scope",
    "scope description",
    "name",
    "line item",
    "cost item",
    "work description",
  ],
  unit: ["unit", "uom", "measure", "unit of measure"],
  quantity: ["qty", "quantity", "count", "takeoff qty", "takeoff quantity"],
  material: [
    "material",
    "material cost",
    "material unit cost",
    "material $/unit",
    "mat",
    "mat cost",
    "materials",
  ],
  labor: ["labor", "labour", "labor cost", "labor unit cost", "labor $/unit", "lab", "lab cost"],
  crewSize: ["crew size", "crew", "crew count", "workers", "people", "headcount"],
  productivity: [
    "productivity",
    "production",
    "production per hour",
    "productivity per hour",
    "units per hour",
    "units/hr",
    "uph",
  ],
  unitCost: ["unit cost", "rate", "price", "price/unit", "$/unit", "cost", "unit price"],
  scopeGroup: ["group", "scope group", "phase", "bucket", "division name", "section"],
  notes: ["notes", "note", "comments", "comment"],
} as const;

const normalizeHeader = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[$]/g, " dollar ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const headerIncludes = (header: string, alias: string) => {
  const normalizedAlias = normalizeHeader(alias);
  return header === normalizedAlias || header.includes(normalizedAlias);
};

const findColumn = (
  headers: readonly string[],
  aliases: readonly string[],
  blockedAliases: readonly string[] = [],
) => {
  const normalizedHeaders = headers.map(normalizeHeader);
  return normalizedHeaders.findIndex((header) => {
    if (!header) return false;
    if (blockedAliases.some((alias) => headerIncludes(header, alias))) return false;
    return aliases.some((alias) => headerIncludes(header, alias));
  });
};

const compact = (value: string, max = 500) => value.trim().replace(/\s+/g, " ").slice(0, max);

const parseNumber = (value: string): number | null => {
  const raw = value.trim();
  if (!raw) return null;
  const negative = /^\(.*\)$/.test(raw) || /^-/.test(raw);
  const cleaned = raw.replace(/[()$,\s]/g, "").replace(/[^0-9.-]/g, "");
  if (!cleaned || cleaned === "-" || cleaned === ".") return null;
  const next = Number(cleaned);
  if (!Number.isFinite(next)) return null;
  return negative ? -Math.abs(next) : next;
};

const toCents = (value: string) => {
  const next = parseNumber(value);
  return next == null ? 0 : Math.round(Math.max(0, next) * 100);
};

const toQuantity = (value: string, unit: string) => {
  const next = parseNumber(value);
  if (next == null) return unit.toUpperCase() === "LS" ? 1 : 1;
  return Math.max(0, next);
};

const normalizeDivision = (value: string, fallbackCode = "") => {
  const raw = compact(value || fallbackCode, 16);
  const digits = raw.match(/\d{1,2}/)?.[0] ?? "";
  return digits ? digits.padStart(2, "0") : "00";
};

const normalizeCode = (value: string, fallbackDivision = "00", max = 32) => {
  const raw = compact(value, max);
  if (raw) return raw;
  return fallbackDivision === "00" ? "" : fallbackDivision;
};

const keywordsFrom = (...values: string[]) =>
  Array.from(
    new Set(
      values
        .join(" ")
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .map((token) => token.trim())
        .filter((token) => token.length > 1)
        .slice(0, 60),
    ),
  );

const getCell = (row: readonly string[], index: number, fallbackIndex = -1) => {
  if (index >= 0) return compact(row[index] ?? "");
  if (fallbackIndex >= 0) return compact(row[fallbackIndex] ?? "");
  return "";
};

const buildHeaderMap = (headers: readonly string[]) => ({
  csiDivision: findColumn(headers, HEADER_ALIASES.csiDivision, HEADER_ALIASES.description),
  csiCode: findColumn(headers, HEADER_ALIASES.csiCode, HEADER_ALIASES.csiDivision),
  costCode: findColumn(headers, HEADER_ALIASES.costCode, HEADER_ALIASES.csiDivision),
  category: findColumn(headers, HEADER_ALIASES.category),
  description: findColumn(headers, HEADER_ALIASES.description),
  unit: findColumn(headers, HEADER_ALIASES.unit),
  quantity: findColumn(headers, HEADER_ALIASES.quantity),
  material: findColumn(headers, HEADER_ALIASES.material),
  labor: findColumn(headers, HEADER_ALIASES.labor),
  crewSize: findColumn(headers, HEADER_ALIASES.crewSize),
  productivity: findColumn(headers, HEADER_ALIASES.productivity),
  unitCost: findColumn(headers, HEADER_ALIASES.unitCost, [
    ...HEADER_ALIASES.material,
    ...HEADER_ALIASES.labor,
  ]),
  scopeGroup: findColumn(headers, HEADER_ALIASES.scopeGroup),
  notes: findColumn(headers, HEADER_ALIASES.notes),
});

const splitRows = (matrix: ImportMatrix, hasHeader: boolean) => ({
  headers: hasHeader ? (matrix[0] ?? []) : [],
  rows: hasHeader ? matrix.slice(1) : matrix,
  offset: hasHeader ? 2 : 1,
});

export function parseCostLibraryRows(matrix: ImportMatrix, hasHeader: boolean) {
  let { headers, rows, offset } = splitRows(matrix, hasHeader);
  let map = buildHeaderMap(headers);
  if (hasHeader && map.description === -1) {
    ({ headers, rows, offset } = splitRows(matrix, false));
    map = buildHeaderMap(headers);
  }
  const rowHasHeader = offset === 2;
  return rows
    .map((row, index): CostLibraryImportRow => {
      const csiCode = getCell(row, map.csiCode, rowHasHeader ? -1 : 1);
      const csiDivision = normalizeDivision(
        getCell(row, map.csiDivision, rowHasHeader ? -1 : 0),
        csiCode,
      );
      const unit = (getCell(row, map.unit, rowHasHeader ? -1 : 4) || "EA").toUpperCase();
      const description = getCell(row, map.description, rowHasHeader ? -1 : 2);
      const unitCost = toCents(getCell(row, map.unitCost));
      const material = toCents(getCell(row, map.material, rowHasHeader ? -1 : 5)) || unitCost;
      const labor = toCents(getCell(row, map.labor, rowHasHeader ? -1 : 6));
      const crewSize = parseNumber(getCell(row, map.crewSize, rowHasHeader ? -1 : 7));
      const productivity = parseNumber(getCell(row, map.productivity, rowHasHeader ? -1 : 8));
      const category = getCell(row, map.category, rowHasHeader ? -1 : 3);
      const issues: ImportIssue[] = [];

      if (!description) issues.push({ level: "error", message: "Missing description" });
      if (!unit) issues.push({ level: "error", message: "Missing unit" });
      if (csiDivision === "00") {
        issues.push({ level: "warning", message: "No CSI division found; using 00" });
      }
      if (material === 0 && labor === 0) {
        issues.push({ level: "warning", message: "No unit cost found" });
      }

      return {
        rowNumber: index + offset,
        valid: !issues.some((issue) => issue.level === "error"),
        issues,
        csi_division: csiDivision,
        csi_code: normalizeCode(csiCode, csiDivision, 16),
        category,
        description,
        unit,
        material_cost_cents: material,
        labor_cost_cents: labor,
        crew_size: crewSize == null ? null : Math.max(0, crewSize),
        productivity_per_hour: productivity == null ? null : Math.max(0, productivity),
        keywords: keywordsFrom(description, category, csiCode),
      };
    })
    .filter(
      (row) => row.description || row.csi_code || row.material_cost_cents || row.labor_cost_cents,
    );
}

export function parseEstimateLineRows(matrix: ImportMatrix, hasHeader: boolean) {
  let { headers, rows, offset } = splitRows(matrix, hasHeader);
  let map = buildHeaderMap(headers);
  if (hasHeader && map.description === -1) {
    ({ headers, rows, offset } = splitRows(matrix, false));
    map = buildHeaderMap(headers);
  }
  const rowHasHeader = offset === 2;
  return rows
    .map((row, index): EstimateLineImportRow => {
      const costCode =
        getCell(row, map.costCode, rowHasHeader ? -1 : 0) ||
        getCell(row, map.csiCode, rowHasHeader ? -1 : 0);
      const csiDivision = normalizeDivision(
        getCell(row, map.csiDivision, rowHasHeader ? -1 : 1),
        costCode,
      );
      const unit = (getCell(row, map.unit, rowHasHeader ? -1 : 4) || "EA").toUpperCase();
      const description = getCell(row, map.description, rowHasHeader ? -1 : 2);
      const unitCost = toCents(getCell(row, map.unitCost));
      const material =
        toCents(getCell(row, map.material, rowHasHeader ? -1 : 6)) ||
        (map.labor >= 0 ? 0 : unitCost);
      const labor = toCents(getCell(row, map.labor, rowHasHeader ? -1 : 7));
      const quantity = toQuantity(getCell(row, map.quantity, rowHasHeader ? -1 : 5), unit);
      const scopeGroup = getCell(row, map.scopeGroup, rowHasHeader ? -1 : 3);
      const notes = getCell(row, map.notes);
      const issues: ImportIssue[] = [];

      if (!description) issues.push({ level: "error", message: "Missing description" });
      if (!unit) issues.push({ level: "error", message: "Missing unit" });
      if (quantity === 0) issues.push({ level: "warning", message: "Quantity is zero" });
      if (csiDivision === "00") {
        issues.push({ level: "warning", message: "No CSI division found; using 00" });
      }
      if (material === 0 && labor === 0) {
        issues.push({ level: "warning", message: "No unit cost found" });
      }

      return {
        rowNumber: index + offset,
        valid: !issues.some((issue) => issue.level === "error"),
        issues,
        csi_division: csiDivision,
        cost_code: normalizeCode(costCode, csiDivision),
        scope_group: scopeGroup,
        description,
        unit,
        quantity,
        material_unit_cost_cents: material,
        labor_unit_cost_cents: labor,
        notes,
      };
    })
    .filter(
      (row) =>
        row.description ||
        row.cost_code ||
        row.material_unit_cost_cents ||
        row.labor_unit_cost_cents,
    );
}

export const costLibraryTemplateCsv = [
  [
    "CSI Division",
    "CSI Code",
    "Description",
    "Category",
    "Unit",
    "Material $/Unit",
    "Labor $/Unit",
    "Crew Size",
    "Production / Hour",
  ],
  ["06", "06 10 00", "Custom framing crew rate", "framing", "HR", "0", "82.50", "3", "1"],
  ["09", "09 91 00", "Interior paint - owner standard", "paint", "SF", "0.58", "1.35", "2", "600"],
]
  .map((row) => row.join(","))
  .join("\n");

export const estimateLineTemplateRows = [
  [
    "Cost Code",
    "CSI Division",
    "Description",
    "Group",
    "Unit",
    "Qty",
    "Material $/Unit",
    "Labor $/Unit",
    "Notes",
  ],
  [
    "06-100",
    "06",
    "Rough framing package",
    "Structure",
    "LS",
    "1",
    "185000",
    "62000",
    "Example row. Replace this with your own master sheet line.",
  ],
  [
    "09-510",
    "09",
    "Interior paint",
    "Finishes",
    "SF",
    "18500",
    "0.58",
    "1.35",
    "Qty x unit costs becomes the direct cost.",
  ],
  [
    "03-300",
    "03",
    "Six-inch slab-on-grade package",
    "Concrete",
    "SF",
    "6200",
    "4.25",
    "3.20",
    "Use SF, LF, CY, EA, LS, MO, HR, or your own unit.",
  ],
  [
    "08-500",
    "08",
    "Window package with install labor",
    "Envelope",
    "EA",
    "42",
    "1850",
    "240",
    "Material and labor should be per unit.",
  ],
  [
    "22-100",
    "22",
    "Plumbing rough-in and fixture allowance",
    "MEP",
    "LS",
    "1",
    "82000",
    "58000",
    "For lump sums, keep Qty at 1.",
  ],
];

export const estimateLineTemplateCsv = estimateLineTemplateRows
  .map((row) => row.join(","))
  .join("\n");
