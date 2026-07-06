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

## Addendum — founder decisions, 2026-07-06

**1. The bill comes from the SOV — never from daily WIP.** This supersedes the
"the WIP locks in and becomes the payment application" line in the dependency
rule above. The founder's workflow ruling:

> The project manager sits down and figures out what he wants to bill from his
> schedule of values. The PM fills out the SOV — updates percent complete —
> and hands it to accounting. Accounting takes that SOV and creates the
> payment application (AIA or invoice), sends it, and handles the accounting:
> lien waivers, aging, tracking, collections. Accounting doesn't know how much
> work has been done — that's the PM's job. The SOV dictates the period's
> billing. A pay application should NOT come from the daily project-tracking
> WIP, because that may not be accurate.

Consequence: the planned "pay-app pre-fill from WIP" slice is **dead by
design**. Daily WIP (Workspace B) is project tracking — crew×hours×rate,
materials, equipment, production rates. It informs the PM; it never becomes
the bill. The rest of the dependency rule stands: billing never waits on WIP.

**2. The budget is locked; only change orders move it.** Enforced in
BUDGETLOCK1 — see the addendum in [BUDGETENGINE.md](./BUDGETENGINE.md).

**3. Lien waivers named.** The founder listed lien waivers among accounting's
send-out duties (with aging, tracking, collections). Not built today; recorded
here as a future Workspace A item so it isn't lost.
