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
- **self-perform labor**: `crew_count`, `hours`, `labor_rate` (blended $/hr),
- **materials** (`material_cost`), **equipment** (`equipment_cost`),
- **production**: `quantity` + `unit` (so a production rate falls out),
- `activity` free-text label + `notes`.

## The math (derived, never stored)

Labor cost is **always** derived from its inputs so it can't drift. The
cents-safe math lives in [`daily-wip.ts`](../../src/lib/daily-wip.ts):

```
labor cost (per row)  = crew_count × hours × labor_rate      (rounded to cents)
work in place (row)   = labor cost + material_cost + equipment_cost
day total             = Σ rows, summed in integer cents, converted once
labor-hours (row)     = crew_count × hours
production rate (row) = quantity ÷ labor-hours   (null unless both > 0)
```

`labor_cost` is **not** a column in the table — it is computed everywhere it is
shown, from `crew_count × hours × labor_rate`, so the stored inputs are the
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

## The dependency rule (load-bearing)

> **WIP feeds billing; billing NEVER waits on WIP.**

Recording daily WIP is **optional and additive**. Nothing in the billing path
reads `daily_wip_entries` as a precondition. When the PM records it, the
intent (future slice) is that the pay-app builder arrives pre-filled — "the WIP
locks in and becomes the payment application". When the PM hasn't touched it —
the stated base case — the biller builds applications exactly as before, with
zero degradation.

This rule is why we could ship daily WIP as a pure addition: it can't break
billing because billing doesn't depend on it.

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

## Deferred (later Workspace B slices)

- **Subcontractor progress vs lump-sum commitments** — needs the
  procurement/buyout **commitments** object, which does not exist yet. Sub
  progress tracked against commitments is the same object the buyout arc will
  use.
- **Pay-app pre-fill from WIP** — the "WIP becomes the payment application"
  automation described in the dependency rule.

---

**Next:** [05 — Data model & code map](05-data-model-and-code-map.md).
