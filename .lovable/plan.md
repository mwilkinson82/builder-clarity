
# Phase 3: Exposure Register + Project Truth Review

Reframe the app from "another cost report" into a risk-to-margin operating system. The schedule of values gives the cost structure; the **exposure register** becomes the heart of the product, and a guided **Project Truth Review** is how PMs feed it.

## Guiding product sentence
The IOR tool is not a budget report. It is a project truth system that starts from the SOV, captures emerging risk, assigns dollar exposure, and converts that exposure into management decisions that protect margin.

## Six modules (target end state)
1. Project setup (exists, light additions)
2. Cost forecast / SOV buckets (exists)
3. Change orders (exists)
4. **Exposure register** — replaces the current `holds` table as the primary risk object (NEW)
5. **Schedule risk** — date movement + blocked decisions tied to dollars (light NEW)
6. **Required decisions** — exposures and CO calls converted into owned actions (NEW)

Plus a cross-cutting **Project Truth Review** wizard that drives weekly/monthly updates.

---

## 1. Data model

### New table: `exposures` (the heart of the system)
Supersedes `holds` as the primary capture object. We keep `holds` as a derived/legacy concept — every active exposure with a dollar amount rolls into E-Hold or C-Hold totals based on its `hold_class`.

Fields:
- `project_id`, `title`, `description`
- `category` enum: `owner_decision | design_drift | trade_performance | procurement | schedule_compression | allowance_overrun | field_change | closeout_punch | other`
- `dollar_exposure` numeric
- `probability` numeric (0-100)
- `schedule_impact_weeks` numeric (nullable)
- `owner` text
- `response_path` enum: `eliminate | recover | offset | accept`
- `release_condition` text
- `hold_class` enum: `E-Hold | C-Hold | Both | None` (drives rollup into the guidance engine)
- `status` enum: `active | escalated | recovered | eliminated | accepted | released`
- `due_date`, `next_review_at`, `opened_at`, `resolved_at`
- `notes`

### New table: `decisions`
- `project_id`, `decision`, `impact` (dollars or qualitative), `owner`, `due_date`
- `status` enum: `open | in_progress | resolved | overdue`
- `linked_exposure_id` (nullable FK)
- `linked_co_id` (nullable FK)

### New table: `reviews` (the "what changed since last review" log)
- `project_id`, `reviewed_at`, `reviewer`
- `forecast_completion_date_before`, `forecast_completion_date_after`
- `summary_notes`
- JSON snapshot of KPI rollup at review time (for trending later)

### `projects` additions
- `forecast_completion_date` date
- `baseline_completion_date` date
- `last_review_summary` text

### Migration path for `holds`
- Backfill: each existing hold becomes an exposure with `hold_class` = its current type, `response_path = 'accept'` as default, status mapped 1:1.
- The Holds panel keeps showing E/C totals — but those totals are now computed from `exposures` where `hold_class in ('E-Hold','Both')` etc., not from a separate `holds` table. We can drop `holds` after backfill.

RLS: owner-via-project on all three new tables, mirroring existing pattern. GRANTs to authenticated + service_role.

`seed_demo_project` rewritten to create 6 exposures (mix of categories, statuses, response paths), 4 decisions (2 open, 1 in_progress, 1 overdue), and one historical review row.

---

## 2. IOR engine updates (`src/lib/ior.ts`)

- `computeRollup` now takes `exposures` instead of `holds`.
  - `exposureHolds` = Σ `dollar_exposure × probability/100` where `status ∈ active|escalated` AND `hold_class ∈ E-Hold|Both`.
  - `contingencyHold` = same, for C-Hold|Both.
- New: `exposureByCategory(exposures)` for the executive view's "margin at risk by category" chart.
- New: `exposureAging(exposures, now)` — days since `opened_at` for active items; surfaces stale risks.
- `evaluateWarnings` gains:
  - Any exposure `active` > 30 days with no `next_review_at` set.
  - Any `response_path = 'accept'` totaling > 1% of original contract without a written note.
  - Forecast completion date later than baseline AND no schedule-category exposure logged.

---

## 3. UI — three-layer workflow

### Layer 1 — Project Truth Review wizard (NEW, top-level CTA on project page)
A 6-step guided modal/sheet. Each step is one screen, one question, fast keyboard flow:

1. **Schedule** — Did forecast completion move? (date picker + reason)
2. **New exposure?** — Inline form: title, category, dollar, probability, response path, owner, release condition. Repeatable.
3. **CO updates** — Quick-edit list of pending COs (status, probability).
4. **Bucket forecast changes** — Only buckets where actual+FTC moved >5% since last review surface here; PM confirms or edits.
5. **Resolutions** — Active exposures listed; one-tap mark recovered/eliminated/released with note.
6. **Required decisions** — Add/confirm top 3 decisions needed to protect margin.

On submit: writes a `reviews` row with before/after snapshot and a summary.

The PM should never need to navigate raw tables during a normal review cycle.

### Layer 2 — Register tabs (replaces today's tabs)
- **Cost Buckets** (exists)
- **Change Orders** (exists)
- **Exposures** (NEW) — full table with filters by category, status, response path; inline edit; "Convert to Decision" action.
- **Decisions** (NEW, replaces placeholder `DecisionsTable`) — live table backed by `decisions` table.
- **Reviews** (NEW, small) — chronological list of past reviews with diff summary.

### Layer 3 — Executive Outcome screen (current dashboard, refined)
Keep the KPI strip, Waterfall, Holds panel. Additions:
- **Margin at risk by category** — horizontal bar chart from `exposureByCategory`.
- **Exposure aging strip** — count of active exposures bucketed by age (<7d, 7-30d, 30+d).
- "Last reviewed X days ago" header chip linking to the wizard.

### Strong UX rules baked in
- Every exposure form **requires** `dollar_exposure` and `response_path` — cannot save without both. This is the "what is the probable dollar consequence" + "what is the treatment" enforcement.
- When a PM lowers a hold below guidance, a `hold_variance_note` is required (already partially there — make it blocking).
- When schedule slips with no new schedule-category exposure, the wizard step 1 forces a confirmation.

---

## 4. Portfolio view
Project cards already show warning count. Add:
- Days since last review (red if > 30).
- Top exposure category for that project.

---

## 5. Out of scope for this pass
- SOV import from CSV / Procore / Buildertrend (manual bucket entry stays).
- Trending charts across reviews (we capture snapshots; visualization comes later).
- Role-based permissions (PM vs owner views).
- Notifications / email digests when reviews are overdue.

---

## Technical section

**Migration order (single migration):**
1. Create `exposures`, `decisions`, `reviews` with GRANTs, RLS, owner-via-project policies, `updated_at` triggers.
2. Add `forecast_completion_date`, `baseline_completion_date`, `last_review_summary` to `projects`.
3. Backfill: `INSERT INTO exposures SELECT ... FROM holds` mapping fields.
4. Rewrite `seed_demo_project` trigger to populate the new tables.
5. Drop `holds` table (after verifying backfill in dev).

**File changes:**
- `src/lib/ior.ts` — swap `HoldLite` for `ExposureLite`; add `exposureByCategory`, `exposureAging`; update warnings.
- `src/lib/projects.functions.ts` — replace hold CRUD with exposure CRUD; add `listExposures`, `upsertExposure`, `listDecisions`, `upsertDecision`, `submitReview`.
- `src/components/outcome/HoldsPanel.tsx` → `ExposureSummary.tsx` (keeps E/C totals header but pulls from exposures).
- `src/components/outcome/ExposuresTable.tsx` — NEW.
- `src/components/outcome/DecisionsTable.tsx` — wire to live data (currently static).
- `src/components/outcome/ReviewsLog.tsx` — NEW.
- `src/components/outcome/ProjectTruthReview.tsx` — NEW, the wizard.
- `src/components/outcome/ExposureByCategoryChart.tsx` — NEW.
- `src/components/outcome/RiskWarnings.tsx` — extend with stale/aging warnings.
- `src/routes/_authenticated/projects.$projectId.tsx` — add "Start Review" button, new tabs, new sections.
- `src/routes/_authenticated/index.tsx` — add last-reviewed + top-category chips on cards.

**Order of work (one PR per step is ideal but we'll batch):**
1. Migration + seed rewrite.
2. IOR engine update + server fns.
3. Exposures + Decisions tables (read/write).
4. Project Truth Review wizard.
5. Executive dashboard additions (category chart, aging, last-reviewed chip).
6. Portfolio card updates.

The visual identity of the executive screen stays — what changes is what feeds it and how the PM gets data in.
