-- First production guardrails for connected-account payments.
--
-- Every company begins with a conservative $25,000 hard ceiling. Company
-- payment preferences may be lower, but neither a company setting nor an
-- invoice override can exceed this value. Raising it is an OverWatch support
-- action only after the connected company has obtained Stripe approval.

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS stripe_payment_limit_cents bigint NOT NULL DEFAULT 2500000;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'organizations_stripe_payment_limit_cents_check'
      AND conrelid = 'public.organizations'::regclass
  ) THEN
    ALTER TABLE public.organizations
      ADD CONSTRAINT organizations_stripe_payment_limit_cents_check
      CHECK (stripe_payment_limit_cents > 0 AND stripe_payment_limit_cents <= 10000000000);
  END IF;
END $$;

COMMENT ON COLUMN public.organizations.stripe_payment_limit_cents IS
  'Hard per-payment ceiling enforced by OverWatch in addition to Stripe account limits. Support raises it only after Stripe approval.';

-- A company can ask OverWatch to review a higher limit, but OverWatch cannot
-- approve Stripe underwriting. The requester must first work with Stripe from
-- the connected account Dashboard and provide the approval/reference here.
CREATE TABLE IF NOT EXISTS public.stripe_limit_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  current_limit_cents bigint NOT NULL,
  requested_limit_cents bigint NOT NULL,
  reason text NOT NULL DEFAULT '',
  stripe_request_reference text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'submitted',
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stripe_limit_requests_amounts_check CHECK (
    current_limit_cents > 0
    AND requested_limit_cents > current_limit_cents
    AND requested_limit_cents <= 10000000000
  ),
  CONSTRAINT stripe_limit_requests_status_check CHECK (
    status IN ('submitted', 'stripe_pending', 'under_review', 'approved', 'declined', 'cancelled')
  )
);

CREATE INDEX IF NOT EXISTS stripe_limit_requests_org_created_idx
  ON public.stripe_limit_requests (organization_id, created_at DESC);

DROP TRIGGER IF EXISTS stripe_limit_requests_set_updated_at
  ON public.stripe_limit_requests;
CREATE TRIGGER stripe_limit_requests_set_updated_at
  BEFORE UPDATE ON public.stripe_limit_requests
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE UNIQUE INDEX IF NOT EXISTS stripe_limit_requests_one_open_per_org_idx
  ON public.stripe_limit_requests (organization_id)
  WHERE status IN ('submitted', 'stripe_pending', 'under_review');

ALTER TABLE public.stripe_limit_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS stripe_limit_requests_billing_read ON public.stripe_limit_requests;
CREATE POLICY stripe_limit_requests_billing_read
  ON public.stripe_limit_requests
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.organization_memberships m
      WHERE m.organization_id = stripe_limit_requests.organization_id
        AND m.user_id = (SELECT auth.uid())
        AND m.status = 'active'
        AND (
          m.role IN ('owner', 'admin')
          OR m.capabilities @> '{"billing.manage": true}'::jsonb
        )
    )
  );

DROP POLICY IF EXISTS stripe_limit_requests_billing_insert ON public.stripe_limit_requests;
CREATE POLICY stripe_limit_requests_billing_insert
  ON public.stripe_limit_requests
  FOR INSERT
  TO authenticated
  WITH CHECK (
    requested_by = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1
      FROM public.organization_memberships m
      WHERE m.organization_id = stripe_limit_requests.organization_id
        AND m.user_id = (SELECT auth.uid())
        AND m.status = 'active'
        AND (
          m.role IN ('owner', 'admin')
          OR m.capabilities @> '{"billing.manage": true}'::jsonb
        )
    )
  );

-- No authenticated UPDATE policy: approval and the organization limit change
-- are support/service-role operations after Stripe approval is verified.
GRANT SELECT, INSERT ON public.stripe_limit_requests TO authenticated;
GRANT ALL ON public.stripe_limit_requests TO service_role;

COMMENT ON TABLE public.stripe_limit_requests IS
  'Company requests for OverWatch to review a higher online-payment ceiling after Stripe approval.';

-- Webhook retries must be able to re-attempt notification delivery after the
-- money ledger was already booked. This key makes the insert idempotent across
-- distinct Stripe deliveries for the same successful Checkout Session.
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS dedupe_key text;

CREATE UNIQUE INDEX IF NOT EXISTS notifications_recipient_dedupe_key_idx
  ON public.notifications (recipient_id, dedupe_key);

COMMENT ON COLUMN public.notifications.dedupe_key IS
  'Producer-supplied idempotency key scoped to one recipient; null means no dedupe contract.';
