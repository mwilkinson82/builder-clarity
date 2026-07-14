# Stripe live rollout for Overwatch

## What belongs to whom

- **Overwatch's Stripe account** is the Connect platform. It owns the API keys,
  webhook endpoints, and any application fees Overwatch deliberately charges.
- **Each Overwatch company** gets its own Stripe connected account. Stripe
  collects that company's identity, agreement, and payout bank information.
- **The company's client** pays a Stripe Checkout Session created directly on
  that connected account. The invoice principal belongs to the company.
- **Overwatch never stores the company's payout bank credentials.** Stripe's
  hosted onboarding and Dashboard own that surface.

The connected-account setup URL is private, single-purpose, and temporary. Do
not store it as a company setting or send it outside the authenticated setup
flow. Overwatch generates a fresh Account Link whenever setup is opened.

## Money flow

Invoice Checkout Sessions are direct charges made with the connected account's
ID in the `Stripe-Account` header. Stripe deposits the net payment to that
company's connected balance. If an Overwatch application fee is configured,
Stripe transfers only that fee to the Overwatch platform balance.

`OVERWATCH_INVOICE_APPLICATION_FEE_BPS` controls the fee in basis points:

- unset or `0`: **0% Overwatch fee**
- `100`: 1%
- `250`: 2.5%

The code caps the value at 3,000 basis points (30%) as a safety guard, but this
is not a recommended price. ALP must choose and disclose its commercial fee;
Stripe does not choose it automatically.

The connected accounts created by this integration use the Standard-equivalent
responsibility model:

- `controller.fees.payer=account`
- `controller.losses.payments=stripe`
- `controller.requirement_collection=stripe`
- `controller.stripe_dashboard.type=full`

That means the connected company pays its Stripe processing fees, Stripe bears
unrecoverable connected-account negative-balance losses, and the company uses
the full Stripe Dashboard. Overwatch can still collect an explicit application
fee on a direct charge.

Stripe references:

- [Direct charges and application fees](https://docs.stripe.com/connect/direct-charges)
- [Connected-account fee payer behavior](https://docs.stripe.com/connect/direct-charges-fee-payer-behavior)
- [Risk and negative-balance responsibility](https://docs.stripe.com/connect/risk-management)
- [Controller-property account configurations](https://docs.stripe.com/connect/migrate-to-controller-properties)

## Initial payment ceiling and increases

Every company starts with an OverWatch hard ceiling of **$25,000 per online
payment**. The company can choose a lower Stripe threshold in its payment
preferences, but an invoice override cannot bypass the OverWatch ceiling.
Stripe may independently enforce a lower per-transaction or weekly ACH limit
for a connected account.

An owner or billing manager requests more capacity in **Company -> Getting
paid**:

1. Open Stripe Support from the company's connected account and request the
   needed ACH transaction and weekly limits.
2. Record the requested amount and Stripe case or approval reference in
   OverWatch.
3. OverWatch support verifies Stripe's approval, then updates the company's
   `stripe_payment_limit_cents` and closes the request.

The request form records and tracks the work; it does not grant Stripe approval
or automatically raise the OverWatch ceiling. Large requisitions use the
invoice's direct bank or wire instructions until both approvals are complete.

## Required server environment

Keep test and live credentials side by side during the rollout:

```text
STRIPE_SECRET_KEY_TEST
STRIPE_SECRET_KEY_LIVE
STRIPE_WEBHOOK_SECRET_TEST
STRIPE_CONNECT_WEBHOOK_SECRET_TEST
STRIPE_WEBHOOK_SECRET_LIVE
STRIPE_CONNECT_WEBHOOK_SECRET_LIVE
```

There are two webhook endpoint scopes in each mode: platform-account events and
connected-account events. Each endpoint has its own `whsec_` value. The handler
tries every configured secret and verifies the raw body before it reads the
event. Never expose these variables with a `VITE_` prefix.

## Why every sandbox user must set up live again

Stripe test and live objects are separate. An `acct_` created with test
credentials cannot accept live payments and cannot be converted into a live
account. Overwatch therefore stores four independent fields:

```text
stripe_connect_account_id_test
stripe_connect_status_test
stripe_connect_account_id_live
stripe_connect_status_live
```

`organizations.stripe_mode` selects which pair checkout uses. Live mode never
falls back to the legacy or test account ID.

## Canary and rollout

1. Keep every company in `stripe_mode=test`.
2. In ALP's Getting Paid settings, select **Set up live Stripe**.
3. Complete Stripe's connected-account requirements using ALP's contractor
   business and payout-bank information.
4. Wait until Overwatch shows **Live account verified - activation required**.
5. Confirm both Stripe live webhook endpoints show successful deliveries.
6. Select **Activate live payments** for ALP only.
7. Create a **$1.00** real invoice and pay it by card. Verify all six outcomes:
   - Checkout and charge are live in ALP's connected Stripe account.
   - The client payment books once in Overwatch.
   - The invoice becomes paid and its open balance becomes $0.00.
   - The project owner and active billing managers receive one in-app
     `billing.paid` notification; repeated webhook delivery creates no duplicate.
   - `stripe_webhook_events.livemode` is `true`.
   - The configured application fee (currently zero unless set) matches the
     platform's Stripe balance/reporting.
8. In Stripe, confirm both live webhook endpoints show successful deliveries
   for the canary. A failed delivery must be resolved before rollout.
9. Refund the canary and verify the invoice/payment ledger reverses correctly.
10. Roll companies one at a time. Each company completes its own live setup and
    explicitly activates only after verification.

Do not delete the legacy `stripe_connect_account_id` columns during this
rollout. They remain synchronized with the active mode for compatibility and
can be removed only after the deployed code and canary are proven.
