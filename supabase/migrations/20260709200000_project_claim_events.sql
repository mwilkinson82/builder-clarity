-- CLAIM CYCLE LOG (Claims/CO/Risk arc — slice 3).
--
-- A claim isn't one event — it's a back-and-forth: sent on X, received on Y,
-- reviewed, a meeting, kicked back for revision, resubmitted on Z, resolved.
-- project_claim_events is that dated trail, one row per event, ordered by
-- event_date. The claim row (project_claims) holds the CURRENT state (status +
-- dates); this table holds the HISTORY of how it got there.
--
-- revision_number tracks resubmission rounds (0 = original submission, 1 = first
-- revised resubmission, ...). seed_key lets the runtime Harbor demo seed the
-- cycle idempotently, same as project_claims / project_inspections.
--
-- Team RLS mirrors project_claims (needs project_id on the row). ON DELETE
-- CASCADE from the claim so deleting a claim takes its cycle log with it.
--
-- Idempotent + portable. Migration desk applies this.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.project_claim_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id uuid NOT NULL REFERENCES public.project_claims(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  seed_key text NOT NULL DEFAULT '',
  event_type text NOT NULL DEFAULT 'submitted',
  event_date date,
  revision_number integer NOT NULL DEFAULT 0,
  note text NOT NULL DEFAULT '',
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.project_claim_events
  ADD COLUMN IF NOT EXISTS seed_key text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS event_type text NOT NULL DEFAULT 'submitted',
  ADD COLUMN IF NOT EXISTS event_date date,
  ADD COLUMN IF NOT EXISTS revision_number integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS note text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

DO $$
BEGIN
  ALTER TABLE public.project_claim_events
    ADD CONSTRAINT project_claim_events_type_check
    CHECK (event_type IN (
      'submitted', 'received', 'reviewed', 'meeting',
      'returned_for_revision', 'resubmitted', 'resolved', 'other'
    ));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.project_claim_events
    ADD CONSTRAINT project_claim_events_revision_nonneg
    CHECK (revision_number >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS project_claim_events_claim_idx
  ON public.project_claim_events(claim_id, event_date);
CREATE INDEX IF NOT EXISTS project_claim_events_project_idx
  ON public.project_claim_events(project_id);
CREATE UNIQUE INDEX IF NOT EXISTS project_claim_events_seed_key_idx
  ON public.project_claim_events(project_id, seed_key)
  WHERE seed_key <> '';

DROP TRIGGER IF EXISTS project_claim_events_set_updated_at ON public.project_claim_events;
CREATE TRIGGER project_claim_events_set_updated_at
  BEFORE UPDATE ON public.project_claim_events
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

ALTER TABLE public.project_claim_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS project_claim_events_team_select ON public.project_claim_events;
CREATE POLICY project_claim_events_team_select ON public.project_claim_events
  FOR SELECT TO authenticated USING (public.can_read_project(project_id));

DROP POLICY IF EXISTS project_claim_events_team_insert ON public.project_claim_events;
CREATE POLICY project_claim_events_team_insert ON public.project_claim_events
  FOR INSERT TO authenticated WITH CHECK (public.can_manage_project(project_id));

DROP POLICY IF EXISTS project_claim_events_team_update ON public.project_claim_events;
CREATE POLICY project_claim_events_team_update ON public.project_claim_events
  FOR UPDATE TO authenticated USING (public.can_manage_project(project_id))
  WITH CHECK (public.can_manage_project(project_id));

DROP POLICY IF EXISTS project_claim_events_team_delete ON public.project_claim_events;
CREATE POLICY project_claim_events_team_delete ON public.project_claim_events
  FOR DELETE TO authenticated USING (public.can_manage_project(project_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_claim_events TO authenticated;
GRANT ALL ON public.project_claim_events TO service_role;

NOTIFY pgrst, 'reload schema';
