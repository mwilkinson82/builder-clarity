// BUDGETVSCONTRACT1 smoke — budget and contract value are two numbers, and the
// delta is margin. Node-runnable via `node --experimental-strip-types`.
//
// The founder's framing is the acceptance test: "the budget is what we drive
// the job on. The contract's what they pay us. The difference between the two,
// the delta, is our profit. The budget and the contract value can't be the
// same."
import assert from "node:assert/strict";
import { computeBudgetLedger, ledgerLineMargin } from "../src/lib/budget-ledger.ts";
import { computeWIPBucket } from "../src/lib/wip.ts";
import { buildBillingLinesFromBuckets } from "../src/lib/billing-line-generation.ts";
import {
  aggregateEstimateToBudget,
  estimateHasDistributableMarkup,
} from "../src/lib/estimate-budget.ts";

// ---------------------------------------------------------------------------
// Line margin math ($ and %), cents-exact.
// ---------------------------------------------------------------------------
const m = ledgerLineMargin(260000, 220000);
assert.ok(m, "priced line has a margin");
assert.equal(m.margin, 40000, "margin $ = contract − budget");
assert.ok(Math.abs(m.marginPct - (40000 / 260000) * 100) < 1e-9, "margin % is of contract");
assert.equal(ledgerLineMargin(0, 220000), null, "unpriced line has NO margin — never zero");
assert.equal(ledgerLineMargin(100000.33, 100000.34)?.margin, -0.01, "cents-exact negative margin");

// ---------------------------------------------------------------------------
// The ledger: contract and budget are independent columns; margin is real.
// ---------------------------------------------------------------------------
const buckets = [
  // Priced: contract > budget → positive margin.
  {
    id: "b1",
    cost_code: "0300",
    bucket: "Structure",
    contract_value: 635000,
    original_budget: 540000,
    actual_to_date: 100000,
    ftc: 400000,
  },
  // Priced at a LOSS: contract < budget → negative margin, still shown.
  {
    id: "b2",
    cost_code: "0900",
    bucket: "Finishes",
    contract_value: 700000,
    original_budget: 780000,
    actual_to_date: 0,
    ftc: 0,
  },
  // UNPRICED: no contract value → priced=false, margin null (the regression).
  {
    id: "b3",
    cost_code: "0100",
    bucket: "GC/OH",
    contract_value: 0,
    original_budget: 270000,
    actual_to_date: 0,
    ftc: 0,
  },
];
const changeOrders = [
  // Approved CO with its own margin: +65k contract / +58k cost.
  { id: "co1", status: "Approved", contract_amount: 65000, cost_amount: 58000 },
  // Pending CO must move NOTHING.
  { id: "co2", status: "Pending", contract_amount: 999999, cost_amount: 999999 },
];
const coAllocations = [
  { change_order_id: "co1", cost_bucket_id: "b1", contract_amount: 65000, cost_amount: 58000 },
  { change_order_id: "co2", cost_bucket_id: "b1", contract_amount: 999999, cost_amount: 999999 },
];

const ledger = computeBudgetLedger(buckets, [], [], changeOrders, coAllocations);
const [r1, r2, r3] = ledger.rows;

// b1: both sides carry the approved CO layer; pending CO ignored.
assert.equal(r1.contractValue, 700000, "contract = 635k + 65k approved CO contract");
assert.equal(r1.budget, 598000, "budget = 540k + 58k approved CO cost");
assert.equal(r1.changeOrderContract, 65000, "CO contract provenance");
assert.equal(r1.changeOrderBudget, 58000, "CO budget provenance");
assert.equal(r1.margin, 102000, "line margin includes the CO's own margin (7k)");
assert.ok(r1.priced, "b1 is priced");

// b2: a loss is a loss — shown, not hidden.
assert.equal(r2.margin, -80000, "negative margin reported honestly");

// b3: the regression the spec demands — unpriced ≠ zero margin.
assert.equal(r3.priced, false, "no contract value → unpriced");
assert.equal(r3.margin, null, "unpriced line must NOT report zero margin");
assert.equal(r3.marginPct, null, "unpriced line has no margin %");
assert.equal(ledger.unpricedCount, 1, "unpriced lines are counted for the UI footnote");

// Roll-up reconciliation (cents tolerance): Σ line contract; margin total
// covers priced lines only.
assert.equal(ledger.totals.contractValue, 700000 + 700000, "Σ contract (unpriced adds 0)");
assert.equal(ledger.totals.budget, 598000 + 780000 + 270000, "Σ budget");
assert.equal(ledger.totals.margin, 102000 - 80000, "margin total = Σ priced margins only");
assert.ok(
  Math.abs((ledger.totals.marginPct ?? 0) - (22000 / 1400000) * 100) < 1e-9,
  "totals margin % is of priced contract",
);

// The budget-as-contract identity is DEAD: contract and budget totals differ.
assert.notEqual(
  ledger.totals.contractValue,
  ledger.totals.budget,
  "contract value and budget must not be the same number",
);

// ---------------------------------------------------------------------------
// Unallocated approved-CO money keeps totals honest, without fake margin.
// ---------------------------------------------------------------------------
const ledger2 = computeBudgetLedger(
  buckets.slice(0, 1),
  [],
  [],
  [{ id: "co9", status: "Approved", contract_amount: 50000, cost_amount: 40000 }],
  [], // never allocated
);
const unallocatedRow = ledger2.rows.find(
  (row) => row.description === "Change orders (unallocated)",
);
assert.ok(unallocatedRow, "unallocated approved CO gets its own line");
assert.equal(unallocatedRow.contractValue, 50000, "unallocated CO contract kept in totals");
assert.equal(unallocatedRow.budget, 40000, "unallocated CO cost kept in totals");
assert.equal(unallocatedRow.margin, null, "no margin claimed until allocation lands it");

// ---------------------------------------------------------------------------
// WIP engine: priced lines use the real contract; unpriced fall back to budget
// (legacy behavior — WIP never zeroes out on old data).
// ---------------------------------------------------------------------------
const wipBase = {
  cost_bucket_id: "b",
  cost_code: "0300",
  bucket: "Structure",
  change_order_additions: 0,
  actual_to_date: 0,
  ftc: 0,
  earned_percent_complete: 50,
  billed_to_date: 0,
  retainage_held: 0,
  retainage_released: 0,
};
const pricedWip = computeWIPBucket({ ...wipBase, contract_value: 635000, original_budget: 540000 });
assert.equal(pricedWip.contract_value, 635000, "WIP contract basis = real contract when priced");
assert.equal(pricedWip.earned_revenue, 317500, "earned % applies to the CONTRACT, not the budget");
const legacyWip = computeWIPBucket({ ...wipBase, contract_value: 0, original_budget: 540000 });
assert.equal(legacyWip.contract_value, 540000, "unpriced legacy line falls back to budget");

// ---------------------------------------------------------------------------
// Billing line generation: priced lines bill the CONTRACT (the user-reported
// bug: SOV import was billing the owner at cost).
// ---------------------------------------------------------------------------
const genBase = {
  changeOrders: [],
  allocations: [],
  previousLines: [],
  amountBilled: 0,
  defaultRetainagePct: 10,
};
const [pricedLine] = buildBillingLinesFromBuckets({
  ...genBase,
  buckets: [
    {
      id: "b1",
      cost_code: "0300",
      bucket: "Structure",
      contract_value: 635000,
      original_budget: 540000,
      retainage_pct: 10,
      billing_method: "percent",
      sort_order: 1,
    },
  ],
});
assert.equal(
  pricedLine.scheduled_value_cents,
  63500000,
  "SOV import bills the contract value, NOT the budget",
);
const [legacyLine] = buildBillingLinesFromBuckets({
  ...genBase,
  buckets: [
    {
      id: "b1",
      cost_code: "0300",
      bucket: "Structure",
      contract_value: 0,
      original_budget: 540000,
      retainage_pct: 10,
      billing_method: "percent",
      sort_order: 1,
    },
  ],
});
assert.equal(
  legacyLine.scheduled_value_cents,
  54000000,
  "unpriced legacy line keeps the budget fallback so existing jobs keep billing",
);

// ---------------------------------------------------------------------------
// BUDGETVSCONTRACT2 — estimate carry, auto-price mode. Markup is distributed
// pro-rata by cost and the per-line contract values reconcile to the estimate's
// contract total to the cent; unpriced/no-markup carries stay cost-only.
// ---------------------------------------------------------------------------
const estLines = [
  {
    cost_code: "0300",
    csi_division: "03",
    scope_group: "Structure",
    description: "Concrete",
    total_extended_cents: 54000000,
  },
  {
    cost_code: "0900",
    csi_division: "09",
    scope_group: "Finishes",
    description: "Finishes",
    total_extended_cents: 78000000,
  },
  {
    cost_code: "0100",
    csi_division: "01",
    scope_group: "GC/OH",
    description: "GC",
    total_extended_cents: 27000000,
  },
];
// Total cost 1.59M; estimate contract (cost + markup) 1.90M → 310k margin.
const contractTotalCents = 190000000;

assert.ok(
  estimateHasDistributableMarkup(estLines, contractTotalCents),
  "a contract total above cost is distributable",
);
assert.equal(
  estimateHasDistributableMarkup(estLines, 159000000),
  false,
  "a contract total equal to cost is NOT distributable (would be zero margin)",
);
assert.equal(
  estimateHasDistributableMarkup(estLines, 0),
  false,
  "no contract total → nothing to distribute",
);

// Manual/unpriced carry: budget only, no contract values.
const manual = aggregateEstimateToBudget(estLines);
assert.ok(
  manual.every((line) => line.contractValue === undefined),
  "unpriced carry leaves every line without a contract value",
);
assert.equal(
  manual.reduce((sum, line) => sum + line.budget, 0),
  1590000,
  "budget total = Σ cost",
);

// Auto carry: contract values proposed, reconciling to the estimate total.
const auto = aggregateEstimateToBudget(estLines, { contractTotalCents });
assert.ok(
  auto.every((line) => line.contractValue !== undefined),
  "auto carry proposes a contract value for every priced line",
);
const autoContractTotal = auto.reduce((sum, line) => sum + (line.contractValue ?? 0), 0);
assert.equal(
  autoContractTotal,
  1900000,
  "Σ proposed contract = the estimate's contract total, exactly",
);
// Pro-rata by cost: Structure is 54/159 of cost → 54/159 of the 1.9M contract.
const structure = auto.find((line) => line.costCode === "0300");
assert.ok(structure && structure.contractValue !== undefined, "structure priced");
assert.ok(
  structure.contractValue > structure.budget,
  "proposed contract exceeds budget — a real positive margin",
);
assert.ok(
  Math.abs(structure.contractValue - 645283.02) < 0.02,
  "structure contract = 540k × 1.9M/1.59M, cents-exact",
);

// A $0-cost line never gets a fabricated contract (can't divide margin onto it).
const withZero = aggregateEstimateToBudget(
  [
    ...estLines,
    {
      cost_code: "9999",
      csi_division: "99",
      scope_group: "Placeholder",
      description: "Zero",
      total_extended_cents: 0,
    },
  ],
  { contractTotalCents },
);
const zeroLine = withZero.find((line) => line.costCode === "9999");
assert.equal(zeroLine?.contractValue, undefined, "a $0-cost line stays unpriced under auto");
assert.equal(
  withZero.reduce((sum, line) => sum + (line.contractValue ?? 0), 0),
  1900000,
  "totals still reconcile with a zero-cost line present",
);

console.log("budget-vs-contract smoke: all assertions passed");
