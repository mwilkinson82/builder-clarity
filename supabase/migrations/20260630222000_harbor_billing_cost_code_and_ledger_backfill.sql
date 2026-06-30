-- Repair legacy Harbor billing sample data that was created before cost codes
-- and cost-ledger rows were fully wired into the billing workspace.

WITH code_map(bucket_name, cost_code) AS (
  VALUES
    ('Sitework', '0100'),
    ('Structure', '0300'),
    ('Envelope', '0700'),
    ('MEP', '1500'),
    ('Finishes', '0900'),
    ('GC/OH', '0130'),
    ('Schedule Compression for Window Delivery (Acceleration)', 'CO-001'),
    ('Change Order - Window Package', 'CO-002'),
    ('Unallocated approved change orders', 'CO-999')
)
UPDATE public.cost_buckets cb
SET cost_code = cm.cost_code
FROM public.projects p, code_map cm
WHERE cb.project_id = p.id
  AND (p.name = 'Harbor Residence' OR p.job_number = 'DEMO-HARBOR')
  AND lower(cb.bucket) = lower(cm.bucket_name)
  AND COALESCE(NULLIF(cb.cost_code, ''), '') = ''
  AND NOT EXISTS (
    SELECT 1
    FROM public.cost_buckets existing
    WHERE existing.project_id = cb.project_id
      AND lower(existing.cost_code) = lower(cm.cost_code)
      AND existing.id <> cb.id
  );

WITH code_map(bucket_name, cost_code) AS (
  VALUES
    ('Sitework', '0100'),
    ('Structure', '0300'),
    ('Envelope', '0700'),
    ('MEP', '1500'),
    ('Finishes', '0900'),
    ('GC/OH', '0130'),
    ('Schedule Compression for Window Delivery (Acceleration)', 'CO-001'),
    ('Change Order - Window Package', 'CO-002'),
    ('Unallocated approved change orders', 'CO-999')
),
line_codes AS (
  SELECT
    bli.id,
    COALESCE(NULLIF(cb.cost_code, ''), cm.cost_code) AS cost_code
  FROM public.billing_line_items bli
  JOIN public.projects p
    ON p.id = bli.project_id
  LEFT JOIN public.cost_buckets cb
    ON cb.id = bli.cost_bucket_id
  LEFT JOIN code_map cm
    ON lower(cm.bucket_name) = lower(bli.description)
  WHERE (p.name = 'Harbor Residence' OR p.job_number = 'DEMO-HARBOR')
    AND COALESCE(NULLIF(bli.cost_code, ''), '') = ''
    AND COALESCE(NULLIF(cb.cost_code, ''), NULLIF(cm.cost_code, '')) IS NOT NULL
)
UPDATE public.billing_line_items bli
SET cost_code = line_codes.cost_code
FROM line_codes
WHERE bli.id = line_codes.id;

WITH approved_co AS (
  SELECT
    co.id AS change_order_id,
    co.project_id,
    cb.id AS cost_bucket_id,
    cb.cost_code,
    co.number || ' - ' || co.description AS description,
    co.contract_amount,
    co.cost_amount
  FROM public.change_orders co
  JOIN public.projects p
    ON p.id = co.project_id
  JOIN public.cost_buckets cb
    ON cb.project_id = co.project_id
   AND lower(cb.bucket) = lower('Finishes')
  WHERE (p.name = 'Harbor Residence' OR p.job_number = 'DEMO-HARBOR')
    AND co.number = 'CO-002'
    AND co.status = 'Approved'
    AND NOT EXISTS (
      SELECT 1
      FROM public.change_order_allocations existing
      WHERE existing.change_order_id = co.id
    )
)
INSERT INTO public.change_order_allocations (
  project_id,
  change_order_id,
  cost_bucket_id,
  cost_code,
  description,
  contract_amount,
  cost_amount
)
SELECT
  project_id,
  change_order_id,
  cost_bucket_id,
  cost_code,
  description,
  contract_amount,
  cost_amount
FROM approved_co;

UPDATE public.change_order_allocations coa
SET cost_code = cb.cost_code
FROM public.cost_buckets cb
JOIN public.projects p
  ON p.id = cb.project_id
WHERE coa.cost_bucket_id = cb.id
  AND coa.project_id = p.id
  AND (p.name = 'Harbor Residence' OR p.job_number = 'DEMO-HARBOR')
  AND COALESCE(NULLIF(coa.cost_code, ''), '') = ''
  AND cb.cost_code <> '';

WITH approved_allocations AS (
  SELECT
    coa.project_id,
    coa.cost_bucket_id,
    round(sum(coa.contract_amount) * 100)::bigint AS contract_cents
  FROM public.change_order_allocations coa
  JOIN public.change_orders co
    ON co.id = coa.change_order_id
  JOIN public.projects p
    ON p.id = coa.project_id
  WHERE coa.cost_bucket_id IS NOT NULL
    AND co.status = 'Approved'
    AND (p.name = 'Harbor Residence' OR p.job_number = 'DEMO-HARBOR')
  GROUP BY coa.project_id, coa.cost_bucket_id
)
UPDATE public.billing_line_items bli
SET change_order_value_cents = aa.contract_cents
FROM approved_allocations aa
WHERE bli.project_id = aa.project_id
  AND bli.cost_bucket_id = aa.cost_bucket_id
  AND bli.change_order_value_cents = 0;

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
    COALESCE(NULLIF(cb.cost_code, ''), sr.cost_code) AS cost_code,
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
    ON lower(cb.cost_code) = lower(sr.cost_code)
    OR lower(cb.bucket) = lower(sr.bucket_name)
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
  bucket_name || ' beta QA cost ledger row',
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
