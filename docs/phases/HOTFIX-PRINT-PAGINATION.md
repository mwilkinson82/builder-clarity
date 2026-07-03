# HOTFIX-PRINT-PAGINATION.md (Claude Code task spec)

Read AGENTS.md. **CPM/Schedule** agent, schedule territory only. Branch:
`schedule/hotfix-print-pagination`. No migrations.

Evidence: founder printed the 11x17 on the live Harbor project (22
activities). Result: 3 pages — page 1 is the report header alone over
whitespace, page 2 is the full grid (which renders well), page 3 is ONE
orphaned row (MS-002) plus the footer. The report should be one sheet.

## Task 0 — One-sheet target
For schedules that fit (~25 activities or fewer at current row heights on
11x17 landscape): header strip, grid+Gantt, and footer flow onto ONE page.
Kill whatever break is stranding the header on its own page (likely a
page-break rule or a 100vh-style block in the print shell). The header is a
strip, not a cover page.

## Task 1 — Multi-page behavior for big schedules
When content genuinely exceeds a page: repeat the table column-header row on
every page; orphan control so no page carries fewer than ~4 activity rows
(break earlier instead); the timeline scale bar and footer sit directly under
the last content on the final page, never on a page of their own; report
header strip repeats (compact) on continuation pages.

## Task 2 — Validate and ship
Print the shell to PDF in the gate via headless Chromium at 11x17 landscape
for two fixtures: the 22-activity case (must be exactly 1 page) and a
synthetic 60-activity case (pages balanced, headers repeated, no orphans).
Pin both in the layout smoke. PR titled `Hotfix: 11x17 print pagination —
one sheet when it fits`. Commit this file to docs/phases/.
