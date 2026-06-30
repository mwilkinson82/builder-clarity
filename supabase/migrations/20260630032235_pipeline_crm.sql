CREATE TABLE IF NOT EXISTS public.pipeline_opportunities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  name text NOT NULL,
  client text NOT NULL DEFAULT '',
  client_contact_name text NOT NULL DEFAULT '',
  client_contact_email text NOT NULL DEFAULT '',
  client_contact_phone text NOT NULL DEFAULT '',

  stage text NOT NULL DEFAULT 'lead'
    CHECK (stage IN ('lead', 'qualifying', 'estimating', 'bid_submitted', 'negotiating', 'won', 'lost', 'no_bid')),

  estimated_contract numeric(14,2) NOT NULL DEFAULT 0,
  estimated_cost numeric(14,2) NOT NULL DEFAULT 0,
  estimated_gp_pct numeric(8,2) GENERATED ALWAYS AS (
    CASE
      WHEN estimated_contract > 0
        THEN ((estimated_contract - estimated_cost) / estimated_contract) * 100
      ELSE 0
    END
  ) STORED,

  bid_due_date date,
  decision_date date,
  probability integer NOT NULL DEFAULT 50 CHECK (probability BETWEEN 0 AND 100),
  source text NOT NULL DEFAULT '',
  project_type text NOT NULL DEFAULT '',
  scope_summary text NOT NULL DEFAULT '',

  bid_decision text NOT NULL DEFAULT 'undecided'
    CHECK (bid_decision IN ('undecided', 'bid', 'no_bid')),
  bid_decision_reason text NOT NULL DEFAULT '',
  bid_decision_date date,

  converted_project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  converted_at timestamptz,

  assigned_to text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived boolean NOT NULL DEFAULT false
);

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS source_opportunity_id uuid;

ALTER TABLE public.projects
  DROP CONSTRAINT IF EXISTS projects_source_opportunity_id_fkey;

ALTER TABLE public.projects
  ADD CONSTRAINT projects_source_opportunity_id_fkey
  FOREIGN KEY (source_opportunity_id)
  REFERENCES public.pipeline_opportunities(id)
  ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.pipeline_activity_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id uuid NOT NULL REFERENCES public.pipeline_opportunities(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  event_type text NOT NULL
    CHECK (event_type IN ('created', 'stage_change', 'note_added', 'bid_decision', 'converted', 'field_update', 'archived')),
  from_value text NOT NULL DEFAULT '',
  to_value text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pipeline_opportunities_org_stage_idx
  ON public.pipeline_opportunities(organization_id, stage, last_activity_at DESC)
  WHERE archived = false;

CREATE INDEX IF NOT EXISTS pipeline_opportunities_org_bid_due_idx
  ON public.pipeline_opportunities(organization_id, bid_due_date)
  WHERE archived = false AND stage NOT IN ('won', 'lost', 'no_bid');

CREATE INDEX IF NOT EXISTS pipeline_opportunities_org_assigned_idx
  ON public.pipeline_opportunities(organization_id, assigned_to)
  WHERE archived = false;

CREATE INDEX IF NOT EXISTS pipeline_opportunities_converted_project_idx
  ON public.pipeline_opportunities(converted_project_id)
  WHERE converted_project_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS projects_source_opportunity_id_idx
  ON public.projects(source_opportunity_id)
  WHERE source_opportunity_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS pipeline_activity_log_opportunity_created_idx
  ON public.pipeline_activity_log(opportunity_id, created_at DESC);

CREATE INDEX IF NOT EXISTS pipeline_activity_log_org_created_idx
  ON public.pipeline_activity_log(organization_id, created_at DESC);

DROP TRIGGER IF EXISTS pipeline_opportunities_set_updated_at
  ON public.pipeline_opportunities;
CREATE TRIGGER pipeline_opportunities_set_updated_at
  BEFORE UPDATE ON public.pipeline_opportunities
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

ALTER TABLE public.pipeline_opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pipeline_activity_log ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON public.pipeline_opportunities TO authenticated;
GRANT SELECT, INSERT ON public.pipeline_activity_log TO authenticated;
GRANT ALL ON public.pipeline_opportunities TO service_role;
GRANT ALL ON public.pipeline_activity_log TO service_role;

DROP POLICY IF EXISTS pipeline_opportunities_member_select ON public.pipeline_opportunities;
CREATE POLICY pipeline_opportunities_member_select
  ON public.pipeline_opportunities
  FOR SELECT
  TO authenticated
  USING (public.is_org_member(organization_id));

DROP POLICY IF EXISTS pipeline_opportunities_member_insert ON public.pipeline_opportunities;
CREATE POLICY pipeline_opportunities_member_insert
  ON public.pipeline_opportunities
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_org_member(organization_id)
    AND (created_by IS NULL OR created_by = auth.uid())
  );

DROP POLICY IF EXISTS pipeline_opportunities_member_update ON public.pipeline_opportunities;
CREATE POLICY pipeline_opportunities_member_update
  ON public.pipeline_opportunities
  FOR UPDATE
  TO authenticated
  USING (public.is_org_member(organization_id))
  WITH CHECK (public.is_org_member(organization_id));

DROP POLICY IF EXISTS pipeline_activity_log_member_select ON public.pipeline_activity_log;
CREATE POLICY pipeline_activity_log_member_select
  ON public.pipeline_activity_log
  FOR SELECT
  TO authenticated
  USING (public.is_org_member(organization_id));

DROP POLICY IF EXISTS pipeline_activity_log_member_insert ON public.pipeline_activity_log;
CREATE POLICY pipeline_activity_log_member_insert
  ON public.pipeline_activity_log
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_org_member(organization_id)
    AND (created_by IS NULL OR created_by = auth.uid())
    AND EXISTS (
      SELECT 1
      FROM public.pipeline_opportunities o
      WHERE o.id = opportunity_id
        AND o.organization_id = pipeline_activity_log.organization_id
    )
  );

CREATE OR REPLACE FUNCTION public.convert_pipeline_opportunity_to_project(
  p_opportunity_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_opportunity public.pipeline_opportunities%ROWTYPE;
  v_project_id uuid;
  v_bucket_budget numeric;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT *
  INTO v_opportunity
  FROM public.pipeline_opportunities
  WHERE id = p_opportunity_id
  FOR UPDATE;

  IF NOT FOUND OR v_opportunity.archived THEN
    RAISE EXCEPTION 'Opportunity not found';
  END IF;

  IF NOT public.is_org_member(v_opportunity.organization_id) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF v_opportunity.converted_project_id IS NOT NULL THEN
    RETURN v_opportunity.converted_project_id;
  END IF;

  IF v_opportunity.stage <> 'won' THEN
    RAISE EXCEPTION 'Opportunity must be won before conversion';
  END IF;

  INSERT INTO public.projects (
    owner_id,
    organization_id,
    source_opportunity_id,
    name,
    client,
    project_manager,
    phase,
    original_contract,
    original_cost_budget
  )
  VALUES (
    auth.uid(),
    v_opportunity.organization_id,
    v_opportunity.id,
    v_opportunity.name,
    v_opportunity.client,
    v_opportunity.assigned_to,
    'Early',
    COALESCE(v_opportunity.estimated_contract, 0),
    COALESCE(v_opportunity.estimated_cost, 0)
  )
  RETURNING id INTO v_project_id;

  v_bucket_budget := COALESCE(v_opportunity.estimated_cost, 0) / 6;

  INSERT INTO public.cost_buckets (
    project_id,
    cost_code,
    bucket,
    original_budget,
    actual_to_date,
    ftc,
    sort_order
  )
  SELECT
    v_project_id,
    '',
    bucket_name,
    v_bucket_budget,
    0,
    v_bucket_budget,
    sort_order
  FROM unnest(ARRAY['Sitework', 'Structure', 'Envelope', 'MEP', 'Finishes', 'GC/OH'])
    WITH ORDINALITY AS default_buckets(bucket_name, sort_order);

  UPDATE public.pipeline_opportunities
  SET
    converted_project_id = v_project_id,
    converted_at = now(),
    last_activity_at = now()
  WHERE id = v_opportunity.id;

  INSERT INTO public.pipeline_activity_log (
    opportunity_id,
    organization_id,
    event_type,
    to_value,
    notes,
    created_by
  )
  VALUES (
    v_opportunity.id,
    v_opportunity.organization_id,
    'converted',
    v_project_id::text,
    'Converted to Overwatch project',
    auth.uid()
  );

  RETURN v_project_id;
END;
$$;

REVOKE ALL ON FUNCTION public.convert_pipeline_opportunity_to_project(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.convert_pipeline_opportunity_to_project(uuid) TO authenticated;
