-- Payments Phase 1: payment_ledger is THE payments table.
-- This migration brings it up to the Phase 1 contract instead of forking a
-- duplicate payments table: integer-cents amount, currency, free-text
-- reference (check number, wire confirmation, ACH trace), and organization_id
-- so payments roll up per company without a join through projects.
--
-- Payment record state machine (payment_ledger.status):
--   source 'manual'  (processor = 'manual'): created as 'succeeded' -- an
--     authorized user with billing.manage attesting funds already arrived
--     (wire/ACH/check/other). May move to 'refunded' or 'void'.
--   source 'stripe'  (processor = 'stripe'/'stripe_connect'): flows
--     pending -> succeeded | failed, and succeeded -> refunded on
--     charge.refunded. 'failed' and 'void' are terminal.
-- Invoices are never marked paid from client-side code: only server functions
-- acting on verified Stripe webhook events or an authorized manual record
-- update billing_invoices.paid_amount/status.

ALTER TABLE public.payment_ledger
  ADD COLUMN IF NOT EXISTS amount_cents bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'usd',
  ADD COLUMN IF NOT EXISTS reference text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.payment_ledger.status IS
  'Payment state machine. manual: created succeeded, -> refunded|void. stripe: pending -> succeeded|failed, succeeded -> refunded. failed/void terminal.';
COMMENT ON COLUMN public.payment_ledger.amount_cents IS
  'Canonical integer-cents amount. Legacy numeric amount column mirrors it in dollars for older readers.';

-- Backfill cents from the legacy dollar amounts (numeric is exact; round
-- handles any sub-cent artifacts from old fee math).
UPDATE public.payment_ledger
SET amount_cents = ROUND(amount * 100)
WHERE amount_cents = 0
  AND amount <> 0;

-- Backfill organization_id through the owning project.
UPDATE public.payment_ledger pl
SET organization_id = p.organization_id
FROM public.projects p
WHERE pl.project_id = p.id
  AND pl.organization_id IS NULL
  AND p.organization_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS payment_ledger_organization_idx
  ON public.payment_ledger (organization_id, paid_at DESC);

-- Per-invoice payment method toggles. Empty object = inherit the company
-- defaults from organization_payment_profiles.default_payment_methods at
-- render time. Keys: direct_bank, card, ach_debit,
-- allow_stripe_over_threshold (deliberate override of the Stripe amount
-- guardrail for this one invoice).
ALTER TABLE public.billing_invoices
  ADD COLUMN IF NOT EXISTS enabled_payment_methods jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.billing_invoices.enabled_payment_methods IS
  'Per-invoice payment method toggles (direct_bank/card/ach_debit/allow_stripe_over_threshold). {} inherits company defaults.';
