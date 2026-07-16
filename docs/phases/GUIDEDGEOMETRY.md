# Guided Geometry — AI location hints for linear and area takeoff

## Outcome

Overwatch can use a cited drawing note plus the full-sheet image to mark a likely
linear route or area region. The markup is an investigation aid, not takeoff
geometry. It never calculates or syncs a quantity.

The estimator remains responsible for:

- accepting or rejecting the marked scope;
- confirming or replacing its label;
- completing two-check Scale Assurance;
- placing the actual vertices with magnetic ink and committed-geometry snapping;
- reviewing the calculated LF or SF quantity before it can feed an estimate row.

## Workflow

1. **Review Notes** extracts selectable PDF notes and renders a bounded full-sheet
   image before any AI credit is charged.
2. Each cited line carries its normalized printed-text anchor into the review so
   the model can reconcile the note with the same full-sheet image.
3. When OpenAI is configured, this single quality-first review uses the Responses
   API, `gpt-5.6-sol` by default, original image detail, and a strict JSON schema.
   The high-volume symbol-count workflow keeps its separate fast model path.
4. The vision provider returns cited LF/SF suggestions. It may include normalized
   guide points only when it can visually locate the scope. A bounded inspection
   region is valid; it is intentionally not a measured perimeter.
5. The application independently validates every guide. Out-of-bounds,
   degenerate, oversized, and self-intersecting geometry is discarded while the
   cited checklist item can remain.
6. Valid hints render as numbered dashed routes or regions on the drawing.
7. Clicking a hint opens the estimator review bar. The estimator can inspect the
   cited note, label the scope, accept it into the durable scope queue, reject it,
   or save it for later.
8. **Start trusted trace** arms the existing linear or area tool. The AI guide is
   not copied into the takeoff. The estimator places every trusted point.
9. The server recalculates quantity from the estimator geometry, verified sheet
   scale, and current scale revision. The durable scope-queue record links the
   AI operation, estimator decision, and completed takeoff.

## Trust contract

- AI guide points are stored only inside the existing `ai_operations.result`
  audit record.
- The existing `measurement_scope_items` row records accept, reject, defer, and
  completion decisions.
- AI guide points never enter `estimate_takeoff_measurements.geometry`.
- A trusted measurement is still server-calculated from estimator geometry.
- Reopening a prior scope review restores its visual hints without another AI
  call or credit.
- No schema migration is required; this phase deliberately reuses the existing
  operation, scope-queue, scale-assurance, and takeoff-trust records.

## Known limit

The visual hint may identify the wrong run, stop short, or outline the wrong
surface. That is why accepting a markup only accepts it as scope to investigate.
It cannot certify completeness and cannot become a quantity without a separate
estimator trace.
