-- AI credits ledger (AITAKEOFF1 Task 0).
-- Balance = SUM(delta), append-only, never updated — same discipline as
-- payment_ledger. Positive deltas are grants/purchases, negative deltas are
-- spends. Members read their org's ledger; every write happens server-side
-- with the service role (no INSERT/UPDATE/DELETE for authenticated).
-- reason is text + CHECK (not an enum) so replayed seeds never hit the
-- INSERT ... SELECT enum-cast trap documented in AGENTS.md.

CREATE TABLE IF NOT EXISTS public.credit_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  delta integer NOT NULL CHECK (delta <> 0),
  reason text NOT NULL CHECK (
    reason IN ('signup_grant', 'purchase', 'ai_count_scan', 'refund', 'admin_adjustment')
  ),
  -- Free-text pointer to what produced the entry: an ai_operations id, a
  -- Stripe checkout session id, or 'signup:<org id>' for grants.
  reference text NOT NULL DEFAULT '',
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.credit_ledger IS
  'Append-only AI credit ledger. Balance is SUM(delta) per organization. Rows are never updated or deleted; corrections are compensating entries (reason refund / admin_adjustment).';
COMMENT ON COLUMN public.credit_ledger.reference IS
  'Operation id (ai_count_scan/refund), Stripe checkout session id (purchase), or signup:<org id> (signup_grant).';

CREATE INDEX IF NOT EXISTS credit_ledger_org_created_idx
  ON public.credit_ledger (organization_id, created_at DESC);

-- One purchase entry per Stripe checkout session: the webhook can replay
-- without double-crediting.
CREATE UNIQUE INDEX IF NOT EXISTS credit_ledger_purchase_reference_key
  ON public.credit_ledger (reference)
  WHERE reason = 'purchase';

-- One signup grant per organization: the trigger and the backfill below can
-- both run without double-granting.
CREATE UNIQUE INDEX IF NOT EXISTS credit_ledger_signup_grant_org_key
  ON public.credit_ledger (organization_id)
  WHERE reason = 'signup_grant';

ALTER TABLE public.credit_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS credit_ledger_members_read ON public.credit_ledger;
CREATE POLICY credit_ledger_members_read ON public.credit_ledger
  FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id));

REVOKE ALL ON public.credit_ledger FROM anon;
REVOKE ALL ON public.credit_ledger FROM authenticated;
GRANT SELECT ON public.credit_ledger TO authenticated;

-- Signup grant: 50 credits the moment an organization is created.
CREATE OR REPLACE FUNCTION public.grant_signup_credits()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.credit_ledger (organization_id, delta, reason, reference)
  VALUES (NEW.id, 50, 'signup_grant', 'signup:' || NEW.id)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.grant_signup_credits() FROM PUBLIC;

DROP TRIGGER IF EXISTS tg_organizations_signup_credits ON public.organizations;
CREATE TRIGGER tg_organizations_signup_credits
  AFTER INSERT ON public.organizations
  FOR EACH ROW
  EXECUTE FUNCTION public.grant_signup_credits();

-- One-time backfill: every existing organization gets the same 50-credit
-- signup grant. Guarded so replays and partially granted environments no-op.
INSERT INTO public.credit_ledger (organization_id, delta, reason, reference)
SELECT o.id, 50, 'signup_grant', 'signup:' || o.id
FROM public.organizations o
WHERE NOT EXISTS (
  SELECT 1
  FROM public.credit_ledger l
  WHERE l.organization_id = o.id
    AND l.reason = 'signup_grant'
)
ON CONFLICT DO NOTHING;
