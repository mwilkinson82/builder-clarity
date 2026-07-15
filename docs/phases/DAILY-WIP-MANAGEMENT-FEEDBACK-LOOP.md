# Daily WIP management feedback loop

This roadmap reconciles the July 2026 repository investigation with current
OverWatch behavior. It distinguishes shipped foundations from the remaining
management loop so older teaching notes do not become the product truth.

## Already in the product

- Daily Log work lines and Daily WIP share `public.daily_wip_entries`.
- Daily earned value, cost, profit/loss, and actual production rates are
  derived without fabricating missing pricing or progress.
- Self-perform WIP reaches project and portfolio forecasts.
- Bought-out subcontract progress can earn subcontract cost.
- Project and portfolio billing position compare earned and billed amounts.
- Daily WIP may link to a CPM activity, but does not silently change it.
- Daily WIP informs billing; it never creates a pay application automatically.

## Slice 1 — production baseline

- [x] Record people per crew; legacy rows default to two.
- [x] Let the PM set a target installed quantity per labor-hour.
- [x] Compare actual with target using a five-percent on-pace tolerance.
- [x] Correct IOR to **Indicated Outcome Report**.
- [x] Retire documentation that says subcontract progress is deferred.

## Slice 2 — project pace to forecast

- [x] Add a project production-target rollup by cost code and time window.
- [x] Compare recent production pace with the remaining quantity and working
      days required to hit the targeted billing date.
- [x] Separate “missing target” from “behind target”; do not infer a verdict.
- [x] Let the PM certify a recommended SOV completion position generated from
      reviewed WIP. Certification remains required before billing changes.

## Slice 2b — PM-to-accounting billing handoff

- [x] Show the latest PM-certified SOV decisions as an optional, compact
      worksheet inside the selected billing application.
- [x] Let accounting explicitly apply a decision only to an existing draft;
      never create, submit, approve, or invoice automatically.
- [x] Preserve carried-forward billing and current stored materials; block a
      certified position below that immutable floor.
- [x] Flag newer reviewed WIP and superseded certifications before accounting
      can act.
- [x] Record who certified the position, who applied it, the draft application,
      the prior draft amount, and the exact applied result.

This is deliberately a two-person bridge. The PM prepares the billing position
from project evidence; accounting formats, reviews, and advances the AIA or
invoice. Small companies may use the same person for both actions. A company
that keeps PMs out of billing can ignore the worksheet and continue entering
the application manually.

## Slice 3 — reviewable CPM progress

- [x] Define which quantity or percent basis controls each linked activity.
- [x] Present a recommended activity percent with source and variance.
- [x] Require an explicit PM action before changing CPM progress.
- [x] Record the recommendation, accepted value, actor, and timestamp.

Automatic schedule movement remains intentionally excluded. Different
activities can use different physical bases, and the accepted value now reaches
CPM only through the PM review action with an append-only evidence snapshot.

## Slice 4 — portfolio operating view

- [ ] Roll daily production trend and target variance across active projects.
- [ ] Compare the trend with planned company billings and known open invoices.
- [ ] Flag forecasted billing that lacks enough reviewed production support.
- [ ] Add drill-through from company variance to project, cost code, and day.

## Slice 5 — AOS Scorecard handoff

- [ ] Define a versioned KPI contract rather than coupling AOS directly to
      OverWatch tables.
- [ ] Publish only reviewed KPIs with company, project, period, value, unit,
      source, and calculation version.
- [ ] Make retries idempotent and expose last successful synchronization.

## Guardrails

- Missing pricing, progress, coding, targets, or quantities remain visibly
  missing; they are never replaced with invented profitability or pace.
- WIP recommendations never bypass PM certification.
- Schedule progress never changes as an unreviewed side effect of a daily log.
- Database changes ship as repository migrations and are applied through the
  connected Lovable deployment workflow after merge.
