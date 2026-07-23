-- Stop synthesizing public logo URLs for organizations that have never
-- uploaded a logo, while preserving the handful of legacy canonical logo
-- objects created before organizations.logo_path was populated.

UPDATE public.organizations AS organization
SET logo_path = object.name
FROM storage.objects AS object
WHERE object.bucket_id = 'company-assets'
  AND object.name = organization.id::text || '/logo'
  AND coalesce(nullif(btrim(organization.logo_path), ''), '') = '';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.organizations AS organization
    JOIN storage.objects AS object
      ON object.bucket_id = 'company-assets'
     AND object.name = organization.id::text || '/logo'
    WHERE coalesce(nullif(btrim(organization.logo_path), ''), '') = ''
  ) THEN
    RAISE EXCEPTION 'canonical company logo path backfill did not converge';
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';