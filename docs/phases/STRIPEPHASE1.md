# STRIPEPHASE1.md — Getting Paid, Tier 0 + Tier 1 (Claude Code task spec)

Read AGENTS.md. You are the **Billing** agent. Branch:
`billing/payments-phase1`. Territory: billing/invoicing modules, company
settings payment section, the client-visible invoice surface, and new payment
server functions. Do not touch estimating, schedule, CRM, or auth helpers.

**This is the money module. Non-negotiable engineering rules:**
- All amounts are integer cents. No floats anywhere near money.
- Payment state is an explicit machine; invoices are never marked paid from
  client-side code — only server functions acting on verified events or an
  authorized manual record.
- Every Stripe webhook is verified (signature) and idempotent (processed
  event ids stored; duplicates no-op). Webhook failures return non-2xx so
  Stripe retries.
- No Stripe secret material in client code, ever. Publishable key only.
- Migrations: file-only, flagged loudly, applied via protocol BEFORE merge.

Founder-approved model (July 3): payments never depend on Stripe's mood.
Direct bank remittance is a permanent first-class rail (Tier 0). Stripe
Connect is additive: encouraged early so verification and history build
before they're needed (Tier 1: cards + ACH debit for smaller amounts). Push
bank-transfer / virtual accounts (Tier 2) is a NAMED FUTURE PHASE — do not
build it now. Platform application fee: wire the plumbing on Stripe charges
(application_fee_amount from a platform-level config), DEFAULT 0 at launch.

## Task 0 — Company payment profile (Tier 0 foundation)
In Company settings (visible/editable only with billing.manage or
company.manage_settings capability): a "Getting paid" section holding the
company's remittance details — bank name, routing number, account number,
optional wire instructions and remittance memo template (e.g. "Reference:
Invoice {number}"). Stored server-side with the same care as other company
data; displayed masked in the UI after entry (last 4) with reveal-on-click
for authorized users. MIGRATION expected (company payment profile columns or
table).

## Task 1 — Remittance on invoices + record payment
- The client-visible invoice surface renders a "How to pay" block per the
  invoice's enabled methods (Task 3). For Direct bank transfer: the
  remittance details with the reference memo, presented cleanly (this is the
  $200K rail — it should look like it belongs on a requisition).
- "Record payment" flow for the contractor (billing.manage): amount (full or
  partial), method (wire/ACH/check/other), date, reference. Creates a payment
  record, updates invoice paid/remaining and A/R aging. Multiple partial
  records supported; over-recording warned.
- MIGRATION expected: payments table — id, org, invoice id, amount_cents,
  currency, source ('manual' | 'stripe'), method, state, reference, stripe
  ids nullable, recorded_by, timestamps. State machine documented in a
  comment: manual records are 'succeeded' on creation; stripe records flow
  pending → succeeded | failed | refunded.

## Task 2 — Stripe Connect onboarding (encouraged, never required)
- "Connect Stripe" in the Getting paid section using Connect Standard
  account onboarding (account link flow). Store the connected account id on
  the organization. MIGRATION expected (stripe_account_id + status columns).
- Status card shows verification state honestly: Not connected → Verification
  in progress → Ready for card & bank-debit payments. Include the founder's
  expectation-setting copy: "Stripe verifies new businesses — card and
  bank-debit payments suit smaller amounts while your account builds history.
  For large requisitions, your invoices already carry your direct wire
  instructions."
- Nudge (dismissible) on the billing dashboard when no Stripe is connected:
  connect early so verification happens before you need it.
- Webhook handles account.updated to keep status current.

## Task 3 — Per-invoice payment method toggles (the founder's workflow)
On invoice create/send/edit: toggles for which methods the client sees —
Direct bank transfer (available when the payment profile exists), Card, Bank
debit (ACH) (each available only when the Stripe account is ready; otherwise
shown disabled with "Connect Stripe to enable"). Company-level defaults with
per-invoice override. MIGRATION expected (enabled_payment_methods jsonb on
invoices, defaulted from company settings).

## Task 4 — Tier 1 Stripe payments on the client invoice page
- For enabled Stripe methods: Pay button → Stripe Checkout Session (or
  Payment Element) created server-side as a direct charge on the connected
  account, with application_fee_amount from the platform config (default 0).
  Card fee pass-through toggle per company (adds the estimated fee as a
  surcharge line when the contractor enables it; note in docs it is the
  contractor's responsibility that surcharging is lawful in their state).
- Webhook (checkout.session.completed / payment_intent.succeeded / failed /
  charge.refunded) → payment records via the state machine → invoice and A/R
  update. Idempotency table for event ids. MIGRATION expected (webhook events
  table).
- Client sees confirmation + receipt (Stripe's receipt is fine for v1).
- Amount guardrail: Stripe methods are hidden (with a note to the contractor
  at send time) on invoices above a configurable threshold (default
  $25,000) — steering requisition-sized money to the direct rail by default;
  contractor can override the threshold per invoice deliberately.

## Task 5 — Validate and ship
Gate + unit tests: state machine transitions, webhook idempotency (same
event twice = one record), cents math round-trips, partial payment
arithmetic, method-availability matrix (profile/Stripe states x toggles).
Integration points that need live Stripe keys are structured behind a config
check so the gate passes without secrets. PR titled `Payments Phase 1:
direct remittance + Stripe Connect (Tier 0/1)` with ALL migrations flagged
loudly. Commit this file to docs/phases/. List in the PR body the exact
founder setup steps required before the feature can go live (platform Stripe
account, Connect enabled, keys, webhook endpoint + signing secret in env).
