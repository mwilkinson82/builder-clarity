-- Payments Phase 1: Stripe webhook idempotency.
-- Every verified webhook event id is recorded here before processing. A
-- duplicate delivery hits the primary-key conflict, the handler sees the
-- event was already processed, and no-ops with a 2xx so Stripe stops
-- retrying. Processing failures roll no rows in here (insert happens first,
-- but the handler deletes the marker on failure) -- failures return non-2xx
-- so Stripe retries.

CREATE TABLE IF NOT EXISTS public.stripe_webhook_events (
  event_id text PRIMARY KEY,
  event_type text NOT NULL DEFAULT '',
  processed_at timestamptz NOT NULL DEFAULT now()
);

-- Service-role only: the webhook route writes with the admin client. RLS on
-- with no policies denies anon/authenticated entirely.
ALTER TABLE public.stripe_webhook_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.stripe_webhook_events FROM anon;
REVOKE ALL ON public.stripe_webhook_events FROM authenticated;
