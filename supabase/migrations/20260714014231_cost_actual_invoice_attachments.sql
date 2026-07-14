-- Keep the supplier invoice image/PDF beside the cost actual it supports.
-- Bytes live in the existing private `project-docs` bucket; these columns are
-- the durable pointer and display metadata used by the Billing cost ledger.
-- Multiple cost-code rows from one invoice may intentionally share one path.

ALTER TABLE public.cost_actuals
  ADD COLUMN IF NOT EXISTS invoice_attachment_path text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS invoice_attachment_name text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS invoice_attachment_type text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS invoice_attachment_size bigint NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'cost_actuals_invoice_attachment_size_nonnegative'
      AND conrelid = 'public.cost_actuals'::regclass
  ) THEN
    ALTER TABLE public.cost_actuals
      ADD CONSTRAINT cost_actuals_invoice_attachment_size_nonnegative
      CHECK (invoice_attachment_size >= 0);
  END IF;
END;
$$;

COMMENT ON COLUMN public.cost_actuals.invoice_attachment_path IS
  'Private Supabase Storage object path in the project-docs bucket.';
COMMENT ON COLUMN public.cost_actuals.invoice_attachment_name IS
  'Original supplier invoice image or PDF filename.';
