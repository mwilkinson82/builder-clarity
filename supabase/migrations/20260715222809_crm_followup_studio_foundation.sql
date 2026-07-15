-- CRMFOLLOWUP1 — value-first follow-up studio foundation.
--
-- The existing pipeline_next_actions table remains the single CRM work ledger.
-- Playbooks expand into those rows, enriched with prepared email copy and an
-- optional value asset.  The new tables hold reusable organization content,
-- playbook definitions, and opportunity enrollments.

CREATE TABLE IF NOT EXISTS public.crm_value_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  title text NOT NULL CHECK (length(trim(title)) > 0),
  description text NOT NULL DEFAULT '',
  source_type text NOT NULL DEFAULT 'upload'
    CHECK (source_type IN ('upload', 'link', 'google_drive')),
  storage_path text NOT NULL DEFAULT '',
  external_url text NOT NULL DEFAULT '',
  original_file_name text NOT NULL DEFAULT '',
  content_type text NOT NULL DEFAULT '',
  size_bytes bigint NOT NULL DEFAULT 0 CHECK (size_bytes >= 0),
  tags text[] NOT NULL DEFAULT '{}',
  audience text NOT NULL DEFAULT '',
  pipeline_stage text NOT NULL DEFAULT '',
  approved_for_external boolean NOT NULL DEFAULT true,
  archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, organization_id),
  CHECK (
    (source_type = 'upload' AND length(trim(storage_path)) > 0)
    OR (source_type IN ('link', 'google_drive') AND length(trim(external_url)) > 0)
  )
);

CREATE TABLE IF NOT EXISTS public.crm_followup_playbooks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  system_key text NOT NULL DEFAULT '',
  name text NOT NULL CHECK (length(trim(name)) > 0),
  description text NOT NULL DEFAULT '',
  audience text NOT NULL DEFAULT '',
  trigger_stage text NOT NULL DEFAULT '',
  is_system boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, organization_id)
);

CREATE TABLE IF NOT EXISTS public.crm_followup_playbook_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  playbook_id uuid NOT NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  step_order integer NOT NULL CHECK (step_order > 0),
  day_offset integer NOT NULL DEFAULT 1 CHECK (day_offset >= 0 AND day_offset <= 3650),
  channel text NOT NULL DEFAULT 'email'
    CHECK (channel IN ('email', 'call', 'text', 'meeting', 'task')),
  title text NOT NULL CHECK (length(trim(title)) > 0),
  purpose text NOT NULL DEFAULT '',
  value_angle text NOT NULL DEFAULT '',
  subject_template text NOT NULL DEFAULT '',
  body_template text NOT NULL DEFAULT '',
  default_asset_id uuid,
  require_review boolean NOT NULL DEFAULT true,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, organization_id),
  UNIQUE (playbook_id, step_order),
  FOREIGN KEY (playbook_id, organization_id)
    REFERENCES public.crm_followup_playbooks(id, organization_id) ON DELETE CASCADE,
  FOREIGN KEY (default_asset_id, organization_id)
    REFERENCES public.crm_value_assets(id, organization_id) ON DELETE RESTRICT
);

-- A composite key keeps every enrollment in the same organization as its
-- opportunity. The existing UUID primary key remains the canonical identity.
CREATE UNIQUE INDEX IF NOT EXISTS pipeline_opportunities_id_org_uidx
  ON public.pipeline_opportunities(id, organization_id);

CREATE TABLE IF NOT EXISTS public.crm_followup_enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  opportunity_id uuid NOT NULL,
  playbook_id uuid NOT NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  owner_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'paused', 'completed', 'stopped')),
  started_at timestamptz NOT NULL DEFAULT now(),
  paused_at timestamptz,
  completed_at timestamptz,
  stop_reason text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, organization_id),
  FOREIGN KEY (opportunity_id, organization_id)
    REFERENCES public.pipeline_opportunities(id, organization_id) ON DELETE CASCADE,
  FOREIGN KEY (playbook_id, organization_id)
    REFERENCES public.crm_followup_playbooks(id, organization_id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS crm_followup_one_open_enrollment_per_opportunity
  ON public.crm_followup_enrollments(opportunity_id)
  WHERE status IN ('active', 'paused');

CREATE UNIQUE INDEX IF NOT EXISTS crm_followup_playbooks_system_key_uidx
  ON public.crm_followup_playbooks(organization_id, system_key)
  WHERE system_key <> '';

CREATE INDEX IF NOT EXISTS crm_value_assets_org_active_idx
  ON public.crm_value_assets(organization_id, created_at DESC)
  WHERE archived = false;
CREATE INDEX IF NOT EXISTS crm_followup_playbooks_org_active_idx
  ON public.crm_followup_playbooks(organization_id, active, created_at DESC);
CREATE INDEX IF NOT EXISTS crm_followup_playbook_steps_playbook_idx
  ON public.crm_followup_playbook_steps(playbook_id, step_order)
  WHERE active = true;
CREATE INDEX IF NOT EXISTS crm_followup_enrollments_org_status_idx
  ON public.crm_followup_enrollments(organization_id, status, started_at DESC);

ALTER TABLE public.pipeline_next_actions
  ADD COLUMN IF NOT EXISTS owner_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS playbook_enrollment_id uuid,
  ADD COLUMN IF NOT EXISTS playbook_step_id uuid,
  ADD COLUMN IF NOT EXISTS value_asset_id uuid,
  ADD COLUMN IF NOT EXISTS subject text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS body text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS value_angle text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS outcome text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS outcome_notes text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS skipped_at timestamptz,
  ADD COLUMN IF NOT EXISTS skipped_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS sent_message_id text NOT NULL DEFAULT '';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pipeline_next_actions_followup_enrollment_fk'
  ) THEN
    ALTER TABLE public.pipeline_next_actions
      ADD CONSTRAINT pipeline_next_actions_followup_enrollment_fk
      FOREIGN KEY (playbook_enrollment_id, organization_id)
      REFERENCES public.crm_followup_enrollments(id, organization_id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pipeline_next_actions_followup_step_fk'
  ) THEN
    ALTER TABLE public.pipeline_next_actions
      ADD CONSTRAINT pipeline_next_actions_followup_step_fk
      FOREIGN KEY (playbook_step_id, organization_id)
      REFERENCES public.crm_followup_playbook_steps(id, organization_id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pipeline_next_actions_value_asset_fk'
  ) THEN
    ALTER TABLE public.pipeline_next_actions
      ADD CONSTRAINT pipeline_next_actions_value_asset_fk
      FOREIGN KEY (value_asset_id, organization_id)
      REFERENCES public.crm_value_assets(id, organization_id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS pipeline_next_actions_followup_queue_idx
  ON public.pipeline_next_actions(organization_id, due_date, priority)
  WHERE playbook_enrollment_id IS NOT NULL
    AND completed_at IS NULL
    AND skipped_at IS NULL;
CREATE INDEX IF NOT EXISTS pipeline_next_actions_followup_enrollment_idx
  ON public.pipeline_next_actions(playbook_enrollment_id, due_date);

DROP TRIGGER IF EXISTS crm_value_assets_set_updated_at ON public.crm_value_assets;
CREATE TRIGGER crm_value_assets_set_updated_at
  BEFORE UPDATE ON public.crm_value_assets
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
DROP TRIGGER IF EXISTS crm_followup_playbooks_set_updated_at ON public.crm_followup_playbooks;
CREATE TRIGGER crm_followup_playbooks_set_updated_at
  BEFORE UPDATE ON public.crm_followup_playbooks
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
DROP TRIGGER IF EXISTS crm_followup_playbook_steps_set_updated_at
  ON public.crm_followup_playbook_steps;
CREATE TRIGGER crm_followup_playbook_steps_set_updated_at
  BEFORE UPDATE ON public.crm_followup_playbook_steps
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
DROP TRIGGER IF EXISTS crm_followup_enrollments_set_updated_at
  ON public.crm_followup_enrollments;
CREATE TRIGGER crm_followup_enrollments_set_updated_at
  BEFORE UPDATE ON public.crm_followup_enrollments
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

ALTER TABLE public.crm_value_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_followup_playbooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_followup_playbook_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_followup_enrollments ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON public.crm_value_assets TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.crm_followup_playbooks TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.crm_followup_playbook_steps TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.crm_followup_enrollments TO authenticated;
GRANT ALL ON public.crm_value_assets TO service_role;
GRANT ALL ON public.crm_followup_playbooks TO service_role;
GRANT ALL ON public.crm_followup_playbook_steps TO service_role;
GRANT ALL ON public.crm_followup_enrollments TO service_role;

DROP POLICY IF EXISTS crm_value_assets_member_select ON public.crm_value_assets;
CREATE POLICY crm_value_assets_member_select ON public.crm_value_assets
  FOR SELECT TO authenticated USING (public.is_org_member(organization_id));
DROP POLICY IF EXISTS crm_value_assets_member_insert ON public.crm_value_assets;
CREATE POLICY crm_value_assets_member_insert ON public.crm_value_assets
  FOR INSERT TO authenticated WITH CHECK (
    public.is_org_member(organization_id)
    AND (created_by IS NULL OR created_by = (SELECT auth.uid()))
  );
DROP POLICY IF EXISTS crm_value_assets_member_update ON public.crm_value_assets;
CREATE POLICY crm_value_assets_member_update ON public.crm_value_assets
  FOR UPDATE TO authenticated
  USING (public.is_org_member(organization_id))
  WITH CHECK (public.is_org_member(organization_id));

DROP POLICY IF EXISTS crm_followup_playbooks_member_select ON public.crm_followup_playbooks;
CREATE POLICY crm_followup_playbooks_member_select ON public.crm_followup_playbooks
  FOR SELECT TO authenticated USING (public.is_org_member(organization_id));
DROP POLICY IF EXISTS crm_followup_playbooks_member_insert ON public.crm_followup_playbooks;
CREATE POLICY crm_followup_playbooks_member_insert ON public.crm_followup_playbooks
  FOR INSERT TO authenticated WITH CHECK (
    public.is_org_member(organization_id)
    AND (created_by IS NULL OR created_by = (SELECT auth.uid()))
  );
DROP POLICY IF EXISTS crm_followup_playbooks_member_update ON public.crm_followup_playbooks;
CREATE POLICY crm_followup_playbooks_member_update ON public.crm_followup_playbooks
  FOR UPDATE TO authenticated
  USING (public.is_org_member(organization_id))
  WITH CHECK (public.is_org_member(organization_id));

DROP POLICY IF EXISTS crm_followup_playbook_steps_member_select
  ON public.crm_followup_playbook_steps;
CREATE POLICY crm_followup_playbook_steps_member_select
  ON public.crm_followup_playbook_steps
  FOR SELECT TO authenticated USING (public.is_org_member(organization_id));
DROP POLICY IF EXISTS crm_followup_playbook_steps_member_insert
  ON public.crm_followup_playbook_steps;
CREATE POLICY crm_followup_playbook_steps_member_insert
  ON public.crm_followup_playbook_steps
  FOR INSERT TO authenticated WITH CHECK (
    public.is_org_member(organization_id)
    AND (created_by IS NULL OR created_by = (SELECT auth.uid()))
  );
DROP POLICY IF EXISTS crm_followup_playbook_steps_member_update
  ON public.crm_followup_playbook_steps;
CREATE POLICY crm_followup_playbook_steps_member_update
  ON public.crm_followup_playbook_steps
  FOR UPDATE TO authenticated
  USING (public.is_org_member(organization_id))
  WITH CHECK (public.is_org_member(organization_id));

DROP POLICY IF EXISTS crm_followup_enrollments_member_select
  ON public.crm_followup_enrollments;
CREATE POLICY crm_followup_enrollments_member_select
  ON public.crm_followup_enrollments
  FOR SELECT TO authenticated USING (public.is_org_member(organization_id));
DROP POLICY IF EXISTS crm_followup_enrollments_member_insert
  ON public.crm_followup_enrollments;
CREATE POLICY crm_followup_enrollments_member_insert
  ON public.crm_followup_enrollments
  FOR INSERT TO authenticated WITH CHECK (
    public.is_org_member(organization_id)
    AND (created_by IS NULL OR created_by = (SELECT auth.uid()))
    AND (owner_user_id IS NULL OR owner_user_id = (SELECT auth.uid()) OR EXISTS (
      SELECT 1 FROM public.organization_memberships m
      WHERE m.organization_id = crm_followup_enrollments.organization_id
        AND m.user_id = crm_followup_enrollments.owner_user_id
        AND m.status = 'active'
    ))
  );
DROP POLICY IF EXISTS crm_followup_enrollments_member_update
  ON public.crm_followup_enrollments;
CREATE POLICY crm_followup_enrollments_member_update
  ON public.crm_followup_enrollments
  FOR UPDATE TO authenticated
  USING (public.is_org_member(organization_id))
  WITH CHECK (
    public.is_org_member(organization_id)
    AND (owner_user_id IS NULL OR EXISTS (
      SELECT 1 FROM public.organization_memberships m
      WHERE m.organization_id = crm_followup_enrollments.organization_id
        AND m.user_id = crm_followup_enrollments.owner_user_id
        AND m.status = 'active'
    ))
  );

-- Private organization-scoped content bucket. Objects are stored at
-- <organizationId>/<assetId>/<filename>. Direct uploads are capped at 25 MB;
-- articles are represented as URL assets and therefore do not use Storage.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'crm-assets',
  'crm-assets',
  false,
  26214400,
  ARRAY[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain',
    'text/markdown',
    'image/jpeg',
    'image/png'
  ]::text[]
)
ON CONFLICT (id) DO UPDATE
  SET public = false,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS crm_assets_storage_select ON storage.objects;
CREATE POLICY crm_assets_storage_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'crm-assets'
    AND public.is_org_member(((storage.foldername(name))[1])::uuid)
  );
DROP POLICY IF EXISTS crm_assets_storage_insert ON storage.objects;
CREATE POLICY crm_assets_storage_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'crm-assets'
    AND public.is_org_member(((storage.foldername(name))[1])::uuid)
  );
DROP POLICY IF EXISTS crm_assets_storage_delete ON storage.objects;
CREATE POLICY crm_assets_storage_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'crm-assets'
    AND public.is_org_member(((storage.foldername(name))[1])::uuid)
  );
