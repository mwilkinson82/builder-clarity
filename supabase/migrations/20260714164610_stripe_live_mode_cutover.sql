-- Keep Stripe sandbox and live connected accounts physically separate.
-- Stripe objects never cross modes; an acct_ created with test credentials
-- cannot receive live money. Existing Overwatch connections were all created
-- in sandbox, so the legacy values backfill into the _test slots only.

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS stripe_connect_account_id_test text,
  ADD COLUMN IF NOT EXISTS stripe_connect_status_test text,
  ADD COLUMN IF NOT EXISTS stripe_connect_account_id_live text,
  ADD COLUMN IF NOT EXISTS stripe_connect_status_live text;

ALTER TABLE public.organizations
  ALTER COLUMN stripe_connect_account_id_test SET DEFAULT '',
  ALTER COLUMN stripe_connect_status_test SET DEFAULT 'not_connected',
  ALTER COLUMN stripe_connect_account_id_live SET DEFAULT '',
  ALTER COLUMN stripe_connect_status_live SET DEFAULT 'not_connected';

UPDATE public.organizations
SET
  stripe_connect_account_id_test = CASE
    WHEN stripe_mode = 'test' AND COALESCE(stripe_connect_account_id_test, '') = ''
      THEN COALESCE(stripe_connect_account_id, '')
    ELSE COALESCE(stripe_connect_account_id_test, '')
  END,
  stripe_connect_status_test = CASE
    WHEN stripe_mode = 'test'
      AND COALESCE(stripe_connect_status_test, 'not_connected') = 'not_connected'
      THEN COALESCE(NULLIF(stripe_connect_status, ''), 'not_connected')
    ELSE COALESCE(NULLIF(stripe_connect_status_test, ''), 'not_connected')
  END,
  stripe_connect_account_id_live = CASE
    WHEN stripe_mode = 'live' AND COALESCE(stripe_connect_account_id_live, '') = ''
      THEN COALESCE(stripe_connect_account_id, '')
    ELSE COALESCE(stripe_connect_account_id_live, '')
  END,
  stripe_connect_status_live = CASE
    WHEN stripe_mode = 'live'
      AND COALESCE(stripe_connect_status_live, 'not_connected') = 'not_connected'
      THEN COALESCE(NULLIF(stripe_connect_status, ''), 'not_connected')
    ELSE COALESCE(NULLIF(stripe_connect_status_live, ''), 'not_connected')
  END;

ALTER TABLE public.organizations
  ALTER COLUMN stripe_connect_account_id_test SET NOT NULL,
  ALTER COLUMN stripe_connect_status_test SET NOT NULL,
  ALTER COLUMN stripe_connect_account_id_live SET NOT NULL,
  ALTER COLUMN stripe_connect_status_live SET NOT NULL;

CREATE INDEX IF NOT EXISTS organizations_stripe_connect_account_id_test_idx
  ON public.organizations (stripe_connect_account_id_test)
  WHERE stripe_connect_account_id_test <> '';

CREATE INDEX IF NOT EXISTS organizations_stripe_connect_account_id_live_idx
  ON public.organizations (stripe_connect_account_id_live)
  WHERE stripe_connect_account_id_live <> '';

COMMENT ON COLUMN public.organizations.stripe_connect_account_id_test IS
  'Stripe Connect account created with sandbox/test credentials.';
COMMENT ON COLUMN public.organizations.stripe_connect_account_id_live IS
  'Stripe Connect account created with live credentials. Never falls back to the test account.';

-- Every webhook endpoint signs the original Stripe Event, whose livemode
-- field is the authoritative test/live tag. Existing rows predate live launch
-- and are therefore backfilled false. New rows are always stamped by code.
ALTER TABLE public.stripe_webhook_events
  ADD COLUMN IF NOT EXISTS livemode boolean;

UPDATE public.stripe_webhook_events
SET livemode = false
WHERE livemode IS NULL;

CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_livemode_processed_at
  ON public.stripe_webhook_events (livemode, processed_at DESC);

COMMENT ON COLUMN public.stripe_webhook_events.livemode IS
  'Copied from Stripe event.livemode after signature verification.';
