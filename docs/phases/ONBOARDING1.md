# ONBOARDING1 — A guided path from zero

**Territory (AGENTS.md):** Shared / home route — `src/routes/_authenticated/index.tsx`
(2,342 lines, the home/dashboard) and, if the stage-rail primitive is lifted here,
`src/components/ui/`. Shared touches need explicit assignment and no concurrent Shared agent
(AGENTS.md). Agents stop at PR-open. No migrations expected (checklist state can persist in
existing user/org prefs or localStorage — see Task 1).

**Depends on:** BILLINGRAIL1 (reuses the stage-rail chip vocabulary; if the primitive landed
in Shared there, import it; if it stayed billing-local, lift it to `src/components/ui/` here
and flag the Shared touch).

---

## The problem (audit 1.4, `[confirm]` resolved by Task 0)

New orgs get a seeded "Harbor Residence" demo (good — no empty state), but there is **no
onboarding sequence** telling a real contractor the intended first workflow. A user lands in
a 10-tab project, next to a demo project and their own empty project, with no narrative for
what to do first. The methodology moat (IOR / Decisions / Exposures / Waterfall) is exactly
what a new user won't discover on their own.

## Task 0 — Capture the actual first-run state before building (the `[confirm]`)

The audit could not operate the UI to see what a brand-new org sees. Before building, verify:
- What `index.tsx` renders for an org with only the seeded demo + one empty project.
- What `seed_demo_project()` creates and how a real (non-demo) project is distinguished from
  the demo (so the checklist can detect "has the user made a *real* project yet").
- Whether any onboarding/first-run flag already exists on the org/user record.

Record findings in the PR body. If the real first-run experience is materially better or
worse than the audit assumed, adjust Task 1's copy/steps to match — do not build against a
guessed state.

## Task 1 — A dismissible first-run checklist on the home route

Render a checklist on `index.tsx` that names the intended path, each item deep-linking to the
exact destination and **self-checking when done** (detected from real data, not a manual
tick):

1. **Set up your company** → company/settings route; done when org profile essentials exist.
2. **Create your first project** → new-project flow; done when a non-demo project exists.
3. **Import a schedule of values** → deep-links into that project's Billing → stage 1 (the
   BILLINGRAIL1 rail); done when SOV lines exist.
4. **Generate your first pay application** → Billing → Pay Applications stage; done when an
   application exists.

Reuse the stage-rail chip vocabulary (empty / in-progress / complete) so onboarding and
in-module guidance speak one visual language. The checklist is **dismissible** and, once all
items complete or it's dismissed, does not nag. Name the IOR/Decisions differentiator
somewhere in or adjacent to the checklist as a reason to go deeper (audit sweep: the moat is
underexposed) — a fifth, optional "Explore your risk register" pointer is enough.

## Task 2 — Persist dismissal/completion without a migration if possible

Prefer an existing per-user/per-org preferences surface or localStorage for the
dismissed/seen state. Only if there is genuinely no home for a boolean does a migration go to
the desk — and then it must be portable (`IF NOT EXISTS`, default false). State the choice in
the PR body.

## Proof

Gate: `npx eslint <changed>`, `tsc` clean, `npm run smoke:phase0`, `npm run build`, bun
frozen-lockfile if the lock moves. Browser-QA in PR body: as an org with only the demo +
empty project, show the checklist with correct initial states; complete a step (e.g. import
an SOV) and show the item self-check without a manual toggle; dismiss and reload to confirm it
stays dismissed. Flag the Shared touch in the PR body. Stop at PR-open.

---

## As built (2026-07-05, PR)

- **Data (Task 0 resolved):** new `src/lib/onboarding.functions.ts` `getOnboardingStatus`
  (RLS-scoped, advisory) returns `hasProject` / `hasScheduleOfValues` / `hasPayApplication`
  / `firstProjectId`. Demo excluded by `job_number !== "DEMO-HARBOR"`. Company step is
  derived client-side from the existing `company-workspace-context` query
  (`name` set and not the "Company" default).
- **Self-checks:** company → `/team`; first project → opens the existing New project dialog
  (made `NewProjectButton` optionally controlled); SOV + pay app deep-link to
  `/projects/$id?tab=billing` (the project route already has a typed `tab` search param, so
  this lands on the billing rail). Billing steps stay disabled-with-reason until their
  prerequisite lands.
- **Persistence (Task 2):** `localStorage` key `overwatch:onboarding-dismissed:v1`, read in a
  client-only effect (no SSR mismatch). **No migration.**
- **No-nag:** the checklist auto-hides once all four steps are complete OR on dismiss. It is
  billing-local reuse of the rail's complete/pending/blocked vocabulary (not yet lifted to a
  Shared primitive). Rendered at the top of the portfolio Projects tab.
- **QA note:** invisible on fully-onboarded workspaces by design — visual QA needs a fresh or
  incomplete workspace.
