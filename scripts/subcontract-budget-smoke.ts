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
  summarizeSubCostByBucket,
  summarizeSubPayments,
  subCostAddition,
  subEarnedKey,
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

  const earned = summarizeSubCostByBucket(subs, allocs, pays, pct).get("b1");
  assert.equal(earned?.paid, 28_520, "recognized cost = earned (20% × 142,600) when it beats paid");
  assert.equal(earned?.open, 114_080, "open = committed − recognized cost (142,600 − 28,520)");
  assert.equal(earned?.committed, 142_600, "committed unchanged");

  // No % map → payments-only, byte-for-byte the old behaviour (backward compatible).
  const plain = summarizeSubCostByBucket(subs, allocs, pays).get("b1");
  assert.equal(plain?.paid, 20_420, "no earned-value input → cost = paid");
  assert.equal(plain?.open, 122_180, "no earned-value input → open = committed − paid");

  // Paid exceeds earned (only 10% logged): cost floors at what's been paid, never
  // understating cost / overstating GP.
  const lowPct = new Map([[subEarnedKey("co1", "b1"), 10]]); // earned 14,260 < 20,420 paid
  const floored = summarizeSubCostByBucket(subs, allocs, pays, lowPct).get("b1");
  assert.equal(
    floored?.paid,
    20_420,
    "cost floors at paid when earned is lower (max(earned,paid))",
  );

  // 100% complete → whole commitment recognized, forecast closes to 0.
  const full = new Map([[subEarnedKey("co1", "b1"), 100]]);
  const done = summarizeSubCostByBucket(subs, allocs, pays, full).get("b1");
  assert.equal(done?.paid, 142_600, "100% → recognized cost = full commitment");
  assert.equal(done?.open, 0, "100% → no remaining commitment");

  // The recognized cost flows into the ledger's actual-to-date (EAC still the
  // commitment — earned value moves the actual/forecast SPLIT, not the total).
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
  assert.equal(row?.actuals, 28_520, "ledger actual-to-date reflects earned value");
  assert.equal(row?.eac, 221_000, "EAC unchanged — earned value is a split, not a total change");
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

console.log("subcontract budget smoke: all assertions passed");
