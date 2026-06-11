// Pure IOR math — used both server-side (in projects.functions.ts) and client-side
// for tooltips and warning display. No imports of anything env-dependent.

export type Phase = "Early" | "Middle" | "Late";
export type COStatus = "Approved" | "Pending" | "Denied";

export interface BucketLite {
  bucket: string;
  original_budget: number;
  actual_to_date: number;
  ftc: number;
}

export interface ChangeOrderLite {
  contract_amount: number;
  cost_amount: number;
  status: COStatus;
  probability: number; // 0-100
}

export interface HoldLite {
  type: "E-Hold" | "C-Hold";
  amount: number;
  status: "Active" | "Released" | "Escalated";
}

export interface ProjectLite {
  original_contract: number;
  original_cost_budget: number;
  phase: Phase;
  percent_complete: number;
  schedule_variance_weeks: number;
}

export interface Rollup {
  // Revenue
  originalContract: number;
  approvedCOContract: number;
  weightedPendingCOContract: number;
  pendingCOContract: number; // raw, unweighted (for KPI Pending COs)
  forecastedFinalContract: number;
  // Cost
  actualToDate: number;
  ftc: number;
  approvedCOCost: number;
  weightedPendingCOCost: number;
  forecastedFinalCost: number;
  // Outcome
  exposureHolds: number;
  contingencyHold: number;
  forecastedGPBeforeHolds: number;
  indicatedGP: number;
  originalGP: number;
  indicatedGPpct: number;
  originalGPpct: number;
  gpAtRisk: number;
  remainingCost: number;
}

export function computeRollup(
  project: ProjectLite,
  buckets: BucketLite[],
  cos: ChangeOrderLite[],
  holds: HoldLite[],
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

  const actualToDate = buckets.reduce((s, b) => s + b.actual_to_date, 0);
  const ftc = buckets.reduce((s, b) => s + b.ftc, 0);

  // Safety fallback: if no cost buckets exist yet, use the original cost budget
  // as the cost baseline. Without this, FFCost = $0 and the project looks
  // wildly profitable. Once buckets are added the real rollup takes over.
  const bucketCostBase =
    buckets.length === 0 ? project.original_cost_budget : actualToDate + ftc;

  const forecastedFinalContract =
    project.original_contract + approvedCOContract + weightedPendingCOContract;
  const forecastedFinalCost =
    bucketCostBase + approvedCOCost + weightedPendingCOCost;

  const active = holds.filter((h) => h.status !== "Released");
  const exposureHolds = active
    .filter((h) => h.type === "E-Hold")
    .reduce((s, h) => s + h.amount, 0);
  const contingencyHold = active
    .filter((h) => h.type === "C-Hold")
    .reduce((s, h) => s + h.amount, 0);

  const forecastedGPBeforeHolds = forecastedFinalContract - forecastedFinalCost;
  const indicatedGP = forecastedGPBeforeHolds - exposureHolds - contingencyHold;
  const originalGP = project.original_contract - project.original_cost_budget;
  const indicatedGPpct =
    forecastedFinalContract > 0 ? (indicatedGP / forecastedFinalContract) * 100 : 0;
  const originalGPpct =
    project.original_contract > 0 ? (originalGP / project.original_contract) * 100 : 0;
  const gpAtRisk = originalGP - indicatedGP;
  const remainingCost = Math.max(0, forecastedFinalCost - actualToDate);

  return {
    originalContract: project.original_contract,
    approvedCOContract,
    weightedPendingCOContract,
    pendingCOContract,
    forecastedFinalContract,
    actualToDate,
    ftc,
    approvedCOCost,
    weightedPendingCOCost,
    forecastedFinalCost,
    exposureHolds,
    contingencyHold,
    forecastedGPBeforeHolds,
    indicatedGP,
    originalGP,
    indicatedGPpct,
    originalGPpct,
    gpAtRisk,
    remainingCost,
  };
}

// Conservative phase-sensitive hold guidance, expressed as % of remaining cost.
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

  // 2. Late phase AND any finish bucket has FTC > 0 AND C-Hold below target
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

  // 3. Schedule slipping AND GC/OH FTC > 0 (proxy for "rising") AND no exposure
  if (project.schedule_variance_weeks > 0) {
    const gcoh = buckets.find((b) => /gc\/?oh|general/i.test(b.bucket));
    if (gcoh && gcoh.ftc > 0 && rollup.exposureHolds === 0) {
      warnings.push({
        id: "schedule-no-exposure",
        severity: "medium",
        title: "Schedule slipped but no exposure reserved",
        detail: `+${project.schedule_variance_weeks} weeks of slip with active GC/OH FTC and zero E-Holds against schedule risk.`,
      });
    }
  }

  // 4. Bucket "savings" > 50% complete with no justification
  if (project.percent_complete > 50) {
    const suspicious = buckets.filter(
      (b) =>
        b.original_budget > 0 &&
        b.actual_to_date + b.ftc < b.original_budget * 0.95,
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

function fmt(n: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}
