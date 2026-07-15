export type ProductionGrain = "day" | "week" | "month";
export type ProductionPerformerType = "self-perform" | "subcontractor";
export type ProductionStatus = "ahead" | "on-pace" | "behind" | "unmeasured";

export interface ProductionAnalyticsRow {
  id: string;
  date: string;
  performerKey: string;
  performerName: string;
  performerType: ProductionPerformerType;
  costBucketId: string;
  costCode: string;
  scopeName: string;
  activity: string;
  quantity: number;
  unit: string;
  laborHours: number;
  targetRate: number | null;
  fieldValue: number;
}

export interface PortfolioProductionAnalyticsRow extends ProductionAnalyticsRow {
  projectId: string;
  projectName: string;
  jobNumber: string;
  projectManager: string;
}

export interface ProductionProjectMeta {
  id: string;
  name: string;
  jobNumber: string;
  projectManager: string;
}

export interface ProductionAggregate {
  quantity: number;
  unit: string | null;
  laborHours: number;
  measuredLaborHours: number;
  coveredLaborHours: number;
  earnedLaborHours: number;
  coveragePercent: number;
  actualRate: number | null;
  targetRate: number | null;
  performanceIndex: number | null;
  variancePercent: number | null;
  hoursVariance: number | null;
  fieldValue: number;
  fieldValuePerUnit: number | null;
  measuredScopeCount: number;
  status: ProductionStatus;
}

export interface ProductionScopeSummary extends ProductionAggregate {
  key: string;
  performerKey: string;
  performerName: string;
  performerType: ProductionPerformerType;
  costBucketId: string;
  costCode: string;
  scopeName: string;
  loggedDays: number;
  rowCount: number;
}

export interface ProductionProjectSummary extends ProductionAggregate, ProductionProjectMeta {
  loggedDays: number;
  rowCount: number;
  performerCount: number;
  scopesBehind: number;
  lastFieldDate: string | null;
}

export interface ProductionPeriodPoint extends ProductionAggregate {
  key: string;
  date: string;
  label: string;
  trendRate: number | null;
  trendTargetRate: number | null;
  trendPerformanceIndex: number | null;
}

const numberValue = (value: unknown): number => {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const positive = (value: unknown): number => Math.max(0, numberValue(value));

const UNIT_ALIASES: Record<string, string> = {
  "SQ FT": "SF",
  SQFT: "SF",
  "SQUARE FOOT": "SF",
  "SQUARE FEET": "SF",
  "LIN FT": "LF",
  "LINEAR FT": "LF",
  "LINEAL FT": "LF",
  "LINEAR FOOT": "LF",
  "LINEAR FEET": "LF",
  "CU YD": "CY",
  "CUBIC YARD": "CY",
  "CUBIC YARDS": "CY",
  EACH: "EA",
  COUNT: "EA",
  PCS: "EA",
  PIECES: "EA",
  "SQ YD": "SY",
  "SQUARE YARD": "SY",
  "SQUARE YARDS": "SY",
};

export function canonicalProductionUnit(value: string | null | undefined): string {
  const normalized = (value ?? "")
    .trim()
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .toUpperCase();
  if (!normalized) return "UNMEASURED";
  return UNIT_ALIASES[normalized] ?? normalized;
}

export function productionScopeKey(
  row: Pick<ProductionAnalyticsRow, "performerKey" | "costBucketId" | "unit">,
): string {
  return [row.performerKey, row.costBucketId || "uncoded", canonicalProductionUnit(row.unit)].join(
    "::",
  );
}

function productionStatus(index: number | null, tolerance = 0.05): ProductionStatus {
  if (index == null) return "unmeasured";
  if (index > 1 + tolerance) return "ahead";
  if (index < 1 - tolerance) return "behind";
  return "on-pace";
}

function aggregateRows(rows: readonly ProductionAnalyticsRow[]): ProductionAggregate {
  let quantity = 0;
  let laborHours = 0;
  let measuredLaborHours = 0;
  let coveredLaborHours = 0;
  let earnedLaborHours = 0;
  let coveredQuantity = 0;
  let fieldValue = 0;
  const units = new Set<string>();
  const measuredScopes = new Set<string>();

  for (const row of rows) {
    const rowQuantity = positive(row.quantity);
    const rowHours = positive(row.laborHours);
    const targetRate = positive(row.targetRate);
    const unit = canonicalProductionUnit(row.unit);
    laborHours += rowHours;
    fieldValue += numberValue(row.fieldValue);

    if (rowQuantity > 0 && unit !== "UNMEASURED") {
      quantity += rowQuantity;
      units.add(unit);
      measuredScopes.add(productionScopeKey(row));
      if (rowHours > 0) measuredLaborHours += rowHours;
    }

    if (rowQuantity > 0 && rowHours > 0 && targetRate > 0 && unit !== "UNMEASURED") {
      coveredQuantity += rowQuantity;
      coveredLaborHours += rowHours;
      earnedLaborHours += rowQuantity / targetRate;
    }
  }

  const unit = units.size === 1 ? [...units][0] : null;
  const actualRate = unit && measuredLaborHours > 0 ? quantity / measuredLaborHours : null;
  const targetRate = unit && earnedLaborHours > 0 ? coveredQuantity / earnedLaborHours : null;
  const performanceIndex = coveredLaborHours > 0 ? earnedLaborHours / coveredLaborHours : null;
  const variancePercent = performanceIndex == null ? null : performanceIndex - 1;
  const hoursVariance = performanceIndex == null ? null : coveredLaborHours - earnedLaborHours;
  const coveragePercent = laborHours > 0 ? coveredLaborHours / laborHours : 0;
  const fieldValuePerUnit = unit && quantity > 0 ? fieldValue / quantity : null;

  return {
    quantity,
    unit,
    laborHours,
    measuredLaborHours,
    coveredLaborHours,
    earnedLaborHours,
    coveragePercent,
    actualRate,
    targetRate,
    performanceIndex,
    variancePercent,
    hoursVariance,
    fieldValue,
    fieldValuePerUnit,
    measuredScopeCount: measuredScopes.size,
    status: productionStatus(performanceIndex),
  };
}

export function summarizeProduction(rows: readonly ProductionAnalyticsRow[]): ProductionAggregate {
  return aggregateRows(rows);
}

export function summarizeProductionScopes(
  rows: readonly ProductionAnalyticsRow[],
): ProductionScopeSummary[] {
  const grouped = new Map<string, ProductionAnalyticsRow[]>();
  for (const row of rows) {
    const key = productionScopeKey(row);
    const current = grouped.get(key) ?? [];
    current.push(row);
    grouped.set(key, current);
  }

  return [...grouped.entries()]
    .map(([key, group]) => {
      const first = group[0];
      return {
        key,
        performerKey: first.performerKey,
        performerName: first.performerName,
        performerType: first.performerType,
        costBucketId: first.costBucketId,
        costCode: first.costCode,
        scopeName: first.scopeName,
        loggedDays: new Set(group.map((row) => row.date)).size,
        rowCount: group.length,
        ...aggregateRows(group),
      };
    })
    .sort((a, b) => {
      const aIndex = a.performanceIndex ?? Number.POSITIVE_INFINITY;
      const bIndex = b.performanceIndex ?? Number.POSITIVE_INFINITY;
      if (aIndex !== bIndex) return aIndex - bIndex;
      return `${a.costCode}|${a.scopeName}|${a.performerName}`.localeCompare(
        `${b.costCode}|${b.scopeName}|${b.performerName}`,
      );
    });
}

export function summarizeProductionProjects(
  rows: readonly PortfolioProductionAnalyticsRow[],
  projects: readonly ProductionProjectMeta[],
): ProductionProjectSummary[] {
  const rowsByProject = new Map<string, PortfolioProductionAnalyticsRow[]>();
  for (const row of rows) {
    const current = rowsByProject.get(row.projectId) ?? [];
    current.push(row);
    rowsByProject.set(row.projectId, current);
  }

  return projects
    .map((project) => {
      const projectRows = rowsByProject.get(project.id) ?? [];
      const scopeSummaries = summarizeProductionScopes(projectRows);
      const dates = projectRows
        .map((row) => row.date)
        .filter(Boolean)
        .sort();
      return {
        ...project,
        ...aggregateRows(projectRows),
        loggedDays: new Set(dates).size,
        rowCount: projectRows.length,
        performerCount: new Set(projectRows.map((row) => row.performerKey)).size,
        scopesBehind: scopeSummaries.filter((scope) => scope.status === "behind").length,
        lastFieldDate: dates.at(-1) ?? null,
      };
    })
    .sort((a, b) => {
      if (a.rowCount === 0 || b.rowCount === 0) {
        if (a.rowCount !== b.rowCount) return a.rowCount === 0 ? 1 : -1;
      }
      const aIndex = a.performanceIndex ?? Number.POSITIVE_INFINITY;
      const bIndex = b.performanceIndex ?? Number.POSITIVE_INFINITY;
      if (aIndex !== bIndex) return aIndex - bIndex;
      return a.name.localeCompare(b.name);
    });
}

function parseIsoDate(value: string): Date | null {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toIsoDate(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(
    date.getUTCDate(),
  ).padStart(2, "0")}`;
}

function periodKey(value: string, grain: ProductionGrain): string {
  const date = parseIsoDate(value);
  if (!date) return value;
  if (grain === "month") {
    date.setUTCDate(1);
  } else if (grain === "week") {
    const mondayOffset = (date.getUTCDay() + 6) % 7;
    date.setUTCDate(date.getUTCDate() - mondayOffset);
  }
  return toIsoDate(date);
}

function periodLabel(value: string, grain: ProductionGrain): string {
  const date = parseIsoDate(value);
  if (!date) return value;
  if (grain === "month") {
    return date.toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" });
  }
  const formatted = date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  return grain === "week" ? `Week of ${formatted}` : formatted;
}

function rollingAggregate(
  points: readonly (ProductionAggregate & { rows: ProductionAnalyticsRow[] })[],
  index: number,
  window: number,
): ProductionAggregate {
  const from = Math.max(0, index - window + 1);
  return aggregateRows(points.slice(from, index + 1).flatMap((point) => point.rows));
}

export function aggregateProductionSeries(
  rows: readonly ProductionAnalyticsRow[],
  grain: ProductionGrain,
): ProductionPeriodPoint[] {
  const grouped = new Map<string, ProductionAnalyticsRow[]>();
  for (const row of rows) {
    const key = periodKey(row.date, grain);
    const current = grouped.get(key) ?? [];
    current.push(row);
    grouped.set(key, current);
  }

  const raw = [...grouped.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, periodRows]) => ({ key, rows: periodRows, ...aggregateRows(periodRows) }));
  const rollingWindow = grain === "day" ? 5 : 3;

  return raw.map((point, index) => {
    const trend = rollingAggregate(raw, index, rollingWindow);
    return {
      key: point.key,
      date: point.key,
      label: periodLabel(point.key, grain),
      quantity: point.quantity,
      unit: point.unit,
      laborHours: point.laborHours,
      measuredLaborHours: point.measuredLaborHours,
      coveredLaborHours: point.coveredLaborHours,
      earnedLaborHours: point.earnedLaborHours,
      coveragePercent: point.coveragePercent,
      actualRate: point.actualRate,
      targetRate: point.targetRate,
      performanceIndex: point.performanceIndex,
      variancePercent: point.variancePercent,
      hoursVariance: point.hoursVariance,
      fieldValue: point.fieldValue,
      fieldValuePerUnit: point.fieldValuePerUnit,
      measuredScopeCount: point.measuredScopeCount,
      status: point.status,
      trendRate: trend.actualRate,
      trendTargetRate: trend.targetRate,
      trendPerformanceIndex: trend.performanceIndex,
    };
  });
}

export function shiftIsoDate(value: string, days: number): string {
  const date = parseIsoDate(value);
  if (!date) return value;
  date.setUTCDate(date.getUTCDate() + days);
  return toIsoDate(date);
}

export function inclusiveDateSpan(from: string, to: string): number {
  const start = parseIsoDate(from);
  const end = parseIsoDate(to);
  if (!start || !end) return 1;
  return Math.max(1, Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1);
}
