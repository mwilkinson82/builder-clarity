// Daily WIP math smoke (Workspace B, BILLINGDESIGN P2). Node-runnable via
// `node --experimental-strip-types`. Proves the work-in-place derivation is
// cents-exact and that labor is always crew × hours × rate.
import assert from "node:assert/strict";
import {
  commitmentBySubBucket,
  costItemsForEdit,
  dailyWipTotals,
  dailyWipWorkInPlaceTotal,
  laborCost,
  laborHours,
  productionRate,
  rowWorkInPlace,
  subCommitmentKey,
  subEarnedValue,
  sumLineItems,
} from "../src/lib/daily-wip.ts";

const row = (over: Partial<Parameters<typeof rowWorkInPlace>[0]> = {}) => ({
  crew_count: 0,
  hours: 0,
  labor_rate: 0,
  material_cost: 0,
  equipment_cost: 0,
  quantity: 0,
  ...over,
});

// Labor is crew × hours × rate.
assert.equal(
  laborCost(row({ crew_count: 4, hours: 8, labor_rate: 42.5 })),
  1360,
  "4×8×42.5 = 1360",
);
assert.equal(laborHours(row({ crew_count: 4, hours: 8 })), 32, "crew×hours labor-hours");

// Fractional cents round cleanly (crew 3 × 7.5h × $41.33 = $929.925 → $929.93).
assert.equal(
  laborCost(row({ crew_count: 3, hours: 7.5, labor_rate: 41.33 })),
  929.93,
  "labor rounds to the cent",
);

// Row work-in-place = labor + materials + equipment.
assert.equal(
  rowWorkInPlace(
    row({ crew_count: 2, hours: 8, labor_rate: 50, material_cost: 250, equipment_cost: 120 }),
  ),
  1170,
  "800 labor + 250 material + 120 equipment = 1170",
);

// A day rolls up cents-safe across activities.
const day = [
  row({ crew_count: 4, hours: 8, labor_rate: 42.5, material_cost: 1200, equipment_cost: 300 }),
  row({ crew_count: 2, hours: 6, labor_rate: 55.25, material_cost: 0, equipment_cost: 0 }),
  row({ material_cost: 875.5 }),
];
const totals = dailyWipTotals(day);
assert.equal(totals.labor, 1360 + 663, "labor = 1360 + (2×6×55.25=663)");
assert.equal(totals.material, 1200 + 875.5, "materials summed");
assert.equal(totals.equipment, 300, "equipment summed");
assert.equal(totals.total, totals.labor + totals.material + totals.equipment, "total = parts");
assert.equal(totals.laborHours, 32 + 12, "labor-hours summed");
assert.equal(totals.rowCount, 3, "row count");

// Empty day is a clean zero, not NaN.
const empty = dailyWipTotals([]);
assert.equal(empty.total, 0, "empty day totals to 0");
assert.equal(empty.rowCount, 0, "empty day has no rows");

// Production rate = quantity ÷ labor-hours, null without both.
assert.equal(
  productionRate(row({ crew_count: 2, hours: 8, quantity: 320 })),
  20,
  "320 / 16h = 20/hr",
);
assert.equal(
  productionRate(row({ crew_count: 2, hours: 8, quantity: 0 })),
  null,
  "no quantity → null",
);
assert.equal(productionRate(row({ quantity: 100 })), null, "no hours → null");

// Bad inputs coerce to 0, never NaN.
assert.equal(
  rowWorkInPlace(row({ crew_count: Number.NaN, hours: 8, labor_rate: 50, material_cost: 10 })),
  10,
  "NaN crew → labor 0, still counts materials",
);

// Opening a line for editing must never silently drop an already-recorded cost.
// A lump material/equipment cost with no line items is surfaced as one editable
// line so that save (which recomputes cost from the items) preserves it.
assert.deepEqual(
  costItemsForEdit([], 900),
  [{ description: "", amount: 900 }],
  "lump with no items → one editable line",
);
assert.equal(
  sumLineItems(costItemsForEdit([], 900)),
  900,
  "lump round-trips through save (no wipe)",
);
assert.deepEqual(costItemsForEdit([], 0), [], "no items and no lump → empty");
assert.deepEqual(
  costItemsForEdit([{ description: "rebar #5", amount: 500 }], 999),
  [{ description: "rebar #5", amount: 500 }],
  "existing line items are kept as-is (lump ignored)",
);

// ── Subcontractor earned value (Darian, Ryder 2026-07-08): a bought-out sub
//    line is valued by commitment × % complete, NOT crew × hours. His exact
//    case: Herrera Carpentry bought out at $146,200 on Dock Pit, super logs 20%
//    complete → work in place must read $29,240, not $0. ──
{
  // The earned-value primitive.
  assert.equal(subEarnedValue(146_200, 20), 29_240, "146,200 × 20% = 29,240 (Darian's number)");
  assert.equal(subEarnedValue(146_200, 0), 0, "0% earns nothing");
  assert.equal(subEarnedValue(146_200, 100), 146_200, "100% earns the whole commitment");
  assert.equal(subEarnedValue(146_200, 150), 146_200, "% clamps at 100");
  assert.equal(subEarnedValue(0, 20), 0, "no commitment → no earned value");
  // Fractional % rounds to the cent (100,000 × 33.33% = 33,330).
  assert.equal(subEarnedValue(100_000, 33.33), 33_330, "fractional % rounds to the cent");

  // rowWorkInPlace switches on the sub tag + a known commitment.
  const subRow = {
    crew_count: 0,
    hours: 0,
    labor_rate: 0,
    material_cost: 0,
    equipment_cost: 0,
    quantity: 0,
    subcontractor_id: "herrera",
    cost_bucket_id: "dock-pit",
    percent_complete: 20,
  };
  assert.equal(
    rowWorkInPlace(subRow, 146_200),
    29_240,
    "sub line values as commitment × % — the $0 bug is gone",
  );
  // The exact bug Darian hit: $29,240 typed into the rate field with no hours
  // used to yield $0. Even with that noise, the sub line earns off %, not rate.
  assert.equal(
    rowWorkInPlace({ ...subRow, labor_rate: 29_240 }, 146_200),
    29_240,
    "sub line ignores crew×hours×rate — earns off % complete",
  );
  // No commitment resolved (sub not bought out / no allocation on this code) →
  // falls back to the self-perform formula, never crashes.
  assert.equal(
    rowWorkInPlace(subRow, null),
    0,
    "sub line with no commitment falls back to self-perform (0 here)",
  );
  // A self-perform line is untouched by the new signature.
  assert.equal(
    rowWorkInPlace(row({ crew_count: 2, hours: 8, labor_rate: 50 })),
    800,
    "self-perform line still crew × hours × rate",
  );
}

// ── commitmentBySubBucket: maps executed buyouts to (company, cost code) →
//    committed dollars, so a WIP line resolves its commitment. Draft buyouts
//    commit nothing; a sub can span multiple codes. ──
{
  const subcontracts = [
    { id: "sc1", subcontractor_id: "herrera", status: "executed" },
    { id: "sc2", subcontractor_id: "acme", status: "draft" },
  ];
  const allocations = [
    { subcontract_id: "sc1", cost_bucket_id: "dock-pit", amount: 146_200 },
    { subcontract_id: "sc1", cost_bucket_id: "slab", amount: 40_000 },
    { subcontract_id: "sc2", cost_bucket_id: "dock-pit", amount: 99_000 }, // draft — ignored
  ];
  const map = commitmentBySubBucket(subcontracts, allocations);
  assert.equal(map.get(subCommitmentKey("herrera", "dock-pit")!), 146_200, "executed buyout maps");
  assert.equal(map.get(subCommitmentKey("herrera", "slab")!), 40_000, "second code on same sub");
  assert.equal(map.get(subCommitmentKey("acme", "dock-pit")!), undefined, "draft buyout excluded");
  assert.equal(subCommitmentKey(null, "dock-pit"), null, "no company → no key");
  assert.equal(subCommitmentKey("herrera", null), null, "uncoded line → no key");

  // dailyWipWorkInPlaceTotal blends a sub line (commitment × %) with a
  // self-perform line (labor + materials) via the lookup.
  const commitmentFor = (r: {
    subcontractor_id?: string | null;
    cost_bucket_id?: string | null;
  }) => {
    const key = subCommitmentKey(r.subcontractor_id, r.cost_bucket_id);
    return key ? (map.get(key) ?? null) : null;
  };
  const rows = [
    {
      crew_count: 0,
      hours: 0,
      labor_rate: 0,
      material_cost: 0,
      equipment_cost: 0,
      quantity: 0,
      subcontractor_id: "herrera",
      cost_bucket_id: "dock-pit",
      percent_complete: 20,
    },
    row({ crew_count: 2, hours: 8, labor_rate: 50, material_cost: 100 }), // 800 + 100
  ];
  assert.equal(
    dailyWipWorkInPlaceTotal(rows, commitmentFor),
    29_240 + 900,
    "day total blends sub earned value with self-perform work in place",
  );
}

console.log("daily WIP smoke: all assertions passed");
