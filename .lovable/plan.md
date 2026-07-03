
# Stripe test + live coexistence with per-org mode toggle

## Goal

Fire sandbox webhook tests today. Add live keys later without swapping secrets or touching code. Each Overwatch company (organization) chooses its own Stripe mode: `test` or `live`.

## Step 1 — Reset secrets

Delete the existing `STRIPE_SECRET_KEY` and start clean with explicitly named secrets.

**Sandbox now (you provide):**
- `STRIPE_SECRET_KEY_TEST` — sandbox `sk_test_...`
- `STRIPE_WEBHOOK_SECRET_TEST` — signing secret for the sandbox **account** webhook endpoint
- `STRIPE_CONNECT_WEBHOOK_SECRET_TEST` — signing secret for the sandbox **Connect** webhook endpoint

**Live later (added when you're ready, sandbox stays in place):**
- `STRIPE_SECRET_KEY_LIVE`
- `STRIPE_WEBHOOK_SECRET_LIVE`
- `STRIPE_CONNECT_WEBHOOK_SECRET_LIVE`

Nothing is ever deleted when going live. Both environments stay available so you can fall back instantly.

## Step 2 — Per-organization mode toggle

Add a `stripe_mode` column to the `organizations` table (enum: `test` | `live`, default `test`). Migration file only — you apply it via your usual protocol.

In the **Getting paid** section of Company settings, add a mode selector (visible/editable to `billing.manage`):
- **Test mode** — badge shown, uses sandbox keys, all Pay buttons and client-facing invoices display a "TEST MODE — no real money" banner so a client never accidentally thinks a sandbox invoice is real.
- **Live mode** — uses live keys. Requires Stripe Connect account to be `ready` in live before it can be toggled on.

## Step 3 — Server-side key resolution

Add `src/lib/stripe.server.ts` helpers (extend existing file):
- `getStripeClient(mode)` returns a Stripe SDK instance built from `STRIPE_SECRET_KEY_TEST` or `STRIPE_SECRET_KEY_LIVE`.
- `getStripeModeForOrganization(orgId)` reads `organizations.stripe_mode`.
- All existing payment server functions (checkout session creation, Connect account link, refunds) resolve mode from the organization, then use the matching client. No mode flag is ever accepted from the browser.

## Step 4 — Single webhook endpoint, tries both signing secrets

Keep one route: `src/routes/api/stripe/webhook.ts` (already exists). Behavior:

1. Read raw body + `Stripe-Signature` header.
2. Try verify against each configured secret in this order until one succeeds:
   `STRIPE_WEBHOOK_SECRET_TEST`, `STRIPE_WEBHOOK_SECRET_LIVE`, `STRIPE_CONNECT_WEBHOOK_SECRET_TEST`, `STRIPE_CONNECT_WEBHOOK_SECRET_LIVE`.
3. Missing/unset secrets are skipped silently (so you can run with only test secrets today).
4. Once verified, tag the event with `mode: 'test' | 'live'` and `source: 'account' | 'connect'` for the idempotency + payment records.
5. Reject with 401 only if none match.
6. Idempotency table already planned in STRIPEPHASE1 — event id is unique, duplicates no-op.

You configure **four Stripe webhook endpoints** total (two per environment) all pointing at the same URL:

```
https://builder-clarity.lovable.app/api/public/stripe/webhook
```

(Move the route to `/api/public/stripe/webhook` if it isn't already — Stripe is an external caller and the `/api/public/*` prefix bypasses Lovable's auth on published sites.)

## Step 5 — Test-mode UI safety rail

Anywhere a Stripe-driven surface is client-visible (client invoice page, Pay buttons, Connect status card): if the resolved org mode is `test`, render a persistent "Sandbox — no real payment" ribbon. Prevents any accidental client-facing use of test infrastructure.

## Step 6 — Fire the sandbox tests

Once secrets are in and code is deployed:
1. In your Stripe sandbox dashboard, create the two webhook endpoints (account + Connect) pointing at the URL above.
2. Copy the `whsec_...` for each into the two `_TEST` secrets.
3. Use "Send test webhook" or `stripe trigger checkout.session.completed` / `stripe trigger account.updated`.
4. I'll check server logs (`stack_modern--server-function-logs` on the published deployment) to confirm signature verification passed, the event was written idempotently, and the invoice/payment/Connect status updated correctly.

## Step 7 — Go live

When ready:
1. You add the three `_LIVE` secrets.
2. Create the two live webhook endpoints in Stripe live dashboard, pointing at the same URL, copy their signing secrets into the `_LIVE` slots.
3. In each org that's ready, toggle Company settings → Getting paid → mode from Test to Live.

No code change, no redeploy, no sandbox teardown.

## Files touched

- `supabase/migrations/<timestamp>_organization_stripe_mode.sql` (new)
- `src/lib/stripe.server.ts` (extend: mode-aware client resolver)
- `src/lib/payments.functions.ts` (thread org mode through Checkout, Connect account link, refunds)
- `src/routes/api/stripe/webhook.ts` — or move to `src/routes/api/public/stripe/webhook.ts` if not already public — multi-secret verify + mode/source tagging
- `src/components/billing/GettingPaidSection.tsx` (mode selector + guard against flipping to live before Connect is live-ready)
- `src/components/billing/HowToPayBlock.tsx` + client invoice route (sandbox ribbon)
- `src/integrations/supabase/types.ts` regenerates from the migration (auto)

## What I need from you to start

1. Approve this plan.
2. Then I'll switch to build mode, delete the existing `STRIPE_SECRET_KEY`, and open the secure form for the three `_TEST` secrets. You paste them in.
3. You create the two sandbox webhook endpoints in Stripe and give me their signing secrets (they'll go into the same secure form).
4. I ship the code, we fire tests, verify logs.
