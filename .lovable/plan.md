## Goal
Turn the IOR app from a dashboard into a true risk-to-margin operating system: PMs import their existing SOV, log dollarized risks with a treatment path, and generate a polished weekly PDF report ready for an L10 / PM meeting. Ship as one coherent release.

## 1. Comma-formatted dollar inputs (`MoneyInput`)
- New `src/components/ui/money-input.tsx`: type-as-you-go thousands separators, returns clean number, accepts decimals, blocks letters.
- Replace raw `<Input type="number">` in: project edit (Original Contract, Original Cost Budget), Cost Buckets table, Change Orders table, Exposures table. Reads stay formatted with `fmtUSD`.

## 2. Schedule of Values ingestion — three paths
Single sheet `ImportSOVSheet.tsx` on the Cost Buckets tab with tabs:
- **CSV** — drag-drop or pick `.csv`, parsed with `papaparse`.
- **Excel (.xlsx)** — same drop zone, parsed with `xlsx` (sheetjs). Worker-safe.
- **Paste from spreadsheet** — large textarea; pastes tab-separated cells from Excel/QuickBooks into an editable grid.

All three converge on the same mapping UI:
- Column picker: which column is Bucket Name / Original Budget / Actual to Date / FTC / Sort Order.
- Live preview grid (first 25 rows) with per-row valid/invalid badges. Bad rows are flagged, not silently dropped.
- Mode: **Replace all buckets** or **Append**.
- "Help me copy from Excel" inline tip with the exact columns to copy.

Backend: new `importCostBuckets` server fn — accepts validated rows, runs as one transaction.

## 3. Treatment path woven into Truth Review wizard
The wizard becomes the weekly IOR generator, not a notes box.
- Step 2 (New exposure) and step 5 (Resolutions) both REQUIRE a treatment path on every active exposure surfaced — `eliminate | recover | offset | accept`. Cannot advance without one selected for each.
- Each path renders with a one-line meaning so the PM picks deliberately:
  - **Eliminate** — remove the risk (scope cut, design change).
  - **Recover** — earn it back (CO, schedule recovery).
  - **Offset** — fund it from another bucket / contingency.
  - **Accept** — book the loss; protect the rest.
- Wizard submit writes the `reviews` row AND triggers PDF generation; the PDF is attached to the review.

## 4. Reviews become real artifacts (editable + downloadable + emailable)
- `reviews` table additions: `pdf_url`, `email_recipients text[]`, `status` (`draft | published`), `body_markdown` (editable narrative).
- New Reviews tab UI: list of past reviews; each row has **View PDF**, **Edit**, **Download**, **Email** (mailto: with PDF link prefilled).
- Edit screen lets PM rewrite the narrative, add executive summary, then "Re-publish" regenerates PDF.

## 5. IOR PDF Report — two samples first, you pick
Server route `/api/reports/ior` (server fn returning a PDF blob), generated with `pdf-lib` (Worker-safe, no native deps).
Both styles will be generated for Harbor Residence so you can pick:

**Style A — Executive one-pager + appendix**
- Page 1: header (project, client, "Week of [date]"), KPI strip, outcome waterfall sketch, top 5 exposures table, required decisions, schedule chip.
- Page 2+: full exposure register grouped by treatment path, CO log, cost bucket detail, review narrative.

**Style B — Multi-page structured report**
- Cover page (project, reviewer, date, status pill).
- Executive summary (narrative + 3 KPI callouts).
- Financial Outcome (waterfall, original→indicated).
- Exposure Register grouped by **treatment path** (Eliminate / Recover / Offset / Accept) with rollup per group.
- Decisions Required.
- Schedule Risk (baseline vs forecast, schedule-category exposures).
- Review Log (last 3 reviews diff).

A "Download IOR Report" button appears at the top of the project page AND after wizard submit. Style picker stays in the UI after we decide.

## 6. Comma input + small fixes
- Fix React #418 hydration error surfaced in runtime errors (likely date formatting differing SSR/client).

## Out of scope this pass
- Email-send via server (mailto: only for now; SMTP integration is a separate ask).
- Branded logo upload for PDF header (uses project name only).
- Per-line-item SOV (we stay at bucket-level rollup, but importer supports up to a few hundred rows mapped into buckets).

---

## Technical notes

**New deps:** `papaparse`, `xlsx`, `pdf-lib` — all Worker-compatible.

**Migration:**
- `reviews`: add `pdf_url text`, `email_recipients text[]`, `status text default 'published'`, `body_markdown text`.
- No new tables.

**Files (new):**
- `src/components/ui/money-input.tsx`
- `src/components/outcome/ImportSOVSheet.tsx`
- `src/components/outcome/ReviewsTab.tsx`
- `src/lib/sov-import.ts` (CSV/XLSX/paste parsers + column mapping)
- `src/lib/ior-pdf.ts` (pdf-lib report generators, two styles)
- `src/lib/reports.functions.ts` (`generateIorReport`, `importCostBuckets`, `updateReview`)

**Files (edited):**
- `src/components/outcome/ProjectTruthReview.tsx` — enforce treatment path per active exposure, trigger PDF on submit.
- `src/components/outcome/{CostBucketsTable,ChangeOrdersTable,ExposuresTable}.tsx` — use `MoneyInput`.
- `src/routes/_authenticated/projects.$projectId.tsx` — Download Report button, Reviews tab, Import SOV button on Cost Buckets, project-edit dialog uses `MoneyInput`.

**Build order I'll execute:**
1. Migration for reviews additions.
2. `MoneyInput` + swap into all tables/dialogs.
3. SOV importer (parsers + sheet UI + server fn).
4. PDF generator with both styles + Download button — render Harbor Residence sample so you can compare.
5. Truth Review wizard rework: treatment-path enforcement + auto-PDF on submit.
6. Reviews tab (edit / download / mailto email).
