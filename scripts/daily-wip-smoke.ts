// Daily WIP math smoke (Workspace B, BILLINGDESIGN P2). Node-runnable via
// `node --experimental-strip-types`. Proves the work-in-place derivation is
// cents-exact and that labor is always crew × hours × rate.
import assert from "node:assert/strict";
import {
  costItemsForEdit,
  dailyWipTotals,
  laborCost,
  laborHours,
  productionRate,
  rowWorkInPlace,
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

console.log("daily WIP smoke: all assertions passed");
