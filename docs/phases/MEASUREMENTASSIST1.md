# MEASUREMENTASSIST1 — Estimator-Guided Measurement Planning

## Product boundary

AI is a scope-reading assistant, not the measurement authority.

- AI may read selectable drawing notes and propose a checklist of linear or area takeoffs.
- Every proposal must cite extracted text from the active sheet.
- The estimator decides whether the scope matters, places every endpoint or perimeter, and approves
  every quantity.
- AI does not infer wall assemblies, choose unseen layers, snap geometry, convert length into
  material, or declare a takeoff complete.
- Count discovery remains in the existing symbol workflow.

This boundary is intentional. It uses the model for a repeatable task it can do well—organizing
written scope—while the estimator retains the visual and geometric judgment that determines bid
accuracy.

## Stage 1 — Cited sheet-note checklist (this release)

- Extract selectable PDF text into stable, numbered source lines.
- Send one sheet at a time through the existing Lovable-managed AI provider path.
- Meter one AI credit per sheet review; platform-super-admin reviews remain unmetered.
- Require strict structured output for linear (LF) and area (SF) suggestions.
- Drop any suggestion whose proposed label or LF/SF tool is not supported by the exact excerpt the
  estimator can see; hidden words elsewhere in the extracted line cannot justify the proposal.
- Reject count-like objects as area scope and reject bare room names as measurable scope.
- Build the visible summary, rationale, and rejection warning deterministically from accepted
  evidence; do not display uncited model prose.
- “Start” prepares the existing takeoff tool; it never creates geometry or a quantity.
- If Scale Assurance is not verified, prepare the scope but keep drawing locked until the estimator
  completes the two checks.
- Save the cited source and the estimator-authority statement in the eventual takeoff notes.
- Record operation source context, structured result, token usage, API cost, and credits charged.

## Stage 1 release gate

1. Apply `20260715164134_guided_measurement_assistant.sql` only through Lovable.
2. Verify authenticated access to `estimate_scale_assessments` is SELECT + INSERT only.
3. Confirm `ai_measurement_plan` is accepted by the credit and operation constraints.
4. On Harbor Residence, review notes on a vector-PDF sheet and confirm every suggestion has a
   visible source line and excerpt.
5. Reject/ignore at least one suggestion; prepare another and confirm the correct linear/area tool
   arms only after verified scale.
6. Finish the measurement and confirm its notes state that the estimator placed geometry and final
   quantity.
7. Confirm the takeoff still passes the existing quantity-trust and estimate-sync gates.
8. Confirm an empty/no-text sheet produces no model guess and no saved quantity.

The July 15 Harbor A-100 live review exercised the kill criteria: a valid citation was not enough to
prevent an access panel from becoming SF scope or a bare RESTROOM label from becoming inferred
ceiling work. Those outputs are regression fixtures now. The release cannot advance until the
semantic evidence gate rejects both and replaces placeholder/model-authored explanations with
grounded application copy.

The follow-up A-100 review exposed a second boundary: the full extracted line contained gypsum-board
language, but the displayed excerpt only showed an attic-area fire-code limit. The visible evidence
gate now requires that exact excerpt—not hidden text on the same PDF row—to support both the label
and measurement tool.

## Stage 2 — Evidence navigation and scope queue (implementation release)

- Keep a normalized PDF rectangle with every extracted source line and center a visible highlight
  when the estimator selects its cited note.
- Add a multi-sheet review queue with duplicate-scope warnings. Similar labels remain separate
  decisions because the same scope can legitimately occur on multiple sheets.
- Preserve accepted, rejected, deferred, and completed checklist state per estimate through
  least-privilege decision RPCs; the Data API exposes the queue as read-only.
- Complete a queued item only after a real estimator-drawn takeoff saves on the cited sheet.
- Show which estimate row ultimately receives each measured scope, or state clearly that the
  completed takeoff remains unlinked.
- Record reviewer identity and timestamps for every checklist decision and completion.
- Append every decision and completion to a read-only event trail so reopening scope never erases
  who reviewed it previously.

### Stage 2 release gate

1. Apply `20260715175219_measurement_scope_queue.sql` through the Lovable connector.
2. Verify authenticated receives SELECT only on `estimate_measurement_scope_items` and its event
   trail; anon receives no privileges.
3. Verify both decision RPCs reject unauthenticated users and enforce `can_manage_estimate`.
4. On two Harbor vector-PDF sheets, queue the same supported LF/SF label and confirm the UI warns
   about possible duplicate scope without merging or deleting either decision.
5. Select Evidence from the current sheet and from another sheet; confirm the correct sheet opens,
   zooms, and highlights the cited text without creating geometry.
6. Defer and reject suggestions, refresh the browser, and confirm state, reviewer, and timestamp
   persist.
7. Start one accepted item, complete the takeoff, and confirm the queue changes to Measured only
   after the takeoff save succeeds.
8. Link that takeoff to an estimate row and confirm the destination is named in the queue while the
   estimate total changes only through the existing quantity-trust sync path.

## Stage 3 — Assembly assistance, still human-controlled

- Let the estimator choose an assembly after measuring geometry.
- AI may summarize relevant note requirements and propose assembly inputs with citations.
- The estimator explicitly confirms wall/foundation/MEP layers, waste, height, spacing, laps, and
  productivity assumptions.
- Deterministic formulas—not model prose—convert confirmed inputs into material and labor quantities.
- Every derived quantity remains traceable to geometry, formula version, confirmed inputs, and
  source notes.

Initial enterprise slice:

- The selected trusted LF/SF takeoff opens an Assembly Workbench with interior wall, continuous
  footing, MEP linear-run, and surface-finish templates.
- Every input has its own estimator confirmation; applying an AI-cited proposal deliberately clears
  that confirmation until the estimator reviews it.
- `assembly-engine-v1` previews formulas in the client, while the save RPC independently recomputes
  authoritative outputs in Postgres and writes normalized output rows plus an append-only snapshot.
- AI review uses only completed scope-queue citations, returns no value instead of inventing a
  default, consumes one credit for non-admin users, and retains operation cost/provenance.
- Draft and confirmed assemblies never write estimate quantities automatically. A takeoff quantity,
  scale revision, or trust-status change marks the assembly stale and retains its prior audit event.

## Stage 4 — AI-assisted revision-set matching

- After upload post-processing reads title-block identity, exact normalized sheet numbers and titles
  are paired deterministically when there is one clear prior-sheet match.
- Ambiguous pages may use the existing Lovable-managed OpenAI or Anthropic provider to rank only a
  short list of supplied metadata candidates. Drawing images and geometry are not sent or compared.
- The model cannot invent a sheet identifier, reuse a prior sheet in the same response, or raise its
  confidence above the deterministic evidence score.
- The estimator reviews every revision page and must accept, reject, manually correct, or mark the
  proposal as having no prior match before decisions save.
- Accepted pairs become shortcuts into the existing visual Revision Overlay. They do not archive
  either set, copy a takeoff, retain a scale, or alter an estimate quantity.
- Reviewed state is read-only through the Data API. A manager-only security-definer RPC validates
  same-estimate and earlier-set membership, then appends an audit event for every decision.
- AI is explicit and metered at no more than one credit per 100 ambiguous pages, capped at five
  credits for a 500-page review. Exact-only sets consume no AI credit.

### Stage 4 release gate

1. Apply `20260715205000_plan_revision_matching.sql` only through the Lovable connector.
2. Verify authenticated users have SELECT-only table access, anon has none, and the decision RPC
   rejects non-managers, later-set candidates, cross-estimate sheets, incomplete AI operations, and
   duplicate accepted prior sheets.
3. Upload a renamed Harbor sample revision and confirm title-block processing finishes before the
   match action enables.
4. Confirm an exact sheet-number/title pair is labeled Exact identity and an ambiguous pair is
   labeled AI metadata suggestion; neither may claim a visual comparison.
5. Accept one pair, reject one, manually correct one, and mark one No prior match. Refresh and verify
   all four decisions, reviewer, and timestamps persist.
6. Use an accepted counterpart in Revision Overlay and confirm the correct retained sheet appears
   without moving takeoffs or copying scale.
7. Confirm Harbor remains exactly `$1,606,137` before and after analysis, review, and overlay use.
8. Confirm AI failure creates no saved decision, refunds its credit, and leaves the manual overlay
   selector usable.

## Stage 5 — Estimator-controlled revision impact register

- An accepted sheet pair can open a structured impact review beside the existing visual overlay.
- The estimator—not AI—records whether the pair has no estimating impact, verified impacts, or
  unresolved follow-up.
- Verified impact rows classify added, removed, modified, clarified, coordinated, or unknown scope
  and route it to remeasure, recount, reprice, scope review, or no-quantity-change follow-up.
- Saving adds an immutable review version. Earlier conclusions remain in the audit history instead
  of being overwritten.
- The register never transfers takeoffs, retains scale, changes geometry, or edits an estimate
  quantity. Existing trust and estimate-sync gates remain the only quantity path.
- Tables stay SELECT-only for authenticated Data API users. A narrowly validated manager RPC is the
  only application write path and only accepts an already reviewed, accepted revision pair.

### Stage 5 release gate

1. Apply `20260715210251_933f23c0-f9bd-40da-b4ca-8cc3c4b2580e.sql` only through the Lovable connector.
2. Verify RLS is enabled, authenticated receives SELECT only, anon receives no table access, and
   the save RPC is revoked from PUBLIC and anon.
3. Verify the RPC rejects unauthenticated callers, non-managers, rejected/unmatched pairs,
   unsupported dispositions, malformed impacts, duplicate impact IDs, and more than 100 impacts.
4. On an accepted Harbor revision pair, open the overlay and save a Needs follow-up review with one
   remeasure item. Refresh and confirm reviewer, time, version, and open action persist.
5. Save a second review version that resolves the action. Confirm version 1 remains queryable and
   version 2 is presented as current.
6. Certify another accepted pair as No estimating impact and confirm the database rejects attached
   impact rows for that disposition.
7. Confirm no review creates, updates, or deletes a takeoff; retains a scale; or changes Harbor's
   `$1,606,137` total.

## Stage 6 — Cited revision-note scope assistant

- On an already accepted sheet pair, AI may compare selectable PDF text from the prior and revised
  pages and select estimating-relevant note differences for human review.
- Every candidate must cite visible revision text; a prior citation is retained only when it is a
  valid supplied counterpart. The application rejects unsupported excerpts, unchanged lines,
  administrative issue text, and non-construction scope.
- The model does not see drawing images, geometry, revision clouds, quantities, costs, or takeoff
  data. It cannot assert that scope was added, removed, measured, counted, priced, or changed.
- Adding a candidate creates an unclassified, open Scope review draft. The estimator must inspect
  the overlay, classify the impact, select the follow-up action, and save the review version.
- A completed AI operation, candidate identifier, and server-normalized citations remain attached
  to the saved impact. The save RPC rejects forged or cross-pair provenance.
- One accepted-pair note review consumes at most one AI credit; platform-super-admin reviews remain
  unmetered. Missing selectable text stops before the AI operation or charge.

### Stage 6 release gate

1. Apply `20260715213051_c90abab6-08c4-4b95-a5b9-f1af7f1148cb.sql` only through the Lovable
   connector.
2. Verify both AI constraints accept `ai_revision_scope_review`, the impact RPC remains revoked
   from PUBLIC and anon, and its search path remains empty.
3. On a legitimate accepted vector-PDF pair, review notes and confirm every candidate shows its
   exact revision citation and any supplied prior counterpart.
4. Confirm unsupported, unchanged, and administrative note candidates are omitted by the
   deterministic parser even when returned by the model.
5. Add a candidate and confirm it enters the review as Unclassified + Scope review + Open; AI must
   not assign an impact category or quantity action.
6. Save the estimator-classified review and verify the RPC rebuilt provenance from the completed
   same-estimate, same-pair AI operation rather than trusting client-supplied citations.
7. Confirm missing selectable text creates no operation or credit charge, and provider failure
   marks the operation failed and refunds the credit.
8. Confirm the comparison never changes geometry, scales, takeoffs, line quantities, or Harbor's
   `$1,606,137` total.

## Stage 7 — Cited plan-set Scope Coverage Matrix

- Aggregate the latest completed `ai_measurement_plan` operation for every sheet in the active plan
  set into one estimator-facing matrix.
- Treat the matrix as review coverage, never estimate completeness. An unreviewed row means the
  notes have not been reviewed; a reviewed empty row means no supported LF/SF note candidate
  survived the evidence gate. Neither state means the sheet has no estimating scope.
- Review one selected sheet at a time through the existing metered operation. Do not add a bulk
  “take off this set” action, hidden parallel spend, or a second quantity path.
- Rebuild summaries and rationales deterministically from the retained cited suggestions when
  loading historical operations. Stored model prose is not authoritative UI copy.
- Show the exact sheet, source line, excerpt, proposed LF/SF tool, and any durable estimator queue
  decision. Opening a historical review re-extracts drawing anchors so Note navigation remains
  tied to the retained PDF.
- Keep every accept, reject, defer, measurement completion, and estimate-row link in the existing
  least-privilege measurement scope queue. The matrix is an index over that evidence and history;
  it does not create a new mutable shadow workflow.

### Stage 7 release gate

1. On Crystal Carwash, confirm the matrix is scoped to the active 24-sheet plan set and separates
   Architectural and Structural sheets from their sheet-number prefixes.
2. Confirm the matrix starts with explicit Reviewed / Needs review / Cited candidates / Estimator
   decisions counts and never labels an unreviewed sheet “missing scope.”
3. Review one previously unreviewed vector-PDF sheet from the matrix and confirm exactly one normal
   sheet-review operation runs, the admin remains unmetered, and the new result appears after the
   operation completes.
4. Reopen a prior cited review without another AI call or credit charge; select Note and confirm the
   correct sheet opens with the cited line highlighted.
5. Queue, defer, or reject a candidate in the existing review panel, reopen the matrix, and confirm
   the durable estimator disposition is shown beside the same candidate.
6. Confirm code-limit fragments, directional material fragments, dimensions, location-only
   callouts, and detail captions are omitted even when the model proposes them.
7. Confirm no matrix action creates geometry, changes scale, links a takeoff, edits an estimate row,
   or changes Harbor's `$1,606,137` total.

This stage needs no new database migration. It reads the existing `ai_operations` audit log and
`estimate_measurement_scope_items` decision queue, both already constrained and RLS-protected by
the earlier releases.

## Kill criteria

Stop expansion if the live Harbor review shows uncited suggestions, repeated irrelevant title-block
scope, or a workflow that makes estimators believe AI measured the drawing. Fix the evidence front
end before adding multi-sheet or assembly intelligence.
