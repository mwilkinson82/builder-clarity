-- Repair the Stripe commercial readiness schema for live environments that
-- missed the earlier billing migration before Stripe Connect was exposed.

ALTER TABLE public.subscription_plans
  ADD COLUMN IF NOT EXISTS stripe_product_id text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS stripe_price_id text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS checkout_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS billing_email text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS billing_contact_name text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS stripe_price_id text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS stripe_checkout_session_id text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS stripe_connect_account_id text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS stripe_connect_status text NOT NULL DEFAULT 'not_connected',
  ADD COLUMN IF NOT EXISTS subscription_current_period_end timestamptz,
  ADD COLUMN IF NOT EXISTS subscription_cancel_at_period_end boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS payment_processor_ready boolean NOT NULL DEFAULT false;

ALTER TABLE public.billing_invoices
  ADD COLUMN IF NOT EXISTS payment_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS payment_url text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS stripe_checkout_session_id text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS stripe_payment_intent_id text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS online_payment_status text NOT NULL DEFAULT 'not_enabled',
  ADD COLUMN IF NOT EXISTS payment_link_sent_at timestamptz;

ALTER TABLE public.payment_ledger
  ADD COLUMN IF NOT EXISTS stripe_checkout_session_id text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS stripe_payment_intent_id text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS stripe_charge_id text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS receipt_url text NOT NULL DEFAULT '';

ALTER TABLE public.organizations
  DROP CONSTRAINT IF EXISTS organizations_stripe_connect_status_check;

UPDATE public.organizations
SET stripe_connect_status = CASE
  WHEN stripe_connect_status IN ('onboarding_started', 'pending_review') THEN 'pending'
  WHEN stripe_connect_status IS NULL OR stripe_connect_status = '' THEN 'not_connected'
  ELSE stripe_connect_status
END;

ALTER TABLE public.organizations
  ADD CONSTRAINT organizations_stripe_connect_status_check
  CHECK (stripe_connect_status IN ('not_connected', 'pending', 'active', 'restricted', 'disabled'));

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'billing_invoices_online_payment_status_check'
  ) THEN
    ALTER TABLE public.billing_invoices
      ADD CONSTRAINT billing_invoices_online_payment_status_check
      CHECK (online_payment_status IN ('not_enabled', 'pending', 'paid', 'expired', 'failed', 'refunded'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS subscription_plans_stripe_price_id_idx
  ON public.subscription_plans(stripe_price_id)
  WHERE stripe_price_id <> '';

CREATE INDEX IF NOT EXISTS organizations_stripe_customer_id_idx
  ON public.organizations(stripe_customer_id)
  WHERE stripe_customer_id <> '';

CREATE INDEX IF NOT EXISTS organizations_stripe_subscription_id_idx
  ON public.organizations(stripe_subscription_id)
  WHERE stripe_subscription_id <> '';

CREATE INDEX IF NOT EXISTS organizations_stripe_connect_account_id_idx
  ON public.organizations(stripe_connect_account_id)
  WHERE stripe_connect_account_id <> '';

CREATE INDEX IF NOT EXISTS billing_invoices_stripe_checkout_session_id_idx
  ON public.billing_invoices(stripe_checkout_session_id)
  WHERE stripe_checkout_session_id <> '';

CREATE INDEX IF NOT EXISTS billing_invoices_stripe_payment_intent_id_idx
  ON public.billing_invoices(stripe_payment_intent_id)
  WHERE stripe_payment_intent_id <> '';

CREATE INDEX IF NOT EXISTS payment_ledger_stripe_payment_intent_id_idx
  ON public.payment_ledger(stripe_payment_intent_id)
  WHERE stripe_payment_intent_id <> '';

COMMENT ON COLUMN public.organizations.billing_email IS
  'Billing contact email used for Stripe Checkout and Connect setup.';

COMMENT ON COLUMN public.organizations.payment_processor_ready IS
  'True only after the company has a verified online payment path for client invoices.';

COMMENT ON COLUMN public.organizations.stripe_connect_account_id IS
  'Connected Stripe account that receives client invoice payouts.';
