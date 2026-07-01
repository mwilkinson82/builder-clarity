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
assert.ok(ESTIMATE_SEED_LIBRARY_ITEMS.reduce((sum, item) => sum + item.synonyms.length, 0) >= 2400);
assert.ok(new Set(ESTIMATE_SEED_LIBRARY_ITEMS.map((item) => item.csi_division)).size >= 15);
assert.ok(ESTIMATE_REGIONS.length >= 70);
assert.ok(ESTIMATE_REGIONS.some((region) => region.code === "national"));

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
