-- GETTINGPAID1: receivables cockpit tracking columns.
--
-- Invoice send/view tracking (status chain: sent -> viewed -> paid),
-- collections activity log, configurable collections threshold, and the
-- application builder's Invoice vs AIA G702/G703 output choice.
--
-- Portable: additive columns only, IF NOT EXISTS everywhere, no seed data.
-- The viewed signal is written server-side when a client portal user opens
-- the invoice detail (no email open-tracking pixels by design).

ALTER TABLE public.billing_invoices
  ADD COLUMN IF NOT EXISTS sent_recipients jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS first_viewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_viewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS view_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS collections_log text NOT NULL DEFAULT '';

COMMENT ON COLUMN public.billing_invoices.sent_recipients IS
  'Email addresses the invoice was last sent to (jsonb string array), stamped by the send flow.';
COMMENT ON COLUMN public.billing_invoices.first_viewed_at IS
  'First client-portal open of this invoice detail, recorded server-side. Not an email pixel.';
COMMENT ON COLUMN public.billing_invoices.collections_log IS
  'Append-only plain-text collections activity log (called 7/12, promised payment, ...).';

-- Collections cue threshold: days past due before a "start collections"
-- flag shows on the receivables cockpit. Default 15 by founder decision.
ALTER TABLE public.organization_payment_profiles
  ADD COLUMN IF NOT EXISTS collections_overdue_days integer NOT NULL DEFAULT 15;

-- Application output choice: invoice (default) or formal AIA G702/G703.
-- Companies that never pick AIA never see AIA fields beyond this choice.
ALTER TABLE public.billing_applications
  ADD COLUMN IF NOT EXISTS output_format text NOT NULL DEFAULT 'invoice';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'billing_applications_output_format_check'
  ) THEN
    ALTER TABLE public.billing_applications
      ADD CONSTRAINT billing_applications_output_format_check
      CHECK (output_format IN ('invoice', 'aia_g702'));
  END IF;
END $$;
