ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS legal_name text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS website_url text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS office_phone text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS address_line1 text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS address_line2 text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS city text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS state text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS postal_code text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS country text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS license_number text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS tax_identifier text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS logo_url text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS logo_path text NOT NULL DEFAULT '';

COMMENT ON COLUMN public.organizations.logo_url IS
  'Public URL for the company logo used in app headers, PDFs, and print output.';
COMMENT ON COLUMN public.organizations.logo_path IS
  'Supabase Storage object path in the company-assets bucket.';

CREATE OR REPLACE FUNCTION public.storage_organization_id(p_name text)
RETURNS uuid
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_first text;
BEGIN
  v_first := split_part(coalesce(p_name, ''), '/', 1);
  IF v_first ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN v_first::uuid;
  END IF;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.storage_organization_id(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.storage_organization_id(text) TO authenticated;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'company-assets',
  'company-assets',
  true,
  2097152,
  ARRAY['image/png', 'image/jpeg']::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS company_assets_team_insert ON storage.objects;
CREATE POLICY company_assets_team_insert
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'company-assets'
    AND public.can_manage_org(public.storage_organization_id(name))
  );

DROP POLICY IF EXISTS company_assets_team_update ON storage.objects;
CREATE POLICY company_assets_team_update
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'company-assets'
    AND public.can_manage_org(public.storage_organization_id(name))
  )
  WITH CHECK (
    bucket_id = 'company-assets'
    AND public.can_manage_org(public.storage_organization_id(name))
  );

DROP POLICY IF EXISTS company_assets_team_delete ON storage.objects;
CREATE POLICY company_assets_team_delete
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'company-assets'
    AND public.can_manage_org(public.storage_organization_id(name))
  );

NOTIFY pgrst, 'reload schema';
