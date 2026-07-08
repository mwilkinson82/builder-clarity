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
}

export interface SubBucketCost {
  committed: number; // total committed on this bucket (executed subs), dollars
  paid: number; // paid-to-date attributed to this bucket, dollars
  open: number; // max(0, committed − paid) = remaining commitment (forecast)
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

// Per cost bucket: committed = Σ executed-sub allocations; paid = each
// subcontract's total payments distributed pro-rata across its allocations by
// allocation share; open = max(0, committed − paid). Only EXECUTED subcontracts
// contribute (a draft buyout has not committed cost yet). Cents-safe throughout.
export function summarizeSubCostByBucket(
  subcontracts: SubcontractLike[],
  allocations: SubcontractAllocationLike[],
  payments: SubcontractPaymentLike[],
): Map<string, SubBucketCost> {
  const executed = new Set(subcontracts.filter((s) => s.status === "executed").map((s) => s.id));
  const paidCentsBySub = new Map<string, number>();
  for (const p of payments) {
    if (!executed.has(p.subcontract_id)) continue;
    paidCentsBySub.set(
      p.subcontract_id,
      (paidCentsBySub.get(p.subcontract_id) ?? 0) + dollarsToCents(numeric(p.amount)),
    );
  }

  const committedCentsByBucket = new Map<string, number>();
  const paidCentsByBucket = new Map<string, number>();

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
    const weightsCents = allocs.map((a) => dollarsToCents(numeric(a.amount)));
    // Committed on each bucket = its allocation amount.
    for (let i = 0; i < allocs.length; i += 1) {
      const bucketId = allocs[i].cost_bucket_id as string;
      committedCentsByBucket.set(
        bucketId,
        (committedCentsByBucket.get(bucketId) ?? 0) + weightsCents[i],
      );
    }
    // Paid distributed across this sub's allocations by committed weight.
    const paidShares = distributeCents(paidCentsBySub.get(subId) ?? 0, weightsCents);
    for (let i = 0; i < allocs.length; i += 1) {
      const bucketId = allocs[i].cost_bucket_id as string;
      paidCentsByBucket.set(bucketId, (paidCentsByBucket.get(bucketId) ?? 0) + paidShares[i]);
    }
  }

  const out = new Map<string, SubBucketCost>();
  const bucketIds = new Set<string>([
    ...committedCentsByBucket.keys(),
    ...paidCentsByBucket.keys(),
  ]);
  for (const bucketId of bucketIds) {
    const committedCents = committedCentsByBucket.get(bucketId) ?? 0;
    const paidCents = paidCentsByBucket.get(bucketId) ?? 0;
    const openCents = Math.max(0, committedCents - paidCents);
    out.set(bucketId, {
      committed: centsToDollars(committedCents),
      paid: centsToDollars(paidCents),
      open: centsToDollars(openCents),
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
  paid: number; // gross paid-to-date (dollars)
  retainageHeld: number; // retainage still held from the sub (dollars)
  netPaid: number; // cash out to the sub = paid − retainageHeld (dollars)
  remaining: number; // committed − paid (dollars, ≥ 0)
  paidPct: number; // paid / committed, 0..100
}

// The PM payment view per subcontract: buyout, gross paid, retainage held, net
// cash out, remaining commitment, % paid. Retainage is summed off the payments.
export function summarizeSubPayments(
  subcontract: SubcontractLike,
  payments: { amount: number; retainage_held: number }[],
): SubcontractPaySummary {
  const committedCents = dollarsToCents(numeric(subcontract.contract_value));
  let paidCents = 0;
  let retainageCents = 0;
  for (const p of payments) {
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
  };
}
