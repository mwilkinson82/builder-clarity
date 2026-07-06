# BILLINGDESIGN.md — Billing Module Architecture (design record)

Founder design session, July 3, 2026. This document is the durable "why"
behind the billing roadmap. Specs reference it; it changes only by founder
decision.

## The anchor-tenant thesis
The billing module's guaranteed daily user is NOT the project manager — it is
the billing/accounting person who already exists at every contracting
company. PMs hold outsized power in contracting orgs (owners can't afford to
lose them) and adopt only what proves itself; the back office adopts what
the owner directs. Therefore the module is built for the biller first, and
the PM's tooling must be additive, optional, and self-evidently valuable.

## Two workspaces, one spine

**Workspace A — Getting Paid (the biller's home).** Her existing ritual,
optimized, never overturned: update the SOV → build the payment application
(invoice OR formal AIA G702/G703 — a minority of companies require AIA, and
those are exactly the ones with lenders/owners' reps) → send → then the
other 25 days of her month: the receivables cockpit — aging, days
until due / overdue, sent-to and paid status, payment notifications,
collections cues, recorded payments, change orders carried with their own
billed percent.

**Workspace B — the Daily WIP (the PM's ritual, later phase).** What the
company expended and earned TODAY: crew size x hours x rate against
activities (self-perform), subcontractor progress tracked against lump-sum
commitments (the same commitments object as the procurement/buyout arc),
materials and equipment, production rates as a byproduct.

**The dependency rule (load-bearing):** WIP feeds billing; billing NEVER
waits on WIP. When WIP entries exist, the pay-app builder arrives pre-filled
(the WIP "locks in and becomes the payment application"). When the PM hasn't
touched it — the stated base case — the biller builds applications manually
exactly as today, with zero degradation.

**The spine:** SOV lines + cost codes. The PM's daily labor, the biller's
monthly application, and the IOR's forecasted-final are the same numbers at
different speeds.

## Sequencing (founder decision)
1. Workspace A polish first (GETTINGPAID1) — hardening a guaranteed-use
   surface, mostly existing bones.
2. WIP as its own later phase, launched WITH founder-led Circle education —
   adoption via teaching, not via UI presence.
3. QuickBooks integration as a named future phase (most companies run QB for
   the corporate-level books). Design consequence NOW: cost codes carry a QB
   mapping concept when the cost-coding pass happens; sync starts as export,
   earns two-way later.

## Out of scope by design
- Forcing PMs into billing flows. - Blocking any billing action on WIP data.
- Accounting-of-record features (GL, payroll) — QB remains the books;
  Overwatch is the job-cost and receivables truth.

## Build-out roadmap (founder review 2026-07-06)

Verified current state (read from code, not assumed):
- ✅ **Prior-billing memory is real and correct.** A new application pulls the
  previous app (`apps[i-1]`) and carries its to-date into this app's "from
  previous" columns — proper G703 D/E/F/G (`billing.functions.ts`,
  `billing-line-generation.ts`, `aia-math.ts`). Surfaced today as the
  "Previous certified" total on the this-period screen.
- ✅ **Accounting WIP schedule exists** (billings-to-date vs cost-to-date →
  over/under billed). This is NOT the same as date-specific daily WIP.
- ✅ Pay-app builder is a 4-step guide (Format → SOV → This-period → Generate),
  editable, approvable; downloads a G702/G703 PDF. Email infra exists
  (`src/lib/email-templates/*`, incl. invoice + IOR notifications).
- ❌ Gaps: emailing the AIA package; a strict "one path to build the bill"
  spine; **date-specific daily WIP tied to daily reports** (= Workspace B,
  already designed above, not built); a **standard reports suite**; and the AIA
  PDF formatting fixes (prep-date/logo overlap, CO row height, G703 grid lines,
  step-4 download bug).

Phases (build one, sign-off, deploy, QA, next — the budget-engine cadence):

- **P1 — The bill is a spine (biller's daily path).** One sequential build:
  Format → SOV → this-period % → review → **finalize** → **download AND email**.
  Surface the carry-forward "previous" per line so the memory is unmistakable
  and trusted. Add the Budget→SOV cue so nobody bills at cost. *Starting first.*
- **P2 — Workspace B: date-specific daily WIP.** Pick a date; record that day's
  work-in-place (crew×hours×rate self-perform, sub progress vs commitments,
  materials/equipment); open any past day to see its daily report + WIP; and
  when WIP exists the pay-app builder arrives pre-filled (dependency rule).
- **P3 — Standard reports suite** (founder picked all four, 2026-07-06):
  **WIP report** (over/under billing), **Job cost** (budget vs actual vs
  committed vs projected), **Billing/requisition history** (AIA application +
  payment log), and **Retainage held + CO log + contract summary**. Each
  filterable, printable to clean PDF, exportable to CSV. Job-cost/receivables
  truth only — GL/payroll stays in QB.
- **P4 — AIA PDF formatting + emailable.** The printout fix list + package email
  (overlaps P1's email). "Printed with no overlap, formatted correctly."

Retainage default was already moved to a per-project setting (10% fallback) in
GETTINGPAID3 — that item is done.
