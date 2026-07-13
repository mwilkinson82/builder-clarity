// Pure IOR math — used both server-side (in projects.functions.ts) and client-side
// for tooltips and warning display. No imports of anything env-dependent.
import { subCostAddition } from "./subcontract-budget.ts";

export type Phase = "Early" | "Middle" | "Late";
export type COStatus = "Approved" | "Pending" | "Denied";
export type ExposureCategory =
  | "owner_decision"
  | "design_drift"
  | "trade_performance"
  | "procurement"
  | "schedule_compression"
  | "allowance_overrun"
  | "field_change"
  | "closeout_punch"
  | "other";
export type ResponsePath = "eliminate" | "recover" | "offset" | "accept";
export type HoldClass = "E-Hold" | "C-Hold" | "Both" | "None";
export type ExposureStatus =
  "active" | "escalated" | "recovered" | "eliminated" | "accepted" | "released";

export interface BucketLite {
  // Optional so existing callers/fixtures don't break; needed only to match the
  // subcontractor layer per cost code when it's supplied.
  id?: string;
  bucket: string;
  original_budget: number;
  actual_to_date: number;
  ftc: number;
}

export interface ChangeOrderLite {
  contract_amount: number;
  cost_amount: number;
  status: COStatus;
  probability: number;
}

export interface ExposureLite {
  category: ExposureCategory;
  dollar_exposure: number;
  probability: number;
  hold_class: HoldClass;
  status: ExposureStatus;
  response_path: ResponsePath;
  released_amount?: number | null;
  opened_at?: string | null;
  next_review_at?: string | null;
}

export interface ProjectLite {
  original_contract: number;
  original_cost_budget: number;
  phase: Phase;
  percent_complete: number;
  schedule_variance_weeks: number;
  forecast_completion_date?: string | null;
  baseline_completion_date?: string | null;
}

export function computeScheduleVarianceWeeks(baseline?: string | null, forecast?: string | null) {
  if (!baseline || !forecast) return null;
  const start = new Date(`${baseline}T00:00:00`);
  const finish = new Date(`${forecast}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(finish.getTime())) return null;
  return Math.round((finish.getTime() - start.getTime()) / 604800000);
}

export interface Rollup {
  originalContract: number;
  approvedCOContract: number;
  currentSignedContract: number;
  weightedPendingCOContract: number;
  pendingCOContract: number;
  forecastedFinalContract: number;
  actualToDate: number;
  ftc: number;
  baseProjectedCost: number;
  approvedCOCost: number;
  weightedPendingCOCost: number;
  forecastedFinalCost: number;
  exposureHolds: number;
  contingencyHold: number;
  forecastedGPBeforeHolds: number;
  indicatedGP: number;
  originalGP: number;
  currentSignedGP: number;
  indicatedGPpct: number;
  originalGPpct: number;
  currentSignedGPpct: number;
  gpAtRisk: number;
  remainingCost: number;
}

export function weightedExposureValue(e: ExposureLite) {
  const exposure = Math.max(0, e.dollar_exposure);
  const probability = Math.max(0, Math.min(100, e.probability));
  return exposure * (probability / 100);
}

export function releasedExposureValue(e: ExposureLite) {
  const released = Math.max(0, e.released_amount ?? 0);
  return Math.min(weightedExposureValue(e), released);
}

export function remainingExposureValue(e: ExposureLite) {
  return Math.max(0, weightedExposureValue(e) - releasedExposureValue(e));
}

function isStatusActive(e: ExposureLite) {
  return e.status === "active" || e.status === "escalated";
}

function carriesRemainingRisk(e: ExposureLite) {
  return remainingExposureValue(e) > 0;
}

export function computeRollup(
  project: ProjectLite,
  buckets: BucketLite[],
  cos: ChangeOrderLite[],
  exposures: ExposureLite[],
  // The subcontractor cost layer per cost code (paid/open/committed). Optional so
  // existing callers are unchanged (no subs → no effect). When supplied, sub cost
  // flows into the forecasted cost — a buyout that pops a line pulls GP down,
  // exactly like the Budget tab — instead of the dashboard GP ignoring it.
  subCostByBucket: ReadonlyMap<
    string,
    { paid: number; open: number; committed?: number }
  > = new Map(),
): Rollup {
  const approved = cos.filter((c) => c.status === "Approved");
  const pending = cos.filter((c) => c.status === "Pending");

  const approvedCOContract = approved.reduce((s, c) => s + c.contract_amount, 0);
  const approvedCOCost = approved.reduce((s, c) => s + c.cost_amount, 0);
  const pendingCOContract = pending.reduce((s, c) => s + c.contract_amount, 0);
  const weightedPendingCOContract = pending.reduce(
    (s, c) => s + c.contract_amount * (c.probability / 100),
    0,
  );
  const weightedPendingCOCost = pending.reduce(
    (s, c) => s + c.cost_amount * (c.probability / 100),
    0,
  );

  // Raw self-perform actuals/forecast (returned as-is; the Budget-tab cards add
  // the sub layer to THESE, so they must stay raw to avoid double-counting).
  const actualToDate = buckets.reduce((s, b) => s + b.actual_to_date, 0);
  const ftc = buckets.reduce((s, b) => s + b.ftc, 0);

  // The subcontractor layer folds into the FORECASTED cost (and thus GP): a
  // buyout that exceeds a line's budget pushes the projected cost up and GP down.
  const subAdd = subCostAddition(buckets, subCostByBucket);
  const bucketCostBase =
    buckets.length === 0 ? project.original_cost_budget : actualToDate + ftc + subAdd;

  const currentSignedContract = project.original_contract + approvedCOContract;
  const forecastedFinalContract = currentSignedContract + weightedPendingCOContract;
  const forecastedFinalCost = bucketCostBase + approvedCOCost + weightedPendingCOCost;

  const carrying = exposures.filter(carriesRemainingRisk);
  const exposureHolds = carrying
    .filter((e) => e.hold_class === "E-Hold" || e.hold_class === "Both")
    .reduce((s, e) => s + remainingExposureValue(e), 0);
  const contingencyHold = carrying
    .filter((e) => e.hold_class === "C-Hold" || e.hold_class === "Both")
    .reduce((s, e) => s + remainingExposureValue(e), 0);

  const forecastedGPBeforeHolds = forecastedFinalContract - forecastedFinalCost;
  const indicatedGP = forecastedGPBeforeHolds - exposureHolds - contingencyHold;
  const originalGP = project.original_contract - project.original_cost_budget;
  const currentSignedGP = originalGP + approvedCOContract - approvedCOCost;
  const indicatedGPpct =
    forecastedFinalContract > 0 ? (indicatedGP / forecastedFinalContract) * 100 : 0;
  const originalGPpct =
    project.original_contract > 0 ? (originalGP / project.original_contract) * 100 : 0;
  const currentSignedGPpct =
    currentSignedContract > 0 ? (currentSignedGP / currentSignedContract) * 100 : 0;
  const gpAtRisk = originalGP - indicatedGP;
  const remainingCost = Math.max(0, forecastedFinalCost - actualToDate);

  return {
    originalContract: project.original_contract,
    approvedCOContract,
    currentSignedContract,
    weightedPendingCOContract,
    pendingCOContract,
    forecastedFinalContract,
    actualToDate,
    ftc,
    baseProjectedCost: bucketCostBase,
    approvedCOCost,
    weightedPendingCOCost,
    forecastedFinalCost,
    exposureHolds,
    contingencyHold,
    forecastedGPBeforeHolds,
    indicatedGP,
    originalGP,
    currentSignedGP,
    indicatedGPpct,
    originalGPpct,
    currentSignedGPpct,
    gpAtRisk,
    remainingCost,
  };
}

export function holdGuidance(phase: Phase): { ePct: number; cPct: number } {
  switch (phase) {
    case "Early":
      return { ePct: 4, cPct: 3 };
    case "Middle":
      return { ePct: 3, cPct: 2.5 };
    case "Late":
      return { ePct: 2, cPct: 1.5 };
  }
}

export function guidanceTargets(phase: Phase, remainingCost: number) {
  const { ePct, cPct } = holdGuidance(phase);
  return {
    ePct,
    cPct,
    eTarget: (ePct / 100) * remainingCost,
    cTarget: (cPct / 100) * remainingCost,
  };
}

export interface Warning {
  id: string;
  severity: "high" | "medium";
  title: string;
  detail: string;
}

export function evaluateWarnings(
  project: ProjectLite,
  buckets: BucketLite[],
  cos: ChangeOrderLite[],
  exposures: ExposureLite[],
  rollup: Rollup,
): Warning[] {
  const warnings: Warning[] = [];
  const targets = guidanceTargets(project.phase, rollup.remainingCost);

  // 1. Pending CO cost > $25k AND E-Holds below target
  const pendingCostExposure = cos
    .filter((c) => c.status === "Pending")
    .reduce((s, c) => s + c.cost_amount, 0);
  if (pendingCostExposure > 25000 && rollup.exposureHolds < targets.eTarget) {
    warnings.push({
      id: "pending-co-exposure",
      severity: "high",
      title: "Pending change-order exposure is not reserved",
      detail: `${fmt(pendingCostExposure)} of pending CO cost is live but E-Holds (${fmt(rollup.exposureHolds)}) are below the ${targets.ePct}% guidance (${fmt(targets.eTarget)}).`,
    });
  }

  // 2. Late phase finish FTC without C-Hold
  if (project.phase === "Late") {
    const finishFtc = buckets
      .filter((b) => /finish|millwork/i.test(b.bucket))
      .reduce((s, b) => s + b.ftc, 0);
    if (finishFtc > 0 && rollup.contingencyHold < targets.cTarget) {
      warnings.push({
        id: "late-finish-uncovered",
        severity: "high",
        title: "Late-phase finish work still has FTC without contingency",
        detail: `${fmt(finishFtc)} of finishes/millwork is still forecasted. C-Hold (${fmt(rollup.contingencyHold)}) is below the ${targets.cPct}% guidance (${fmt(targets.cTarget)}).`,
      });
    }
  }

  // 3. Schedule slipping with no schedule-category exposure logged
  const baseline = project.baseline_completion_date
    ? new Date(project.baseline_completion_date)
    : null;
  const forecast = project.forecast_completion_date
    ? new Date(project.forecast_completion_date)
    : null;
  const slipping =
    (baseline && forecast && forecast > baseline) || project.schedule_variance_weeks > 0;
  if (slipping) {
    const hasSchedExp = exposures.some(
      (e) =>
        carriesRemainingRisk(e) &&
        (e.category === "schedule_compression" ||
          e.category === "procurement" ||
          e.category === "owner_decision"),
    );
    if (!hasSchedExp) {
      warnings.push({
        id: "schedule-no-exposure",
        severity: "medium",
        title: "Schedule slipped but no schedule-related exposure logged",
        detail: `Completion forecast has moved past baseline. Log an exposure (schedule, procurement, or owner decision) with dollar impact.`,
      });
    }
  }

  // 4. Stale active exposures (>30 days, no next_review_at)
  const now = Date.now();
  for (const e of exposures.filter(
    (exposure) => isStatusActive(exposure) || carriesRemainingRisk(exposure),
  )) {
    if (!e.opened_at) continue;
    const ageDays = (now - new Date(e.opened_at).getTime()) / 86400000;
    if (ageDays > 30 && !e.next_review_at) {
      warnings.push({
        id: `stale-${e.category}-${Math.round(e.dollar_exposure)}`,
        severity: "medium",
        title: "Stale exposure with no next review date",
        detail: `An active ${e.category.replace(/_/g, " ")} exposure (${fmt(e.dollar_exposure)}) is ${Math.round(ageDays)} days old without a scheduled next review.`,
      });
    }
  }

  // 5. Accepted exposures > 1% of original contract
  const accepted = exposures
    .filter((e) => e.response_path === "accept" && carriesRemainingRisk(e))
    .reduce((s, e) => s + remainingExposureValue(e), 0);
  if (accepted > project.original_contract * 0.01) {
    warnings.push({
      id: "accept-too-much",
      severity: "medium",
      title: "Accepted exposures exceed 1% of contract",
      detail: `${fmt(accepted)} in active exposures has response path 'accept'. Confirm these cannot be eliminated, recovered, or offset.`,
    });
  }

  // 6. Bucket "savings" > 50% complete with no justification
  if (project.percent_complete > 50) {
    const suspicious = buckets.filter(
      (b) => b.original_budget > 0 && b.actual_to_date + b.ftc < b.original_budget * 0.95,
    );
    for (const b of suspicious) {
      warnings.push({
        id: `savings-${b.bucket}`,
        severity: "medium",
        title: `${b.bucket} showing unexplained savings`,
        detail: `Forecast (${fmt(b.actual_to_date + b.ftc)}) is more than 5% under budget (${fmt(b.original_budget)}) at ${project.percent_complete}% complete. Confirm the savings are real.`,
      });
    }
  }

  return warnings;
}

export function exposureByCategory(
  exposures: ExposureLite[],
): { category: ExposureCategory; total: number; count: number }[] {
  const map = new Map<ExposureCategory, { total: number; count: number }>();
  for (const e of exposures) {
    if (!carriesRemainingRisk(e)) continue;
    const cur = map.get(e.category) ?? { total: 0, count: 0 };
    cur.total += remainingExposureValue(e);
    cur.count += 1;
    map.set(e.category, cur);
  }
  return Array.from(map.entries())
    .map(([category, v]) => ({ category, ...v }))
    .sort((a, b) => b.total - a.total);
}

export function exposureAging(
  exposures: ExposureLite[],
  now: number = Date.now(),
): { fresh: number; recent: number; stale: number } {
  const buckets = { fresh: 0, recent: 0, stale: 0 };
  for (const e of exposures) {
    if (!carriesRemainingRisk(e) || !e.opened_at) continue;
    const days = (now - new Date(e.opened_at).getTime()) / 86400000;
    if (days < 7) buckets.fresh += 1;
    else if (days < 30) buckets.recent += 1;
    else buckets.stale += 1;
  }
  return buckets;
}

function fmt(n: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}
