ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS job_number text NOT NULL DEFAULT '';

ALTER TABLE public.cost_buckets
  ADD COLUMN IF NOT EXISTS source_type text NOT NULL DEFAULT 'original_sov',
  ADD COLUMN IF NOT EXISTS source_date date,
  ADD COLUMN IF NOT EXISTS source_note text NOT NULL DEFAULT '';

ALTER TABLE public.schedule_risks
  ADD COLUMN IF NOT EXISTS dollar_exposure numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS probability numeric NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS schedule_impact_weeks numeric,
  ADD COLUMN IF NOT EXISTS owner text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS due_date date,
  ADD COLUMN IF NOT EXISTS response_path public.response_path NOT NULL DEFAULT 'recover',
  ADD COLUMN IF NOT EXISTS hold_class public.hold_class NOT NULL DEFAULT 'E-Hold',
  ADD COLUMN IF NOT EXISTS linked_exposure_id uuid REFERENCES public.exposures(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.billing_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  application_number text NOT NULL DEFAULT '',
  invoice_number text NOT NULL DEFAULT '',
  submitted_date date,
  due_date date,
  billing_period text NOT NULL DEFAULT '',
  contract_amount numeric NOT NULL DEFAULT 0,
  change_order_amount numeric NOT NULL DEFAULT 0,
  amount_billed numeric NOT NULL DEFAULT 0,
  paid_to_date numeric NOT NULL DEFAULT 0,
  retainage numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft',
  notes text NOT NULL DEFAULT '',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.billing_applications TO authenticated;
GRANT ALL ON public.billing_applications TO service_role;

ALTER TABLE public.billing_applications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS billing_applications_owner_via_project ON public.billing_applications;

CREATE POLICY billing_applications_owner_via_project ON public.billing_applications
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = billing_applications.project_id
        AND p.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = billing_applications.project_id
        AND p.owner_id = auth.uid()
    )
  );

DROP TRIGGER IF EXISTS billing_applications_set_updated_at ON public.billing_applications;

CREATE TRIGGER billing_applications_set_updated_at
  BEFORE UPDATE ON public.billing_applications
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE INDEX IF NOT EXISTS billing_applications_project_id_idx
  ON public.billing_applications(project_id);

UPDATE public.projects
SET job_number = 'HR-2601'
WHERE name = 'Harbor Residence'
  AND job_number = '';

UPDATE public.cost_buckets
SET source_type = 'original_sov',
    source_date = created_at::date
WHERE source_date IS NULL;

INSERT INTO public.billing_applications (
  project_id,
  application_number,
  invoice_number,
  submitted_date,
  due_date,
  billing_period,
  contract_amount,
  change_order_amount,
  amount_billed,
  paid_to_date,
  retainage,
  status,
  sort_order
)
SELECT
  p.id,
  'Pay App 006',
  'INV-' || COALESCE(NULLIF(p.job_number, ''), substring(p.id::text from 1 for 8)),
  current_date - 9,
  current_date + 21,
  'Current cycle',
  p.original_contract,
  210000,
  round((p.original_contract + 210000) * (p.percent_complete / 100.0)),
  round((p.original_contract + 210000) * (p.percent_complete / 100.0) * 0.85),
  round((p.original_contract + 210000) * (p.percent_complete / 100.0) * 0.10),
  'submitted',
  1
FROM public.projects p
WHERE p.name = 'Harbor Residence'
  AND NOT EXISTS (
    SELECT 1 FROM public.billing_applications b
    WHERE b.project_id = p.id
  );
