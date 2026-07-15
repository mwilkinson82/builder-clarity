import {
  canonicalProductionUnit,
  productionScopeKey,
  summarizeProductionScopes,
  type ProductionAnalyticsRow,
} from "@/lib/production-analytics";

export type ProductionForecastStatus =
  "ahead" | "on-pace" | "behind" | "complete" | "missing-plan" | "missing-date" | "no-evidence";

export interface ProductionScopePlan {
  performerKey: string;
  costBucketId: string;
  plannedQuantity: number;
  unit: string;
}

export interface ProductionForecastScope {
  key: string;
  performerKey: string;
  performerName: string;
  costBucketId: string;
  costCode: string;
  scopeName: string;
  unit: string;
  plannedQuantity: number | null;
  installedQuantity: number;
  remainingQuantity: number | null;
  targetDate: string | null;
  workingDaysRemaining: number | null;
  recentWorkingDays: number;
  recentDailyPace: number | null;
  requiredDailyPace: number | null;
  recentLaborRate: number | null;
  targetLaborRate: number | null;
  requiredLaborHoursPerDay: number | null;
  status: ProductionForecastStatus;
  paceVariancePercent: number | null;
}

export interface SovRecommendationInput {
  id: string;
  cost_bucket_id: string | null;
  entry_date: string;
  updated_at: string;
  percent_basis: "sov" | "cpm";
  percent_complete: number;
  wip_reviewed_at: string | null;
}

export interface SovRecommendationBucket {
  id: string;
  cost_code: string;
  bucket: string;
  earned_percent_complete: number;
}

export interface SovCompletionRecommendation {
  costBucketId: string;
  costCode: string;
  scopeName: string;
  currentSovPercent: number;
  recommendedPercent: number;
  evidenceDate: string;
  reviewedAt: string;
  sourceEntryId: string;
}

function parseIsoDate(value: string): Date | null {
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isoDate(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(
    date.getUTCDate(),
  ).padStart(2, "0")}`;
}

function nextDay(value: string): string {
  const parsed = parseIsoDate(value);
  if (!parsed) return value;
  parsed.setUTCDate(parsed.getUTCDate() + 1);
  return isoDate(parsed);
}

export function workingDaysInclusive(from: string, to: string): number {
  const start = parseIsoDate(from);
  const end = parseIsoDate(to);
  if (!start || !end || start > end) return 0;
  let total = 0;
  for (const cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) total += 1;
  }
  return total;
}

function validPlan(
  plan: ProductionScopePlan | undefined,
  unit: string,
): ProductionScopePlan | null {
  if (!plan || plan.plannedQuantity <= 0) return null;
  return canonicalProductionUnit(plan.unit) === unit ? plan : null;
}

function forecastStatus(input: {
  hasPlan: boolean;
  targetDate: string | null;
  remainingQuantity: number | null;
  workingDaysRemaining: number | null;
  recentDailyPace: number | null;
  requiredDailyPace: number | null;
}): ProductionForecastStatus {
  if (!input.hasPlan) return "missing-plan";
  if (!input.targetDate) return "missing-date";
  if (input.remainingQuantity != null && input.remainingQuantity <= 0) return "complete";
  if (input.workingDaysRemaining === 0) return "behind";
  if (input.recentDailyPace == null || input.recentDailyPace <= 0) return "no-evidence";
  if (input.requiredDailyPace == null) return "missing-date";
  const index = input.requiredDailyPace > 0 ? input.recentDailyPace / input.requiredDailyPace : 1;
  if (index > 1.05) return "ahead";
  if (index < 0.95) return "behind";
  return "on-pace";
}

export function buildProductionForecast(input: {
  rows: readonly ProductionAnalyticsRow[];
  plans: readonly ProductionScopePlan[];
  periodFrom: string;
  periodTo: string;
  targetDate: string | null;
}): ProductionForecastScope[] {
  const throughRows = input.rows.filter((row) => row.date <= input.periodTo);
  const recentRows = throughRows.filter(
    (row) => row.date >= input.periodFrom && row.date <= input.periodTo,
  );
  const scopes = summarizeProductionScopes(throughRows);
  const plans = new Map(
    input.plans.map((plan) => [
      [plan.performerKey, plan.costBucketId || "uncoded", canonicalProductionUnit(plan.unit)].join(
        "::",
      ),
      plan,
    ]),
  );

  return scopes.map((scope) => {
    const unit = canonicalProductionUnit(scope.unit);
    const plan = validPlan(plans.get(scope.key), unit);
    const scopeRecentRows = recentRows.filter((row) => productionScopeKey(row) === scope.key);
    const recent = summarizeProductionScopes(scopeRecentRows)[0] ?? null;
    const recentDates = scopeRecentRows.map((row) => row.date).sort();
    const recentStart =
      recentDates[0] && recentDates[0] > input.periodFrom ? recentDates[0] : input.periodFrom;
    const recentWorkingDays = recentDates.length
      ? workingDaysInclusive(recentStart, input.periodTo)
      : 0;
    const recentQuantity = scopeRecentRows.reduce(
      (total, row) => total + Math.max(0, Number(row.quantity) || 0),
      0,
    );
    const recentDailyPace = recentWorkingDays > 0 ? recentQuantity / recentWorkingDays : null;
    const plannedQuantity = plan?.plannedQuantity ?? null;
    const remainingQuantity =
      plannedQuantity == null ? null : Math.max(0, plannedQuantity - scope.quantity);
    const workingDaysRemaining = input.targetDate
      ? workingDaysInclusive(nextDay(input.periodTo), input.targetDate)
      : null;
    const requiredDailyPace =
      remainingQuantity != null && workingDaysRemaining != null && workingDaysRemaining > 0
        ? remainingQuantity / workingDaysRemaining
        : remainingQuantity === 0
          ? 0
          : null;
    const targetLaborRate = recent?.targetRate ?? scope.targetRate;
    const requiredLaborHoursPerDay =
      requiredDailyPace != null && targetLaborRate != null && targetLaborRate > 0
        ? requiredDailyPace / targetLaborRate
        : null;
    const status = forecastStatus({
      hasPlan: plan != null,
      targetDate: input.targetDate,
      remainingQuantity,
      workingDaysRemaining,
      recentDailyPace,
      requiredDailyPace,
    });
    const paceVariancePercent =
      recentDailyPace != null && requiredDailyPace != null && requiredDailyPace > 0
        ? recentDailyPace / requiredDailyPace - 1
        : null;

    return {
      key: scope.key,
      performerKey: scope.performerKey,
      performerName: scope.performerName,
      costBucketId: scope.costBucketId,
      costCode: scope.costCode,
      scopeName: scope.scopeName,
      unit,
      plannedQuantity,
      installedQuantity: scope.quantity,
      remainingQuantity,
      targetDate: input.targetDate,
      workingDaysRemaining,
      recentWorkingDays,
      recentDailyPace,
      requiredDailyPace,
      recentLaborRate: recent?.actualRate ?? null,
      targetLaborRate,
      requiredLaborHoursPerDay,
      status,
      paceVariancePercent,
    };
  });
}

export function buildSovCompletionRecommendations(
  entries: readonly SovRecommendationInput[],
  buckets: readonly SovRecommendationBucket[],
  throughDate: string,
): SovCompletionRecommendation[] {
  const latestByBucket = new Map<string, SovRecommendationInput>();
  for (const entry of entries) {
    if (
      !entry.cost_bucket_id ||
      entry.percent_basis !== "sov" ||
      !entry.wip_reviewed_at ||
      entry.entry_date > throughDate
    ) {
      continue;
    }
    const current = latestByBucket.get(entry.cost_bucket_id);
    if (
      !current ||
      `${entry.entry_date}|${entry.updated_at}|${entry.id}` >
        `${current.entry_date}|${current.updated_at}|${current.id}`
    ) {
      latestByBucket.set(entry.cost_bucket_id, entry);
    }
  }

  return buckets
    .flatMap((bucket): SovCompletionRecommendation[] => {
      const entry = latestByBucket.get(bucket.id);
      if (!entry) return [];
      return [
        {
          costBucketId: bucket.id,
          costCode: bucket.cost_code,
          scopeName: bucket.bucket,
          currentSovPercent: Math.min(100, Math.max(0, bucket.earned_percent_complete)),
          recommendedPercent: Math.min(100, Math.max(0, entry.percent_complete)),
          evidenceDate: entry.entry_date,
          reviewedAt: entry.wip_reviewed_at ?? entry.updated_at,
          sourceEntryId: entry.id,
        },
      ];
    })
    .sort((a, b) => a.costCode.localeCompare(b.costCode) || a.scopeName.localeCompare(b.scopeName));
}
