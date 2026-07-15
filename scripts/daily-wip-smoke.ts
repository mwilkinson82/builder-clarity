// Daily WIP math smoke (Workspace B, BILLINGDESIGN P2). Node-runnable via
// `node --experimental-strip-types`. Proves the work-in-place derivation is
// cents-exact and that labor uses the field-recorded people per crew.
import assert from "node:assert/strict";
import {
  applySelfPerformToBuckets,
  commitmentBySubBucket,
  costItemsForEdit,
  dailyWipTotals,
  dailyWipWorkInPlaceTotal,
  isPercentOverridden,
  laborCost,
  laborHours,
  PEOPLE_PER_CREW,
  priorSubPercent,
  progressChronologyWarning,
  productionPace,
  productionRate,
  resolvePercentReview,
  rowWorkInPlace,
  selfPerformCostByBucket,
  subCommitmentKey,
  subEarnedIncrement,
  subEarnedValue,
  sumLineItems,
  dayProfitSummary,
  lineProfitToday,
  priorCodePercent,
} from "../src/lib/daily-wip.ts";
import { subcontractProductionBenchmarks } from "../src/lib/subcontract-production.ts";
import {
  aggregateProductionSeries,
  canonicalProductionUnit,
  inclusiveDateSpan,
  productionScopeKey,
  shiftIsoDate,
  summarizeProduction,
  summarizeProductionBenchmarks,
  summarizeProductionProjects,
  summarizeProductionScopes,
  type PortfolioProductionAnalyticsRow,
  type ProductionAnalyticsRow,
} from "../src/lib/production-analytics.ts";

const row = (over: Partial<Parameters<typeof rowWorkInPlace>[0]> = {}) => ({
  crew_count: 0,
  hours: 0,
  labor_rate: 0,
  material_cost: 0,
  equipment_cost: 0,
  quantity: 0,
  ...over,
});

// ── SUBCONTRACT PRODUCTION HISTORY (Contractor School, 2026-07-14) ────────
//    The GC can learn its purchased $/unit and the sub's observed field pace
//    without pretending to know the sub's internal labor cost.
{
  const buckets = [
    {
      id: "drywall",
      cost_code: "09-2900",
      bucket: "Drywall install",
      contract_quantity: 24_000,
      unit: "SF",
    },
    {
      id: "flooring",
      cost_code: "09-6500",
      bucket: "LVT flooring install",
      contract_quantity: 10_000,
      unit: "SF",
    },
  ];
  const entries = [
    {
      id: "d1",
      subcontractor_id: "atlas",
      cost_bucket_id: "drywall",
      entry_date: "2026-07-12",
      updated_at: "2026-07-12T17:00:00Z",
      crew_count: 1,
      people_per_crew: 4,
      hours: 8,
      labor_rate: 0,
      material_cost: 0,
      equipment_cost: 0,
      quantity: 1_000,
      unit: "SF",
      percent_complete: 4,
      target_production_rate: 30,
    },
    {
      id: "d2",
      subcontractor_id: "atlas",
      cost_bucket_id: "drywall",
      entry_date: "2026-07-13",
      updated_at: "2026-07-13T17:00:00Z",
      crew_count: 2,
      people_per_crew: 4,
      hours: 8,
      labor_rate: 0,
      material_cost: 0,
      equipment_cost: 0,
      quantity: 2_100,
      unit: "SF",
      percent_complete: 13,
      target_production_rate: 30,
    },
    {
      id: "d3",
      subcontractor_id: "atlas",
      cost_bucket_id: "drywall",
      entry_date: "2026-07-14",
      updated_at: "2026-07-14T17:00:00Z",
      crew_count: 2,
      people_per_crew: 4,
      hours: 8,
      labor_rate: 0,
      material_cost: 0,
      equipment_cost: 0,
      quantity: 2_100,
      unit: "SF",
      percent_complete: 22,
      target_production_rate: 30,
    },
    {
      id: "f1",
      subcontractor_id: "summit",
      cost_bucket_id: "flooring",
      entry_date: "2026-07-12",
      updated_at: "2026-07-12T17:00:00Z",
      crew_count: 1,
      people_per_crew: 3,
      hours: 8,
      labor_rate: 0,
      material_cost: 0,
      equipment_cost: 0,
      quantity: 420,
      unit: "SF",
      percent_complete: 4,
      target_production_rate: 18,
    },
    {
      id: "f2",
      subcontractor_id: "summit",
      cost_bucket_id: "flooring",
      entry_date: "2026-07-13",
      updated_at: "2026-07-13T17:00:00Z",
      crew_count: 1,
      people_per_crew: 3,
      hours: 8,
      labor_rate: 0,
      material_cost: 0,
      equipment_cost: 0,
      quantity: 500,
      unit: "SF",
      percent_complete: 9,
      target_production_rate: 18,
    },
    {
      id: "f3",
      subcontractor_id: "summit",
      cost_bucket_id: "flooring",
      entry_date: "2026-07-14",
      updated_at: "2026-07-14T17:00:00Z",
      crew_count: 1,
      people_per_crew: 3,
      hours: 8,
      labor_rate: 0,
      material_cost: 0,
      equipment_cost: 0,
      quantity: 250,
      unit: "SF",
      percent_complete: 13,
      target_production_rate: 18,
    },
  ];
  const commitments = new Map([
    [subCommitmentKey("atlas", "drywall")!, 120_000],
    [subCommitmentKey("summit", "flooring")!, 90_000],
  ]);
  const settings = new Map([
    [
      subCommitmentKey("atlas", "drywall")!,
      { plannedQuantity: 24_000, unit: "SF", benchmarkLaborRate: 110 },
    ],
    [
      subCommitmentKey("summit", "flooring")!,
      { plannedQuantity: 10_000, unit: "SF", benchmarkLaborRate: 162 },
    ],
  ]);
  const result = subcontractProductionBenchmarks(entries, buckets, commitments, settings);
  const drywall = result.find((benchmark) => benchmark.subcontractorId === "atlas")!;
  const flooring = result.find((benchmark) => benchmark.subcontractorId === "summit")!;

  assert.equal(drywall.buyoutUnitCost, 5, "drywall buyout = $120k / 24k SF = $5/SF");
  assert.equal(drywall.installedQuantity, 5_200, "drywall aggregates daily installed quantity");
  assert.equal(drywall.laborHours, 160, "drywall uses each day's recorded crew size");
  assert.equal(drywall.actualRate, 32.5, "drywall field pace = 5,200 / 160 = 32.5 SF/hr");
  assert.equal(drywall.targetRate, 22, "$110/hr over a $5/SF buyout derives 22 SF/hr");
  assert.equal(
    drywall.laborEquivalentHours,
    120_000 / 110,
    "buyout derives labor-equivalent hours",
  );
  assert.equal(drywall.paceStatus, "ahead", "32.5 is ahead of the derived 22 SF/hr target");
  assert.equal(
    Number(drywall.benchmarkLaborCostPerActualUnit?.toFixed(2)),
    3.38,
    "$110 / 32.5 actual SF/hr = $3.38/SF benchmark labor cost",
  );
  assert.equal(drywall.allInCarryPerObservedHour, 162.5, "$5/SF × 32.5 SF/hr = $162.50/hr carry");
  assert.equal(drywall.earnedSubcontractCost, 26_400, "22% of $120k = $26.4k earned cost");
  assert.equal(
    Number(drywall.earnedCostPerLoggedUnit?.toFixed(2)),
    5.08,
    "field $/logged unit exposes buyout/progress/quantity alignment",
  );
  assert.equal(drywall.alignmentStatus, "aligned", "5,200 SF aligns with 22% of 24,000 SF");

  assert.equal(flooring.buyoutUnitCost, 9, "flooring buyout = $90k / 10k SF = $9/SF");
  assert.equal(flooring.actualRate, 16.25, "flooring field pace = 1,170 / 72 = 16.25 SF/hr");
  assert.equal(flooring.paceStatus, "behind", "16.25 trails the 18 SF/hr target");
  assert.equal(flooring.earnedCostPerLoggedUnit, 10, "13% earned over 1,170 SF = $10/SF");
  assert.equal(
    flooring.alignmentStatus,
    "below-progress",
    "1,170 logged SF is materially below the 1,300 SF implied by certified progress",
  );

  const sharedLine = subcontractProductionBenchmarks(
    [entries[0], { ...entries[0], id: "d4", subcontractor_id: "other-drywall" }],
    buckets,
    new Map([
      [subCommitmentKey("atlas", "drywall")!, 120_000],
      [subCommitmentKey("other-drywall", "drywall")!, 20_000],
    ]),
  );
  assert.equal(
    sharedLine.every((benchmark) => benchmark.buyoutUnitCost == null),
    true,
    "a shared SOV quantity is never attributed to multiple subs as if each owned all units",
  );
}

// Backfilled cumulative progress is checked against both chronological neighbors.
{
  const history = [
    {
      id: "old",
      subcontractor_id: "atlas",
      cost_bucket_id: "drywall",
      entry_date: "2026-07-12",
      percent_complete: 22,
    },
    {
      id: "new",
      subcontractor_id: "atlas",
      cost_bucket_id: "drywall",
      entry_date: "2026-07-14",
      percent_complete: 4,
    },
  ];
  assert.equal(
    progressChronologyWarning(
      {
        id: "middle",
        subcontractor_id: "atlas",
        cost_bucket_id: "drywall",
        entry_date: "2026-07-13",
        percent_complete: 13,
      },
      history,
    )?.kind,
    "decrease-from-prior",
    "22% on the older report warns before a later 13% creates a negative correction",
  );
  assert.equal(
    progressChronologyWarning(
      {
        id: "backfill",
        subcontractor_id: "atlas",
        cost_bucket_id: "drywall",
        entry_date: "2026-07-13",
        percent_complete: 13,
      },
      [history[1]],
    )?.kind,
    "higher-than-next",
    "a backfill above an already-saved later percentage warns too",
  );
  assert.equal(
    progressChronologyWarning(
      {
        id: "different-sub",
        subcontractor_id: "another-sub",
        cost_bucket_id: "drywall",
        entry_date: "2026-07-13",
        percent_complete: 80,
      },
      history,
    ),
    null,
    "two subcontractors sharing a cost code keep independent cumulative progress",
  );
}

// Legacy rows still use the historical two-person default.
assert.equal(PEOPLE_PER_CREW, 2, "legacy field crews default to two people");
assert.equal(
  laborCost(row({ crew_count: 4, hours: 8, labor_rate: 42.5 })),
  2720,
  "4 crews × 2 people × 8h × $42.50 = $2,720",
);
assert.equal(
  laborHours(row({ crew_count: 4, hours: 8 })),
  64,
  "4 crews × 2 people × 8h = 64 labor-hours",
);
assert.equal(
  laborCost(row({ crew_count: 3, people_per_crew: 4, hours: 8, labor_rate: 42.5 })),
  4080,
  "3 crews × 4 people × 8h × $42.50 = $4,080",
);
assert.equal(
  laborHours(row({ crew_count: 3, people_per_crew: 4, hours: 8 })),
  96,
  "3 crews × 4 people × 8h = 96 labor-hours",
);

// Fractional inputs remain cents-safe.
assert.equal(
  laborCost(row({ crew_count: 3, hours: 7.5, labor_rate: 41.33 })),
  1859.85,
  "labor rounds to the cent",
);

// Row work-in-place = labor + materials + equipment.
assert.equal(
  rowWorkInPlace(
    row({ crew_count: 2, hours: 8, labor_rate: 50, material_cost: 250, equipment_cost: 120 }),
  ),
  1970,
  "1,600 labor + 250 material + 120 equipment = 1,970",
);

// A day rolls up cents-safe across activities.
const day = [
  row({ crew_count: 4, hours: 8, labor_rate: 42.5, material_cost: 1200, equipment_cost: 300 }),
  row({ crew_count: 2, hours: 6, labor_rate: 55.25, material_cost: 0, equipment_cost: 0 }),
  row({ material_cost: 875.5 }),
];
const totals = dailyWipTotals(day);
assert.equal(totals.labor, 2720 + 1326, "labor includes two people per crew");
assert.equal(totals.material, 1200 + 875.5, "materials summed");
assert.equal(totals.equipment, 300, "equipment summed");
assert.equal(totals.total, totals.labor + totals.material + totals.equipment, "total = parts");
assert.equal(totals.laborHours, 64 + 24, "two-person crew labor-hours summed");
assert.equal(totals.rowCount, 3, "row count");

// Empty day is a clean zero, not NaN.
const empty = dailyWipTotals([]);
assert.equal(empty.total, 0, "empty day totals to 0");
assert.equal(empty.rowCount, 0, "empty day has no rows");

// Production rate = quantity ÷ labor-hours, null without both.
assert.equal(
  productionRate(row({ crew_count: 2, hours: 8, quantity: 320 })),
  10,
  "320 / 32 labor-hours = 10/hr",
);
assert.equal(
  productionRate(row({ crew_count: 2, hours: 8, quantity: 0 })),
  null,
  "no quantity → null",
);
assert.equal(productionRate(row({ quantity: 100 })), null, "no hours → null");

// Target comparisons only form a verdict when actual and target both exist.
assert.equal(
  productionPace(
    row({
      crew_count: 2,
      people_per_crew: 2,
      hours: 8,
      quantity: 352,
      target_production_rate: 10,
    }),
  )?.status,
  "ahead",
  "10% over target is ahead",
);
assert.equal(
  productionPace(row({ crew_count: 2, hours: 8, quantity: 320, target_production_rate: 10 }))
    ?.status,
  "on-pace",
  "actual equal to target is on pace",
);
assert.equal(
  productionPace(row({ crew_count: 2, hours: 8, quantity: 256, target_production_rate: 10 }))
    ?.status,
  "behind",
  "20% under target is behind",
);
assert.equal(
  productionPace(row({ crew_count: 2, hours: 8, quantity: 320 })),
  null,
  "no target means no fabricated pace verdict",
);

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
    1600,
    "self-perform line uses crews × 2 people × hours × rate",
  );
}

// ── EARNED-VALUE INCREMENT (Darian, 2026-07-09): the field %-complete is
//    CUMULATIVE, logged fresh each day. Herrera on Dock Pit ($142,600 buyout) was
//    at 20% Monday; Tuesday he's at 30%. Tuesday's log put 10% in place ($14,260),
//    NOT 30% again ($42,780). "it should just be another 10." ──
{
  // Cumulative → incremental: the dollars ADDED by moving 20% → 30%.
  assert.equal(
    subEarnedValue(142_600, 20),
    28_520,
    "20% of $142,600 = $28,520 (Monday, cumulative)",
  );
  assert.equal(
    subEarnedValue(142_600, 30),
    42_780,
    "30% of $142,600 = $42,780 (Tuesday, cumulative)",
  );
  assert.equal(
    subEarnedIncrement(142_600, 20, 30),
    14_260,
    "20% → 30% earns another $14,260, not $42,780 (Darian's 'another 10')",
  );
  assert.equal(
    subEarnedIncrement(142_600, 0, 20),
    28_520,
    "first log (0 → 20%) earns the full 20%",
  );
  assert.equal(
    subEarnedIncrement(142_600, 30, 20),
    -14_260,
    "a downward correction is a negative increment",
  );

  // rowWorkInPlace with a prior % values the day's increment.
  const tuesday = {
    crew_count: 0,
    hours: 0,
    labor_rate: 0,
    material_cost: 0,
    equipment_cost: 0,
    quantity: 0,
    subcontractor_id: "herrera",
    cost_bucket_id: "dock-pit",
    percent_complete: 30,
  };
  assert.equal(
    rowWorkInPlace(tuesday, 142_600, 20),
    14_260,
    "Tuesday's entry earns the 10% increment",
  );
  assert.equal(
    rowWorkInPlace(tuesday, 142_600),
    42_780,
    "no prior % (default 0) → full cumulative, unchanged",
  );

  // priorSubPercent finds the cumulative % as of the entry before each one.
  const entries = [
    {
      id: "mon",
      subcontractor_id: "herrera",
      cost_bucket_id: "dock-pit",
      percent_complete: 20,
      entry_date: "2026-07-07",
      updated_at: "2026-07-07T18:00:00Z",
    },
    {
      id: "tue",
      subcontractor_id: "herrera",
      cost_bucket_id: "dock-pit",
      percent_complete: 30,
      entry_date: "2026-07-08",
      updated_at: "2026-07-08T18:00:00Z",
    },
  ];
  assert.equal(priorSubPercent(entries[0], entries), 0, "Monday is the first log — no prior");
  assert.equal(priorSubPercent(entries[1], entries), 20, "Tuesday's prior is Monday's 20%");
  // Different cost code / company shares no history.
  assert.equal(
    priorSubPercent({ ...entries[1], cost_bucket_id: "slab" }, entries),
    0,
    "a different cost code carries no prior %",
  );

  // Summing the daily increments telescopes to the latest cumulative earned —
  // the whole point: two days never re-earn the same work.
  const commitmentFor = () => 142_600;
  const priorFor = (r: (typeof entries)[number]) => priorSubPercent(r, entries);
  const monTotal = dailyWipWorkInPlaceTotal([entries[0]], commitmentFor, priorFor);
  const tueTotal = dailyWipWorkInPlaceTotal([entries[1]], commitmentFor, priorFor);
  assert.equal(monTotal, 28_520, "Monday's work in place = 20% increment");
  assert.equal(tueTotal, 14_260, "Tuesday's work in place = 10% increment");
  assert.equal(
    monTotal + tueTotal,
    42_780,
    "increments telescope to 30% cumulative — no double-count",
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
    row({ crew_count: 2, hours: 8, labor_rate: 50, material_cost: 100 }), // 1,600 + 100
  ];
  assert.equal(
    dailyWipWorkInPlaceTotal(rows, commitmentFor),
    29_240 + 1700,
    "day total blends sub earned value with self-perform work in place",
  );
}

// ── Super-% vs PM-% review (Slice B): the super logs a field %, the PM reviews
//    it in the WIP and may adjust it; the field number is kept and any change is
//    tracked. resolvePercentReview is the pure engine for that. ──
{
  const NOW = "2026-07-09T12:00:00.000Z";

  // Super logs 30% on a fresh line: field and reviewed track together, no override.
  const superNew = resolvePercentReview("field", 30, null, NOW);
  assert.deepEqual(
    superNew,
    { field_percent_complete: 30, percent_complete: 30, percent_overridden_at: null },
    "super's field log sets both numbers in lockstep, no override",
  );
  assert.equal(isPercentOverridden(superNew), false, "in-lockstep line is not flagged");

  // PM reviews that line down to 25% (SOV can't bill 30%): field kept, reviewed
  // changes, override stamped.
  const pmCap = resolvePercentReview("costing", 25, superNew, NOW);
  assert.deepEqual(
    pmCap,
    { field_percent_complete: 30, percent_complete: 25, percent_overridden_at: NOW },
    "PM cap keeps the field number, moves the reviewed value, stamps the override",
  );
  assert.equal(isPercentOverridden(pmCap), true, "a PM cap is flagged as adjusted");

  // Super later re-logs the field to 40%: the field number moves, but the PM's
  // reviewed 25% is preserved (their billing decision stands).
  const superAgain = resolvePercentReview("field", 40, pmCap, NOW);
  assert.deepEqual(
    superAgain,
    { field_percent_complete: 40, percent_complete: 25, percent_overridden_at: NOW },
    "a later field update moves the field but preserves the PM override",
  );

  // PM re-aligns to the field number: the override clears.
  const realigned = resolvePercentReview("costing", 40, superAgain, NOW);
  assert.equal(realigned.percent_overridden_at, null, "matching the field clears the override");
  assert.equal(isPercentOverridden(realigned), false, "re-aligned line is no longer flagged");

  // A PM creating a line from scratch (no field number yet) is not an override.
  const pmFresh = resolvePercentReview("costing", 50, null, NOW);
  assert.deepEqual(
    pmFresh,
    { field_percent_complete: 50, percent_complete: 50, percent_overridden_at: null },
    "PM-created line seeds both numbers, no override",
  );

  // Percent clamps 0..100 in the engine.
  assert.equal(resolvePercentReview("field", 150, null, NOW).field_percent_complete, 100, "clamps");

  // isPercentOverridden also catches a bare value mismatch (defensive — e.g. a
  // legacy row with no stamp).
  assert.equal(
    isPercentOverridden({ field_percent_complete: 30, percent_complete: 20 }),
    true,
    "value mismatch alone counts as overridden",
  );
}

// ── SELF-PERFORM ROLL-UP (Darian, 2026-07-09): self-perform daily WIP is real
//    actual cost and must reflect on the budget + dashboard. "this didn't reflect
//    on the budget??" — the logged line never reached actuals. It ADDS to actual and DISPLACES the
//    forecast, so projected cost holds until it exceeds the remaining forecast. ──
{
  const selfRow = (over: Record<string, unknown> = {}) => ({
    crew_count: 0,
    hours: 0,
    labor_rate: 0,
    material_cost: 0,
    equipment_cost: 0,
    quantity: 0,
    subcontractor_id: null,
    cost_bucket_id: "saw-cutting",
    percent_complete: 0,
    ...over,
  });
  const commitmentFor = (r: { subcontractor_id?: string | null; cost_bucket_id?: string | null }) =>
    // Only the bought-out sub line resolves a commitment.
    r.subcontractor_id === "herrera" && r.cost_bucket_id === "dock-pit" ? 142_600 : null;

  const rows = [
    // Five crews = ten people: 10 × 8 × 33 = 2,640 labor + 400 materials.
    selfRow({ crew_count: 5, hours: 8, labor_rate: 33, material_cost: 400 }),
    // Another self-perform day on the same code, materials only.
    selfRow({ material_cost: 250 }),
    // A DIFFERENT self-perform code.
    selfRow({ cost_bucket_id: "slab", crew_count: 2, hours: 8, labor_rate: 50 }), // 1,600
    // A bought-out sub line — excluded (the sub layer owns it), never in self-perform.
    selfRow({ subcontractor_id: "herrera", cost_bucket_id: "dock-pit", percent_complete: 30 }),
  ];
  const byBucket = selfPerformCostByBucket(rows, commitmentFor);
  assert.equal(
    byBucket.get("saw-cutting"),
    3_290,
    "self-perform sums per code (2,640 + 400 + 250)",
  );
  assert.equal(byBucket.get("slab"), 1600, "second self-perform code totals its own work");
  assert.equal(
    byBucket.get("dock-pit"),
    undefined,
    "bought-out sub line excluded from self-perform",
  );

  // Fold displaces forecast: actual += WIP, ftc floored at 0, projected steady.
  const buckets = [
    { id: "saw-cutting", actual_to_date: 4_300, ftc: 11_801 },
    { id: "slab", actual_to_date: 0, ftc: 500 }, // WIP 1,600 > ftc 500 → overrun
    { id: "untouched", actual_to_date: 1_000, ftc: 2_000 },
  ];
  const folded = applySelfPerformToBuckets(buckets, byBucket);
  const saw = folded.find((b) => b.id === "saw-cutting")!;
  assert.equal(saw.actual_to_date, 7_590, "actual = 4,300 + 3,290 WIP");
  assert.equal(saw.ftc, 8_511, "forecast displaced: 11,801 − 3,290");
  assert.equal(
    saw.actual_to_date + saw.ftc,
    4_300 + 11_801,
    "projected cost unchanged (within forecast)",
  );
  const slab = folded.find((b) => b.id === "slab")!;
  assert.equal(slab.actual_to_date, 1600, "overrun: actual = 0 + 1,600");
  assert.equal(slab.ftc, 0, "forecast floored at 0, not negative");
  assert.equal(
    slab.actual_to_date + slab.ftc,
    1600,
    "projected grows past budget on a real overrun",
  );
  const untouched = folded.find((b) => b.id === "untouched")!;
  assert.equal(untouched.actual_to_date, 1_000, "a code with no WIP is unchanged");
  assert.equal(untouched.ftc, 2_000, "…and its forecast holds");
  // The originals are never mutated (the drawer still edits raw actual_to_date).
  assert.equal(buckets[0].actual_to_date, 4_300, "fold returns new objects — raw bucket untouched");
}

// ── Daily P&L (field request 2026-07-09): made/lost today per line ──────────
{
  // The earned baseline is per CODE, whoever performed the work: a line's sub
  // tag flipping (the super's form has no sub picker; the PM tags later) must
  // never re-earn the whole cumulative % as fresh profit.
  const history = [
    {
      id: "e1",
      subcontractor_id: "acme",
      cost_bucket_id: "b1",
      percent_complete: 50,
      entry_date: "2026-07-08",
      updated_at: "1",
    },
  ];
  assert.equal(
    priorCodePercent(
      {
        id: "e9",
        subcontractor_id: null,
        cost_bucket_id: "b1",
        percent_complete: 60,
        entry_date: "2026-07-09",
        updated_at: "9",
      },
      history,
    ),
    50,
    "an untagged line inherits the code's baseline — a tag flip never re-earns",
  );
  // A 0% entry is the form default ("% not logged") — it never sets a baseline.
  assert.equal(
    priorCodePercent(
      {
        id: "e9",
        subcontractor_id: null,
        cost_bucket_id: "b1",
        percent_complete: 60,
        entry_date: "2026-07-09",
        updated_at: "9",
      },
      [
        {
          id: "e0",
          subcontractor_id: null,
          cost_bucket_id: "b1",
          percent_complete: 0,
          entry_date: "2026-07-08",
          updated_at: "1",
        },
      ],
    ),
    0,
    "a 0% entry (the form default) never becomes the code's baseline",
  );

  // Earned = contract value × the day's % movement; profit = earned − cost.
  // 60,142 × 2.5% = 1,503.55 against 1,320 of cost → +183.55 on the day.
  const line = lineProfitToday(60_142, 42.5, 45, 1_320);
  assert.equal(line.earnedToday, 1_503.55, "earned prices the day's % movement at contract value");
  assert.equal(line.profitToday, 183.55, "profit is earned minus the day's cost");
  assert.equal(line.reason, null, "a measured line carries no excuse");

  // Honesty rails — the review found each of these fabricating money:
  // 1. A 0% entry after real progress is "not logged", NEVER a walk-back loss.
  const blankAfterProgress = lineProfitToday(100_000, 30, 0, 800);
  assert.equal(blankAfterProgress.reason, "no-progress", "0%% after 30%% = not logged, not −$30k");
  assert.equal(blankAfterProgress.profitToday, null, "…and no loss is fabricated");
  // 2. %-movement with $0 cost never claims the earned value as pure profit.
  const unpricedCost = lineProfitToday(100_000, 30, 40, 0);
  assert.equal(unpricedCost.reason, "uncosted", "earned with $0 cost = costs not priced yet");
  assert.equal(unpricedCost.profitToday, null, "…no fabricated pure profit");
  // 3. Unpriced / uncoded lines say so.
  assert.equal(lineProfitToday(0, 0, 25, 500).reason, "unpriced", "a $0-contract code says so");
  assert.equal(lineProfitToday(null, 0, 25, 500).reason, "no-code", "an uncoded line says so");
  // 4. No % movement on a priced, costed line = not measured.
  assert.equal(lineProfitToday(60_142, 10, 10, 500).reason, "no-progress", "no movement");

  // A downward correction to a REAL % (> 0) earns negative, honestly.
  const corrected = lineProfitToday(10_000, 30, 20, 100);
  assert.equal(corrected.earnedToday, -1_000, "a % walk-back to a real % earns negative");

  // The day rolls up measured lines; unmeasured cost is reported separately,
  // never silently folded into a fake loss.
  const day = dayProfitSummary([
    lineProfitToday(60_142, 42.5, 45, 1_320),
    lineProfitToday(126_582, 40, 42.5, 3_565),
    lineProfitToday(null, 0, 0, 792),
  ]);
  assert.equal(day.measuredCount, 2, "two lines measured");
  assert.equal(day.unmeasuredCount, 1, "one line couldn't be measured");
  assert.equal(day.unmeasuredCost, 792, "…and its cost is reported, not hidden");
  assert.equal(day.earned, 4_668.1, "earned sums cents-exact");
  assert.equal(day.profit, -216.9, "day profit = earned − measured cost");
}

// ── Production Control analytics (project Phase 1, 2026-07-15) ─────────────
{
  const productionRows: ProductionAnalyticsRow[] = [
    {
      id: "drywall-1",
      date: "2026-07-07",
      performerKey: "sub:atlas",
      performerName: "Atlas Drywall",
      performerType: "subcontractor",
      costBucketId: "drywall",
      costCode: "09-2900",
      scopeName: "Drywall installation",
      activity: "Hang Level 1",
      quantity: 100,
      unit: "sq ft",
      laborHours: 10,
      targetRate: 8,
      fieldValue: 500,
    },
    {
      id: "drywall-2",
      date: "2026-07-08",
      performerKey: "sub:atlas",
      performerName: "Atlas Drywall",
      performerType: "subcontractor",
      costBucketId: "drywall",
      costCode: "09-2900",
      scopeName: "Drywall installation",
      activity: "Hang Level 1",
      quantity: 100,
      unit: "SF",
      laborHours: 20,
      targetRate: 8,
      fieldValue: 500,
    },
    {
      id: "boxes-1",
      date: "2026-07-08",
      performerKey: "self",
      performerName: "Self-perform",
      performerType: "self-perform",
      costBucketId: "electrical",
      costCode: "26-0500",
      scopeName: "Electrical rough-in",
      activity: "Set boxes",
      quantity: 20,
      unit: "each",
      laborHours: 8,
      targetRate: 2,
      fieldValue: 880,
    },
    {
      id: "boxes-unmeasured",
      date: "2026-07-09",
      performerKey: "self",
      performerName: "Self-perform",
      performerType: "self-perform",
      costBucketId: "electrical",
      costCode: "26-0500",
      scopeName: "Electrical rough-in",
      activity: "Layout",
      quantity: 0,
      unit: "EA",
      laborHours: 8,
      targetRate: 2,
      fieldValue: 880,
    },
  ];

  assert.equal(canonicalProductionUnit("square feet"), "SF", "unit aliases normalize");
  assert.equal(canonicalProductionUnit("Each"), "EA", "count units normalize");
  assert.equal(
    productionScopeKey(productionRows[0]),
    productionScopeKey(productionRows[1]),
    "the same performer, cost code, and normalized unit remain one scope",
  );

  const drywall = summarizeProduction(productionRows.slice(0, 2));
  assert.equal(
    drywall.actualRate,
    200 / 30,
    "period rate is quantity ÷ hours, not a mean of rates",
  );
  assert.equal(drywall.targetRate, 8, "the comparable target stays weighted by earned hours");
  assert.equal(drywall.performanceIndex, 25 / 30, "index = earned hours ÷ actual hours");
  assert.equal(drywall.hoursVariance, 5, "positive hours variance is labor-equivalent hours lost");

  const combined = summarizeProduction(productionRows);
  assert.equal(combined.actualRate, null, "mixed units never fabricate a company-wide rate");
  assert.equal(combined.targetRate, null, "mixed units never fabricate a target rate");
  assert.equal(combined.performanceIndex, 35 / 38, "different units combine through earned hours");
  assert.equal(combined.coveragePercent, 38 / 46, "unmeasured hours lower coverage honestly");
  assert.equal(combined.measuredScopeCount, 2, "the combined pulse counts measured scopes");

  const scopes = summarizeProductionScopes(productionRows);
  assert.equal(scopes.length, 2, "performer/cost-code/unit scopes stay separate");
  assert.equal(scopes[0].status, "behind", "the weakest measured scope ranks first");
  assert.equal(scopes[1].unit, "EA", "scope rows retain their normalized unit");

  const daily = aggregateProductionSeries(productionRows, "day");
  assert.equal(daily.length, 3, "daily grain creates one point per field date");
  assert.equal(daily[1].quantity, 120, "same-day mixed work retains total recorded output");
  assert.equal(daily[1].unit, null, "same-day mixed units are never mislabeled as one unit");
  assert.ok(daily[1].trendPerformanceIndex != null, "series exposes the rolling weighted trend");

  const weekly = aggregateProductionSeries(productionRows, "week");
  assert.equal(weekly.length, 1, "Monday-through-Sunday entries group into one week");
  assert.match(weekly[0].label, /^Week of /, "weekly labels explain their period start");

  assert.equal(shiftIsoDate("2026-07-15", -7), "2026-07-08", "date shifting is UTC-stable");
  assert.equal(inclusiveDateSpan("2026-07-01", "2026-07-15"), 15, "date spans are inclusive");
}

// ── Portfolio Production Control analytics (Phase 2, 2026-07-15) ──────────
{
  const projects = [
    { id: "p-behind", name: "Behind project", jobNumber: "101", projectManager: "Morgan" },
    { id: "p-ahead", name: "Ahead project", jobNumber: "102", projectManager: "Alex" },
    { id: "p-empty", name: "No field data", jobNumber: "103", projectManager: "Alex" },
  ];
  const portfolioRows: PortfolioProductionAnalyticsRow[] = [
    {
      id: "behind-1",
      date: "2026-07-14",
      projectId: "p-behind",
      projectName: "Behind project",
      jobNumber: "101",
      projectManager: "Morgan",
      performerKey: "sub:slow",
      performerName: "Slow Sub",
      performerType: "subcontractor",
      costBucketId: "drywall",
      costCode: "09-2900",
      scopeName: "Drywall",
      activity: "Hang board",
      quantity: 50,
      unit: "SF",
      laborHours: 10,
      targetRate: 10,
      fieldValue: 500,
    },
    {
      id: "ahead-1",
      date: "2026-07-15",
      projectId: "p-ahead",
      projectName: "Ahead project",
      jobNumber: "102",
      projectManager: "Alex",
      performerKey: "self-perform",
      performerName: "Self-perform",
      performerType: "self-perform",
      costBucketId: "concrete",
      costCode: "03-3000",
      scopeName: "Concrete",
      activity: "Place slab",
      quantity: 150,
      unit: "CY",
      laborHours: 10,
      targetRate: 10,
      fieldValue: 1_500,
    },
  ];

  const summaries = summarizeProductionProjects(portfolioRows, projects);
  assert.equal(summaries.length, 3, "every active project stays visible in the ranking");
  assert.equal(summaries[0].id, "p-behind", "the weakest comparable project rises first");
  assert.equal(summaries[0].status, "behind", "project status uses target-weighted pace");
  assert.equal(summaries[0].scopesBehind, 1, "behind scopes roll up per project");
  assert.equal(summaries[1].id, "p-ahead", "ahead measured work follows the exception");
  assert.equal(summaries[1].performerCount, 1, "performers are deduplicated inside a project");
  assert.equal(summaries[1].lastFieldDate, "2026-07-15", "latest evidence date is retained");
  assert.equal(summaries[2].id, "p-empty", "projects without field evidence sort last");
  assert.equal(summaries[2].rowCount, 0, "empty projects never fabricate production");

  const company = summarizeProduction(portfolioRows);
  assert.equal(company.actualRate, null, "unlike units never fabricate a portfolio physical rate");
  assert.equal(company.performanceIndex, 1, "earned hours combine safely across project units");
}

// ── Company Production Benchmark Library (Phase 3, 2026-07-15) ──────────
{
  const benchmarkRows: PortfolioProductionAnalyticsRow[] = [
    ["p1-d1", "p1", "Project One", "2026-07-01", 100, 10, 1, 4],
    ["p1-d2", "p1", "Project One", "2026-07-02", 50, 10, 1, 4],
    ["p2-d1", "p2", "Project Two", "2026-07-03", 80, 10, 2, 3],
    ["p2-d2", "p2", "Project Two", "2026-07-04", 60, 10, 2, 3],
    ["p2-d3", "p2", "Project Two", "2026-07-05", 90, 10, 2, 3],
  ].map(([id, projectId, projectName, date, quantity, hours, crews, people]) => ({
    id: String(id),
    date: String(date),
    projectId: String(projectId),
    projectName: String(projectName),
    jobNumber: String(projectId).toUpperCase(),
    projectManager: "Morgan",
    performerKey: "sub:atlas",
    performerName: "Atlas Drywall",
    performerType: "subcontractor" as const,
    costBucketId: `${projectId}-drywall`,
    costCode: "09-2900",
    scopeName: "Drywall installation",
    activity: "Hang board",
    quantity: Number(quantity),
    unit: "square feet",
    laborHours: Number(hours),
    targetRate: 8,
    fieldValue: Number(quantity) * 10,
    crewCount: Number(crews),
    peoplePerCrew: Number(people),
    blendedLaborRate: 110,
  }));
  benchmarkRows.push({
    ...benchmarkRows[0],
    id: "self-drywall",
    performerKey: "self-perform",
    performerName: "Self-perform",
    performerType: "self-perform",
  });

  const benchmarks = summarizeProductionBenchmarks(benchmarkRows);
  assert.equal(benchmarks.length, 2, "self-perform and subcontract evidence never mix");
  const subcontractBenchmark = benchmarks.find(
    (benchmark) => benchmark.performerType === "subcontractor",
  );
  assert.ok(subcontractBenchmark, "subcontract benchmark is retained");
  assert.equal(subcontractBenchmark.projectCount, 2, "benchmark counts contributing projects");
  assert.equal(subcontractBenchmark.fieldDays, 5, "benchmark counts project field days");
  assert.equal(subcontractBenchmark.laborHours, 50, "benchmark retains actual evidence hours");
  assert.equal(subcontractBenchmark.actualRate, 7.6, "observed rate is quantity divided by hours");
  assert.equal(
    subcontractBenchmark.planningRate,
    6,
    "planning rate uses the slower labor-weighted observed quartile",
  );
  assert.equal(subcontractBenchmark.targetRate, 8, "management target remains visible");
  assert.equal(subcontractBenchmark.fieldValuePerUnit, 10, "buyout value per unit is explicit");
  assert.equal(
    subcontractBenchmark.modeledLaborCostPerUnit,
    110 / 6,
    "GC blended rate converts the planning rate into modeled labor cost per unit",
  );
  assert.equal(
    subcontractBenchmark.confidence,
    "building",
    "two projects, five field days, and forty-plus hours build benchmark confidence",
  );
}

console.log("daily WIP smoke: all assertions passed");
