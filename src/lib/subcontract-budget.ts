// Additive subcontractor cost layer for the budget ledger.
//
// A subcontract "buyout" is COMMITTED cost against one or more cost codes; a
// progress payment against it is ACTUAL cost. This module summarizes, per cost
// bucket, the committed / paid / open (remaining commitment) amounts so the
// budget ledger can fold them in ADDITIVELY:
//   actuals             += Σ sub payments (gross work value)
//   open (forecast)     += Σ (committed − paid)  = remaining commitment
// Nothing here touches cost_actuals or the shared budget trigger — this is a
// parallel, additive layer, exactly like change-order allocations. All math runs
// in integer cents; dollars exist only at the edges.
//
// Founder call (2026-07-07): the additive layer, not a global trigger change.
// Retainage held from a payment is cash-flow only — the COST incurred is the
// gross payment (the work is in place), so the ledger uses the gross amount and
// retainage is tracked separately in the payment view.
import { centsToDollars, dollarsToCents } from "./payments-domain.ts";

export interface SubcontractLike {
  id: string;
  // The buyout total (what the GC owes the sub for the scope). Dollars.
  contract_value: number;
  // Only 'executed' subcontracts commit real cost; a 'draft' buyout does not
  // move the budget yet.
  status: string;
  // The directory company that owns this buyout. Optional — only needed to look
  // up the sub's field percent-complete for earned-value recognition (Slice C
  // part 2); omit for the plain payments-only summary.
  subcontractor_id?: string;
}

export interface SubcontractAllocationLike {
  subcontract_id: string;
  // The cost code (bucket) this slice of the buyout lands on. Null = unallocated
  // (excluded from per-bucket math; surfaced separately by the caller).
  cost_bucket_id: string | null;
  // Committed portion of the buyout on this cost code. Dollars.
  amount: number;
}

export interface SubcontractPaymentLike {
  subcontract_id: string;
  // Gross progress payment (the work value put in place this payment). Dollars.
  // Retainage held is tracked on the payment separately and is NOT netted here.
  amount: number;
  // Optional row id — only needed to match an explicit per-payment cost-code
  // split (see PaymentSplitLike). Without it the payment always pro-rates.
  id?: string;
  // Pay-app lifecycle (field request 2026-07-09): draft → approved → paid. Only
  // 'paid' rows are actual cost; draft/approved stay inside the open commitment
  // (committed − paid), so the total forecast never moves before money does.
  // Absent status = a pre-lifecycle row, which was by definition paid.
  status?: string;
}

// An explicit per-payment cost-code split row (subcontract_payment_allocations).
// A payment with ANY split rows uses them verbatim instead of the pro-rata
// derivation; only coded rows land on buckets.
export interface PaymentSplitLike {
  payment_id: string;
  cost_bucket_id: string | null;
  amount: number; // dollars
}

// Only a PAID pay app is actual cost out the door. Rows recorded before the
// lifecycle existed carry no status and were paid facts.
const isPaidPayment = (payment: { status?: string }) =>
  !payment.status || payment.status === "paid";

export interface SubBucketCost {
  committed: number; // total committed on this bucket (executed subs), dollars
  // Actual cash paid-to-date attributed to this bucket (payments distributed
  // pro-rata), dollars. This is "actual cost" on the budget — what's actually
  // gone out the door.
  paid: number;
  open: number; // max(0, committed − paid) = remaining commitment (forecast)
  // Earned value: the buyout commitment × the sub's field percent-complete on
  // this code, dollars. What the work in place is WORTH (progress/production),
  // distinct from what's been paid. Display-only — it never drives the ledger
  // actuals/forecast (paid/open do); it's shown alongside so the gap between
  // work done and cash paid is visible. 0 with no earned-value input.
  earned: number;
}

const numeric = (value: number) => (Number.isFinite(value) ? value : 0);

// Distribute a total (cents) across weights (cents) proportionally, cents-exact:
// each share = round(total × weight / Σweights), and the last positive-weight
// share absorbs the rounding remainder so the shares sum to `total` exactly.
function distributeCents(totalCents: number, weightsCents: number[]): number[] {
  const sumWeights = weightsCents.reduce((s, w) => s + Math.max(0, w), 0);
  const out = weightsCents.map(() => 0);
  if (sumWeights <= 0 || totalCents === 0) return out;
  let lastPositive = -1;
  let running = 0;
  for (let i = 0; i < weightsCents.length; i += 1) {
    const w = Math.max(0, weightsCents[i]);
    if (w <= 0) continue;
    const share = Math.round((totalCents * w) / sumWeights);
    out[i] = share;
    running += share;
    lastPositive = i;
  }
  if (lastPositive >= 0) out[lastPositive] += totalCents - running; // absorb remainder
  return out;
}

// The lookup key for a subcontractor company's field percent-complete on a cost
// code: `${subcontractor_id}:${cost_bucket_id}`. Matches what the callers build
// from daily_wip_entries (latestPercentBySubBucket in daily-wip.ts).
export function subEarnedKey(subcontractorId: string, costBucketId: string): string {
  return `${subcontractorId}:${costBucketId}`;
}

// A sub change order/credit as the budget layer sees it: signed dollars tagged
// (or not) to a cost code. Mirrors subcontract_change_orders rows.
export interface SubChangeOrderBudgetLike {
  subcontract_id: string;
  cost_bucket_id: string | null;
  // Signed dollars: a change order is positive, a credit is negative.
  amount: number;
}

// Per cost bucket: committed = Σ executed-sub allocations + Σ signed change
// orders TAGGED to that code (field request 2026-07-09: "change orders didn't
// roll up to the dashboards" — a coded CO now carries into committed
// automatically; untagged COs stay on the card until coded); paid = each
// subcontract's payments distributed pro-rata across its allocations (actual cash
// out); open = max(0, committed − paid) = remaining commitment; earned = Σ
// (allocation commitment × the sub's field percent-complete on that code) — what
// the work in place is worth, display-only (it does NOT drive actuals/forecast).
// Only EXECUTED subcontracts contribute. Cents-safe throughout. With no
// earned-value map, earned is 0.
export function summarizeSubCostByBucket(
  subcontracts: SubcontractLike[],
  allocations: SubcontractAllocationLike[],
  payments: SubcontractPaymentLike[],
  // Latest field percent-complete (0–100) per `${subcontractor_id}:${cost_bucket_id}`
  // (see subEarnedKey). Optional; empty → payments-only behaviour.
  currentPctByCompanyCode: ReadonlyMap<string, number> = new Map(),
  // Signed COs/credits; only rows tagged to a cost code fold into committed.
  changeOrders: SubChangeOrderBudgetLike[] = [],
  // Explicit per-payment splits; a payment with rows here bypasses pro-rata.
  paymentSplits: PaymentSplitLike[] = [],
): Map<string, SubBucketCost> {
  const executedSubs = subcontracts.filter((s) => s.status === "executed");
  const executed = new Set(executedSubs.map((s) => s.id));
  const companyBySub = new Map(executedSubs.map((s) => [s.id, s.subcontractor_id] as const));
  const splitPaymentIds = new Set(paymentSplits.map((split) => split.payment_id));
  // Payments the user explicitly coded (field request 2026-07-09): their cash
  // lands exactly where they said, and they leave the pro-rata pool entirely.
  const explicitlySplitIds = new Set<string>();
  const paidCentsBySub = new Map<string, number>();
  for (const p of payments) {
    if (!executed.has(p.subcontract_id)) continue;
    // Draft/approved pay apps are not cost yet — they stay in open commitment.
    // Skipping BEFORE the split check also keeps an unpaid payment's explicit
    // split rows off the buckets (it never joins explicitlySplitIds).
    if (!isPaidPayment(p)) continue;
    if (p.id && splitPaymentIds.has(p.id)) {
      explicitlySplitIds.add(p.id);
      continue;
    }
    paidCentsBySub.set(
      p.subcontract_id,
      (paidCentsBySub.get(p.subcontract_id) ?? 0) + dollarsToCents(numeric(p.amount)),
    );
  }

  const committedCentsByBucket = new Map<string, number>();
  const paidCentsByBucket = new Map<string, number>();
  const earnedCentsByBucket = new Map<string, number>();

  // Group executed allocations by subcontract so payments distribute correctly.
  const allocsBySub = new Map<string, SubcontractAllocationLike[]>();
  for (const a of allocations) {
    if (!executed.has(a.subcontract_id)) continue;
    if (!a.cost_bucket_id) continue; // unallocated — caller handles separately
    const list = allocsBySub.get(a.subcontract_id) ?? [];
    list.push(a);
    allocsBySub.set(a.subcontract_id, list);
  }

  for (const [subId, allocs] of allocsBySub) {
    const company = companyBySub.get(subId);
    const weightsCents = allocs.map((a) => dollarsToCents(numeric(a.amount)));
    // Committed on each bucket = its allocation amount.
    for (let i = 0; i < allocs.length; i += 1) {
      const bucketId = allocs[i].cost_bucket_id as string;
      committedCentsByBucket.set(
        bucketId,
        (committedCentsByBucket.get(bucketId) ?? 0) + weightsCents[i],
      );
    }
    // Cash paid distributed across this sub's allocations by committed weight
    // (→ actual). Earned value = commitment × the sub's field % on that code,
    // clamped 0–100 (→ display, alongside paid).
    const paidShares = distributeCents(paidCentsBySub.get(subId) ?? 0, weightsCents);
    for (let i = 0; i < allocs.length; i += 1) {
      const bucketId = allocs[i].cost_bucket_id as string;
      const pct = company
        ? Math.max(
            0,
            Math.min(
              100,
              numeric(currentPctByCompanyCode.get(subEarnedKey(company, bucketId)) ?? 0),
            ),
          )
        : 0;
      const earnedCents = Math.round((weightsCents[i] * pct) / 100);
      paidCentsByBucket.set(bucketId, (paidCentsByBucket.get(bucketId) ?? 0) + paidShares[i]);
      earnedCentsByBucket.set(bucketId, (earnedCentsByBucket.get(bucketId) ?? 0) + earnedCents);
    }
  }

  // Explicitly-coded payments: their coded rows land cents directly on those
  // buckets (uncoded rows stay off the bucket map, same as unallocated cash).
  // The server enforces rows sum to the payment, so nothing double-counts with
  // the pro-rata pool those payments already left.
  for (const split of paymentSplits) {
    if (!explicitlySplitIds.has(split.payment_id)) continue;
    if (!split.cost_bucket_id) continue;
    paidCentsByBucket.set(
      split.cost_bucket_id,
      (paidCentsByBucket.get(split.cost_bucket_id) ?? 0) + dollarsToCents(numeric(split.amount)),
    );
  }

  // Fold signed change orders/credits into committed on their tagged code. Only
  // executed subs move the budget (same rule as allocations); untagged COs stay
  // card-only. Payments still distribute by ALLOCATION weights — a CO changes
  // what's committed, not how past cash was coded.
  for (const co of changeOrders) {
    if (!executed.has(co.subcontract_id)) continue;
    if (!co.cost_bucket_id) continue;
    committedCentsByBucket.set(
      co.cost_bucket_id,
      (committedCentsByBucket.get(co.cost_bucket_id) ?? 0) + dollarsToCents(numeric(co.amount)),
    );
  }

  const out = new Map<string, SubBucketCost>();
  const bucketIds = new Set<string>([
    ...committedCentsByBucket.keys(),
    ...paidCentsByBucket.keys(),
  ]);
  for (const bucketId of bucketIds) {
    // Floor at 0: a credit larger than the code's buyout can't drive committed
    // negative (open already floors the same way).
    const committedCents = Math.max(0, committedCentsByBucket.get(bucketId) ?? 0);
    const paidCents = paidCentsByBucket.get(bucketId) ?? 0;
    const openCents = Math.max(0, committedCents - paidCents);
    out.set(bucketId, {
      committed: centsToDollars(committedCents),
      paid: centsToDollars(paidCents),
      open: centsToDollars(openCents),
      earned: centsToDollars(earnedCentsByBucket.get(bucketId) ?? 0),
    });
  }
  return out;
}

// The total cost the subcontractor layer ADDS on top of the raw bucket cost base
// (Σ actual_to_date + Σ ftc). A sub payment is real actual cost; a buyout
// DISPLACES the code's own budgeted forecast (netted per bucket, floored at 0)
// rather than stacking; sub cost on a code that isn't a listed bucket is added
// raw. This is the SINGLE SOURCE used by both the IOR rollup's forecasted cost
// and (by construction, it equals subCostTotals.paid + openAdj) the Budget-tab
// cards, so the dashboard GP and the Budget tab can never drift on sub cost.
export function subCostAddition(
  buckets: readonly { id?: string; ftc: number }[],
  subCostByBucket: ReadonlyMap<string, { paid: number; open: number; committed?: number }>,
): number {
  if (subCostByBucket.size === 0) return 0;
  const listed = new Set<string>();
  let cents = 0;
  for (const bucket of buckets) {
    if (!bucket.id) continue;
    listed.add(bucket.id);
    const sub = subCostByBucket.get(bucket.id);
    if (!sub) continue;
    // paid → actual; open displaces self-perform ftc: added forecast delta is
    // open − min(ftc, committed). Total added = paid + open − min(ftc, committed).
    cents +=
      dollarsToCents(sub.paid) +
      dollarsToCents(sub.open) -
      Math.min(dollarsToCents(bucket.ftc), dollarsToCents(sub.committed ?? 0));
  }
  // Sub cost tied to a code that isn't a listed bucket — no self-perform ftc to
  // displace, so paid + open, raw (matches the ledger's "unallocated" catch-all).
  for (const [bucketId, sub] of subCostByBucket) {
    if (listed.has(bucketId)) continue;
    cents += dollarsToCents(sub.paid) + dollarsToCents(sub.open);
  }
  return centsToDollars(cents);
}

export interface SubcontractPaySummary {
  subcontract_id: string;
  committed: number; // buyout total (dollars)
  paid: number; // gross paid-to-date — PAID pay apps only (dollars)
  retainageHeld: number; // retainage still held from the sub — paid rows (dollars)
  netPaid: number; // cash out to the sub = paid − retainageHeld (dollars)
  remaining: number; // committed − paid (dollars, ≥ 0)
  paidPct: number; // paid / committed, 0..100
  // The approval pipeline (field request 2026-07-09): pay apps logged but not
  // yet approved, and pay apps approved for payment but not yet paid. Neither
  // is cost or cash yet — they're what's sitting on the PM's desk.
  draftTotal: number;
  approvedTotal: number;
}

// The PM payment view per subcontract: buyout, gross paid, retainage held, net
// cash out, remaining commitment, % paid. Retainage is summed off the payments.
// Only PAID pay apps move the money numbers; draft/approved are reported as
// their own pipeline totals.
export function summarizeSubPayments(
  subcontract: SubcontractLike,
  payments: { amount: number; retainage_held: number; status?: string }[],
): SubcontractPaySummary {
  const committedCents = dollarsToCents(numeric(subcontract.contract_value));
  let paidCents = 0;
  let retainageCents = 0;
  let draftCents = 0;
  let approvedCents = 0;
  for (const p of payments) {
    if (!isPaidPayment(p)) {
      if (p.status === "approved") approvedCents += dollarsToCents(numeric(p.amount));
      else draftCents += dollarsToCents(numeric(p.amount));
      continue;
    }
    paidCents += dollarsToCents(numeric(p.amount));
    retainageCents += dollarsToCents(numeric(p.retainage_held));
  }
  const netCents = Math.max(0, paidCents - retainageCents);
  const remainingCents = Math.max(0, committedCents - paidCents);
  const paidPct = committedCents > 0 ? (paidCents / committedCents) * 100 : 0;
  return {
    subcontract_id: subcontract.id,
    committed: centsToDollars(committedCents),
    paid: centsToDollars(paidCents),
    retainageHeld: centsToDollars(retainageCents),
    netPaid: centsToDollars(netCents),
    remaining: centsToDollars(remainingCents),
    paidPct,
    draftTotal: centsToDollars(draftCents),
    approvedTotal: centsToDollars(approvedCents),
  };
}

// ── Change orders & credits (kept separate from the contracted amount) ──────
// Field request (2026-07-09): a sub CO or credit is its own line item, NOT an
// edit to the base contract. The app derives revised = base + Σ change orders
// (credits are negative). All math in integer cents.

export interface SubChangeOrderLike {
  subcontract_id: string;
  // Signed dollars: a change order is positive, a credit is negative.
  amount: number;
}

export function sumChangeOrders(changeOrders: SubChangeOrderLike[]): number {
  let cents = 0;
  for (const co of changeOrders) cents += dollarsToCents(co.amount);
  return centsToDollars(cents);
}

export interface RevisedSubSummary {
  base: number; // the contracted amount, untouched (dollars)
  changeOrders: number; // Σ signed COs/credits (dollars)
  revised: number; // base + change orders (dollars)
  remaining: number; // max(0, revised − paid) (dollars)
  paidPct: number; // paid / revised, 0..100
}

// Layer the change-order total onto a payment summary. The base commitment is
// never mutated — that separation is the whole point.
export function reviseSubSummary(
  summary: SubcontractPaySummary,
  changeOrderTotal: number,
): RevisedSubSummary {
  const baseCents = dollarsToCents(summary.committed);
  const coCents = dollarsToCents(changeOrderTotal);
  const revisedCents = baseCents + coCents;
  const paidCents = dollarsToCents(summary.paid);
  return {
    base: centsToDollars(baseCents),
    changeOrders: centsToDollars(coCents),
    revised: centsToDollars(revisedCents),
    remaining: centsToDollars(Math.max(0, revisedCents - paidCents)),
    paidPct: revisedCents > 0 ? (paidCents / revisedCents) * 100 : 0,
  };
}

export interface PaymentCodeSplit {
  cost_code: string;
  description: string;
  amount: number; // dollars
}

// Field request (2026-07-09): "when payment is recorded to a sub we should be
// able to see how much gets allocated to each cost code." The split is derived
// pro-rata from the buyout's cost-code allocations (the same distribution the
// budget layer uses), cents-exact via largest-remainder so the rows always sum
// to the payment. No allocations → empty (the caller shows "not coded yet").
export function allocatePaymentAcrossCodes(
  paymentAmount: number,
  allocations: { cost_code: string; description: string; amount: number }[],
): PaymentCodeSplit[] {
  const basis = allocations.filter((allocation) => allocation.amount > 0);
  const basisCents = basis.map((allocation) => dollarsToCents(allocation.amount));
  const basisTotal = basisCents.reduce((sum, cents) => sum + cents, 0);
  const paymentCents = dollarsToCents(paymentAmount);
  if (basisTotal <= 0 || paymentCents <= 0) return [];

  const exact = basisCents.map((cents) => (paymentCents * cents) / basisTotal);
  const floors = exact.map((value) => Math.floor(value));
  let shortfall = paymentCents - floors.reduce((sum, value) => sum + value, 0);
  // Hand the leftover cents to the largest remainders, stable by input order.
  const order = exact
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (const entry of order) {
    if (shortfall <= 0) break;
    floors[entry.index] += 1;
    shortfall -= 1;
  }
  return basis.map((allocation, index) => ({
    cost_code: allocation.cost_code,
    description: allocation.description,
    amount: centsToDollars(floors[index]),
  }));
}

// One payment's pro-rata share on ONE cost code (for the budget line drawer's
// "where actual to date comes from" list). Distributed cents-exact across the
// subcontract's coded allocations with the same largest-remainder scheme as
// allocatePaymentAcrossCodes, then the target bucket's share is read out — so
// per-bucket shares always sum to the payment across buckets.
export function paymentShareForBucket(
  paymentAmount: number,
  allocations: { cost_bucket_id: string | null; amount: number }[],
  costBucketId: string,
): number {
  const basis = allocations.filter(
    (allocation) => allocation.cost_bucket_id && allocation.amount > 0,
  );
  const basisCents = basis.map((allocation) => dollarsToCents(allocation.amount));
  const basisTotal = basisCents.reduce((sum, cents) => sum + cents, 0);
  const paymentCents = dollarsToCents(paymentAmount);
  if (basisTotal <= 0 || paymentCents <= 0) return 0;
  const exact = basisCents.map((cents) => (paymentCents * cents) / basisTotal);
  const floors = exact.map((value) => Math.floor(value));
  let shortfall = paymentCents - floors.reduce((sum, value) => sum + value, 0);
  const order = exact
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (const entry of order) {
    if (shortfall <= 0) break;
    floors[entry.index] += 1;
    shortfall -= 1;
  }
  let shareCents = 0;
  basis.forEach((allocation, index) => {
    if (allocation.cost_bucket_id === costBucketId) shareCents += floors[index];
  });
  return centsToDollars(shareCents);
}
