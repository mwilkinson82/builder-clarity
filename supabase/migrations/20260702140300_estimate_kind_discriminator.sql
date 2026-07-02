-- estimates.kind: first-class discriminator between project estimates and
-- reusable master sheets. Until now master sheets were flagged by overloading
-- project_type = 'master_sheet'; after this migration project_type only ever
-- means project type again.

ALTER TABLE public.estimates
  ADD COLUMN IF NOT EXISTS kind varchar(16) NOT NULL DEFAULT 'estimate';

ALTER TABLE public.estimates
  DROP CONSTRAINT IF EXISTS estimates_kind_check;
ALTER TABLE public.estimates
  ADD CONSTRAINT estimates_kind_check CHECK (kind IN ('estimate', 'master_sheet'));

-- Backfill legacy master sheets (kind first, then release project_type).
UPDATE public.estimates
SET kind = 'master_sheet'
WHERE project_type = 'master_sheet'
  AND kind = 'estimate';

UPDATE public.estimates
SET project_type = 'commercial'
WHERE kind = 'master_sheet'
  AND project_type = 'master_sheet';

CREATE INDEX IF NOT EXISTS idx_estimates_org_kind
  ON public.estimates(organization_id, kind, updated_at DESC);
