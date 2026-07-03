// 11x17 print pagination smoke: renders the REAL CpmPrintSheet for two
// fixtures, prints them to PDF with headless Chromium at 11x17 landscape, and
// asserts page counts against the pagination math the component itself uses.
//
// Fixture 22 (the live Harbor case) must be exactly ONE page. Fixture 60 must
// paginate: predicted page count, headers repeated per page by construction,
// and no page under the orphan minimum.
//
// Requires a prior `npm run build` (compiled CSS is read from .output) — the
// validation gate always builds.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PRINT_MIN_TASK_ROWS_PER_PAGE,
  paginateSchedulePrint,
} from "../src/lib/schedule-print-pagination.ts";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// ---------- Pure pagination unit checks (fast, no browser) ----------
{
  const uniform = (count: number) =>
    Array.from({ length: count }, (_, index) => ({ key: `t-${index + 1}`, height: 30 }));
  const single = paginateSchedulePrint({
    groups: [{ division: "A", parentPaths: [], headingHeight: 16, tasks: uniform(20) }],
    firstPageBudget: 800,
    continuationPageBudget: 900,
    footerHeight: 30,
    chunkOverheadHeight: 64,
    minTaskRowsPerPage: 4,
  });
  assert.equal(single.length, 1, "A schedule that fits must produce exactly one page chunk.");
  assert.equal(single[0].taskCount, 20);

  const multi = paginateSchedulePrint({
    groups: [{ division: "A", parentPaths: [], headingHeight: 16, tasks: uniform(60) }],
    firstPageBudget: 800,
    continuationPageBudget: 900,
    footerHeight: 30,
    chunkOverheadHeight: 64,
    minTaskRowsPerPage: 4,
  });
  assert.ok(multi.length > 1, "Sixty uniform rows must paginate.");
  assert.equal(
    multi.reduce((sum, chunk) => sum + chunk.taskCount, 0),
    60,
    "Pagination must not drop or duplicate rows.",
  );
  for (const chunk of multi) {
    assert.ok(
      chunk.taskCount >= 4,
      `Orphan control: no page may carry fewer than 4 rows (got ${chunk.taskCount}).`,
    );
  }

  // Orphan fix-up: heights tuned so the greedy pass leaves 1 trailing row.
  const orphanProne = paginateSchedulePrint({
    groups: [{ division: "A", parentPaths: [], headingHeight: 16, tasks: uniform(21) }],
    firstPageBudget: 64 + 16 + 20 * 30, // exactly 20 rows fit page 1
    continuationPageBudget: 900,
    footerHeight: 30,
    chunkOverheadHeight: 64,
    minTaskRowsPerPage: 4,
  });
  assert.equal(orphanProne.length, 2);
  assert.ok(
    orphanProne[1].taskCount >= 4,
    `The break must move earlier instead of stranding rows (last page got ${orphanProne[1].taskCount}).`,
  );
}

// ---------- Headless Chromium PDF checks ----------
function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter((candidate): candidate is string => Boolean(candidate));
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function findBuiltCss() {
  const assetsDir = join(rootDir, ".output", "public", "assets");
  if (!existsSync(assetsDir)) return null;
  const cssFiles = readdirSync(assetsDir).filter(
    (name) => name.startsWith("styles-") && name.endsWith(".css"),
  );
  if (cssFiles.length === 0) return null;
  return join(assetsDir, cssFiles.sort().at(-1)!);
}

function countPdfPages(pdfPath: string) {
  const raw = readFileSync(pdfPath, "latin1");
  const pageMatches = raw.match(/\/Type\s*\/Page[^s]/g);
  if (pageMatches && pageMatches.length > 0) return pageMatches.length;
  const countMatches = [...raw.matchAll(/\/Type\s*\/Pages[^>]*\/Count\s+(\d+)/g)];
  if (countMatches.length > 0) {
    return Math.max(...countMatches.map((match) => Number(match[1])));
  }
  throw new Error(`Could not count pages in ${pdfPath}`);
}

const chrome = findChrome();
assert.ok(
  chrome,
  "Headless Chromium is required for the 11x17 print smoke. Install Google Chrome or set CHROME_PATH.",
);
const builtCss = findBuiltCss();
assert.ok(
  builtCss,
  "Compiled CSS not found under .output/public/assets. Run `npm run build` before the print smoke.",
);

const workDir = mkdtempSync(join(tmpdir(), "constructline-print-smoke-"));
const bundlePath = join(workDir, "print-fixture-entry.mjs");
execFileSync(
  join(rootDir, "node_modules", ".bin", "esbuild"),
  [
    join(rootDir, "scripts", "print-fixtures", "print-fixture-entry.tsx"),
    "--bundle",
    "--format=esm",
    "--platform=node",
    `--alias:@=${join(rootDir, "src")}`,
    "--jsx=automatic",
    "--banner:js=import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
    `--outfile=${bundlePath}`,
    "--log-level=warning",
  ],
  { cwd: rootDir, stdio: ["ignore", "inherit", "inherit"] },
);
execFileSync(process.execPath, [bundlePath, workDir, builtCss!], {
  cwd: rootDir,
  stdio: ["ignore", "ignore", "inherit"],
});

const predictions = JSON.parse(readFileSync(join(workDir, "predictions.json"), "utf8")) as Record<
  string,
  { pages: number; chunkTaskCounts: number[] }
>;

function printToPdf(fixtureKey: string) {
  const pdfPath = join(workDir, `${fixtureKey}.pdf`);
  execFileSync(
    chrome!,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      "--no-pdf-header-footer",
      `--print-to-pdf=${pdfPath}`,
      `file://${join(workDir, `${fixtureKey}.html`)}`,
    ],
    { stdio: ["ignore", "ignore", "pipe"], timeout: 60_000 },
  );
  const raw = readFileSync(pdfPath, "latin1");
  // 11x17 landscape = 1224 x 792 pt. Chrome honors the @page size rule.
  assert.ok(
    /\/MediaBox\s*\[\s*0\s+0\s+1224\s+792\s*\]/.test(raw),
    `${fixtureKey}: PDF page size must be 17in x 11in landscape (1224x792pt MediaBox).`,
  );
  return countPdfPages(pdfPath);
}

const pages22 = printToPdf("fixture-22");
assert.equal(
  predictions["fixture-22"].pages,
  1,
  "Pagination math must place the 22-activity schedule on one page.",
);
assert.equal(
  pages22,
  1,
  `The 22-activity report must print on exactly ONE sheet (got ${pages22}).`,
);

const pages60 = printToPdf("fixture-60");
assert.ok(pages60 >= 2, `The 60-activity report must genuinely paginate (got ${pages60} page).`);
assert.equal(
  pages60,
  predictions["fixture-60"].pages,
  `Printed page count (${pages60}) must match the pagination math (${predictions["fixture-60"].pages}).`,
);
for (const taskCount of predictions["fixture-60"].chunkTaskCounts) {
  assert.ok(
    taskCount >= PRINT_MIN_TASK_ROWS_PER_PAGE,
    `Orphan control: every printed page carries at least ${PRINT_MIN_TASK_ROWS_PER_PAGE} activity rows (got ${taskCount}).`,
  );
}

console.log(
  `ConstructLine CPM print smoke passed: fixture-22 -> ${pages22} page, fixture-60 -> ${pages60} pages (${predictions["fixture-60"].chunkTaskCounts.join("/")} rows).`,
);
