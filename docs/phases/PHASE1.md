# PHASE1.md — Estimating Foundations (Claude Code task spec)

Read `AGENTS.md` first and follow it. You are the **Estimating** agent. Branch:
`estimating/phase1-foundations`. This phase lays schema and structure that every
later estimating milestone (tiled PDF viewer, scale trust, takeoff maturity, sync
hardening) depends on. Zero user-visible feature changes except where stated.

## Task 0 — Commit the two repaired migration files (provided alongside this spec)

Replace the repo copies with the provided patched versions:

1. `supabase/migrations/20260623161515_6bcf2ee5-6878-4010-a528-371bff10cc5f.sql`
   — the super-admin seed is now guarded (`INSERT ... SELECT ... WHERE id = ...`)
   so the file replays on fresh databases.
2. `supabase/migrations/20260624161000_caleb_access_firebreak.sql` — two
   `INSERT ... SELECT` statements now cast `'owner'::public.account_role` and
   `'active'::public.member_status` (bare literals in SELECT lists fail against
   enum columns at runtime; this broke in production on 2026-07-02).

These exact patched versions are **already applied** to production and both
replica databases. Committing them only makes the repo match reality. Do not
create new migration files for this task; edit in place.

## Task 1 — Three schema migrations (files only; do not apply to any DB)

### 1a. `estimates.kind` — first-class master sheet discriminator

New migration `..._estimate_kind_discriminator.sql`:

- `ALTER TABLE public.estimates ADD COLUMN IF NOT EXISTS kind varchar(16) NOT NULL DEFAULT 'estimate';`
- `CHECK (kind IN ('estimate','master_sheet'))` (drop/re-add constraint guarded).
- Backfill: `UPDATE public.estimates SET kind='master_sheet' WHERE project_type='master_sheet' AND kind='estimate';`
- Reset those rows' `project_type` to `'commercial'` so project_type only ever
  means project type again.
- Partial index: `CREATE INDEX IF NOT EXISTS idx_estimates_org_kind ON public.estimates(organization_id, kind, updated_at DESC);`

Code changes in `src/lib/estimates.functions.ts`:

- `listEstimates` filters `kind = 'estimate'` **server-side**; add
  `listMasterSheets` filtering `kind = 'master_sheet'` (or a kind parameter).
- Remove the client-side master filtering in
  `src/routes/_authenticated/estimates.tsx` (currently filters
  `project_type !== MASTER_ESTIMATE_PROJECT_TYPE` in the component).
- Master sheet creation paths set `kind='master_sheet'` instead of overloading
  `project_type`. Keep `MASTER_ESTIMATE_PROJECT_TYPE` reads tolerant during
  transition (treat either signal as master) so pre-migration rows never leak.

### 1b. `cost_library_items.labor_basis` — make labor numbers mean something

New migration `..._cost_library_labor_basis.sql`:

- `ADD COLUMN IF NOT EXISTS labor_basis varchar(24) NOT NULL DEFAULT 'per_unit'`
- `CHECK (labor_basis IN ('per_unit','per_hour','installed'))`
  - `per_unit`: labor_cost_cents is labor per takeoff unit (current implied meaning — hence the default)
  - `per_hour`: labor_cost_cents is a crew-hour rate; pairs with `crew_size` + `productivity_per_hour`
  - `installed`: material+labor combined per unit; material_cost_cents must be 0 for these rows

UI changes in `src/routes/_authenticated/cost-library.tsx`: show the basis as a
column/badge; the add/edit form requires choosing it; filter by basis. Estimate
and master-sheet pricing pulls must respect the basis when computing unit costs
(per_hour rows convert via crew_size × rate ÷ productivity_per_hour; if either
factor is missing, block the pull with a clear message instead of guessing).

### 1c. `estimate_line_items` quantity provenance — the anti-clobber schema

New migration `..._estimate_line_quantity_provenance.sql`:

- `ADD COLUMN IF NOT EXISTS quantity_source varchar(16) NOT NULL DEFAULT 'manual'`
  with `CHECK (quantity_source IN ('manual','takeoff'))`
- `ADD COLUMN IF NOT EXISTS takeoff_quantity numeric(14,4)` (last synced rollup, waste applied)
- `ADD COLUMN IF NOT EXISTS takeoff_synced_at timestamptz`

Code changes in `src/lib/plan-room.functions.ts` (`syncTakeoffQuantityToLine`):

- **Apply waste**: rollup = Σ (measurement.quantity × (1 + waste_pct/100)).
  Today waste_pct is stored but never applied — silent underpricing bug.
- Write `takeoff_quantity` + `takeoff_synced_at`, set `quantity_source='takeoff'`,
  and only then set `quantity`.
- If the line's current `quantity` differs from its last `takeoff_quantity` and
  `quantity_source='manual'`, return a `conflict: true` payload with both values
  instead of overwriting; the Plan Room UI shows old → new and asks to confirm.
  A confirmed sync passes `force: true`.
- Manual edits to quantity in the estimate grid set `quantity_source='manual'`.

UI: in the estimate grid, quantity cells with `quantity_source='takeoff'` get a
small link/badge back to the takeoff (sheet + measurement). Keep it subtle.

## Task 2 — Split `PlanRoomWorkspace.tsx` (mechanical, zero behavior change)

5,506 lines → a `src/components/estimates/plan-room/` module:

- `PlanRoomWorkspace.tsx` — composition shell only
- `PdfSheetViewer.tsx` — pdfjs loading/rendering/zoom/pan (isolates the surface the
  tiled-viewer milestone will replace)
- `TakeoffTools.tsx` — tool palette, draft geometry, measurement creation
- `TakeoffWorksheet.tsx` — worksheet, linking, sync actions
- `SheetSidebar.tsx` — drawing set list, filters, minimap
- `ReadinessPanel.tsx` — readiness checklist
- `planRoomShared.ts` — shared types/constants/pure helpers

Rules: move code verbatim; no renames of exported symbols used elsewhere; keep
`data-testid` attributes intact; commit the split separately from Tasks 0–1.

## Task 3 — Validate and ship

Run the full gate from AGENTS.md including `npm run test:estimating`. Browser-QA:
estimates list (no master sheets leaking), master sheets page, cost library, one
Plan Room open with all panels. Rebase on latest `origin/main`, push, open PR
titled `Estimating Phase 1: provenance schema, labor basis, kind discriminator,
plan room split`. PR description lists the three migration files so DB application
can be coordinated after merge.

**Do not attempt any database connection or application. Migration files only.**
