# WIPHONESTY1 — WIP tells the truth: no borrowed percentages

**Territory (AGENTS.md):** Billing — `src/lib/wip.ts`, WIP assembly in
`src/lib/billing.functions.ts`, the WIP table UI (`wip-analysis` pane in
`src/routes/_authenticated/projects.$projectId.tsx` L3215+ and any
`src/components/billing/` piece it renders), billing tests. No migrations. Agents stop at
PR-open.

---

## The bug (confirmed against `main`, 2026-07-05)

`billing.functions.ts` L468–469 assembles each WIP bucket's earned percent as:

```ts
earned_percent_complete:
  bucket.earned_percent_complete || input.project.percent_complete || 0,
```

`computeWIPBucket` (`wip.ts` L53–76) is arithmetically correct — over/under = billed −
(contract × earned%). The **input** is the lie. Any bucket with no explicitly-entered earned
% silently inherits the project-level roll-up. A project shown at "60% complete" makes every
un-assessed cost bucket report **60% earned**, fabricating earned-revenue and
over/under-billing per line. The total can read plausible while every row is fiction. This
is very likely *the* reason WIP "doesn't make sense" — the numbers move when the user never
touched them.

**Worse than the audit stated:** the `||` chain treats `0` as falsy, so a bucket a user
*deliberately* set to `0%` earned ALSO falls through to the project percent. There is no way
today to say "this bucket has earned nothing yet" — the app overrides you.

A contractor makes draw decisions off this screen. Silent-wrong is worse than missing.

## Task 0 — Distinguish "not assessed" from "0% earned" (the data fix)

The fallback must die. A bucket's earned % has three states, and the pipeline must preserve
all three end to end:

1. **Explicitly assessed** (including an explicit `0`) → use the entered value.
2. **Not assessed** (no per-bucket value ever entered) → `null`, never a borrowed number.
3. Project roll-up is **never** substituted for a bucket value. Full stop.

Implementation:
- Change the WIP input contract so `earned_percent_complete` is `number | null`
  (`WIPBucketInput` in `wip.ts`). Assembly in `billing.functions.ts` passes the bucket's own
  value or `null` — delete the `|| input.project.percent_complete` term entirely. Preserve
  an explicit `0` (use nullish `??`, not `||`, and only against a genuine "unset" sentinel
  from the row, not against `0`).
- `computeWIPBucket`: when `earned_percent_complete` is `null`, `earned_revenue`,
  `over_under_billing`, and any derived margin fields that depend on earned% must be `null`
  (a "not assessed" result), NOT `0`. Keep cost-side fields (cost_to_date, FTC, contract
  value) computing normally — those are known regardless of assessment.
- `computeProjectWIP` totals: sum earned/over-under across **assessed buckets only**, and
  carry an `assessed_count` / `bucket_count` so the UI can state coverage. Do not let
  unassessed buckets contribute `0` to a total that then reads as precise.

## Task 1 — The WIP table stops implying precision it doesn't have

In the `wip-analysis` pane:
- A not-assessed bucket renders its earned %, earned revenue, and over/under as an explicit
  **"Not assessed"** (em-dash or muted label), never `$0.00` and never a number.
- The table header/summary shows **"N of M buckets assessed"**. When N < M, the project
  over/under total is labelled as partial ("Over/under reflects 4 of 11 buckets") rather
  than presented as the whole truth.
- Column meanings stay legible to a contractor who has never seen the app (AGENTS.md code
  standard): "Earned %" gets a one-line "how much of this budget you've actually completed"
  affordance if not already present.

## Task 2 — Fix the problem where the user sees it

Add a per-bucket **"Set % complete"** affordance inline in the WIP row (inline edit or small
popover) that writes the bucket's `earned_percent_complete`. The fix path lives where the
problem is visible — a user who sees "Not assessed" can resolve it in one click without
hunting for another screen. Writing a value (including `0`) moves the bucket to assessed and
recomputes. Respect existing RLS/roles for who may edit billing figures.

## Task 3 — Regression test (the audit's "one test")

`src/lib/__tests__/` (or the existing billing test location — match convention):
- A fixture project at `percent_complete = 60` with three buckets: one assessed at `25`, one
  assessed at explicit `0`, one never assessed.
- Assert the `25` bucket earns `contract × 0.25`; the explicit-`0` bucket earns exactly `0`
  (NOT 60% — this is the `||`-zero regression); the unassessed bucket returns `null`
  earned/over-under (NOT 60%, NOT 0).
- Assert `computeProjectWIP` reports `assessed_count = 2`, `bucket_count = 3`, and its
  earned/over-under totals exclude the unassessed bucket.
- Keep/adjust any existing WIP test that assumed the old fallback — its old expectation
  encodes the bug; update it and note why in the commit.

## Scope guard

This is a **disclosure/correctness** fix, not the dollars→cents migration for WIP.
`wip.ts` computes in dollars today; leave that as-is (money-is-cents is a separate,
founder-scheduled change). Do not widen the numeric surface here — only remove the borrowed
percentage and represent "not assessed."

## Non-goal / future hook

Once buckets are honestly assessable, CPM schedule % becomes a legitimate *source* to
suggest a bucket's earned % (sweep item from the audit). Out of scope here — but leave the
per-bucket setter open to being fed a suggestion later; do not hard-wire the project roll-up
back in under a new name.

## Proof

Gate: `npx eslint <changed>`, `tsc` clean, `npm run smoke:phase0`, billing suite + the new
test, `npm run build`, bun frozen-lockfile if deps move (they should not). Browser-QA in PR
body: open Harbor WIP with at least one unassessed bucket, show it reads "Not assessed" and
"N of M assessed" — not a fabricated percentage; set one bucket to 0% and confirm it stays 0
(does not jump to the project number); set another to a real value and confirm the total
recomputes and the assessed count increments. Stop at PR-open.
