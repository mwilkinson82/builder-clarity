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
- Drop any suggestion whose source excerpt cannot be resolved to its cited source line.
- Show summary, source evidence, rationale, and direct-vs-review evidence strength.
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

## Stage 2 — Evidence navigation and scope queue

- Highlight the cited note on the drawing when its suggestion is selected.
- Add a multi-sheet review queue with duplicate-scope detection.
- Preserve accepted, rejected, deferred, and completed checklist state per estimate.
- Show which estimate row or cost-library item ultimately received each measured scope.
- Add reviewer identity and timestamps to checklist decisions.

## Stage 3 — Assembly assistance, still human-controlled

- Let the estimator choose an assembly after measuring geometry.
- AI may summarize relevant note requirements and propose assembly inputs with citations.
- The estimator explicitly confirms wall/foundation/MEP layers, waste, height, spacing, laps, and
  productivity assumptions.
- Deterministic formulas—not model prose—convert confirmed inputs into material and labor quantities.
- Every derived quantity remains traceable to geometry, formula version, confirmed inputs, and
  source notes.

## Kill criteria

Stop expansion if the live Harbor review shows uncited suggestions, repeated irrelevant title-block
scope, or a workflow that makes estimators believe AI measured the drawing. Fix the evidence front
end before adding multi-sheet or assembly intelligence.
