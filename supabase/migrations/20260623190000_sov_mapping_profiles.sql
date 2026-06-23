CREATE TABLE IF NOT EXISTS public.sov_mapping_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  name text NOT NULL,
  normalized_name text NOT NULL,
  source_type text NOT NULL DEFAULT '',
  source_sheet text NOT NULL DEFAULT '',
  profile text NOT NULL DEFAULT '',
  confidence text NOT NULL DEFAULT 'unknown' CHECK (confidence IN ('high', 'medium', 'low', 'unknown')),
  has_header boolean NOT NULL DEFAULT true,
  column_map jsonb NOT NULL DEFAULT '{}'::jsonb,
  selected_budget_column integer,
  selected_budget_label text NOT NULL DEFAULT '',
  sample_headers jsonb NOT NULL DEFAULT '[]'::jsonb,
  amount_choices jsonb NOT NULL DEFAULT '[]'::jsonb,
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  last_used_at timestamptz,
  use_count integer NOT NULL DEFAULT 0 CHECK (use_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (btrim(name) <> ''),
  CHECK (normalized_name = lower(btrim(name)))
);

CREATE UNIQUE INDEX IF NOT EXISTS sov_mapping_profiles_org_name_unique
  ON public.sov_mapping_profiles (organization_id, normalized_name);

CREATE INDEX IF NOT EXISTS sov_mapping_profiles_org_updated_idx
  ON public.sov_mapping_profiles (organization_id, updated_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sov_mapping_profiles TO authenticated;
GRANT ALL ON public.sov_mapping_profiles TO service_role;

ALTER TABLE public.sov_mapping_profiles ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS sov_mapping_profiles_set_updated_at ON public.sov_mapping_profiles;
CREATE TRIGGER sov_mapping_profiles_set_updated_at
  BEFORE UPDATE ON public.sov_mapping_profiles
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

DROP POLICY IF EXISTS sov_mapping_profiles_member_select ON public.sov_mapping_profiles;
CREATE POLICY sov_mapping_profiles_member_select
  ON public.sov_mapping_profiles
  FOR SELECT
  TO authenticated
  USING (public.is_org_member(organization_id));

DROP POLICY IF EXISTS sov_mapping_profiles_member_insert ON public.sov_mapping_profiles;
CREATE POLICY sov_mapping_profiles_member_insert
  ON public.sov_mapping_profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_org_member(organization_id)
    AND created_by = (SELECT auth.uid())
  );

DROP POLICY IF EXISTS sov_mapping_profiles_member_update ON public.sov_mapping_profiles;
CREATE POLICY sov_mapping_profiles_member_update
  ON public.sov_mapping_profiles
  FOR UPDATE
  TO authenticated
  USING (public.is_org_member(organization_id))
  WITH CHECK (public.is_org_member(organization_id));

DROP POLICY IF EXISTS sov_mapping_profiles_member_delete ON public.sov_mapping_profiles;
CREATE POLICY sov_mapping_profiles_member_delete
  ON public.sov_mapping_profiles
  FOR DELETE
  TO authenticated
  USING (public.is_org_member(organization_id));
