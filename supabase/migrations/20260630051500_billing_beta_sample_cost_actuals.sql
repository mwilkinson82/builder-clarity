-- Seed Harbor Residence with visible cost actual rows for Billing/WIP beta QA.
-- Existing demo buckets already carry actual_to_date totals, so this migration
-- backs the sample amount out first and lets the cost_actuals trigger restore it.

WITH sample_rows AS (
  SELECT *
  FROM (
    VALUES
      (
        '0100',
        'Sitework',
        'subcontract',
        42500::numeric,
        'Bay Civil',
        'AP-1007',
        '2026-06-30'::date,
        'paid',
        'Excavation and drainage draw entered for beta billing QA.',
        'harbor-beta-cost:sitework:ap-1007'
      ),
      (
        '0300',
        'Structure',
        'subcontract',
        76000::numeric,
        'Northline Framing',
        'AP-1014',
        '2026-06-30'::date,
        'paid',
        'Framing progress draw entered for beta billing QA.',
        'harbor-beta-cost:structure:ap-1014'
      ),
      (
        '1500',
        'MEP',
        'subcontract',
        68000::numeric,
        'Harbor Mechanical',
        'COM-221',
        '2026-06-30'::date,
        'committed',
        'Rough-in commitment entered for beta billing QA.',
        'harbor-beta-cost:mep:com-221'
      ),
      (
        '0900',
        'Finishes',
        'material',
        38500::numeric,
        'Seaside Millwork',
        'PO-443',
        '2026-06-30'::date,
        'committed',
        'Millwork deposit entered for beta billing QA.',
        'harbor-beta-cost:finishes:po-443'
      )
  ) AS row_data(
    cost_code,
    bucket_name,
    category,
    amount,
    vendor,
    reference_number,
    cost_date,
    status,
    notes,
    source_external_id
  )
),
target_rows AS (
  SELECT
    p.id AS project_id,
    cb.id AS cost_bucket_id,
    cb.cost_code,
    sr.bucket_name,
    sr.category,
    sr.amount,
    sr.vendor,
    sr.reference_number,
    sr.cost_date,
    sr.status,
    sr.notes,
    sr.source_external_id
  FROM public.projects p
  JOIN public.cost_buckets cb
    ON cb.project_id = p.id
  JOIN sample_rows sr
    ON lower(COALESCE(NULLIF(cb.cost_code, ''), cb.bucket)) =
       lower(COALESCE(NULLIF(sr.cost_code, ''), sr.bucket_name))
  WHERE (p.name = 'Harbor Residence' OR p.job_number = 'DEMO-HARBOR')
    AND NOT EXISTS (
      SELECT 1
      FROM public.cost_actuals ca
      WHERE ca.project_id = p.id
        AND ca.source_external_id = sr.source_external_id
    )
),
bucket_adjustments AS (
  SELECT cost_bucket_id, sum(amount) AS amount
  FROM target_rows
  GROUP BY cost_bucket_id
),
adjust_bucket_actuals AS (
  UPDATE public.cost_buckets cb
  SET actual_to_date = GREATEST(0, COALESCE(cb.actual_to_date, 0) - ba.amount)
  FROM bucket_adjustments ba
  WHERE cb.id = ba.cost_bucket_id
  RETURNING cb.id
)
INSERT INTO public.cost_actuals (
  project_id,
  cost_bucket_id,
  cost_code,
  description,
  category,
  amount,
  vendor,
  reference_number,
  source_external_id,
  cost_date,
  status,
  notes
)
SELECT
  project_id,
  cost_bucket_id,
  cost_code,
  bucket_name || ' beta QA cost actual',
  category,
  amount,
  vendor,
  reference_number,
  source_external_id,
  cost_date,
  status,
  notes
FROM target_rows
ON CONFLICT DO NOTHING;
