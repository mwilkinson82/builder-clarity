-- CLAIMS MODULE (Claims/CO/Risk arc — slice 2).
--
-- A claim is a formal request through the contract's dispute-resolution process
-- for money and/or time (extension of time, delay damages, acceleration,
-- disruption). Many claims START life as a risk we're carrying in the tally and,
-- if unresolved, harden into a submitted claim. This table is the record of the
-- claim itself: what it is, where it sits in the review pipeline, the money/time
-- asked vs. awarded, and the paper trail links.
--
-- Mirrors project_inspections (same team RLS, updated_at trigger, seed pattern).
-- Money is stored as numeric whole-dollars to match exposures/change_orders in
-- the IOR module (the module this lives in), NOT billing's integer cents.
--
-- Outgoing links (risk_exposure_id, change_order_id) let a claim point at the
-- risk it came from and the change order it may resolve into. Reference only —
-- the two-way tagging UI lands in a later slice. FK ON DELETE SET NULL so
-- deleting a linked risk/CO just clears the pointer.
--
-- The cycle log (project_claim_events) and document attachments
-- (project_claim_documents) are separate later-slice migrations.
--
-- Idempotent + portable. Migration desk applies this.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.project_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  seed_key text NOT NULL DEFAULT '',
  claim_number text NOT NULL DEFAULT '',
  title text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  claim_type text NOT NULL DEFAULT 'delay',
  status text NOT NULL DEFAULT 'in_preparation',
  money_claimed numeric NOT NULL DEFAULT 0,
  time_claimed_days integer NOT NULL DEFAULT 0,
  money_awarded numeric NOT NULL DEFAULT 0,
  time_awarded_days integer NOT NULL DEFAULT 0,
  outcome text NOT NULL DEFAULT '',
  owner text NOT NULL DEFAULT '',
  submitted_at date,
  resolved_at date,
  risk_exposure_id uuid REFERENCES public.exposures(id) ON DELETE SET NULL,
  change_order_id uuid REFERENCES public.change_orders(id) ON DELETE SET NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Column-backfill for environments where the table pre-exists in a leaner shape.
ALTER TABLE public.project_claims
  ADD COLUMN IF NOT EXISTS seed_key text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS claim_number text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS title text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS claim_type text NOT NULL DEFAULT 'delay',
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'in_preparation',
  ADD COLUMN IF NOT EXISTS money_claimed numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS time_claimed_days integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS money_awarded numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS time_awarded_days integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS outcome text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS owner text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS submitted_at date,
  ADD COLUMN IF NOT EXISTS resolved_at date,
  ADD COLUMN IF NOT EXISTS risk_exposure_id uuid REFERENCES public.exposures(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS change_order_id uuid REFERENCES public.change_orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

DO $$
BEGIN
  ALTER TABLE public.project_claims
    ADD CONSTRAINT project_claims_type_check
    CHECK (claim_type IN (
      'delay', 'extension_of_time', 'delay_damages', 'acceleration', 'disruption', 'other'
    ));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.project_claims
    ADD CONSTRAINT project_claims_status_check
    CHECK (status IN (
      'in_preparation', 'submitted', 'pending_review', 'under_review',
      'reviewed', 'resolved', 'rejected', 'withdrawn'
    ));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS project_claims_project_status_idx
  ON public.project_claims(project_id, status);
CREATE INDEX IF NOT EXISTS project_claims_risk_exposure_idx
  ON public.project_claims(risk_exposure_id);
CREATE INDEX IF NOT EXISTS project_claims_change_order_idx
  ON public.project_claims(change_order_id);
CREATE UNIQUE INDEX IF NOT EXISTS project_claims_project_seed_key_idx
  ON public.project_claims(project_id, seed_key)
  WHERE seed_key <> '';

DROP TRIGGER IF EXISTS project_claims_set_updated_at ON public.project_claims;
CREATE TRIGGER project_claims_set_updated_at
  BEFORE UPDATE ON public.project_claims
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

ALTER TABLE public.project_claims ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS project_claims_team_select ON public.project_claims;
CREATE POLICY project_claims_team_select ON public.project_claims
  FOR SELECT TO authenticated USING (public.can_read_project(project_id));

DROP POLICY IF EXISTS project_claims_team_insert ON public.project_claims;
CREATE POLICY project_claims_team_insert ON public.project_claims
  FOR INSERT TO authenticated WITH CHECK (public.can_manage_project(project_id));

DROP POLICY IF EXISTS project_claims_team_update ON public.project_claims;
CREATE POLICY project_claims_team_update ON public.project_claims
  FOR UPDATE TO authenticated USING (public.can_manage_project(project_id))
  WITH CHECK (public.can_manage_project(project_id));

DROP POLICY IF EXISTS project_claims_team_delete ON public.project_claims;
CREATE POLICY project_claims_team_delete ON public.project_claims
  FOR DELETE TO authenticated USING (public.can_manage_project(project_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_claims TO authenticated;
GRANT ALL ON public.project_claims TO service_role;

-- Harbor demo seed: two claims that show both ends of the pipeline — a submitted
-- extension-of-time + delay-damages claim (from the electrical reinspection that
-- drove schedule risk) and an in-preparation weather-delay claim.
WITH harbor_projects AS (
  SELECT id
  FROM public.projects
  WHERE job_number = 'DEMO-HARBOR'
     OR lower(coalesce(name, '')) LIKE '%harbor residence%'
     OR lower(coalesce(job_number, '')) LIKE '%harbor%'
     OR lower(coalesce(client, '')) LIKE '%private luxury residence%'
),
demo_claims (
  seed_key,
  claim_number,
  title,
  description,
  claim_type,
  status,
  money_claimed,
  time_claimed_days,
  money_awarded,
  time_awarded_days,
  outcome,
  owner,
  submitted_at,
  resolved_at
) AS (
  VALUES
    (
      'harbor-demo:claim:electrical-delay',
      'CLM-001',
      'Electrical rework — extension of time & delay damages',
      'Failed electrical rough-in and the corrective reinspection cycle held drywall release. Seeking an extension of time plus the extended general-conditions cost the delay caused.',
      'extension_of_time',
      'submitted',
      48200,
      12,
      0,
      0,
      '',
      'PM',
      DATE '2026-06-18',
      NULL::date
    ),
    (
      'harbor-demo:claim:weather-delay',
      'CLM-002',
      'Weather delay — extension of time',
      'A run of storms stopped exterior work. Documenting the lost days now; likely a time-only extension request once the weather logs are compiled.',
      'delay',
      'in_preparation',
      0,
      6,
      0,
      0,
      '',
      'PM',
      NULL::date,
      NULL::date
    )
)
INSERT INTO public.project_claims (
  project_id,
  seed_key,
  claim_number,
  title,
  description,
  claim_type,
  status,
  money_claimed,
  time_claimed_days,
  money_awarded,
  time_awarded_days,
  outcome,
  owner,
  submitted_at,
  resolved_at
)
SELECT
  hp.id,
  dc.seed_key,
  dc.claim_number,
  dc.title,
  dc.description,
  dc.claim_type,
  dc.status,
  dc.money_claimed,
  dc.time_claimed_days,
  dc.money_awarded,
  dc.time_awarded_days,
  dc.outcome,
  dc.owner,
  dc.submitted_at,
  dc.resolved_at
FROM harbor_projects hp
CROSS JOIN demo_claims dc
ON CONFLICT DO NOTHING;

NOTIFY pgrst, 'reload schema';
