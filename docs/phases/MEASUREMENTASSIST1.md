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

## Kill criteria

Stop expansion if the live Harbor review shows uncited suggestions, repeated irrelevant title-block
scope, or a workflow that makes estimators believe AI measured the drawing. Fix the evidence front
end before adding multi-sheet or assembly intelligence.
