# Overwatch Commercial Build-Out Phases

## Purpose

Overwatch is not trying to become Procore all at once. The wedge is narrower and more valuable for Contractor Circle: start with a live financial IOR operating record, then add the client-facing and billing pieces required for a contractor to manage jobs without Buildertrend or Procore for the core workflows.

The anchor remains:

1. Import or build the SOV.
2. Work the schedule.
3. Price the exposure.
4. Convert exposure into action.
5. Show indicated gross profit at project and portfolio level.
6. Produce an IOR report that can run a project management meeting.

## Guardrails

- Contractor Circle members keep open grant access during the current rollout. Hard subscription gates should not block them until billing is intentionally launched.
- The project-level financial dashboard remains the center of gravity. Other modules exist to feed it, not distract from it.
- Client-facing access must be explicit by project and by item. Internal risk notes, margin strategy, and PM-only commentary do not become visible just because a client can log in.
- Every production feature needs a database migration, RLS coverage, a happy-path UI, and a clear failure state.
- Do not chase broad Procore parity yet. RFIs, submittals, specs, insurance, procurement logs, and deep document control are later modules unless a paying customer makes them necessary.

## Current Foundation

Already in the repo:

- Organization, membership, invite, profile, and subscription plan foundation.
- Contractor Circle grant model that lets authenticated Overwatch users create projects during the current rollout.
- Project-level IOR dashboard, schedule, risk tally, to-dos, SOV/costs, billing, change orders, IOR reports, and daily reports.
- Daily report attachments, client-visible flags, and storage accounting fields.
- SOV intake assistant that stages contractor spreadsheets, flags doubtful mappings, and imports reviewed rows.
- Partial risk release model for exposures that are only partially recovered, offset, eliminated, or accepted.
- Basic billing application ledger.

## Phase 0 - Stabilize The Current Rollout

Goal: Contractor Circle members can get in, create projects, import SOVs, and run the core IOR loop without Marshall or support intervention.

Deliverables:

- Verify magic-link login on `overwatch.alpcontractorcircle.com`, including callback routing and direct project navigation.
- Keep project creation open for authenticated Contractor Circle grant users.
- Confirm core write paths do not fail against Lovable Cloud schema cache: project edit, project create, risk create/edit/delete, linked to-do, schedule-to-risk allocation, pay app create/edit/delete, daily report create/edit/upload.
- Add clear toast messages for all create/update/delete actions.
- Preserve SOV review workflow and add import-history visibility so a PM can see what file or paste created the current cost buckets.
- Keep AJ-style builder estimate spreadsheets working without the user reading instructions.

Definition of done:

- A new member can sign in, create a project, import a messy spreadsheet, create a schedule risk, allocate it into the risk tally, create a linked to-do, add a pay app, upload a daily report attachment, and download an IOR report.
- The same flow works from the custom domain, not only the Lovable preview domain.

## Phase 1 - Team Workspace And Portfolio Control

Goal: Companies can run Overwatch as a team, while Marshall can still support and inspect the portfolio rollout.

Deliverables:

- Profile page for each user: name, company, title, phone, default organization, avatar later.
- Team settings page: invite people, revoke invites, change roles, disable members, assign project access.
- Role model in the UI: owner, admin, executive, project manager, member, viewer.
- Project manager assignment on every project.
- Portfolio views:
  - Admin/executive sees all organization projects.
  - PM sees assigned projects and optionally projects where they are a member.
  - Marshall support view can filter by company, PM, GP at risk, indicated GP, schedule variance, and stale IOR review date.
- Activity log for major changes: SOV import, risk edits, releases, pay apps, daily report uploads, project metadata changes, client approvals later.
- Soft entitlement display: project count, seats, daily reports this month, storage used. Show limits without blocking Contractor Circle grants yet.

Definition of done:

- AJ or another member can invite a PM, assign that PM to projects, and the PM sees the right work without seeing unrelated companies.

## Phase 2 - Client Portal MVP

Goal: Give contractors a client-facing side without exposing internal IOR risk strategy.

Deliverables:

- Client contacts per project.
- Client project access table separate from internal organization membership.
- Client magic-link login.
- Client portal routes:
  - Project home: client-safe project summary.
  - Change orders: view, approve, reject, comment.
  - Proposals: view and accept.
  - Invoices/pay applications: view status and payment options later.
  - Daily reports: only reports marked client-visible.
  - Shared documents: controlled project files later.
- Approval records: approver, email, timestamp, IP/user agent if available, decision, notes, source document version.
- Email notifications for client approvals and contractor follow-up.

Definition of done:

- A client can receive a link, open a project-specific portal, approve a change order, and the approval updates the contractor-side change order and IOR financial posture.

## Phase 3 - Billing, Invoices, And Client Money

Goal: Make the billing side strong enough that contractors can run pay applications, invoices, and client payments inside Overwatch.

Deliverables:

- Cost-code model that connects SOV/cost buckets, change orders, pay applications, invoices, and risk exposure.
- Pay application workflow:
  - Draft, submitted, approved, partially paid, paid, overdue, void.
  - Billing period, invoice number, submitted date, due date, retainage, paid-to-date, outstanding, notes.
  - Schedule of values line allocation where needed.
- Invoice/proposal PDF generation with Overwatch branding.
- Email invoice/proposal to client contacts.
- Stripe payment flow:
  - Client pays invoice.
  - Contractor receives payment through the connected flow chosen later.
  - Overwatch can support a transaction fee when commercialized.
- Payment ledger: amount, processor fee, Overwatch fee, net payout, payment status, refund status.
- Export package for accounting: invoice CSV, payment CSV, cost code summary.

Definition of done:

- A contractor can create an invoice from a pay app, send it to a client, accept payment, and see the invoice/payment reflected in billing and portfolio-level cash posture.

## Phase 4 - Commercial Plans And Gating

Goal: Turn the current Contractor Circle grant into a controlled commercial product without breaking current members.

Deliverables:

- Stripe subscriptions for Overwatch plans.
- Plan limits for projects, seats, storage, daily reports, and optional premium modules.
- Admin override/grant model:
  - Contractor Circle grant.
  - Founder/customer comp.
  - Trial.
  - Paid plan.
- Grace periods and non-destructive enforcement. Never delete project data because billing changes.
- Upgrade prompts at natural choke points: creating project above limit, inviting seat above limit, uploading beyond storage, sending client invoices/payments.
- Usage dashboard in organization settings.
- Internal admin panel for support: account status, plan, usage, recent errors, impersonation or support access only if deliberately approved.

Definition of done:

- New public accounts can choose a plan, Contractor Circle members remain comped, and limits are enforced only after the organization is outside a grant or trial.

## Phase 5 - Buildertrend/Procore Replacement Wedge

Goal: Offer a practical replacement for the workflows Contractor Circle members actually use every week.

Core replacement scope:

- Financial IOR dashboard.
- SOV/cost buckets and cost coding.
- Schedule updates and schedule risk.
- Risk tally with E-holds, C-holds, treatment paths, action plans, partial releases, and to-dos.
- Change orders with client approval.
- Daily reports with photo/file attachments and client visibility.
- Pay apps, invoices, payment status, and client payment.
- Client portal.
- IOR reporting and meeting packet export.
- Portfolio dashboard across projects and PMs.

Explicitly deferred:

- Full RFI module.
- Submittals.
- Specification management.
- Insurance and compliance tracking.
- Deep procurement workflows.
- Full document control.
- Field workforce timekeeping.

Definition of done:

- A Contractor Circle company can run active jobs in Overwatch and reasonably cancel Buildertrend/Procore for the workflows listed in the core scope.

## Phase 6 - Platform Maturity

Goal: Make Overwatch durable enough to support more companies, more storage, and more financial workflows without support load exploding.

Deliverables:

- Automated smoke tests for auth, project creation, SOV import, risk release, daily report upload, client approval, invoice/payment.
- Error observability and admin-visible event logs.
- Backup/export strategy.
- Bulk import tools from Buildertrend, Procore, QuickBooks exports, and generic Excel.
- File retention policy by plan.
- Email reminders: stale IOR reviews, overdue to-dos, schedule update due, client approval pending, invoice overdue.
- Better onboarding: sample project, guided SOV import, "first IOR review" checklist.

## Immediate Execution Queue

These are the next repo-backed moves after the SOV intake work:

1. Add SOV import history and mapping profile persistence.
2. Add team settings/profile screens for the organization foundation already in the schema.
3. Add client contacts and client project access tables.
4. Build the first client portal route for change-order approval.
5. Convert pay apps into an invoice lifecycle with status history.
6. Add usage meters to the organization UI while keeping Contractor Circle grant access non-blocking.
7. Add daily report client packet export.
8. Add admin/support portfolio filters for company, PM, GP at risk, indicated GP, schedule variance, stale IOR review, and daily-report activity.
9. Add smoke-test coverage for the current custom-domain member flow.
10. Add Stripe subscription and payment planning once the invoice data model is settled.

## Architecture Notes

- Internal users belong to organizations. Clients should have project-specific access, not organization membership.
- RLS should follow organization membership for internal users and project-client access for clients.
- Storage paths should include organization and project ids so usage can be measured and isolated.
- Money-affecting actions should become auditable events, not silent overwrites.
- Client-visible content should be opt-in per item: daily reports, documents, change orders, invoices, proposals.
- Support access should be explicit and logged.

## Product Positioning

The promise is not "all of Procore, cheaper." The promise is:

"Run every project through the money, see gross profit at risk before it disappears, and give the client enough portal, approval, billing, and daily-report workflow to keep the job moving."

