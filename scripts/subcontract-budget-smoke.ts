// Subcontractor additive-cost-layer acceptance smoke (SUBCONTRACTORS Slice 1).
//
// Proves the money model the founder approved: a buyout is committed cost
// (→ forecast-to-complete), a progress payment is actual cost (→ actual-to-date
// and forecast-to-complete drops by the same), EAC stays flat across a payment,
// payments distribute cents-exact across a split buyout, and retainage held is
// tracked separately from the gross cost.
//
// Run: node --experimental-strip-types scripts/subcontract-budget-smoke.ts
import assert from "node:assert/strict";
import { summarizeSubCostByBucket, summarizeSubPayments } from "../src/lib/subcontract-budget.ts";
import { computeBudgetLedger } from "../src/lib/budget-ledger.ts";

// ── Darian's scenario: $145k buyout on one cost code, pay $20k → 20/145 ──
{
  const subs = [{ id: "s1", contract_value: 145_000, status: "executed" }];
  const allocs = [{ subcontract_id: "s1", cost_bucket_id: "b1", amount: 145_000 }];

  // Before any payment: committed 145k → forecast; paid 0.
  const before = summarizeSubCostByBucket(subs, allocs, []);
  assert.equal(before.get("b1")?.committed, 145_000, "buyout commits 145k");
  assert.equal(before.get("b1")?.paid, 0, "nothing paid yet");
  assert.equal(before.get("b1")?.open, 145_000, "full 145k is open (forecast)");

  // Pay 20k → actual 20k, open drops to 125k. EAC (actual+open) stays 145k.
  const after = summarizeSubCostByBucket(subs, allocs, [{ subcontract_id: "s1", amount: 20_000 }]);
  assert.equal(after.get("b1")?.paid, 20_000, "20k now actual");
  assert.equal(after.get("b1")?.open, 125_000, "forecast-to-complete dropped to 125k");
  assert.equal(
    (after.get("b1")?.paid ?? 0) + (after.get("b1")?.open ?? 0),
    145_000,
    "EAC (actual+forecast) flat across the payment",
  );
}

// ── Draft buyout does not commit cost ──
{
  const subs = [{ id: "s2", contract_value: 80_000, status: "draft" }];
  const allocs = [{ subcontract_id: "s2", cost_bucket_id: "b1", amount: 80_000 }];
  const res = summarizeSubCostByBucket(subs, allocs, [{ subcontract_id: "s2", amount: 10_000 }]);
  assert.equal(res.size, 0, "a draft buyout moves nothing (no committed, no paid)");
}

// ── Split buyout across two codes: payment distributes pro-rata, cents-exact ──
{
  const subs = [{ id: "s3", contract_value: 100_000, status: "executed" }];
  const allocs = [
    { subcontract_id: "s3", cost_bucket_id: "b1", amount: 60_000 },
    { subcontract_id: "s3", cost_bucket_id: "b2", amount: 40_000 },
  ];
  const res = summarizeSubCostByBucket(subs, allocs, [{ subcontract_id: "s3", amount: 25_000 }]);
  // 25k × 60/100 = 15k on b1; 25k × 40/100 = 10k on b2.
  assert.equal(res.get("b1")?.paid, 15_000, "b1 gets 60% of the payment");
  assert.equal(res.get("b2")?.paid, 10_000, "b2 gets 40% of the payment");
  assert.equal(res.get("b1")?.open, 45_000, "b1 open = 60k − 15k");
  assert.equal(res.get("b2")?.open, 30_000, "b2 open = 40k − 10k");
  // Shares reconcile to the payment exactly.
  assert.equal(
    (res.get("b1")?.paid ?? 0) + (res.get("b2")?.paid ?? 0),
    25_000,
    "split payment reconciles to the cent",
  );
}

// ── Awkward split forces a rounding remainder; shares still reconcile exact ──
{
  const subs = [{ id: "s4", contract_value: 3, status: "executed" }];
  const allocs = [
    { subcontract_id: "s4", cost_bucket_id: "b1", amount: 1 },
    { subcontract_id: "s4", cost_bucket_id: "b2", amount: 1 },
    { subcontract_id: "s4", cost_bucket_id: "b3", amount: 1 },
  ];
  // Pay $1 across three equal $1 allocations → 33.33¢ each can't be exact; the
  // last positive share absorbs the remainder so the total is exactly $1.
  const res = summarizeSubCostByBucket(subs, allocs, [{ subcontract_id: "s4", amount: 1 }]);
  const total =
    (res.get("b1")?.paid ?? 0) + (res.get("b2")?.paid ?? 0) + (res.get("b3")?.paid ?? 0);
  assert.equal(total, 1, "rounding remainder absorbed — pennies reconcile to $1.00");
}

// ── Overpayment clamps open to 0 (never negative forecast) ──
{
  const subs = [{ id: "s5", contract_value: 50_000, status: "executed" }];
  const allocs = [{ subcontract_id: "s5", cost_bucket_id: "b1", amount: 50_000 }];
  const res = summarizeSubCostByBucket(subs, allocs, [{ subcontract_id: "s5", amount: 55_000 }]);
  assert.equal(res.get("b1")?.paid, 55_000, "overpaid actual reflects reality");
  assert.equal(res.get("b1")?.open, 0, "open never goes negative");
}

// ── PM payment view: gross paid, retainage held, net cash, remaining, % ──
{
  const sub = { id: "s6", contract_value: 145_000, status: "executed" };
  const view = summarizeSubPayments(sub, [
    { amount: 20_000, retainage_held: 2_000 },
    { amount: 30_000, retainage_held: 3_000 },
  ]);
  assert.equal(view.committed, 145_000, "buyout total");
  assert.equal(view.paid, 50_000, "gross paid-to-date");
  assert.equal(view.retainageHeld, 5_000, "retainage held (10% of each)");
  assert.equal(view.netPaid, 45_000, "net cash out = paid − retainage");
  assert.equal(view.remaining, 95_000, "remaining commitment = 145k − 50k");
  assert.ok(Math.abs(view.paidPct - (50_000 / 145_000) * 100) < 1e-9, "% paid");
}

// ── The additive layer folds into computeBudgetLedger: buyout $145k on a code,
//    $20k paid → the ledger row shows actual +20k, forecast +125k, EAC 145k ──
{
  const subs = [{ id: "s1", contract_value: 145_000, status: "executed" }];
  const allocs = [{ subcontract_id: "s1", cost_bucket_id: "b1", amount: 145_000 }];
  const subCost = summarizeSubCostByBucket(subs, allocs, [
    { subcontract_id: "s1", amount: 20_000 },
  ]);
  const bucket = {
    id: "b1",
    cost_code: "0300",
    bucket: "Structure",
    contract_value: 250_000,
    original_budget: 200_000,
    actual_to_date: 0,
    ftc: 0,
  };
  const ledger = computeBudgetLedger([bucket], [], [], [], [], subCost);
  const row = ledger.rows.find((r) => r.costBucketId === "b1");
  assert.equal(row?.actuals, 20_000, "sub payment shows as actual-to-date in the ledger");
  assert.equal(row?.open, 125_000, "remaining sub commitment shows as forecast-to-complete");
  assert.equal(row?.eac, 145_000, "EAC = 20k actual + 125k forecast");
  assert.equal(row?.overUnder, 55_000, "over/under = 200k budget − 145k EAC = 55k under");
  // Baseline columns are untouched — the sub layer is purely additive.
  assert.equal(row?.originalBudget, 200_000, "original budget untouched");
  assert.equal(row?.contractValue, 250_000, "contract value untouched");
  // With no sub layer the same bucket reads zero actual/forecast (additive, no-op).
  const bare = computeBudgetLedger([bucket], [], []).rows.find((r) => r.costBucketId === "b1");
  assert.equal(bare?.actuals, 0, "no subs → no added actuals (backwards compatible)");
  assert.equal(bare?.open, 0, "no subs → no added forecast");
}

console.log("subcontract budget smoke: all assertions passed");
