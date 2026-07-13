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
import {
  allocatePaymentAcrossCodes,
  paymentShareForBucket,
  reviseSubSummary,
  subCostAddition,
  subEarnedKey,
  sumChangeOrders,
  summarizeSubCostByBucket,
  summarizeSubPayments,
} from "../src/lib/subcontract-budget.ts";
import { computeBudgetLedger } from "../src/lib/budget-ledger.ts";
import { computeRollup } from "../src/lib/ior.ts";
import { latestPercentBySubBucket } from "../src/lib/daily-wip.ts";

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

// ── REGRESSION (Darian, live QA 2026-07-08): a real cost code is seeded with
//    ftc = budget, NOT 0. The buyout must DISPLACE that budgeted forecast, not
//    stack on it. Buyout $142,600 on a code budgeted $221,000 (ftc 221,000).
//    Bug was: forecast = ftc(221,000) + open → EAC ballooned to ~budget+buyout
//    and a payment never burned it down. Correct: buyout consumes budgeted
//    forecast, code still forecasts to its budget, payments burn it down. ──
{
  const subs = [{ id: "s7", contract_value: 142_600, status: "executed" }];
  const allocs = [{ subcontract_id: "s7", cost_bucket_id: "b1", amount: 142_600 }];
  const bucket = {
    id: "b1",
    cost_code: "03-8011",
    bucket: "Dock Pit F/R/P",
    contract_value: 221_000,
    original_budget: 221_000,
    actual_to_date: 0,
    ftc: 221_000, // seeded to budget, as real cost codes are
  };

  // Buyout recorded, nothing paid yet: forecast still = budget (buyout consumed
  // 142,600 of the 221,000 budgeted forecast, then added 142,600 back).
  const atBuyout = summarizeSubCostByBucket(subs, allocs, []);
  const rowBuyout = computeBudgetLedger([bucket], [], [], [], [], atBuyout).rows.find(
    (r) => r.costBucketId === "b1",
  );
  assert.equal(rowBuyout?.actuals, 0, "buyout alone adds no actual");
  assert.equal(
    rowBuyout?.open,
    221_000,
    "forecast still equals budget — buyout displaced, not stacked",
  );
  assert.equal(rowBuyout?.eac, 221_000, "EAC = budget, NOT budget + buyout (the bug)");
  assert.equal(rowBuyout?.overUnder, 0, "on budget, not 142,600 over");

  // Pay $20,420: actual rises, forecast burns DOWN by the payment, EAC flat.
  const afterPay = summarizeSubCostByBucket(subs, allocs, [
    { subcontract_id: "s7", amount: 20_420 },
  ]);
  const rowPaid = computeBudgetLedger([bucket], [], [], [], [], afterPay).rows.find(
    (r) => r.costBucketId === "b1",
  );
  assert.equal(rowPaid?.actuals, 20_420, "payment shows as actual-to-date");
  assert.equal(rowPaid?.open, 200_580, "forecast burned down by the payment (221,000 − 20,420)");
  assert.equal(rowPaid?.eac, 221_000, "EAC holds at budget across the payment");
}

// ── Over-buyout: a buyout larger than the code's budgeted forecast honestly
//    shows the code going over budget (commitment exceeds the plan). ──
{
  const subs = [{ id: "s8", contract_value: 150_000, status: "executed" }];
  const allocs = [{ subcontract_id: "s8", cost_bucket_id: "b1", amount: 150_000 }];
  const bucket = {
    id: "b1",
    cost_code: "03-8012",
    bucket: "Slab",
    contract_value: 130_000,
    original_budget: 120_000,
    actual_to_date: 0,
    ftc: 120_000,
  };
  const subCost = summarizeSubCostByBucket(subs, allocs, []);
  const row = computeBudgetLedger([bucket], [], [], [], [], subCost).rows.find(
    (r) => r.costBucketId === "b1",
  );
  // Budgeted ftc 120k fully consumed (min(120k,150k)); forecast = 0 + 150k open.
  assert.equal(row?.open, 150_000, "forecast = the commitment when it exceeds the budgeted ftc");
  assert.equal(row?.eac, 150_000, "EAC = the buyout");
  assert.equal(row?.overUnder, -30_000, "over/under = 120k budget − 150k EAC = 30k OVER");
}

// ── Partial buyout: code part self-perform, part sub. Both forecasts coexist,
//    total still equals budget while unpaid. ──
{
  const subs = [{ id: "s9", contract_value: 60_000, status: "executed" }];
  const allocs = [{ subcontract_id: "s9", cost_bucket_id: "b1", amount: 60_000 }];
  const bucket = {
    id: "b1",
    cost_code: "03-8013",
    bucket: "Openings",
    contract_value: 110_000,
    original_budget: 100_000,
    actual_to_date: 0,
    ftc: 100_000,
  };
  const subCost = summarizeSubCostByBucket(subs, allocs, []);
  const row = computeBudgetLedger([bucket], [], [], [], [], subCost).rows.find(
    (r) => r.costBucketId === "b1",
  );
  // self-perform remaining = 100k − 60k = 40k; + sub open 60k = 100k = budget.
  assert.equal(row?.open, 100_000, "self-perform 40k + sub 60k = budget, no double-count");
  assert.equal(row?.eac, 100_000, "EAC = budget");
}

// ── Coherence guard (Darian: "committed cost updated up top but not below"):
//    sub cost tied to a code that ISN'T a listed budget line (orphaned/stale
//    allocation) must still land in the ledger TOTALS via a catch-all row, so the
//    Budget-tab summary cards — which sum the WHOLE sub map — match the table
//    total below. Without the catch-all the table dropped it and the two views
//    disagreed. ──
{
  const bucket = {
    id: "b1",
    cost_code: "03-100",
    bucket: "Concrete",
    contract_value: 120_000,
    original_budget: 100_000,
    actual_to_date: 0,
    ftc: 100_000,
  };
  // One listed bucket + one orphaned bucket id NOT in the buckets list.
  const subCost = new Map([
    ["b1", { paid: 10_000, open: 20_000, committed: 30_000 }],
    ["orphan", { paid: 5_000, open: 7_000, committed: 12_000 }],
  ]);
  const ledger = computeBudgetLedger([bucket], [], [], [], [], subCost);
  const catchAll = ledger.rows.find(
    (r) => r.description === "Subcontractor cost (unallocated to a listed code)",
  );
  assert.ok(catchAll, "orphaned sub cost gets its own catch-all row");
  assert.equal(catchAll?.actuals, 5_000, "catch-all actuals = orphaned sub paid");
  assert.equal(catchAll?.open, 7_000, "catch-all open = orphaned sub open");
  // Cards' "Actual to date" = Σ bucket.actual (0) + Σ ALL sub paid (10k+5k) = 15k.
  assert.equal(ledger.totals.actuals, 15_000, "table total actuals == cards' whole-map sub sum");
  // Cards' "Forecast to complete" = Σ bucket.ftc (100k) + Σ[subOpen − min(ftc,committed)]
  // = 100k + (20k−30k) + (7k−0) = 97k; table = [max(0,100k−30k)=70k + 20k] + 7k = 97k.
  assert.equal(ledger.totals.open, 97_000, "table total open == cards' netted whole-map sum");
}

// ── subCostAddition: the single number both the dashboard rollup and the
//    Budget-tab cards use for the sub layer. Displaces self-perform ftc per code
//    (floored at 0), adds orphaned-code cost raw — must equal what the Budget
//    cards add (Σ paid + Σ[open − min(ftc, committed)]). ──
{
  // No subs → adds nothing (backwards compatible).
  assert.equal(subCostAddition([{ id: "b1", ftc: 100_000 }], new Map()), 0, "no subs → 0 added");

  // Buyout within a code's budgeted forecast displaces it, adds nothing net.
  const withinBudget = new Map([["b1", { paid: 0, open: 120_000, committed: 120_000 }]]);
  assert.equal(
    subCostAddition([{ id: "b1", ftc: 150_000 }], withinBudget),
    0,
    "buyout under the budgeted ftc displaces it — 0 net added",
  );

  // Over-buyout pops the line: adds (committed − ftc) on top.
  const overBudget = new Map([["b1", { paid: 0, open: 150_000, committed: 150_000 }]]);
  assert.equal(
    subCostAddition([{ id: "b1", ftc: 120_000 }], overBudget),
    30_000,
    "over-buyout adds committed − budgeted ftc (150k − 120k)",
  );

  // Listed code + orphaned code: listed displaces, orphan adds raw.
  const mixed = new Map([
    ["b1", { paid: 10_000, open: 20_000, committed: 30_000 }],
    ["orphan", { paid: 5_000, open: 7_000, committed: 12_000 }],
  ]);
  // b1: 10k + 20k − min(100k, 30k)=30k → 0; orphan: 5k + 7k → 12k. Total 12k.
  assert.equal(
    subCostAddition([{ id: "b1", ftc: 100_000 }], mixed),
    12_000,
    "orphaned-code sub cost adds raw; listed code displaces",
  );

  // subCostAddition equals what the Budget cards add — the anti-drift guarantee.
  const paidSum = 10_000 + 5_000;
  const openAdj = 20_000 - Math.min(100_000, 30_000) + (7_000 - 0); // b1 netted + orphan raw
  assert.equal(
    subCostAddition([{ id: "b1", ftc: 100_000 }], mixed),
    paidSum + openAdj,
    "subCostAddition == cards' (Σ paid + Σ openAdj) — dashboard & Budget tab can't drift",
  );
}

// ── computeRollup (dashboard GP) now folds the sub layer: an over-buyout that
//    pops a line pulls the dashboard's Indicated GP down by exactly the added
//    cost — the Ryder fix (subs were invisible to the dashboard, faking upside). ──
{
  const project = {
    original_contract: 1_000_000,
    original_cost_budget: 800_000,
    phase: "Middle" as const,
    percent_complete: 40,
    schedule_variance_weeks: 0,
  };
  const buckets = [
    { id: "b1", bucket: "Slab", original_budget: 120_000, actual_to_date: 0, ftc: 120_000 },
    { id: "b2", bucket: "Other", original_budget: 680_000, actual_to_date: 0, ftc: 680_000 },
  ];

  // Baseline: no subs → forecast cost = Σ ftc = 800k, GP = 200k (20%).
  const bare = computeRollup(project, buckets, [], []);
  assert.equal(bare.forecastedFinalCost, 800_000, "no subs → forecast = self-perform budget");
  assert.equal(bare.indicatedGP, 200_000, "no subs → GP = contract − budget");

  // A $150k sub buyout on the $120k Slab line pops it by $30k.
  const subs = [{ id: "s1", contract_value: 150_000, status: "executed" }];
  const allocs = [{ subcontract_id: "s1", cost_bucket_id: "b1", amount: 150_000 }];
  const subCost = summarizeSubCostByBucket(subs, allocs, []);
  const withSubs = computeRollup(project, buckets, [], [], subCost);
  assert.equal(
    withSubs.forecastedFinalCost,
    830_000,
    "over-buyout adds 30k to the dashboard's forecasted cost",
  );
  assert.equal(withSubs.indicatedGP, 170_000, "dashboard Indicated GP drops by the popped 30k");
  assert.equal(withSubs.gpAtRisk, 30_000, "the 30k pop shows up as GP at risk vs the original 20%");

  // actualToDate / ftc stay RAW so the Budget cards (which add subs to these) and
  // the sub-inclusive forecastedFinalCost reconcile to one number, not two.
  assert.equal(withSubs.actualToDate, 0, "rollup.actualToDate stays raw (cards add subs to it)");
  assert.equal(withSubs.ftc, 800_000, "rollup.ftc stays raw (cards add subs to it)");
  const openAdj = 150_000 - Math.min(120_000, 150_000); // sub open − displaced self-perform ftc
  assert.equal(
    withSubs.actualToDate + 0 + (withSubs.ftc + openAdj),
    withSubs.forecastedFinalCost,
    "Budget cards' (actual+subPaid)+(ftc+openAdj) == dashboard forecastedFinalCost",
  );
}

// ── The Money dashboard separates the signed deal from weighted pending COs.
//    Approved CO margin belongs in current signed GP; pending COs do not. ──
{
  const rollup = computeRollup(
    {
      original_contract: 3_200_000,
      original_cost_budget: 2_720_000,
      phase: "Middle",
      percent_complete: 60,
      schedule_variance_weeks: 0,
    },
    [],
    [
      { contract_amount: 65_000, cost_amount: 58_000, status: "Approved", probability: 100 },
      { contract_amount: 145_000, cost_amount: 122_000, status: "Pending", probability: 50 },
      { contract_amount: 85_000, cost_amount: 72_000, status: "Pending", probability: 75 },
      { contract_amount: 120_000, cost_amount: 98_000, status: "Pending", probability: 50 },
    ],
    [],
  );

  assert.equal(rollup.currentSignedContract, 3_265_000, "approved CO revenue is signed");
  assert.equal(rollup.currentSignedGP, 487_000, "approved CO margin belongs in signed GP");
  assert.equal(rollup.weightedPendingCOContract, 196_250, "pending revenue stays weighted");
  assert.equal(rollup.weightedPendingCOCost, 164_000, "pending cost stays weighted");
  assert.equal(
    rollup.forecastedFinalContract,
    rollup.currentSignedContract + rollup.weightedPendingCOContract,
    "risk-adjusted contract bridges from current signed plus weighted pending",
  );
}

// ── Earned value drives recognized cost (Slice C part 2): a sub's cost-to-date
//    = max(earned, paid), earned = commitment × the field %-complete on that code.
//    Payments become a floor, not the driver — "% drives cost". ──
{
  // Darian's Dock Pit, % now logged on the buyout's own code: committed 142,600,
  // paid 20,420, 20% complete → earned 28,520 > paid → recognized cost 28,520.
  const subs = [
    { id: "sc1", contract_value: 142_600, status: "executed", subcontractor_id: "co1" },
  ];
  const allocs = [{ subcontract_id: "sc1", cost_bucket_id: "b1", amount: 142_600 }];
  const pays = [{ subcontract_id: "sc1", amount: 20_420 }];
  const pct = new Map([[subEarnedKey("co1", "b1"), 20]]);

  const ev = summarizeSubCostByBucket(subs, allocs, pays, pct).get("b1");
  // Actual = cash PAID (what's gone out the door); earned = the work's value
  // (progress), shown alongside. They are distinct — the gap is work done but
  // not yet paid.
  assert.equal(ev?.paid, 20_420, "paid = actual cash out (Darian's $20,420)");
  assert.equal(ev?.earned, 28_520, "earned = 20% × 142,600 = the work's value (display)");
  assert.equal(ev?.open, 122_180, "open = committed − PAID (142,600 − 20,420), cash-based");
  assert.equal(ev?.committed, 142_600, "committed unchanged");

  // No % map → earned is 0; paid/open unchanged (earned is purely additive display).
  const plain = summarizeSubCostByBucket(subs, allocs, pays).get("b1");
  assert.equal(plain?.paid, 20_420, "paid = cash regardless of the earned-value map");
  assert.equal(plain?.open, 122_180, "open = committed − paid");
  assert.equal(plain?.earned, 0, "no % map → earned 0");

  // Earned value tracks % independently of cash: 10% → 14,260 earned, paid still
  // 20,420 (you've paid ahead of production here — the gap goes the other way).
  const lowPct = new Map([[subEarnedKey("co1", "b1"), 10]]);
  const low = summarizeSubCostByBucket(subs, allocs, pays, lowPct).get("b1");
  assert.equal(low?.earned, 14_260, "earned = 10% × 142,600, independent of what's paid");
  assert.equal(low?.paid, 20_420, "paid unchanged — earned never moves actual");

  // 100% complete → earned = the whole commitment; paid/open still cash-driven.
  const full = new Map([[subEarnedKey("co1", "b1"), 100]]);
  const done = summarizeSubCostByBucket(subs, allocs, pays, full).get("b1");
  assert.equal(done?.earned, 142_600, "100% → earned = full commitment");
  assert.equal(done?.paid, 20_420, "paid still the cash out");
  assert.equal(done?.open, 122_180, "open still committed − paid (cash-based)");

  // The CASH paid flows into the ledger's actual-to-date (earned is display-only;
  // EAC = the commitment regardless of the paid/earned split).
  const bucket = {
    id: "b1",
    cost_code: "03-8011",
    bucket: "Dock Pit F/R/P",
    contract_value: 221_000,
    original_budget: 221_000,
    actual_to_date: 0,
    ftc: 221_000,
  };
  const row = computeBudgetLedger(
    [bucket],
    [],
    [],
    [],
    [],
    summarizeSubCostByBucket(subs, allocs, pays, pct),
  ).rows.find((r) => r.costBucketId === "b1");
  assert.equal(row?.actuals, 20_420, "ledger actual-to-date = cash paid (not earned value)");
  assert.equal(row?.eac, 221_000, "EAC = the commitment — the paid/earned split doesn't move it");
}

// ── latestPercentBySubBucket: the recognized % per (sub, code) is the LATEST
//    entry's value (cumulative), keyed to match subEarnedKey. ──
{
  const entries = [
    {
      subcontractor_id: "co1",
      cost_bucket_id: "b1",
      percent_complete: 20,
      entry_date: "2026-07-06",
      updated_at: "2026-07-06T10:00:00Z",
    },
    {
      subcontractor_id: "co1",
      cost_bucket_id: "b1",
      percent_complete: 35,
      entry_date: "2026-07-08",
      updated_at: "2026-07-08T10:00:00Z",
    },
    // self-perform (no sub) and uncoded lines are ignored.
    {
      subcontractor_id: null,
      cost_bucket_id: "b1",
      percent_complete: 99,
      entry_date: "2026-07-09",
      updated_at: "",
    },
  ];
  const map = latestPercentBySubBucket(entries);
  assert.equal(
    map.get(subEarnedKey("co1", "b1")),
    35,
    "latest entry's % wins (cumulative, not summed)",
  );
  assert.equal(map.size, 1, "self-perform / uncoded entries excluded");
}

// ── Change orders & credits stay separate from the base contract ────────────
{
  const sub = { id: "s1", contract_value: 123672.88, status: "executed" };
  const summary = summarizeSubPayments(sub, [{ amount: 108173, retainage_held: 0 }]);
  const coTotal = sumChangeOrders([
    { subcontract_id: "s1", amount: 11500 }, // change order adds
    { subcontract_id: "s1", amount: -2500.5 }, // credit deducts
  ]);
  assert.equal(coTotal, 8999.5, "signed COs/credits sum cents-exact");
  const revised = reviseSubSummary(summary, coTotal);
  assert.equal(revised.base, 123672.88, "the base contract is never mutated");
  assert.equal(revised.revised, 132672.38, "revised = base + change orders");
  assert.equal(revised.remaining, 24499.38, "remaining measures against the revised total");
  assert.ok(
    Math.abs(revised.paidPct - (108173 / 132672.38) * 100) < 0.001,
    "% paid measures against the revised total",
  );
  // No change orders → revised mirrors the base numbers.
  const flat = reviseSubSummary(summary, 0);
  assert.equal(flat.revised, flat.base, "no COs → revised equals base");
}

// ── Payment splits pro-rata across the buyout's cost codes, cents-exact ─────
{
  const allocations = [
    { cost_code: "03-8009", description: "Saw Cutting: Dock Pits", amount: 98372.88 },
    { cost_code: "03-8010", description: "Saw Cutting: Plumbing", amount: 25300 },
    { cost_code: "03-8009", description: "Saw Cutting: Dock Pits 2", amount: 11500 },
  ];
  const split = allocatePaymentAcrossCodes(108173, allocations);
  assert.equal(split.length, 3, "every coded allocation gets a share");
  const total = split.reduce((sum, row) => sum + Math.round(row.amount * 100), 0);
  assert.equal(total, 10817300, "the split sums cents-exact to the payment");
  assert.ok(
    split[0].amount > split[1].amount && split[1].amount > split[2].amount,
    "shares are proportional to the allocation sizes",
  );
  assert.deepEqual(
    allocatePaymentAcrossCodes(5000, []),
    [],
    "no coded allocations → no derived split",
  );
  assert.deepEqual(allocatePaymentAcrossCodes(0, allocations), [], "zero payment → no split");
}

// ── A payment's pro-rata share on ONE cost code (budget drawer drill-through) ─
{
  const allocations = [
    { cost_bucket_id: "b1", amount: 98372.88 },
    { cost_bucket_id: "b2", amount: 25300 },
    { cost_bucket_id: null, amount: 11500 }, // uncoded slice never claims a share
  ];
  const b1 = paymentShareForBucket(108173, allocations, "b1");
  const b2 = paymentShareForBucket(108173, allocations, "b2");
  assert.equal(
    Math.round(b1 * 100) + Math.round(b2 * 100),
    10817300,
    "per-bucket shares sum cents-exact to the payment",
  );
  assert.ok(b1 > b2, "shares track the allocation sizes");
  assert.equal(paymentShareForBucket(108173, allocations, "b9"), 0, "no allocation → no share");
  assert.equal(paymentShareForBucket(0, allocations, "b1"), 0, "zero payment → zero share");
}

// ── Coded change orders fold into committed (the dashboard roll-up ask) ─────
// Field feedback 2026-07-09: "change orders didnt roll up to the dashboards."
// A CO tagged to a cost code now carries into that code's committed (and from
// there the Budget grid + rollup); untagged COs stay card-only.
{
  const subs = [{ id: "s1", contract_value: 117_672.88, status: "executed" }];
  const allocs = [
    { subcontract_id: "s1", cost_bucket_id: "b8009", amount: 92_372.88 },
    { subcontract_id: "s1", cost_bucket_id: "b8010", amount: 25_300 },
  ];

  // DB3T's own $11,500 CO, tagged to 03-8009 → that code's committed rises.
  const withCo = summarizeSubCostByBucket(subs, allocs, [], undefined, [
    { subcontract_id: "s1", cost_bucket_id: "b8009", amount: 11_500 },
  ]);
  assert.equal(withCo.get("b8009")?.committed, 103_872.88, "coded CO adds to its code");
  assert.equal(withCo.get("b8010")?.committed, 25_300, "other codes untouched");
  assert.equal(withCo.get("b8009")?.open, 103_872.88, "open follows the revised commitment");

  // A credit (negative) reduces committed on its code.
  const withCredit = summarizeSubCostByBucket(subs, allocs, [], undefined, [
    { subcontract_id: "s1", cost_bucket_id: "b8010", amount: -5_300 },
  ]);
  assert.equal(withCredit.get("b8010")?.committed, 20_000, "credit reduces its code");

  // A credit larger than the code's buyout floors committed at 0, not negative.
  const overCredit = summarizeSubCostByBucket(subs, allocs, [], undefined, [
    { subcontract_id: "s1", cost_bucket_id: "b8010", amount: -99_999 },
  ]);
  assert.equal(overCredit.get("b8010")?.committed, 0, "committed floors at 0");

  // Untagged COs stay card-only; draft-sub COs never move the budget.
  const untagged = summarizeSubCostByBucket(subs, allocs, [], undefined, [
    { subcontract_id: "s1", cost_bucket_id: null, amount: 50_000 },
  ]);
  assert.equal(untagged.get("b8009")?.committed, 92_372.88, "untagged CO does not fold");
  const draftSubs = [{ id: "s9", contract_value: 10_000, status: "draft" }];
  const draftCo = summarizeSubCostByBucket(draftSubs, [], [], undefined, [
    { subcontract_id: "s9", cost_bucket_id: "b8009", amount: 7_500 },
  ]);
  assert.equal(draftCo.size, 0, "a draft sub's CO does not move the budget");

  // A CO on a code the sub has NO allocation on still lands on that code.
  const newCode = summarizeSubCostByBucket(subs, allocs, [], undefined, [
    { subcontract_id: "s1", cost_bucket_id: "b-new", amount: 4_000 },
  ]);
  assert.equal(newCode.get("b-new")?.committed, 4_000, "CO alone creates the code's commitment");

  // Payments still distribute by ALLOCATION weights — a CO changes what's
  // committed, not how past cash was coded.
  const paidWithCo = summarizeSubCostByBucket(
    subs,
    allocs,
    [{ subcontract_id: "s1", amount: 10_000 }],
    undefined,
    [{ subcontract_id: "s1", cost_bucket_id: "b8009", amount: 11_500 }],
  );
  const paidPlain = summarizeSubCostByBucket(subs, allocs, [
    { subcontract_id: "s1", amount: 10_000 },
  ]);
  assert.equal(
    paidWithCo.get("b8009")?.paid,
    paidPlain.get("b8009")?.paid,
    "CO leaves payment distribution unchanged",
  );

  // End to end through the rollup's displacement math: once committed passes the
  // code's budgeted forecast, the CO pops GP by exactly the overage…
  const tightBuckets = [{ id: "b8009", ftc: 92_372.88 }];
  const addPlain = subCostAddition(tightBuckets, summarizeSubCostByBucket(subs, allocs, []));
  const addWithCo = subCostAddition(tightBuckets, withCo);
  assert.equal(
    Math.round((addWithCo - addPlain) * 100),
    1_150_000,
    "the $11,500 CO flows through to the rollup's added sub cost",
  );
  // …while a code with budget headroom absorbs it (displacement, not stacking):
  // committed still SHOWS the CO on the grid, but EAC only moves on the overage.
  const roomyBuckets = [{ id: "b8009", ftc: 130_000 }];
  const addRoomPlain = subCostAddition(roomyBuckets, summarizeSubCostByBucket(subs, allocs, []));
  const addRoomWithCo = subCostAddition(roomyBuckets, withCo);
  assert.equal(
    Math.round((addRoomWithCo - addRoomPlain) * 100),
    0,
    "a CO inside the code's budgeted forecast displaces instead of stacking",
  );
}

// ── Explicit per-payment splits override the pro-rata paid distribution ─────
// Field feedback 2026-07-09: "for progress payments i dont see where to add
// which cost code it goes to." A payment with saved split rows lands its cash
// exactly where the user coded it; payments without keep the pro-rata split.
{
  const subs = [{ id: "s1", contract_value: 100_000, status: "executed" }];
  const allocs = [
    { subcontract_id: "s1", cost_bucket_id: "bA", amount: 75_000 },
    { subcontract_id: "s1", cost_bucket_id: "bB", amount: 25_000 },
  ];
  const pays = [
    { id: "p1", subcontract_id: "s1", amount: 10_000 },
    { id: "p2", subcontract_id: "s1", amount: 4_000 },
  ];
  // p1 is explicitly coded 100% to bB; p2 stays automatic (pro-rata 75/25).
  const splits = [{ payment_id: "p1", cost_bucket_id: "bB", amount: 10_000 }];
  const res = summarizeSubCostByBucket(subs, allocs, pays, undefined, [], splits);
  assert.equal(res.get("bB")?.paid, 10_000 + 1_000, "coded payment lands whole on its code");
  assert.equal(res.get("bA")?.paid, 3_000, "uncoded payment still pro-rates");
  assert.equal(
    (res.get("bA")?.paid ?? 0) + (res.get("bB")?.paid ?? 0),
    14_000,
    "total paid is conserved across explicit + automatic payments",
  );

  // Without the payment id, splits can't match — everything pro-rates (the
  // pre-migration behaviour).
  const noIds = summarizeSubCostByBucket(
    subs,
    allocs,
    pays.map(({ subcontract_id, amount }) => ({ subcontract_id, amount })),
    undefined,
    [],
    splits,
  );
  assert.equal(noIds.get("bA")?.paid, 10_500, "id-less payments keep pro-rata");

  // A split row aimed at a code the sub has no allocation on still lands there.
  const crossSplit = summarizeSubCostByBucket(
    subs,
    allocs,
    pays,
    undefined,
    [],
    [{ payment_id: "p1", cost_bucket_id: "bC", amount: 10_000 }],
  );
  assert.equal(crossSplit.get("bC")?.paid, 10_000, "split can code cash to any bucket");
  assert.equal(crossSplit.get("bC")?.committed, 0, "coding cash does not fake a commitment");

  // Draft subs stay out entirely, split or not.
  const draft = summarizeSubCostByBucket(
    [{ id: "s9", contract_value: 5_000, status: "draft" }],
    [],
    [{ id: "p9", subcontract_id: "s9", amount: 5_000 }],
    undefined,
    [],
    [{ payment_id: "p9", cost_bucket_id: "bA", amount: 5_000 }],
  );
  assert.equal(draft.size, 0, "a draft sub's coded payment does not move the budget");
}

// ── Pay-app lifecycle (field request 2026-07-09): draft → approved → paid.
//    Only PAID pay apps are actual cost; draft/approved stay inside the open
//    commitment, so the total forecast (EAC) never moves before money does.
//    Rows recorded before the lifecycle carry no status → treated as paid. ──
{
  const subs = [{ id: "sl1", contract_value: 100_000, status: "executed" }];
  const allocs = [{ subcontract_id: "sl1", cost_bucket_id: "b1", amount: 100_000 }];

  // A draft pay app moves nothing: paid 0, open = full commitment.
  const drafted = summarizeSubCostByBucket(subs, allocs, [
    { subcontract_id: "sl1", amount: 25_000, status: "draft" },
  ]).get("b1");
  assert.equal(drafted?.paid, 0, "a draft pay app is not actual cost");
  assert.equal(drafted?.open, 100_000, "the full commitment stays open");

  // Approving it still moves nothing — cost lands when the money leaves.
  const approved = summarizeSubCostByBucket(subs, allocs, [
    { subcontract_id: "sl1", amount: 25_000, status: "approved" },
  ]).get("b1");
  assert.equal(approved?.paid, 0, "approved-for-payment is not actual cost yet");
  assert.equal(approved?.open, 100_000, "EAC unchanged until it's paid");

  // Marking it paid is the existing behaviour: actual up, open down, EAC flat.
  const paid = summarizeSubCostByBucket(subs, allocs, [
    { subcontract_id: "sl1", amount: 25_000, status: "paid" },
  ]).get("b1");
  assert.equal(paid?.paid, 25_000, "paid pay app = actual cost");
  assert.equal(paid?.open, 75_000, "open commitment burned down");

  // An UNPAID pay app with an explicit cost-code split: the split rows must not
  // land either — coding a draft says where the cash WILL go, not that it went.
  const draftSplit = summarizeSubCostByBucket(
    subs,
    allocs,
    [{ id: "pd1", subcontract_id: "sl1", amount: 25_000, status: "draft" }],
    undefined,
    [],
    [{ payment_id: "pd1", cost_bucket_id: "b1", amount: 25_000 }],
  ).get("b1");
  assert.equal(draftSplit?.paid, 0, "a draft's explicit split rows don't land as cost");
  assert.equal(draftSplit?.open, 100_000, "commitment stays fully open");
  // …and the same payment marked paid lands its split verbatim.
  const paidSplit = summarizeSubCostByBucket(
    subs,
    allocs,
    [{ id: "pd1", subcontract_id: "sl1", amount: 25_000, status: "paid" }],
    undefined,
    [],
    [{ payment_id: "pd1", cost_bucket_id: "b1", amount: 25_000 }],
  ).get("b1");
  assert.equal(paidSplit?.paid, 25_000, "once paid, the explicit split lands verbatim");

  // A pre-lifecycle row (no status) was a paid fact — identical to 'paid'.
  const legacy = summarizeSubCostByBucket(subs, allocs, [
    { subcontract_id: "sl1", amount: 25_000 },
  ]).get("b1");
  assert.equal(legacy?.paid, 25_000, "statusless legacy rows still count as paid");

  // The PM view splits the pipeline out and keeps money numbers paid-only.
  const view = summarizeSubPayments(subs[0], [
    { amount: 10_000, retainage_held: 1_000, status: "draft" },
    { amount: 20_000, retainage_held: 2_000, status: "approved" },
    { amount: 30_000, retainage_held: 3_000, status: "paid" },
    { amount: 5_000, retainage_held: 500 }, // legacy row = paid
  ]);
  assert.equal(view.draftTotal, 10_000, "draft pipeline total");
  assert.equal(view.approvedTotal, 20_000, "approved-for-payment pipeline total");
  assert.equal(view.paid, 35_000, "paid-to-date = paid + legacy rows only");
  assert.equal(view.retainageHeld, 3_500, "retainage held only from paid rows");
  assert.equal(view.netPaid, 31_500, "net cash out = paid − retainage held");
  assert.equal(view.remaining, 65_000, "remaining = committed − paid (drafts don't shrink it)");
}

console.log("subcontract budget smoke: all assertions passed");
