// AIA G702/G703 arithmetic (GETTINGPAID1 Task 1).
//
// Pure integer-cents math shared by the PDF, any preview, and the unit
// tests, so the continuation sheet, its totals row, and the G702 face are
// one arithmetic system: the lender's cross-check (G703 totals -> G702
// lines 1-9) reconciles by construction, penny-exact.
//
// Column letters follow the G703 form: C scheduled value, D+E from previous
// application, E this period, F materials presently stored, G total
// completed and stored to date, H = G/C, I balance to finish (C - G).
// Relative .ts import so node-based smoke tests can load this module.
import { percentOfCents } from "./payments-domain.ts";

export interface G703LineInput {
  cost_code: string;
  description: string;
  scheduled_value_cents: number;
  change_order_value_cents: number;
  work_completed_previous_cents: number;
  materials_stored_previous_cents: number;
  work_completed_this_period_cents: number;
  materials_stored_this_period_cents: number;
  work_completed_to_date_cents: number;
  materials_stored_to_date_cents: number;
  total_completed_and_stored_cents: number;
  balance_to_finish_cents: number;
  retainage_pct: number;
  retainage_held_cents: number;
  retainage_released_cents: number;
}

export interface G703Row {
  item: string;
  description: string;
  scheduledValueCents: number; // C (incl. allocated approved COs)
  fromPreviousCents: number; // D+E from previous application
  thisPeriodCents: number; // E work completed this period
  storedMaterialCents: number; // F materials presently stored
  totalCompletedStoredCents: number; // G = D+E+F
  percentComplete: number; // H = G / C * 100
  balanceToFinishCents: number; // I = C - G
  retainageCents: number; // held less released
  // G702 line 5 split, rounded at the line: 5a on completed work, 5b on
  // stored material.
  retainageCompletedWorkCents: number;
  retainageStoredMaterialCents: number;
}

export interface G703Totals {
  scheduledValueCents: number;
  fromPreviousCents: number;
  thisPeriodCents: number;
  storedMaterialCents: number;
  totalCompletedStoredCents: number;
  balanceToFinishCents: number;
  retainageCents: number;
  retainageCompletedWorkCents: number;
  retainageStoredMaterialCents: number;
  percentComplete: number;
}

export interface G702Face {
  originalContractSumCents: number; // line 1
  netChangeByChangeOrdersCents: number; // line 2
  contractSumToDateCents: number; // line 3 = 1 + 2
  totalCompletedStoredCents: number; // line 4 (G703 column G total)
  retainageCompletedWorkCents: number; // line 5a
  retainageStoredMaterialCents: number; // line 5b
  totalRetainageCents: number; // line 5 = 5a + 5b
  totalEarnedLessRetainageCents: number; // line 6 = 4 - 5
  previousCertificatesCents: number; // line 7 (line 6 from prior certificate)
  currentPaymentDueCents: number; // line 8 = 6 - 7
  balanceToFinishInclRetainageCents: number; // line 9 = 3 - 6
}

export function computeG703Row(line: G703LineInput, index: number): G703Row {
  const scheduledValueCents =
    Math.round(line.scheduled_value_cents) + Math.round(line.change_order_value_cents);
  const fromPreviousCents =
    Math.round(line.work_completed_previous_cents) +
    Math.round(line.materials_stored_previous_cents);
  const thisPeriodCents = Math.round(line.work_completed_this_period_cents);
  const storedMaterialCents = Math.round(line.materials_stored_this_period_cents);
  const totalCompletedStoredCents = Math.round(line.total_completed_and_stored_cents);
  const retainagePct = Math.max(0, line.retainage_pct);
  // Line 5 split rounds at the LINE (cents-exact rule): 5a against work
  // completed to date, 5b against materials presently stored. Released
  // retainage reduces 5a first (releases follow completed work).
  const grossRetainageCompleted = percentOfCents(
    Math.round(line.work_completed_to_date_cents),
    retainagePct,
  );
  const grossRetainageStored = percentOfCents(
    Math.round(line.materials_stored_to_date_cents),
    retainagePct,
  );
  const released = Math.max(0, Math.round(line.retainage_released_cents));
  const retainageCompletedWorkCents = Math.max(0, grossRetainageCompleted - released);
  const retainageStoredMaterialCents = Math.max(
    0,
    grossRetainageStored - Math.max(0, released - grossRetainageCompleted),
  );

  return {
    item: line.cost_code || String(index + 1),
    description: line.description,
    scheduledValueCents,
    fromPreviousCents,
    thisPeriodCents,
    storedMaterialCents,
    totalCompletedStoredCents,
    percentComplete:
      scheduledValueCents > 0 ? (totalCompletedStoredCents / scheduledValueCents) * 100 : 0,
    balanceToFinishCents: Math.round(line.balance_to_finish_cents),
    retainageCents:
      Math.max(0, Math.round(line.retainage_held_cents)) -
      Math.min(Math.max(0, Math.round(line.retainage_held_cents)), released),
    retainageCompletedWorkCents,
    retainageStoredMaterialCents,
  };
}

export function computeG703Rows(lines: readonly G703LineInput[]): G703Row[] {
  return lines.map((line, index) => computeG703Row(line, index));
}

export function computeG703Totals(rows: readonly G703Row[]): G703Totals {
  const totals = rows.reduce(
    (sum, row) => {
      sum.scheduledValueCents += row.scheduledValueCents;
      sum.fromPreviousCents += row.fromPreviousCents;
      sum.thisPeriodCents += row.thisPeriodCents;
      sum.storedMaterialCents += row.storedMaterialCents;
      sum.totalCompletedStoredCents += row.totalCompletedStoredCents;
      sum.balanceToFinishCents += row.balanceToFinishCents;
      sum.retainageCents += row.retainageCents;
      sum.retainageCompletedWorkCents += row.retainageCompletedWorkCents;
      sum.retainageStoredMaterialCents += row.retainageStoredMaterialCents;
      return sum;
    },
    {
      scheduledValueCents: 0,
      fromPreviousCents: 0,
      thisPeriodCents: 0,
      storedMaterialCents: 0,
      totalCompletedStoredCents: 0,
      balanceToFinishCents: 0,
      retainageCents: 0,
      retainageCompletedWorkCents: 0,
      retainageStoredMaterialCents: 0,
      percentComplete: 0,
    },
  );
  totals.percentComplete =
    totals.scheduledValueCents > 0
      ? (totals.totalCompletedStoredCents / totals.scheduledValueCents) * 100
      : 0;
  return totals;
}

// Line 7: previous certificates = each line's previous completed and stored
// less the retainage that was held on it, rounded at the line — the best
// available truth when prior certificates are not stored as documents.
export function computePreviousCertificatesCents(lines: readonly G703LineInput[]): number {
  return lines.reduce((sum, line) => {
    const previousCompletedStored =
      Math.round(line.work_completed_previous_cents) +
      Math.round(line.materials_stored_previous_cents);
    const previousRetainage = percentOfCents(
      previousCompletedStored,
      Math.max(0, line.retainage_pct),
    );
    return sum + Math.max(0, previousCompletedStored - previousRetainage);
  }, 0);
}

// ---------------------------------------------------------------------------
// Overbilling guardrail (GETTINGPAID3 Task 1 — lender-rejection prevention)
// ---------------------------------------------------------------------------

export interface OverbilledLine {
  item: string;
  description: string;
  scheduledValueCents: number; // C (incl. allocated approved COs)
  totalCompletedStoredCents: number; // G
  percentComplete: number; // G / C * 100, > 100 here
  overageCents: number; // G - C, always positive
}

// A line is overbilled when total completed & stored exceeds its scheduled
// value (G > C, i.e. > 100% / negative balance to finish). Lenders typically
// reject lines over 100%. A soft flag, never a block — the estimator decides
// whether to reallocate via change order or adjust.
export function overbilledLines(lines: readonly G703LineInput[]): OverbilledLine[] {
  return computeG703Rows(lines)
    .filter(
      (row) =>
        row.scheduledValueCents > 0 && row.totalCompletedStoredCents > row.scheduledValueCents,
    )
    .map((row) => ({
      item: row.item,
      description: row.description,
      scheduledValueCents: row.scheduledValueCents,
      totalCompletedStoredCents: row.totalCompletedStoredCents,
      percentComplete: row.percentComplete,
      overageCents: row.totalCompletedStoredCents - row.scheduledValueCents,
    }));
}

// The estimator-facing warning naming the line and its overage.
export function overbilledLineMessage(line: OverbilledLine): string {
  return `${line.description || line.item} bills to ${line.percentComplete.toFixed(
    1,
  )}% of scheduled value — lenders typically reject lines over 100%; reallocate via change order or adjust.`;
}

export interface G702FaceInput {
  originalContractSumCents: number;
  netChangeByChangeOrdersCents: number;
  totals: G703Totals;
  previousCertificatesCents: number;
}

// The G702 application face, lines 1-9, derived entirely from the G703
// totals so the two documents reconcile by construction.
export function computeG702Face(input: G702FaceInput): G702Face {
  const contractSumToDateCents =
    Math.round(input.originalContractSumCents) + Math.round(input.netChangeByChangeOrdersCents);
  const totalCompletedStoredCents = input.totals.totalCompletedStoredCents;
  const retainageCompletedWorkCents = input.totals.retainageCompletedWorkCents;
  const retainageStoredMaterialCents = input.totals.retainageStoredMaterialCents;
  const totalRetainageCents = retainageCompletedWorkCents + retainageStoredMaterialCents;
  const totalEarnedLessRetainageCents = totalCompletedStoredCents - totalRetainageCents;
  const previousCertificatesCents = Math.max(0, Math.round(input.previousCertificatesCents));
  return {
    originalContractSumCents: Math.round(input.originalContractSumCents),
    netChangeByChangeOrdersCents: Math.round(input.netChangeByChangeOrdersCents),
    contractSumToDateCents,
    totalCompletedStoredCents,
    retainageCompletedWorkCents,
    retainageStoredMaterialCents,
    totalRetainageCents,
    totalEarnedLessRetainageCents,
    previousCertificatesCents,
    currentPaymentDueCents: totalEarnedLessRetainageCents - previousCertificatesCents,
    balanceToFinishInclRetainageCents: contractSumToDateCents - totalEarnedLessRetainageCents,
  };
}
