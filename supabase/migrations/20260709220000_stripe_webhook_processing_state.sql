-- STRIPEIDEMPOTENCY1: record webhook processing OUTCOME, not just the sighting.
--
-- Before this migration, a row in stripe_webhook_events meant only "I have seen
-- this event id" -- it was inserted before the handler ran and deleted (best
-- effort) on failure. When that delete failed, the surviving row made the next
-- Stripe retry look like a duplicate: 200 OK, work never done, nobody told.
--
-- The fix: a row is only 'processed' once its handler ran to completion. A row
-- still 'processing' after a failure is re-taken by the next retry. Existing
-- rows default to 'processed' so they keep their current "already handled, skip"
-- meaning -- no data rewrite, no reconciliation owed.

ALTER TABLE public.stripe_webhook_events
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'processed'
    CHECK (status IN ('processing', 'processed'));

ALTER TABLE public.stripe_webhook_events
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz NOT NULL DEFAULT now();

-- processed_at stays; it now means "when processing finished". Legacy rows keep
-- their original value (they were written at completion under the old flow).

-- Stale-claim sweep: the retry path scans for 'processing' rows older than the
-- stale window to re-take them.
CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_status_claimed_at
  ON public.stripe_webhook_events (status, claimed_at);
