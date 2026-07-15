
# Stripe Live Audit — OverWatch (read-only)

No connections were linked, mutated, or disconnected. All calls were read-only through the Lovable connector gateway against the two workspace "Stripe (live)" entries.

## Live Stripe connections in this workspace

Two duplicate live entries, both point at the same account:

| Connection ID | Label | Resolved account |
|---|---|---|
| `std_01kra2672rerwb66ews5b3fjbx` | Stripe (live) | `acct_1HPL9DJdDAUSVXbN` |
| `std_01kv51rp2hebfrt9st24n5n20r` | Stripe (live) | `acct_1HPL9DJdDAUSVXbN` |

(There are also two "Stripe (sandbox)" entries — not inspected, out of scope.)

## Platform account behind the live secrets

`GET /v1/account` on both live connections returned the same platform account:

- **Account ID:** `acct_1HPL9DJdDAUSVXbN`
- **Business / dashboard display name:** **ALPio**
- **Business profile name:** ALPio
- **Legal / individual:** Marshall Wilkinson (sole prop, US)
- **Support email:** marshall@marshallwilkinson.com
- **URL:** www.altitudelogicpressure.com
- **Statement descriptor:** ALPIO
- **Type:** `standard` (own controller), `charges_enabled: true`, `payouts_enabled: true`, `details_submitted: true`
- **Default currency:** USD

This is the ALP platform account. Both live connector entries carry a restricted key scoped to `acct_1HPL9DJdDAUSVXbN`, so `STRIPE_SECRET_KEY_LIVE` in the project (and the paired `STRIPE_PUBLISHABLE_KEY_LIVE` / `STRIPE_WEBHOOK_SECRET_LIVE` / `STRIPE_CONNECT_WEBHOOK_SECRET_LIVE`) resolve to this same ALPio account regardless of which duplicate is linked. The duplicate is safe from an "am I on the right account?" standpoint — they are the same platform.

Caveat: the actual `STRIPE_SECRET_KEY_LIVE` secret value in Project Settings cannot be read; this identification is by matching each live connection's account via the Stripe API, plus the fact that both resolve to the same `acct_`.

## Live products whose name contains "OverWatch"

- `GET /v1/products/search?query=name~"OverWatch"` → **0 results**.
- Full scan of `GET /v1/products?active=true&limit=100` (first page, 100 products; `has_more: true`) also shows **0 product names containing "OverWatch"** (case-insensitive). Names in the catalog are AOS/ALP/Contractor Circle/Level Up/coaching/one-off client SKUs.

**Conclusion on OverWatch SKUs:** none currently exist on the live ALPio account under that name. If OverWatch pricing needs to be represented on Stripe live, it would need to be created (not part of this audit). A second sweep beyond the first 100 products can be run on request, but Stripe's own search API already returned zero name matches across the full account.

## Nothing was changed

No products, prices, webhooks, accounts, or connector links were created, edited, archived, or removed.
