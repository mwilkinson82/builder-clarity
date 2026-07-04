-- AI operations log (AITAKEOFF1 Task 0).
-- One row per AI operation (Phase A: count scans). This table IS the margin
-- dashboard: credits_charged (what the org paid in credits) vs api_cost_cents
-- (what the Anthropic call actually cost, computed from the config price
-- table). Members read their org's operations; writes are server-only.

CREATE TABLE IF NOT EXISTS public.ai_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  operation_type text NOT NULL DEFAULT 'ai_count_scan' CHECK (
    operation_type IN ('ai_count_scan')
  ),
  estimate_id uuid REFERENCES public.estimates(id) ON DELETE SET NULL,
  sheet_ids uuid[] NOT NULL DEFAULT '{}',
  -- How many of sheet_ids finished scanning. Drives partial refunds: a
  -- failed operation refunds credits_charged minus one credit per completed
  -- sheet (compensating credit_ledger entry, reason 'refund').
  sheets_completed integer NOT NULL DEFAULT 0,
  model_used text NOT NULL DEFAULT '',
  input_tokens bigint NOT NULL DEFAULT 0,
  output_tokens bigint NOT NULL DEFAULT 0,
  api_cost_cents integer NOT NULL DEFAULT 0,
  credits_charged integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'succeeded', 'failed')
  ),
  error text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.ai_operations IS
  'Durable record of AI-assisted operations. credits_charged vs api_cost_cents is the founder''s margin view. Proposals themselves are session-scoped and never persisted.';

CREATE INDEX IF NOT EXISTS ai_operations_org_created_idx
  ON public.ai_operations (organization_id, created_at DESC);

ALTER TABLE public.ai_operations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_operations_members_read ON public.ai_operations;
CREATE POLICY ai_operations_members_read ON public.ai_operations
  FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id));

REVOKE ALL ON public.ai_operations FROM anon;
REVOKE ALL ON public.ai_operations FROM authenticated;
GRANT SELECT ON public.ai_operations TO authenticated;
