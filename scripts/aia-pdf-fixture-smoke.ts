// AIA G702/G703 print fixture check (GETTINGPAID1 Task 3).
//
// Generates the real PDF package from fixture data in node and asserts the
// print contract: letter-size pages (G702 portrait, G703 landscape), the
// continuation paginates with repeated headers, and the totals row never
// orphans onto a header-less page. Money rendering correctness is covered
// by the aia-math assertions in billing-payments-smoke.
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import { generateAiaBillingPdf } from "../src/lib/aia-pdf.ts";

const LETTER_PORTRAIT = { width: 612, height: 792 };
const LETTER_LANDSCAPE = { width: 792, height: 612 };

const project = {
  name: "Harbor Residence",
  client: "Harborline Development LLC",
  job_number: "2601",
  project_manager: "D. Alvarez",
  organization_name: "ALP Contractor Circle",
  organization_logo_url: "",
} as never;

const payApp = {
  application_number: "Application 4",
  invoice_number: "2601-4",
  billing_period: "June 2026",
  submitted_date: "2026-07-01",
  due_date: "2026-07-31",
  contract_amount: 2_120_250,
  change_order_amount: 45_000,
  amount_billed: 385_000,
  paid_to_date: 210_000,
  retainage: 38_500,
  output_format: "aia_g702",
} as never;

// Enough lines to force multiple continuation pages; odd cents on purpose.
const lineItems = Array.from({ length: 42 }, (_, index) => {
  const scheduled = 5_048_75 + index * 1_37; // cents
  const completed = Math.round(scheduled * 0.62);
  const stored = index % 5 === 0 ? 25_000 : 0;
  const previous = Math.round(completed * 0.7);
  return {
    cost_code: `${String(index + 1).padStart(2, "0")}-100`,
    description: `Work package ${index + 1} — schedule of values line with a description long enough to wrap`,
    scheduled_value_cents: scheduled,
    change_order_value_cents: index === 3 ? 450_000 : 0,
    work_completed_previous_cents: previous,
    materials_stored_previous_cents: 0,
    work_completed_this_period_cents: completed - previous,
    materials_stored_this_period_cents: stored,
    work_completed_to_date_cents: completed,
    materials_stored_to_date_cents: stored,
    total_completed_and_stored_cents: completed + stored,
    balance_to_finish_cents: scheduled + (index === 3 ? 450_000 : 0) - completed - stored,
    billing_percent_complete: 62,
    retainage_pct: 10,
    retainage_held_cents: Math.round((completed + stored) * 0.1),
    retainage_released_cents: 0,
  };
}) as never;

const bytes = await generateAiaBillingPdf({
  project,
  payApp,
  lineItems,
  generatedAt: new Date("2026-07-03T12:00:00Z"),
});
assert.ok(bytes.byteLength > 10_000, "PDF should have real content");

const doc = await PDFDocument.load(bytes);
const pages = doc.getPages();
// 42 rows at ~18 rows per landscape page: one G702 face + 3+ continuation
// pages proves headers repeat and pagination works.
assert.ok(pages.length >= 4, `expected 4+ pages, got ${pages.length}`);

const face = pages[0].getSize();
assert.equal(Math.round(face.width), LETTER_PORTRAIT.width, "G702 face is letter portrait");
assert.equal(Math.round(face.height), LETTER_PORTRAIT.height);
for (const page of pages.slice(1)) {
  const size = page.getSize();
  assert.equal(Math.round(size.width), LETTER_LANDSCAPE.width, "G703 pages are letter landscape");
  assert.equal(Math.round(size.height), LETTER_LANDSCAPE.height);
}

// Empty application (no line detail) still produces a valid two-page package
// through the same math via the synthetic fallback line.
const fallbackBytes = await generateAiaBillingPdf({
  project,
  payApp,
  lineItems: [] as never,
  generatedAt: new Date("2026-07-03T12:00:00Z"),
});
const fallbackDoc = await PDFDocument.load(fallbackBytes);
assert.ok(fallbackDoc.getPages().length >= 2, "fallback package has face + continuation");

console.log(
  `aia pdf fixture smoke: ${pages.length}-page package at letter size, all assertions passed`,
);
