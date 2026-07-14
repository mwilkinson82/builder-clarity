# 04 — Daily WIP (Workspace B)

This is the PM's daily ritual: **record what the company put in place today**,
and be able to **go back to any day** and see that day's work next to that day's
daily report. It is the "Workspace B" of the billing design — the counterpart to
the biller's receivables cockpit (Workspace A).

Founder's ask, verbatim in spirit: *"If you're going to do a daily WIP, we've
got to be able to select the date… go back to any day and look at that daily
report and look at that WIP."*

## What it records

Surface: the project **Daily WIP** tab
([`DailyWipWorkspace.tsx`](../../src/components/outcome/DailyWipWorkspace.tsx)).
Pick any date (prev/next day, date picker, "Today"). For that day you log one row
per activity into `public.daily_wip_entries`:

- **cost code** (`cost_bucket_id`, nullable — you can log before the work is
  coded),
- **self-perform labor**: `crew_count`, `people_per_crew`, `hours`,
  `labor_rate` (blended $/person-hour),
- **materials** (`material_cost`), **equipment** (`equipment_cost`),
- **production**: `quantity` + `unit` (so a production rate falls out), plus an
  optional `target_production_rate` for actual-versus-target management,
- `activity` free-text label + `notes`.

## The math (derived, never stored)

Labor cost is **always** derived from its inputs so it can't drift. The
cents-safe math lives in [`daily-wip.ts`](../../src/lib/daily-wip.ts):

```
labor cost (per row)  = crew_count × people_per_crew × hours × labor_rate
                        (rounded to cents)
work in place (row)   = labor cost + material_cost + equipment_cost
day total             = Σ rows, summed in integer cents, converted once
labor-hours (row)     = crew_count × people_per_crew × hours
production rate (row) = quantity ÷ labor-hours   (null unless both > 0)
```

`labor_cost` is **not** a column in the table — it is computed everywhere it is
shown, from `crew_count × people_per_crew × hours × labor_rate`, so the stored inputs are the
single source of truth. Verified by
[`scripts/daily-wip-smoke.ts`](../../scripts/daily-wip-smoke.ts)
(`npm run test:wip`): labor cents-exact, day roll-up, production rate, and
NaN-safety.

## The daily report shows alongside

The narrative **daily report** for the selected date (crew count, weather,
work performed, delays) is loaded from `public.daily_reports` (via
`listDailyReports`) and shown read-only in the aside — so "look at the daily
report AND the WIP" is one screen. Editing the daily report itself stays in the
**Daily Reports** tab; Daily WIP only references it.

## Daily WIP is tracking — the bill comes from the SOV (founder ruling)

Founder decision, 2026-07-06: **a pay application must never come from the
daily WIP.** Daily tracking may not be accurate enough to bill from. The
billing workflow is: the PM sits down with the **schedule of values**, decides
what to bill, updates percent complete per line, and hands the SOV to
accounting; accounting creates the pay application (AIA or invoice), sends it,
and handles aging, tracking, collections (and, in the future, lien waivers).
The SOV dictates the period's billing — the PM is the driving force behind it.

This supersedes the earlier design note that "the WIP locks in and becomes the
payment application" — that pre-fill idea is **dead by design**
(see the 2026-07-06 addendum in [`docs/BILLINGDESIGN.md`](../BILLINGDESIGN.md)).
Daily WIP informs the PM — what was spent and placed, production rates; it
never becomes the bill.

The rest of the dependency rule stands: recording daily WIP is **optional and
additive**, and nothing in the billing path reads `daily_wip_entries` as a
precondition. It can't break billing because billing doesn't depend on it.

## Server functions & graceful degradation

CRUD lives in
[`daily-wip.functions.ts`](../../src/lib/daily-wip.functions.ts):
`listDailyWipEntries`, `saveDailyWipEntry` (insert if new, update if `id`),
`deleteDailyWipEntry`. All RLS-scoped (`can_read_project` /
`can_manage_project`, mirroring `exposure_allocations`).

The table `daily_wip_entries` ships in migration
[`20260706120000_daily_wip_entries.sql`](../../supabase/migrations/20260706120000_daily_wip_entries.sql).
Because migrations are applied by a separate desk, the code **degrades
gracefully** until the table exists: reads return `[]` and writes surface a
clear "not enabled yet" message (`isMissingDailyWipTable`). The app never breaks
ahead of the migration.

## Implemented follow-on slices

- **Subcontractor progress vs lump-sum commitments** — Daily WIP can now earn
  subcontract cost against bought-out commitments. This supersedes the earlier
  note that subcontract progress was deferred.
- **Actual versus target production** — PMs can set an optional target rate per
  work line. The production panel compares installed quantity per labor-hour
  with that target and reports ahead, on pace, or behind without inventing a
  verdict when either side is missing.
- **Configurable crew size** — the field records people per crew. Existing rows
  retain the historical two-person default.

## Still deferred

- Roll production pace into the project's targeted billing forecast.
- Recommend an SOV completion/billing position for PM certification; Daily WIP
  must not create a pay application automatically.
- Feed Daily WIP into CPM progress only through a reviewable, explicitly
  configured rule rather than silently moving schedule activities.
- ~~Pay-app pre-fill from WIP~~ — **cancelled by founder decision 2026-07-06**:
  the bill comes from the SOV, never from daily tracking (see above).

---

**Next:** [05 — Data model & code map](05-data-model-and-code-map.md).
