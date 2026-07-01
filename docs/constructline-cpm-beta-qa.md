# ConstructLine CPM Beta QA

Last verified: 2026-07-01
Verified runtime commit: `6e8c8599abf10c51f5dfd337f80e4cd4728a5d28`

## Scope

This checklist covers the CPM schedule workspace requirements for WBS hierarchy, faster WBS ordering feedback, CPM print identity, full-width schedule operations, lookahead filters, templates, Risk Tally handoff, delay impacts, and default schedule presentation.

## Verified Requirements

| Requirement | Evidence |
| --- | --- |
| WBS reorder gives immediate feedback while save confirms in the background | `scripts/constructline-cpm-smoke.ts` asserts `queueWbsReorder`, `WBS_ORDER_SAVE_DEBOUNCE_MS = 75`, optimistic cache update, immediate `WBS order applied` toast, and background confirmation copy. |
| WBS supports parent/child sections such as `03 - Concrete / Northwest corner` | CPM smoke builds parent and child WBS rows, verifies child ordering, and checks `Concrete / Northwest corner`, `Southwest corner`, and `Eastern corner` UI copy. |
| WBS manager supports drag/drop nesting and top-level drop | CPM smoke asserts `WBS / area manager`, `Add child area`, `Nest under`, and `Drop here to make top-level WBS`. |
| Schedule workspace opens full-width without the project side rail | Phase smoke checks the dedicated schedule route; CPM smoke asserts `Open full schedule workspace`, `workspaceMode="full"`, and route shell `overflow-x-clip`. |
| Full workspace includes schedule operations below CPM grid | CPM smoke asserts Schedule Update History, Interim Milestones, Critical Delayed Decisions, Procurement Risks, and Trade Performance Risks. |
| CPM grid is the main anchor in the schedule workspace | CPM smoke asserts the screen grid owns `matrixId="cpm-grid"` rather than the print-only matrix. |
| Fit view is the default scale | CPM smoke asserts `CONSTRUCTLINE_FIT_DAY_PX` is used as the initial zoom state. |
| Logic lines are on by default | CPM smoke asserts `const [showLogicLines, setShowLogicLines] = useState(true);`. |
| Start-date order is the default schedule order | CPM smoke asserts `useState<ScheduleActivityOrder>("start")`. |
| 1-week, 2-week, and 6-week lookahead filters exist | CPM smoke asserts the filter labels, report labels, and day windows: 7, 14, and 42 days. |
| CPM templates can be saved/applied, with browser fallback if shared storage is unavailable | CPM smoke asserts the template UI, browser storage key, save/import mutations, and user-facing fallback copy. |
| Activity detail can send a CPM item to Risk Tally | CPM smoke asserts `Send to Risk Tally`, exposure creation, schedule-impact weeks, and zero-dollar initial exposure for pricing. |
| Delay impacts show on the Gantt side | CPM smoke asserts delay extension finish dates, Gantt extension/marker classes, and delay extension copy. |
| Print identifies company, report type, critical path, finish, data date, and legend | CPM smoke asserts Critical Path Report, company/report footer labels, critical path finish, print report strip, and 11 x 17 landscape print CSS. |
| Product UI does not expose Lovable/Supabase migration wording | CPM smoke rejects user-facing `Lovable still needs`, `schedule_delay_fragments migration`, setup-state, and backend template setup wording. |
| Matrix, modal, WBS manager, and print layout have repeatable overflow/text-fit guards | `npm run test:cpm:layout` asserts the full-width route, fit-mode timeline sizing, shared table/Gantt scroll surface, shared table columns, modal `overflow-x-hidden`, WBS manager responsive sizing, text truncation guards, and 11 x 17 print overflow rules. |

## Commands Run

```bash
npm run test:cpm
npm run test:cpm:layout
./node_modules/.bin/eslint src/components/outcome/ScheduleRisk.tsx 'src/routes/_authenticated/projects.$projectId.schedule.tsx' src/lib/schedule.functions.ts scripts/constructline-cpm-smoke.ts
./node_modules/.bin/tsc --noEmit
npm run smoke:phase0
npm run build
git diff --check
git ls-remote origin refs/heads/main
```

Results:

- `npm run test:cpm`: passed.
- `npm run test:cpm:layout`: passed.
- Scoped ESLint: passed.
- TypeScript: passed.
- `npm run smoke:phase0`: `99 passed, 0 failed, 1 warning`.
- `npm run build`: passed with existing TanStack/Radix warnings.
- `git diff --check`: passed.
- GitHub `main` at runtime verification: `6e8c8599abf10c51f5dfd337f80e4cd4728a5d28`.

## Remaining Limitation

Authenticated browser interaction QA is not complete in this Codex session because the controllable in-app browser redirects to `/auth`, and local Mac browser control timed out. The code, build, smoke, lint, and type checks are green, but final click-through QA for WBS drag/drop, modal save, print preview, and Risk Tally handoff still requires an authenticated browser session.
