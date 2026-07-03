# FACELIFT1.md — Company & Portfolio Surfaces (Claude Code task spec)

Read AGENTS.md. Territory: **Company module + Portfolio page presentation
only** — no server functions, no schema, no business logic, NO migrations.
Branch: `ui/facelift-company-portfolio`. Other agents run in parallel; touch
nothing in estimating, schedule, billing logic, or auth.

Founder evidence, verbatim intent: "the way the page looks for Company — I
don't really like that aesthetic... the Portfolio page I don't think is
optimized." These are demo-visible surfaces for a Sunday presentation.

## The standard to match
The Plan Room, CPM workbench, and IOR pages already carry the app's best
visual language: serif display headings, generous stat cards, hairline
borders, calm spacing, disciplined use of the accent palette, contractor-
plain microcopy. This task brings Company and Portfolio up to THAT standard —
consistency, not invention. Do not introduce new colors, fonts, or component
styles that don't already exist elsewhere in the app.

## Task 0 — Company section
Every page in the Company area (profile/settings, Team [preserve all Roles
Phase 2 functionality exactly], Getting Paid, and siblings): consistent page
headers (serif title + one-line description like the IOR pages), stat cards
where summary numbers exist, aligned section rhythm and spacing, form fields
grouped with the same card treatment used in the schedule module, empty
states with guidance instead of blank panels. The Team screen's capability
checkboxes keep their exact behavior — presentation polish only.

## Task 1 — Portfolio page
The project portfolio/list: scannable cards or rows with visual hierarchy
(project name and health signal prominent; job number, PM, contract vs
forecast where available), consistent status badging with the IOR header's
existing vocabulary, hover/active states, a proper empty state for new
companies, and responsive behavior down to laptop widths. This is the first
page a member sees after login — it should feel like the cockpit the IOR
pages promise.

## Task 2 — Validate and ship
Gate + full phase0 smoke (these are high-traffic routes). Screenshot the
before/after of each changed page in the PR body — the founder reviews on the
Lovable preview BEFORE merging; his eye is the acceptance gate for this one.
PR titled `UI: Company & Portfolio facelift to app standard`. Commit this
file to docs/phases/.
