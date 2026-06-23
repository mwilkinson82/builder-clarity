# Phase 0 Smoke Test

Use this before telling Contractor Circle members to rely on Overwatch after a publish.

## Static Repo Gate

Run this locally before pushing or after pulling Lovable work:

```bash
npm run smoke:phase0
npm run build
```

The smoke command checks the pieces that have broken during rollout:

- Magic-link auth, callback, portfolio, team, project, and client portal routes are generated.
- Project creation and direct project navigation are wired.
- SOV import, reusable SOV mapping profiles, schedule-to-risk allocation, linked to-do, risk delete, pay app, daily report, and client portal write paths exist with user-facing toasts.
- Migrations include the tables, columns, grants, RLS, and RPCs that the UI expects.

## Live Custom Domain Gate

After Lovable publishes, run:

```bash
npm run smoke:phase0:live
```

This checks that `https://overwatch.alpcontractorcircle.com` responds on the public, auth, and client portal surfaces. It does not click a magic link because that requires a real inbox session.

## Manual Member Workflow

Use a real member account on `https://overwatch.alpcontractorcircle.com`.

1. Request a magic link and confirm it lands on Portfolio.
2. Open Harbor Residence and confirm the demo IOR is visible.
3. Create a new project with a job number, client, PM, contract, budget, baseline date, and forecast date.
4. Import a messy SOV spreadsheet. Confirm SOV lines are grouped by division/code and searchable. Save the successful mapping profile, start a second import, and confirm the saved mapping can be reapplied.
5. Add or edit a schedule update.
6. Add a schedule risk and create a risk allocation from it.
7. Open Risk Tally and confirm the schedule allocation appears in E-holds or C-holds.
8. Create a linked to-do from the risk row.
9. Delete a test risk and confirm the table updates.
10. Add a pay app and confirm Billing totals update.
11. Add a daily report with one attachment, mark it client-visible, and confirm it saves.
12. Add a client contact, toggle COs/Daily/Billing intentionally, and send a client magic link.
13. Open the client portal link in a separate signed-in browser profile.
14. Approve or reject one shared change order and confirm the contractor-side status updates.

## Pass Standard

Phase 0 is ready when the workflow above can be run twice on the custom domain without schema-cache failures, dead buttons, blank pages, or silent saves.
