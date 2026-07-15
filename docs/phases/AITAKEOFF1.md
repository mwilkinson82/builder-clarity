# AITAKEOFF1.md — AI-Assisted Counts + Credits (Claude Code task spec)

Read AGENTS.md. **Estimating** agent territory plus two new modules it owns:
`src/lib/ai-takeoff/` and `src/lib/credits/`. Branch:
`estimating/ai-takeoff-phase-a`. **Migrations ARE expected (credits ledger,
AI operations log) — file-only, flagged loudly, applied via protocol before
merge.** A Billing agent may be active — do not touch billing/invoicing
surfaces; credits are their own module.

Founder-approved design (July 3): AI proposes, the human verifies in the
existing takeoff harness. Measurement authority NEVER belongs to the model —
in Phase A the model only finds symbol locations; counts are countable by
the human eye at accept time. Suggest, never force — same DNA as Detect
Sheet Names. Provenance always visible. Credits always transparent.

## Task 0 — Credits infrastructure (build first; everything meters through it)
- MIGRATION: `credit_ledger` — id, organization_id, delta (integer credits,
  positive grants/purchases, negative spends), reason ('signup_grant',
  'purchase', 'ai_count_scan', 'admin_adjustment'), reference (op id /
  stripe payment id), created_by, created_at. Balance = SUM(delta),
  append-only, never updated — same discipline as payment_ledger. RLS:
  members read their org's ledger; inserts server-only (service role).
- MIGRATION: `ai_operations` — id, organization_id, user, operation_type,
  estimate_id, sheet_ids, model_used, input_tokens, output_tokens,
  api_cost_cents (computed from a config price table), credits_charged,
  status (pending/succeeded/failed), created_at. Failed operations refund
  their credits automatically (compensating ledger entry). This table IS the
  founder's margin dashboard: credits_charged vs api_cost_cents.
- Signup grant: 50 credits on organization creation (and a one-time backfill
  grant for existing orgs, in the seed). Balance surfaced by a server fn.
- Credit packs: config-driven (default: 100 credits / $25). Live purchase uses
  the reusable OverWatch Stripe Price `price_1TtJmrJGLltOYaiieUrp4fSn`; explicit
  sandbox mode retains inline test pricing. Purchase runs
  through the EXISTING platform Stripe checkout path (charge on the PLATFORM
  account — this is Overwatch revenue, not a connected-account charge), with
  webhook crediting the ledger idempotently. If the existing subscription
  checkout route can be reused with a one-time price, do that; do not build
  a parallel checkout.
- Model routing + pricing table live in config (env/constant module):
  default model claude-sonnet-4-6 unless ANTHROPIC_MODEL is set; per-model
  $/MTok price map used to compute api_cost_cents. Switching models must
  never require code changes.

## Task 1 — The scan (server-side)
Server function: given estimate, sheet id(s), and an exemplar (the bounding
region of one human-placed count marker), render the sheet region tiles at
detection resolution (the pdfjs render machinery exists), send tiles + the
exemplar crop + a tight instruction to the configured Anthropic model via
the Messages API (ANTHROPIC_API_KEY from env — founder setup item, list it
in the PR), and parse a strict-JSON response of match candidates:
{x, y, confidence} in sheet coordinates. Multi-sheet scans iterate sheets
(sequential is fine for v1; charge 1 credit per sheet scanned). Guardrails:
pre-check credit balance and quote cost before running; hard cap sheets per
scan (default 30); timeouts and failures refund per Task 0. Never create
takeoff records from the model output directly — proposals only (Task 2).

## Task 2 — Ghost proposals + the review bar (the experience)
- Proposals render on the canvas as GHOSTS: dashed amber circles with "?",
  visually unmistakable from solid accepted markers. Low-confidence
  proposals get a warning tint and sort LAST in review.
- Floating review bar (the popover z-order/clamping lessons apply): "N found
  · Reviewing i of N · M accepted", Accept / Reject buttons, keyboard cadence
  Enter=accept, X or Delete=reject, arrows navigate; the viewport pans/zooms
  to each proposal in turn so the human always sees the actual symbol.
  "Accept all remaining" exists but sits behind the per-item flow, never
  first.
- Accepting converts the ghost into an ORDINARY count marker on the active
  (or exemplar's) count takeoff — joins groups, links, estimate flow like
  any human count. Rejecting discards. Ghosts never persist across reload
  (proposals are session-scoped; the ai_operations row is the durable
  record).
- Provenance: accepted markers carry created_by_ai; worksheet rows and the
  takeoff inspector show a small "AI-assisted" chip. Tagged to sheet number
  per the founder's spec.

## Task 3 — Entry point + credits UI
- "AI Assist" panel in the Plan Room (toolbar entry, sparkle icon): shows
  the exemplar (pick by clicking one of your own count markers), scope
  selector (this sheet / all sheets with credit quote), Find more like this,
  results summary, and the credit balance chip. Out of credits → the buy
  panel (packs via Task 0's checkout) with the balance always visible.
- Empty/first-run state teaches the loop in one line: "Count one yourself,
  then let AI find the rest — you approve every match."

## Task 4 — Validate and ship
Gate + test:estimating + new unit tests (ledger balance math + refund
compensation, cost computation from the price table, proposal→marker
conversion, confidence sort). Model calls mocked in tests; a
config-disabled state renders the panel with "AI assist not configured"
when no API key exists. PR titled `Estimating: AI-assisted counts + credits
(Phase A)`, ALL migrations flagged loudly. List founder setup in the PR
body: ANTHROPIC_API_KEY in Lovable env (create at console.anthropic.com),
optional ANTHROPIC_MODEL override. Commit this file to docs/phases/.
