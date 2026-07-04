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
