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
  crewCount?: number;
  peoplePerCrew?: number;
  blendedLaborRate?: number;
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

export type ProductionBenchmarkConfidence = "low" | "building" | "strong";

export interface ProductionBenchmarkSummary {
  key: string;
  costCode: string;
  scopeName: string;
  unit: string;
  performerType: ProductionPerformerType;
  quantity: number;
  laborHours: number;
  actualRate: number;
  planningRate: number;
  targetRate: number | null;
  targetCoveragePercent: number;
  targetVariancePercent: number | null;
  fieldValuePerUnit: number | null;
  blendedLaborRate: number | null;
  modeledLaborCostPerUnit: number | null;
  typicalPeoplePerCrew: number | null;
  typicalCrewCount: number | null;
  projectCount: number;
  projectIds: string[];
  projectNames: string[];
  performerCount: number;
  performerNames: string[];
  fieldDays: number;
  rowCount: number;
  confidence: ProductionBenchmarkConfidence;
  lastFieldDate: string;
  lastProjectId: string;
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

function weightedPercentile(
  values: readonly { value: number; weight: number }[],
  percentile: number,
): number | null {
  const valid = values
    .filter((item) => item.value > 0 && item.weight > 0)
    .sort((a, b) => a.value - b.value);
  const totalWeight = valid.reduce((sum, item) => sum + item.weight, 0);
  if (totalWeight <= 0) return null;
  const threshold = totalWeight * Math.min(1, Math.max(0, percentile));
  let cumulative = 0;
  for (const item of valid) {
    cumulative += item.weight;
    if (cumulative >= threshold) return item.value;
  }
  return valid.at(-1)?.value ?? null;
}

function weightedAverage(
  rows: readonly PortfolioProductionAnalyticsRow[],
  value: (row: PortfolioProductionAnalyticsRow) => number,
): number | null {
  let weightedTotal = 0;
  let totalWeight = 0;
  for (const row of rows) {
    const next = positive(value(row));
    const weight = positive(row.laborHours);
    if (next <= 0 || weight <= 0) continue;
    weightedTotal += next * weight;
    totalWeight += weight;
  }
  return totalWeight > 0 ? weightedTotal / totalWeight : null;
}

function mostObservedScopeName(rows: readonly PortfolioProductionAnalyticsRow[]): string {
  const weights = new Map<string, number>();
  for (const row of rows) {
    const name = row.scopeName.trim() || "Uncoded scope";
    weights.set(name, (weights.get(name) ?? 0) + positive(row.laborHours));
  }
  return (
    [...weights.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ??
    "Uncoded scope"
  );
}

function benchmarkConfidence(
  projectCount: number,
  fieldDays: number,
  laborHoursValue: number,
): ProductionBenchmarkConfidence {
  if (projectCount >= 3 && fieldDays >= 10 && laborHoursValue >= 160) return "strong";
  if (projectCount >= 2 && fieldDays >= 5 && laborHoursValue >= 40) return "building";
  return "low";
}

export function productionBenchmarkKey(
  row: Pick<PortfolioProductionAnalyticsRow, "costCode" | "unit" | "performerType">,
): string {
  return [
    row.costCode.trim().toUpperCase() || "UNCODED",
    canonicalProductionUnit(row.unit),
    row.performerType,
  ].join("::");
}

export function summarizeProductionBenchmarks(
  rows: readonly PortfolioProductionAnalyticsRow[],
): ProductionBenchmarkSummary[] {
  const grouped = new Map<string, PortfolioProductionAnalyticsRow[]>();
  for (const row of rows) {
    if (
      positive(row.quantity) <= 0 ||
      positive(row.laborHours) <= 0 ||
      canonicalProductionUnit(row.unit) === "UNMEASURED"
    ) {
      continue;
    }
    const key = productionBenchmarkKey(row);
    const current = grouped.get(key) ?? [];
    current.push(row);
    grouped.set(key, current);
  }

  const confidenceRank: Record<ProductionBenchmarkConfidence, number> = {
    strong: 2,
    building: 1,
    low: 0,
  };

  return [...grouped.entries()]
    .map(([key, group]) => {
      const first = group[0];
      const aggregate = aggregateRows(group);
      const actualRate = aggregate.actualRate ?? 0;
      const slowerQuartile =
        weightedPercentile(
          group.map((row) => ({
            value: positive(row.quantity) / positive(row.laborHours),
            weight: positive(row.laborHours),
          })),
          0.25,
        ) ?? actualRate;
      const planningRate = Math.min(actualRate, slowerQuartile);
      const projectIds = [...new Set(group.map((row) => row.projectId))];
      const projectNames = [...new Set(group.map((row) => row.projectName))].sort();
      const performerNames = [...new Set(group.map((row) => row.performerName))].sort();
      const fieldDays = new Set(group.map((row) => `${row.projectId}:${row.date}`)).size;
      const dates = group
        .map((row) => row.date)
        .filter(Boolean)
        .sort();
      const lastFieldDate = dates.at(-1) ?? "";
      const lastProjectId =
        group
          .filter((row) => row.date === lastFieldDate)
          .sort((a, b) => a.projectName.localeCompare(b.projectName))[0]?.projectId ??
        first.projectId;
      const blendedLaborRate = weightedAverage(group, (row) => row.blendedLaborRate ?? 0);
      const typicalPeoplePerCrew = weightedAverage(group, (row) => row.peoplePerCrew ?? 0);
      const typicalCrewCount = weightedAverage(group, (row) => row.crewCount ?? 0);
      const targetVariancePercent =
        aggregate.targetRate != null && aggregate.targetRate > 0
          ? actualRate / aggregate.targetRate - 1
          : null;

      return {
        key,
        costCode: first.costCode.trim() || "Uncoded",
        scopeName: mostObservedScopeName(group),
        unit: canonicalProductionUnit(first.unit),
        performerType: first.performerType,
        quantity: aggregate.quantity,
        laborHours: aggregate.laborHours,
        actualRate,
        planningRate,
        targetRate: aggregate.targetRate,
        targetCoveragePercent: aggregate.coveragePercent,
        targetVariancePercent,
        fieldValuePerUnit: aggregate.fieldValuePerUnit,
        blendedLaborRate,
        modeledLaborCostPerUnit:
          blendedLaborRate != null && planningRate > 0 ? blendedLaborRate / planningRate : null,
        typicalPeoplePerCrew,
        typicalCrewCount,
        projectCount: projectIds.length,
        projectIds,
        projectNames,
        performerCount: performerNames.length,
        performerNames,
        fieldDays,
        rowCount: group.length,
        confidence: benchmarkConfidence(projectIds.length, fieldDays, aggregate.laborHours),
        lastFieldDate,
        lastProjectId,
      } satisfies ProductionBenchmarkSummary;
    })
    .sort((a, b) => {
      const confidenceDifference = confidenceRank[b.confidence] - confidenceRank[a.confidence];
      if (confidenceDifference !== 0) return confidenceDifference;
      if (a.laborHours !== b.laborHours) return b.laborHours - a.laborHours;
      return `${a.costCode}|${a.unit}|${a.performerType}`.localeCompare(
        `${b.costCode}|${b.unit}|${b.performerType}`,
      );
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
