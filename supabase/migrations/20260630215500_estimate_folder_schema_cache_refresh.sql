ALTER TABLE public.estimates
  ADD COLUMN IF NOT EXISTS folder varchar(48) NOT NULL DEFAULT 'sales_process';

ALTER TABLE public.estimates
  DROP CONSTRAINT IF EXISTS estimates_folder_check;

ALTER TABLE public.estimates
  ADD CONSTRAINT estimates_folder_check
  CHECK (folder IN ('sales_process', 'won', 'not_won', 'archived'));

CREATE INDEX IF NOT EXISTS idx_estimates_org_folder_updated
  ON public.estimates(organization_id, folder, updated_at DESC);

NOTIFY pgrst, 'reload schema';
