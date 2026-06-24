ALTER TABLE public.daily_reports
  ADD COLUMN IF NOT EXISTS manpower text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS visitors text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS quality_notes text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS client_visible boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS attachment_manifest jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS attachment_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS attachment_bytes bigint NOT NULL DEFAULT 0;

DO $$
BEGIN
  ALTER TABLE public.daily_reports
    ADD CONSTRAINT daily_reports_attachment_count_nonnegative
    CHECK (attachment_count >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.daily_reports
    ADD CONSTRAINT daily_reports_attachment_bytes_nonnegative
    CHECK (attachment_bytes >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

UPDATE public.daily_reports
SET attachment_manifest = jsonb_build_array(
  jsonb_build_object(
    'name', attachment_name,
    'path', attachment_path,
    'type', attachment_type,
    'size', 0,
    'uploaded_at', created_at,
    'client_visible', client_visible
  )
)
WHERE attachment_path <> ''
  AND jsonb_array_length(attachment_manifest) = 0;

UPDATE public.daily_reports dr
SET
  attachment_count = jsonb_array_length(dr.attachment_manifest),
  attachment_bytes = COALESCE((
    SELECT SUM(
      CASE
        WHEN (item.value ->> 'size') ~ '^[0-9]+$'
          THEN (item.value ->> 'size')::bigint
        ELSE 0
      END
    )
    FROM jsonb_array_elements(dr.attachment_manifest) AS item(value)
  ), 0);

CREATE INDEX IF NOT EXISTS daily_reports_project_visibility_date_idx
  ON public.daily_reports(project_id, client_visible, report_date DESC);

NOTIFY pgrst, 'reload schema';
