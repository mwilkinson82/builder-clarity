import { laborHours, subCommitmentKey, subEarnedValue, type DailyWipRowLike } from "./daily-wip.ts";

export interface ProductionBucketLike {
  id: string;
  cost_code: string;
  bucket: string;
  contract_quantity?: number;
  unit?: string;
}

export interface SubcontractProductionEntry extends DailyWipRowLike {
  subcontractor_id?: string | null;
  cost_bucket_id?: string | null;
  entry_date?: string;
  updated_at?: string;
  percent_complete?: number;
  unit?: string;
  target_production_rate?: number | null;
}

export interface ProductionBenchmarkSetting {
  plannedQuantity: number;
  unit: string;
  benchmarkLaborRate: number;
}

export type ProductionPaceStatus = "ahead" | "on-pace" | "behind";
export type QuantityAlignmentStatus =
  "aligned" | "above-progress" | "below-progress" | "unmeasured";

export interface SubcontractProductionBenchmark {
  key: string;
  subcontractorId: string;
  costBucketId: string;
  costCode: string;
  scope: string;
  commitment: number;
  unit: string;
  plannedQuantity: number | null;
  installedQuantity: number;
  laborHours: number;
  actualRate: number | null;
  targetRate: number | null;
  paceVariancePercent: number | null;
  paceStatus: ProductionPaceStatus | null;
  latestPercent: number;
  earnedSubcontractCost: number;
  buyoutUnitCost: number | null;
  earnedCostPerLoggedUnit: number | null;
  benchmarkLaborRate: number | null;
  laborEquivalentHours: number | null;
  benchmarkLaborCostPerActualUnit: number | null;
  allInCarryPerObservedHour: number | null;
  targetSource: "derived" | "manual" | null;
  expectedInstalledQuantity: number | null;
  quantityVariance: number | null;
  quantityVariancePercent: number | null;
  alignmentStatus: QuantityAlignmentStatus;
  loggedDays: number;
  mixedUnits: boolean;
  sharedSovLine: boolean;
}

interface BenchmarkAccumulator {
  subcontractorId: string;
  costBucketId: string;
  entries: SubcontractProductionEntry[];
}

const numberValue = (value: unknown): number => {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizedUnit = (value: string | null | undefined): string =>
  (value ?? "").trim().toLowerCase();

const rowTimestamp = (row: SubcontractProductionEntry): string =>
  `${row.entry_date ?? ""}|${row.updated_at ?? ""}`;

function latestRow(rows: readonly SubcontractProductionEntry[]): SubcontractProductionEntry | null {
  let latest: SubcontractProductionEntry | null = null;
  for (const row of rows) {
    if (!latest || rowTimestamp(row) > rowTimestamp(latest)) latest = row;
  }
  return latest;
}

function latestTarget(rows: readonly SubcontractProductionEntry[]): number | null {
  const candidates = rows
    .filter((row) => numberValue(row.target_production_rate) > 0)
    .sort((a, b) => rowTimestamp(a).localeCompare(rowTimestamp(b)));
  const target = numberValue(candidates.at(-1)?.target_production_rate);
  return target > 0 ? target : null;
}

function paceVerdict(
  actualRate: number | null,
  targetRate: number | null,
  tolerance = 0.05,
): Pick<SubcontractProductionBenchmark, "paceVariancePercent" | "paceStatus"> {
  if (actualRate == null || targetRate == null || targetRate <= 0) {
    return { paceVariancePercent: null, paceStatus: null };
  }
  const paceVariancePercent = (actualRate - targetRate) / targetRate;
  const paceStatus: ProductionPaceStatus =
    paceVariancePercent > tolerance
      ? "ahead"
      : paceVariancePercent < -tolerance
        ? "behind"
        : "on-pace";
  return { paceVariancePercent, paceStatus };
}

function alignmentVerdict(
  installedQuantity: number,
  plannedQuantity: number | null,
  latestPercent: number,
  usableUnits: boolean,
  tolerance = 0.08,
): Pick<
  SubcontractProductionBenchmark,
  "expectedInstalledQuantity" | "quantityVariance" | "quantityVariancePercent" | "alignmentStatus"
> {
  if (!usableUnits || plannedQuantity == null || plannedQuantity <= 0 || latestPercent <= 0) {
    return {
      expectedInstalledQuantity: null,
      quantityVariance: null,
      quantityVariancePercent: null,
      alignmentStatus: "unmeasured",
    };
  }
  const expectedInstalledQuantity = plannedQuantity * (latestPercent / 100);
  if (expectedInstalledQuantity <= 0) {
    return {
      expectedInstalledQuantity: null,
      quantityVariance: null,
      quantityVariancePercent: null,
      alignmentStatus: "unmeasured",
    };
  }
  const quantityVariance = installedQuantity - expectedInstalledQuantity;
  const quantityVariancePercent = quantityVariance / expectedInstalledQuantity;
  const alignmentStatus: QuantityAlignmentStatus =
    Math.abs(quantityVariancePercent) <= tolerance
      ? "aligned"
      : quantityVariancePercent > 0
        ? "above-progress"
        : "below-progress";
  return {
    expectedInstalledQuantity,
    quantityVariance,
    quantityVariancePercent,
    alignmentStatus,
  };
}

/**
 * Turns subcontract-tagged Daily WIP history into a purchased-scope benchmark.
 *
 * This deliberately does not claim to know a subcontractor's internal labor
 * cost. The economic measures are the GC's executed commitment per planned SOV
 * unit and earned commitment per field-logged unit. Production is physical
 * quantity per labor-hour from the Daily Report.
 */
export function subcontractProductionBenchmarks(
  entries: readonly SubcontractProductionEntry[],
  buckets: readonly ProductionBucketLike[],
  commitments: ReadonlyMap<string, number>,
  settings: ReadonlyMap<string, ProductionBenchmarkSetting> = new Map(),
): SubcontractProductionBenchmark[] {
  const bucketById = new Map(buckets.map((bucket) => [bucket.id, bucket] as const));
  const grouped = new Map<string, BenchmarkAccumulator>();

  for (const entry of entries) {
    const key = subCommitmentKey(entry.subcontractor_id, entry.cost_bucket_id);
    if (!key || !commitments.has(key)) continue;
    const current = grouped.get(key) ?? {
      subcontractorId: entry.subcontractor_id as string,
      costBucketId: entry.cost_bucket_id as string,
      entries: [],
    };
    current.entries.push(entry);
    grouped.set(key, current);
  }

  const groupsPerBucket = new Map<string, number>();
  for (const group of grouped.values()) {
    groupsPerBucket.set(group.costBucketId, (groupsPerBucket.get(group.costBucketId) ?? 0) + 1);
  }

  const benchmarks: SubcontractProductionBenchmark[] = [];
  for (const [key, group] of grouped) {
    const bucket = bucketById.get(group.costBucketId);
    const setting = settings.get(key);
    const commitment = numberValue(commitments.get(key));
    const latest = latestRow(group.entries);
    const latestPercent = Math.max(0, Math.min(100, numberValue(latest?.percent_complete)));
    const sharedSovLine = (groupsPerBucket.get(group.costBucketId) ?? 0) > 1;
    const plannedUnit = normalizedUnit(setting?.unit || bucket?.unit);
    const entryUnits = new Set(
      group.entries
        .filter((row) => numberValue(row.quantity) > 0)
        .map((row) => normalizedUnit(row.unit))
        .filter(Boolean),
    );
    const unit =
      (setting?.unit ?? "").trim() ||
      (bucket?.unit ?? "").trim() ||
      group.entries.find((row) => row.unit?.trim())?.unit?.trim() ||
      "unit";
    const effectiveUnit = normalizedUnit(unit);
    const mixedUnits =
      entryUnits.size > 1 ||
      (plannedUnit !== "" && entryUnits.size > 0 && !entryUnits.has(plannedUnit));
    const matchingEntries = mixedUnits
      ? group.entries.filter((row) => normalizedUnit(row.unit) === effectiveUnit)
      : group.entries;
    const installedQuantity = matchingEntries.reduce(
      (sum, row) => sum + Math.max(0, numberValue(row.quantity)),
      0,
    );
    const totalLaborHours = matchingEntries.reduce((sum, row) => sum + laborHours(row), 0);
    const actualRate =
      installedQuantity > 0 && totalLaborHours > 0 ? installedQuantity / totalLaborHours : null;
    const rawPlannedQuantity = numberValue(setting?.plannedQuantity || bucket?.contract_quantity);
    // A configured benchmark explicitly chooses the production measure for
    // this subcontract scope. Daily Reports may retain ancillary quantities
    // (for example boxes and wire alongside LF of conduit); those extra units
    // must not invalidate the selected LF comparison.
    const unitsComparable = !mixedUnits || setting != null;
    const plannedQuantity =
      (setting != null || !sharedSovLine) && unitsComparable && rawPlannedQuantity > 0
        ? rawPlannedQuantity
        : null;
    const buyoutUnitCost =
      plannedQuantity != null && plannedQuantity > 0 ? commitment / plannedQuantity : null;
    const rawBenchmarkLaborRate = numberValue(setting?.benchmarkLaborRate);
    const benchmarkLaborRate = rawBenchmarkLaborRate > 0 ? rawBenchmarkLaborRate : null;
    const laborEquivalentHours =
      benchmarkLaborRate != null && commitment > 0 ? commitment / benchmarkLaborRate : null;
    const derivedTargetRate =
      plannedQuantity != null && laborEquivalentHours != null && laborEquivalentHours > 0
        ? plannedQuantity / laborEquivalentHours
        : null;
    const manualTargetRate = latestTarget(group.entries);
    const targetRate = derivedTargetRate ?? manualTargetRate;
    const targetSource =
      derivedTargetRate != null ? "derived" : manualTargetRate != null ? "manual" : null;
    const pace = paceVerdict(actualRate, targetRate);
    const earnedSubcontractCost = subEarnedValue(commitment, latestPercent);
    const earnedCostPerLoggedUnit =
      installedQuantity > 0 ? earnedSubcontractCost / installedQuantity : null;
    const benchmarkLaborCostPerActualUnit =
      benchmarkLaborRate != null && actualRate != null && actualRate > 0
        ? benchmarkLaborRate / actualRate
        : null;
    const allInCarryPerObservedHour =
      buyoutUnitCost != null && actualRate != null ? buyoutUnitCost * actualRate : null;
    const alignment = alignmentVerdict(
      installedQuantity,
      plannedQuantity,
      latestPercent,
      unitsComparable,
    );

    benchmarks.push({
      key,
      subcontractorId: group.subcontractorId,
      costBucketId: group.costBucketId,
      costCode: bucket?.cost_code ?? "",
      scope: bucket?.bucket ?? "Uncoded scope",
      commitment,
      unit,
      plannedQuantity,
      installedQuantity,
      laborHours: totalLaborHours,
      actualRate,
      targetRate,
      ...pace,
      latestPercent,
      earnedSubcontractCost,
      buyoutUnitCost,
      earnedCostPerLoggedUnit,
      benchmarkLaborRate,
      laborEquivalentHours,
      benchmarkLaborCostPerActualUnit,
      allInCarryPerObservedHour,
      targetSource,
      ...alignment,
      loggedDays: new Set(group.entries.map((row) => row.entry_date).filter(Boolean)).size,
      mixedUnits,
      sharedSovLine,
    });
  }

  return benchmarks.sort((a, b) =>
    `${a.costCode}|${a.scope}|${a.subcontractorId}`.localeCompare(
      `${b.costCode}|${b.scope}|${b.subcontractorId}`,
    ),
  );
}
