# GETTINGPAID2 — "Viewed" means the client actually opened the invoice

**Territory (AGENTS.md):** `src/routes/_authenticated/client.projects.$projectId.tsx`, `src/lib/client-portal.functions.ts`, tests. Small, surgical. Agents stop at PR-open. **Branch from the post-revert main** (the bot-commit revert must merge first; tsc must be exit 0 on your base). No migrations.

---

## The bug (verified in code at `client.projects.$projectId.tsx:145–156`)

`viewedInvoiceId` is derived as `find(selectedInvoiceId) ?? visibleInvoices[0]`, and a `useEffect` fires `recordInvoicePortalView` whenever that id changes. Because `selectedInvoiceId` starts null, ANY portal visit — daily reports, change orders, anything — silently stamps the client's first invoice as "Viewed" server-side. The cockpit's Sent → Viewed → Paid chain then shows a view that never happened, and collections get delayed on the belief the client has seen the bill. The Viewed signal is a trust feature; a false positive here is worse than no signal.

## Task 0 — Gate recording on explicit opens

- The RECORDING derivation must not fall back: record only when the user has explicitly opened an invoice — a non-null `selectedInvoiceId` (or the equivalent explicit billing-tab invoice navigation event). Delete `?? visibleInvoices[0]` from the recording path. If the UI wants to DISPLAY a default invoice, that display default must be a separate variable that never feeds `recordView`.
- Keep the per-visit dedupe ref; it's fine once the trigger is honest.

## Task 1 — Tests

- Component test: mount the portal route with invoices present and no selection → assert `recordInvoicePortalView` is NOT called. Select an invoice → assert exactly one call with that id. Switch invoices → one call each, deduped on revisit.
- Server-side unchanged, but add an assertion that internal-team sessions remain excluded (existing behavior, pin it).

## Data note (founder decision, not code)

`first_viewed_at` / `view_count` stamps written by the false path are already persisted and cannot be distinguished retroactively with certainty. Options: leave history as-is and trust it forward from deploy, or the founder identifies known-false stamps on live invoices (e.g., 2601-x) and the migration desk nulls them by hand on his explicit list. Recommend the desk route for any invoice currently in a collections decision.

## Proof

Gate: eslint, tsc (exit 0), phase0, test suites, build, bun frozen-lockfile. QA in PR body: open the client portal as a portal user, land on daily reports, verify no Viewed stamp appears in the cockpit; open the invoice explicitly, verify the stamp appears with the correct timestamp.
