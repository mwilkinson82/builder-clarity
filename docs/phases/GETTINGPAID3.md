# GETTINGPAID3 — The AIA path guides instead of hides

**Territory (AGENTS.md):** pay-application builder UI, AIA print fixture, billing domain warnings, tests. Agents stop at PR-open. No migrations expected unless Task 3 requires a project-level default column — if so, migration desk before merge.

---

## Founder-reported friction (2026-07-05, first real AIA package generated)

Two invisible gates in sequence: (1) AIA affordances only appear after flipping the application's output format — nothing hints the toggle exists; (2) the Download AIA button only appears after "Import from SOV" — before that it is simply absent, with no explanation. Users hunt, work out of sequence, and mis-enter. The package itself passed penny-level desk QA (retainage rounding, line 4/G703 reconciliation, lines 6/8/9 arithmetic) — the math is done; the path to it is the product gap.

## Task 0 — Visible progression, never hidden gates

Replace conditional rendering of AIA affordances with a persistent stepper/checklist in the pay-app builder, all steps visible from application creation:
1. **Output format** — Invoice / AIA G702-G703 choice, always shown, current selection explicit.
2. **Schedule of values** — "Import from SOV" with line count once imported.
3. **This-period entries** — progress indicator (n of m lines with activity, or explicit zero-period).
4. **Generate package** — the Download AIA action, always VISIBLE; disabled with an inline reason until its prerequisites hold ("Import your schedule of values first — the G703 continuation sheet is built from these lines"). Same pattern for every step: present, disabled-with-reason, never absent.
Out-of-sequence clicks route to the blocking step rather than no-oping.

## Task 1 — Overbilling guardrail (lender-rejection prevention)

At this-period entry and at package generation: any line where total completed & stored would exceed scheduled value (G > C, i.e. >100% / negative balance-to-finish) gets a soft warning naming the line and the overage ("Sitework bills to 108.8% of scheduled value — lenders typically reject lines over 100%; reallocate via change order or adjust"). Warning, not a block — founder's methodology: the tool flags, the estimator decides. Package generation with warnings present requires one explicit confirm. Test: fixture SOV with one overbilled line asserts the warning at entry and the confirm at generation; clean SOV asserts silence.

## Task 2 — Change orders must reach line 2 (verification, then fix if needed)

The Harbor demo package shows a CO-named SOV line while G702 line 2 / the CO summary report $0.00 — likely seed data bypassing the CO module, but prove it: integration test that approves a change order through the CO module, allocates it to SOV, generates the package, and asserts (a) line 1 = original contract sum EXCLUDING the CO, (b) line 2 = net CO value, (c) line 3 = 1+2, (d) CO summary rows populated, (e) G703 grand total still reconciles to line 4. If the flow is broken anywhere, fix in this phase; if seed-only, correct the seed so demo data models the form correctly.

## Task 3 — Small fidelity + defaults batch

- G703 header: from-previous column prints "D+E"; the standard form labels it "D" (G = D+E+F). Fix the print fixture header row.
- Per-project default output format: a project marked AIA-native births every new application as `aia_g702` (founder friction note 2026-07-05). Org-level default optional if trivial. If this needs a column, the migration goes to the desk before merge.
- Application creation flow surfaces the format choice at creation time, not only in the builder afterward.

## Proof

Gate: eslint, tsc exit 0, phase0, billing suites + new tests, build, bun frozen-lockfile. QA in PR body: create a fresh AIA application on Harbor start-to-finish following ONLY the stepper — no hunting; trigger the overbilling warning on Sitework; run the CO integration path; regenerate the package and re-verify line 4/G703 reconciliation to the cent.
