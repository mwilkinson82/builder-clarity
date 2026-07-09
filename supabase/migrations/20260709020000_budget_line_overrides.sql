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

-- Mirror cost_buckets_owner_via_project: access is scoped to the owning project.
DROP POLICY IF EXISTS budget_line_overrides_owner_via_project ON public.budget_line_overrides;
CREATE POLICY budget_line_overrides_owner_via_project ON public.budget_line_overrides
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = budget_line_overrides.project_id AND p.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = budget_line_overrides.project_id AND p.owner_id = auth.uid()
    )
  );
