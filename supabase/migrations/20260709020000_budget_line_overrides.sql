-- BUDGETCONSOLIDATE1 — budget line override audit log.
--
-- The project Budget tab is collapsing from two tables (a read-only ledger plus
-- an always-editable grid) into ONE ledger you open a line to edit. A budget
-- line's cost figures are normally derived — actuals roll up from the daily log,
-- forecast/commitment from the subcontract buyout, budget moves only through
-- change orders — so typing a number in the line editor is a manual OVERRIDE of
-- a derived figure. This table records every such override (old -> new, who,
-- when) so an override is never invisible: it reads back into the line editor as
-- "recent changes" and marks hand-touched lines on the ledger.
--
-- Immutable trail: authenticated users may SELECT and INSERT only (no UPDATE /
-- DELETE). Portable: guarded so it no-ops where referenced rows are absent.

CREATE TABLE IF NOT EXISTS public.budget_line_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  cost_bucket_id uuid REFERENCES public.cost_buckets(id) ON DELETE CASCADE,
  field text NOT NULL,
  old_value numeric NOT NULL DEFAULT 0,
  new_value numeric NOT NULL DEFAULT 0,
  note text,
  changed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS budget_line_overrides_project_idx
  ON public.budget_line_overrides (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS budget_line_overrides_bucket_idx
  ON public.budget_line_overrides (cost_bucket_id);

GRANT SELECT, INSERT ON public.budget_line_overrides TO authenticated;
GRANT ALL ON public.budget_line_overrides TO service_role;

ALTER TABLE public.budget_line_overrides ENABLE ROW LEVEL SECURITY;

-- Team-based access, matching the rest of the schema. cost_buckets grants access
-- through BOTH an owner-only policy AND four can_read_project / can_manage_project
-- team policies (RLS policies OR together), so a non-owner PM who can edit a
-- budget line gets in via the team policies. An owner-only policy here would deny
-- that PM's override INSERT — and because logging is best-effort, it would fail
-- silently, leaving invisible holes in the audit trail for every non-owner. So we
-- gate on the same team helpers: read for SELECT, manage for INSERT. Immutable —
-- no UPDATE / DELETE policies (and none granted), so the trail can't be rewritten.
DROP POLICY IF EXISTS budget_line_overrides_owner_via_project ON public.budget_line_overrides;
DROP POLICY IF EXISTS budget_line_overrides_team_select ON public.budget_line_overrides;
CREATE POLICY budget_line_overrides_team_select ON public.budget_line_overrides
  FOR SELECT USING (public.can_read_project(project_id));
DROP POLICY IF EXISTS budget_line_overrides_team_insert ON public.budget_line_overrides;
CREATE POLICY budget_line_overrides_team_insert ON public.budget_line_overrides
  FOR INSERT WITH CHECK (public.can_manage_project(project_id));
