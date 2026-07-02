#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { utils as xlsxUtils } from "xlsx";
import {
  costLibraryTemplateCsv,
  estimateLineTemplateCsv,
  parseCostLibraryRows,
  parseEstimateLineRows,
} from "../src/lib/estimate-import.ts";
import { analyzeSovIntake, applyMapping, guessColumnMap } from "../src/lib/sov-import.ts";
import { ESTIMATE_REGIONS, ESTIMATE_SEED_LIBRARY_ITEMS } from "../src/lib/estimate-seed-data.ts";
import {
  calculateTakeoffQuantity,
  decimalFeetHint,
  disciplineForSheetNumber,
  extractSheetIdentity,
  formatFeetInches,
  matchSheetNumber,
  normalizeTakeoffUnit,
  parseFeetInches,
  snapLinearPoint,
  statedScaleFeetPerPixel,
  takeoffUnitsCompatible,
} from "../src/lib/plan-room-math.ts";

const parseDelimited = (text, delimiter) =>
  text
    .trim()
    .split(/\r?\n/)
    .map((line) => line.split(delimiter).map((cell) => cell.trim()));

const parseTabPaste = (text) => parseDelimited(text, "\t");

const dollars = (cents) => cents / 100;

const contractorCosts = parseCostLibraryRows(
  parseTabPaste(`CSI Division\tCSI Code\tDescription\tCategory\tUnit\tMaterial $/Unit\tLabor $/Unit
03\t03 30 00\tGarage slab - local ready mix\tconcrete\tSF\t5.75\t3.20
06\t06 10 00\tCustom framing crew rate\tframing\tHR\t0\t82.50
09\t09 91 00\tInterior paint - owner standard\tpaint\tSF\t0.58\t1.35`),
  true,
);

assert.equal(contractorCosts.length, 3);
assert.equal(
  contractorCosts.every((row) => row.valid),
  true,
);
assert.equal(contractorCosts[0].material_cost_cents, 575);
assert.equal(contractorCosts[1].labor_cost_cents, 8250);
assert.deepEqual(
  contractorCosts.map((row) => row.csi_division),
  ["03", "06", "09"],
);

const oneColumnPrice = parseCostLibraryRows(
  parseTabPaste(`CSI\tDescription\tUnit\tUnit Cost
10 14 00\tCustom monument sign\tEA\t1275.50`),
  true,
);
assert.equal(oneColumnPrice.length, 1);
assert.equal(oneColumnPrice[0].valid, true);
assert.equal(oneColumnPrice[0].material_cost_cents, 127550);
assert.equal(oneColumnPrice[0].labor_cost_cents, 0);

const templateCosts = parseCostLibraryRows(parseDelimited(costLibraryTemplateCsv, ","), true);
assert.equal(templateCosts.length, 2);
assert.equal(
  templateCosts.every((row) => row.valid),
  true,
);
assert.equal(templateCosts[0].labor_cost_cents, 8250);
assert.equal(templateCosts[0].crew_size, 3);
assert.equal(templateCosts[1].productivity_per_hour, 600);

const contractorEstimatePaste =
  parseTabPaste(`Cost Code\tCSI Division\tDescription\tGroup\tUnit\tQty\tMaterial $/Unit\tLabor $/Unit\tNotes
03-100\t03\tGarage slab - local ready mix\tConcrete\tSF\t1250\t5.75\t3.20\tOwner garage alternate
06-200\t06\tCustom framing crew rate\tStructure\tHR\t420\t0\t82.50\tImported crew hours
09-510\t09\tInterior paint - owner standard\tFinishes\tSF\t18500\t0.58\t1.35\t`);
const estimateRows = parseEstimateLineRows(contractorEstimatePaste, true);
assert.equal(estimateRows.length, 3);
assert.equal(
  estimateRows.every((row) => row.valid),
  true,
);
assert.equal(estimateRows[0].quantity, 1250);
assert.equal(estimateRows[1].labor_unit_cost_cents, 8250);
assert.equal(
  dollars(
    estimateRows.reduce(
      (sum, row) => sum + row.quantity * (row.material_unit_cost_cents + row.labor_unit_cost_cents),
      0,
    ),
  ),
  81542.5,
);

const workbookMatrix = [
  [
    "Cost Code",
    "CSI Division",
    "Description",
    "Group",
    "Unit",
    "Qty",
    "Material $/Unit",
    "Labor $/Unit",
    "Notes",
  ],
  ["01-310", "01", "Supervision allowance", "General Conditions", "MO", 10, 0, 24000, ""],
  ["07-210", "07", "Wall insulation package", "Interior Buildout", "SF", 18500, 1.25, 0.68, ""],
];
const worksheet = xlsxUtils.aoa_to_sheet(workbookMatrix);
const matrixFromExcel = xlsxUtils
  .sheet_to_json(worksheet, { header: 1, blankrows: false })
  .map((row) => row.map((cell) => String(cell ?? "")));
const excelEstimateRows = parseEstimateLineRows(matrixFromExcel, true);
assert.equal(excelEstimateRows.length, 2);
assert.equal(
  excelEstimateRows.every((row) => row.valid),
  true,
);
assert.equal(excelEstimateRows[0].unit, "MO");
assert.equal(excelEstimateRows[1].quantity, 18500);

const csiDivisionSovPaste = parseTabPaste(`Code\tTitle\tBuilder Cost
DIV 09 Finishes\t1 line\t
09\tSack and Patch\t12500
DIV 10 Specialties\t1 line\t
10\tSaw Cutting: Door Opening\t8500
DIV 11 MEP\t1 line\t
11\tSaw Cutting: Plumbing Opening\t9200`);
const csiDivisionSovMap = guessColumnMap(csiDivisionSovPaste, true);
assert.equal(csiDivisionSovMap[0], "cost_code");
assert.equal(csiDivisionSovMap[1], "bucket");
assert.notEqual(csiDivisionSovMap[0], "bucket");
const csiDivisionSovRows = applyMapping(csiDivisionSovPaste, true, csiDivisionSovMap);
const csiDivisionValidRows = csiDivisionSovRows.filter((row) => row.valid);
assert.equal(csiDivisionValidRows.length, 3);
assert.deepEqual(
  csiDivisionValidRows.map((row) => row.bucket),
  ["Sack and Patch", "Saw Cutting: Door Opening", "Saw Cutting: Plumbing Opening"],
);
assert.deepEqual(
  csiDivisionValidRows.map((row) => row.cost_code),
  ["09", "10", "11"],
);
assert.equal(csiDivisionSovRows.filter((row) => row.reason === "CSI division header").length, 3);
const csiDivisionSovAnalysis = analyzeSovIntake(csiDivisionSovPaste, true, csiDivisionSovMap);
assert.ok(
  csiDivisionSovAnalysis.warnings.some((warning) =>
    /3 CSI division header rows skipped/.test(warning),
  ),
);
assert.equal(csiDivisionSovAnalysis.skippedRowReasons[0]?.reason, "CSI division header");
assert.equal(csiDivisionSovAnalysis.skippedRowReasons[0]?.count, 3);
assert.equal(
  csiDivisionSovAnalysis.columnSuggestions.find((suggestion) => suggestion.label === "Code")?.field,
  "cost_code",
);
assert.ok(
  csiDivisionSovAnalysis.columnSuggestions
    .find((suggestion) => suggestion.label === "Code")
    ?.reasons.some((reason) => /DIV\/Division section rows/.test(reason)),
);
assert.equal(
  csiDivisionSovAnalysis.columnSuggestions.find((suggestion) => suggestion.label === "Title")
    ?.field,
  "bucket",
);

const templateEstimateRows = parseEstimateLineRows(
  parseDelimited(estimateLineTemplateCsv, ","),
  true,
);
assert.ok(templateEstimateRows.length >= 5);
assert.equal(
  templateEstimateRows.every((row) => row.valid),
  true,
);

const externalIds = ESTIMATE_SEED_LIBRARY_ITEMS.map((item) => item.external_id).filter(Boolean);
assert.ok(ESTIMATE_SEED_LIBRARY_ITEMS.length >= 500);
assert.ok(new Set(externalIds).size >= 450);
assert.ok(ESTIMATE_SEED_LIBRARY_ITEMS.filter((item) => item.material_cost_cents > 0).length >= 390);
assert.ok(ESTIMATE_SEED_LIBRARY_ITEMS.filter((item) => item.labor_cost_cents > 0).length >= 100);
assert.ok(
  ESTIMATE_SEED_LIBRARY_ITEMS.filter(
    (item) => item.labor_cost_cents > 0 && item.material_cost_cents === 0,
  ).length >= 100,
);
assert.ok(ESTIMATE_SEED_LIBRARY_ITEMS.reduce((sum, item) => sum + item.synonyms.length, 0) >= 2400);
assert.ok(new Set(ESTIMATE_SEED_LIBRARY_ITEMS.map((item) => item.csi_division)).size >= 15);
assert.ok(ESTIMATE_REGIONS.length >= 70);
assert.ok(ESTIMATE_REGIONS.some((region) => region.code === "national"));

const takeoffViewSize = { width: 100, height: 100 };
assert.equal(
  calculateTakeoffQuantity({
    tool: "linear",
    points: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ],
    scaleFeetPerPixel: 0.5,
    viewSize: takeoffViewSize,
  }),
  50,
);
assert.equal(
  calculateTakeoffQuantity({
    tool: "area",
    points: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ],
    scaleFeetPerPixel: 0.5,
    viewSize: takeoffViewSize,
  }),
  2500,
);
assert.equal(
  calculateTakeoffQuantity({
    tool: "count",
    points: [
      { x: 0.25, y: 0.25 },
      { x: 0.75, y: 0.25 },
      { x: 0.75, y: 0.75 },
    ],
    scaleFeetPerPixel: 0,
    viewSize: takeoffViewSize,
  }),
  3,
);

// --- Takeoff unit alias matcher (Phase 2 unit-mismatch guard) ---
assert.equal(normalizeTakeoffUnit("LF"), "LF");
assert.equal(normalizeTakeoffUnit("lnft"), "LF");
assert.equal(normalizeTakeoffUnit("Lin Ft"), "LF");
assert.equal(normalizeTakeoffUnit("lin. ft."), "LF");
assert.equal(normalizeTakeoffUnit("feet"), "LF");
assert.equal(normalizeTakeoffUnit("sq ft"), "SF");
assert.equal(normalizeTakeoffUnit("SQFT"), "SF");
assert.equal(normalizeTakeoffUnit("sq. ft."), "SF");
assert.equal(normalizeTakeoffUnit("square feet"), "SF");
assert.equal(normalizeTakeoffUnit("each"), "EA");
assert.equal(normalizeTakeoffUnit("CT"), "EA");
assert.equal(normalizeTakeoffUnit("count"), "EA");
assert.equal(normalizeTakeoffUnit("sq yd"), "SY");
assert.equal(normalizeTakeoffUnit("cu yd"), "CY");
assert.equal(normalizeTakeoffUnit("cubic yards"), "CY");
assert.equal(normalizeTakeoffUnit("LS"), "LS");
assert.equal(normalizeTakeoffUnit("  "), "");
assert.equal(takeoffUnitsCompatible("LF", "lnft"), true);
assert.equal(takeoffUnitsCompatible("LF", "SF"), false);
assert.equal(takeoffUnitsCompatible("SF", "sy"), false);
assert.equal(takeoffUnitsCompatible("EA", "count"), true);
assert.equal(takeoffUnitsCompatible("", "SF"), true);
assert.equal(takeoffUnitsCompatible("LS", "LS"), true);
assert.equal(takeoffUnitsCompatible("LS", "EA"), false);

// --- Stated-scale conversion (Phase 2 scale trust) ---
// 36in x 24in sheet: page width = 36 * 72 = 2592 pdf points, rendered at the
// 1800px base long edge, so 1.44 points per stored pixel.
const STATED_SCALE_PAGE = { pageWidthPoints: 2592, renderedWidthPx: 1800 };
const POINTS_PER_PX = STATED_SCALE_PAGE.pageWidthPoints / STATED_SCALE_PAGE.renderedWidthPx;
const ARCH_PRESET_INCHES = [3 / 32, 1 / 8, 3 / 16, 1 / 4, 3 / 8, 1 / 2, 3 / 4, 1, 1.5, 3];
for (const statedInches of ARCH_PRESET_INCHES) {
  const got = statedScaleFeetPerPixel({ statedInches, statedFeet: 1, ...STATED_SCALE_PAGE });
  const expected = (1 / statedInches / 72) * POINTS_PER_PX;
  assert.ok(Math.abs(got - expected) < 1e-12, `arch preset ${statedInches}`);
}
const ENGINEERING_PRESET_FEET = [10, 20, 30, 40, 50, 60, 100];
for (const statedFeet of ENGINEERING_PRESET_FEET) {
  const got = statedScaleFeetPerPixel({ statedInches: 1, statedFeet, ...STATED_SCALE_PAGE });
  const expected = (statedFeet / 72) * POINTS_PER_PX;
  assert.ok(Math.abs(got - expected) < 1e-12, `eng preset 1"=${statedFeet}'`);
}
// Round trip: at 1/4" = 1'-0" a 100 ft wall draws 25 paper inches; on this
// sheet that is 1250 stored px, which must measure back to 100 ft.
const quarterInchScale = statedScaleFeetPerPixel({
  statedInches: 0.25,
  statedFeet: 1,
  ...STATED_SCALE_PAGE,
});
assert.ok(Math.abs(1250 * quarterInchScale - 100) < 1e-9);
// Half-size print trap: the same drawing plotted at 50% (18in page, still
// rendered to the 1800px base) makes the stated scale read exactly 2x off —
// the 100 ft wall (still 1250 rendered px) reads 50 ft, which is what the
// verify-scale check catches.
const halfSizeScale = statedScaleFeetPerPixel({
  statedInches: 0.25,
  statedFeet: 1,
  pageWidthPoints: 1296,
  renderedWidthPx: 1800,
});
assert.ok(Math.abs(1250 * halfSizeScale - 50) < 1e-9);
assert.equal(statedScaleFeetPerPixel({ statedInches: 0, statedFeet: 1, ...STATED_SCALE_PAGE }), 0);
assert.equal(
  statedScaleFeetPerPixel({
    statedInches: 0.25,
    statedFeet: 1,
    pageWidthPoints: 0,
    renderedWidthPx: 1800,
  }),
  0,
);

// --- Feet + inches entry ---
assert.equal(parseFeetInches("12' 6\""), 12.5);
assert.equal(parseFeetInches("12ft 6in"), 12.5);
assert.equal(parseFeetInches("12.5"), 12.5);
assert.equal(parseFeetInches("12"), 12);
assert.equal(parseFeetInches('6"'), 0.5);
assert.equal(parseFeetInches("5'"), 5);
assert.equal(parseFeetInches("0"), null);
assert.equal(parseFeetInches("wall"), null);
assert.equal(parseFeetInches(""), null);

// --- Linear angle guide snapping ---
const guideView = { width: 1000, height: 1000 };
const nearLevel = snapLinearPoint({
  anchor: { x: 0.2, y: 0.5 },
  cursor: { x: 0.6, y: 0.505 },
  viewSize: guideView,
});
assert.equal(nearLevel.snapped, true);
assert.equal(nearLevel.angleDeg, 0);
assert.ok(Math.abs(nearLevel.point.y - 0.5) < 1e-9);
const diagonal = snapLinearPoint({
  anchor: { x: 0.2, y: 0.5 },
  cursor: { x: 0.3, y: 0.4 },
  viewSize: guideView,
});
assert.equal(diagonal.snapped, true);
assert.equal(diagonal.angleDeg, 45);
const offAngle = snapLinearPoint({
  anchor: { x: 0.2, y: 0.5 },
  cursor: { x: 0.4, y: 0.38 },
  viewSize: guideView,
});
assert.equal(offAngle.snapped, false);
assert.ok(Math.abs(offAngle.angleDeg - 31) < 1.5);
const shiftConstrained = snapLinearPoint({
  anchor: { x: 0.2, y: 0.5 },
  cursor: { x: 0.4, y: 0.38 },
  viewSize: guideView,
  shiftKey: true,
});
assert.equal(shiftConstrained.snapped, true);
assert.equal(shiftConstrained.angleDeg, 45);

// --- Sheet-number pattern matcher (Phase 2.5 sheet identity) ---
for (const token of ["A-101", "A1.1", "E-201", "M-1.1", "FP-102", "A-700", "AD-3", "LV-101"]) {
  assert.equal(matchSheetNumber(token), token, `sheet number ${token}`);
}
assert.equal(matchSheetNumber("A 101"), "A101");
assert.equal(matchSheetNumber("SCALE"), null);
assert.equal(matchSheetNumber("12"), null);
assert.equal(matchSheetNumber("ABCD-1"), null);
assert.equal(matchSheetNumber("A-1234"), null);
assert.equal(matchSheetNumber(""), null);

// --- Discipline map ---
assert.equal(disciplineForSheetNumber("A-101"), "Architectural");
assert.equal(disciplineForSheetNumber("AD-3"), "Architectural");
assert.equal(disciplineForSheetNumber("S-201"), "Structural");
assert.equal(disciplineForSheetNumber("M-1.1"), "Mechanical");
assert.equal(disciplineForSheetNumber("E-201"), "Electrical");
assert.equal(disciplineForSheetNumber("P-102"), "Plumbing");
assert.equal(disciplineForSheetNumber("C-100"), "Civil");
assert.equal(disciplineForSheetNumber("L-1"), "Landscape");
assert.equal(disciplineForSheetNumber("FP-102"), "Fire Protection");
assert.equal(disciplineForSheetNumber("T-1"), "Low Voltage");
assert.equal(disciplineForSheetNumber("LV-2"), "Low Voltage");
assert.equal(disciplineForSheetNumber("G-001"), "General");
// PG is the app's page placeholder, never plumbing.
assert.equal(disciplineForSheetNumber("PG-001"), "");
assert.equal(disciplineForSheetNumber(""), "");

// --- Title-block extraction on a synthetic 2592x1728pt page ---
const titleBlockItems = [
  { text: "GENERAL NOTES", x: 300, y: 1500, height: 14 },
  { text: "CRYSTAL CARWASH", x: 2200, y: 500, height: 10 },
  { text: "DOOR, WINDOW TYPES", x: 2200, y: 300, height: 12 },
  { text: "& SCHEDULES", x: 2200, y: 284, height: 12 },
  { text: "SCALE: AS NOTED", x: 2200, y: 200, height: 8 },
  { text: "A-700", x: 2260, y: 120, height: 28 },
];
const identity = extractSheetIdentity({
  items: titleBlockItems,
  pageWidth: 2592,
  pageHeight: 1728,
});
assert.equal(identity.sheetNumber, "A-700");
assert.equal(identity.sheetName, "DOOR, WINDOW TYPES & SCHEDULES");
const scannedIdentity = extractSheetIdentity({ items: [], pageWidth: 2592, pageHeight: 1728 });
assert.equal(scannedIdentity.sheetNumber, null);
assert.equal(scannedIdentity.sheetName, null);

// --- Decimal-feet trap (Phase 2.5 founder finding) ---
assert.equal(parseFeetInches("12' 8\""), 12 + 8 / 12);
assert.ok(Math.abs(parseFeetInches("12' 8\"") - 12.6667) < 0.001);
assert.equal(formatFeetInches(12.8), "12'-9 5/8\"");
assert.equal(formatFeetInches(12.5), "12'-6\"");
assert.equal(formatFeetInches(12), "12'");
const typoHint = decimalFeetHint("12.8");
assert.ok(typoHint);
assert.equal(typoHint.conversionLabel, "12.8 ft = 12'-9 5/8\"");
assert.ok(typoHint.suggestion);
assert.equal(typoHint.suggestion.label, "Did you mean 12'-8\"?");
assert.equal(parseFeetInches(typoHint.suggestion.value), 12 + 8 / 12);
const halfFootHint = decimalFeetHint("12.5");
assert.ok(halfFootHint);
assert.equal(halfFootHint.conversionLabel, "12.5 ft = 12'-6\"");
assert.equal(halfFootHint.suggestion, null);
assert.equal(decimalFeetHint("12"), null);
assert.equal(decimalFeetHint("12' 8\""), null);
const bigFractionHint = decimalFeetHint("12.80");
assert.ok(bigFractionHint);
assert.equal(bigFractionHint.suggestion, null);

const slab = ESTIMATE_SEED_LIBRARY_ITEMS.find((item) => item.external_id === "slab-4in");
assert.ok(slab);
assert.equal(slab.csi_division, "03");
assert.equal(slab.unit, "SF");
assert.equal(slab.material_cost_cents, 325);

const estimatesSource = await readFile(
  new URL("../src/lib/estimates.functions.ts", import.meta.url),
  "utf8",
);
assert.match(estimatesSource, /Harbor Residence - Sample Estimate/);
assert.match(estimatesSource, /Harbor Residence - Sample Master Sheet/);
assert.match(estimatesSource, /ensureHarborSampleMasterSheet/);
assert.match(estimatesSource, /createBlankLineItems/);
const harborBlock = estimatesSource.match(
  /const HARBOR_DEMO_ESTIMATE_LINES = \[([\s\S]*?)\n\] as const;/,
)?.[1];
assert.ok(harborBlock);
const harborLines = Function(`"use strict"; return [${harborBlock}];`)();
assert.ok(harborLines.length >= 20);
assert.ok(new Set(harborLines.map((line) => line.scope_group)).size >= 7);
assert.deepEqual(
  ["01", "03", "06", "07", "09", "22", "23", "26", "31"].filter((division) =>
    harborLines.some((line) => line.csi_division === division),
  ),
  ["01", "03", "06", "07", "09", "22", "23", "26", "31"],
);
const harborDirectCents = harborLines.reduce(
  (sum, line) => sum + line.quantity * (line.material_unit_cost_cents + line.labor_unit_cost_cents),
  0,
);
assert.ok(harborDirectCents > 200_000_00);

console.log(
  [
    "Estimating beta smoke checks passed:",
    `${contractorCosts.length} contractor cost rows`,
    `${estimateRows.length + excelEstimateRows.length} imported estimate rows`,
    `${ESTIMATE_SEED_LIBRARY_ITEMS.length} seed library items`,
    `${ESTIMATE_REGIONS.length} regions`,
    `${harborLines.length} Harbor sample lines`,
    `$${dollars(harborDirectCents).toLocaleString("en-US")} Harbor direct cost`,
  ].join(" "),
);
