# Plan Room Gesture Repair — Route Writes Through Atomic RPCs

## Goal

Live grants revoke authenticated INSERT/UPDATE/DELETE on `estimate_line_items` and `estimate_takeoff_measurements`. Plan Room still uses direct client DML for six user gestures, so create/link/recalculate/delete/group-link/build-line silently fail. Replace those writes with the existing authenticated atomic RPCs, preserve operation-key retention and conflict-review UX, and prove the wiring with tests. No schema changes, no publish.

## Handler-by-handler contract mapping

| Handler in `src/lib/plan-room.functions.ts` | Current DML sites | Replacement RPC (exact) |
|---|---|---|
| `createTakeoffMeasurement` (human + AI create) | insert 1188/1200/1209 + follow-up `syncTakeoffQuantityToLine` | `mutate_estimate_takeoff_measurement_atomic` with `p_action='create'`, `p_measurement_id=null`, `p_expected_version=0`, `p_patch=` full payload, `p_recalculate_from_geometry=true` |
| `updateTakeoffMeasurement` (edit + AI accept/reject) | update 1310/1316 | `mutate_estimate_takeoff_measurement_atomic` with `p_action='update'`, `p_expected_version=currentRow.version`, `p_recalculate_from_geometry` from caller, `p_force_manual`/`p_force_unit` passthrough |
| `recalculateTakeoffSheet` | update loop 1365/1371 | `recalculate_estimate_takeoff_sheet_atomic` with `p_expected_scale_revision=sheet.scale_revision` |
| `deleteTakeoffMeasurement` | delete 1411 + follow-up sync | `mutate_estimate_takeoff_measurement_atomic` with `p_action='delete'`, `p_expected_version=currentRow.version` |
| `syncTakeoffQuantityToLine` (line quantity fold-in) | reads only today, but writes when sync applies | `sync_estimate_takeoff_quantity_atomic` (`p_expected_updated_at=lineRow.updated_at`, `p_quantity`, `p_takeoff_unit`) |
| `buildEstimateLineFromMeasurements` (~L1620–1680) | line insert 1656 + measurement link update 1665 | `create_estimate_line_items_atomic` for the line, then `link_estimate_takeoff_group_atomic` (`p_measurement_ids`, `p_expected_versions=[…]`, `p_line_item_id=<new id>`) |

The pre-migration column-fallback branches (`isMissingCreatedByAiColumn`, `isMissingTakeoffTrustColumn`, `isMissingScopeBriefTakeoffProvenanceColumn`) are removed for the write paths: those columns are live in production, and the RPC owns column shaping. Read-only usage of the helpers stays.

## Operation-key retention

Every one of the six handlers gains a required `operation_key: string` on its input schema. Callers already retain keys for other atomic mutations (see `estimates.functions.ts:985` for the shape). Rules:

- Handler NEVER mints an operation key server-side; it uses the caller-supplied value verbatim.
- On success (RPC returns non-error result) → return `{ …, operation_key }` so the client can release.
- On RPC returning a conflict envelope (`{ conflict: true, … }`) or throw → surface it unchanged; the client keeps the same key and retries.
- `force_manual` / `force_unit` inputs already exist on the client's conflict-review dialog; they are threaded straight into the RPC arguments so the second-attempt semantics stay identical.

## Files to edit

1. `src/lib/plan-room.functions.ts` — replace the six write paths per the table above; add `operation_key` (and where applicable `expected_version`, `expected_updated_at`, `expected_scale_revision`, `force_manual`, `force_unit`) to the six input validators; delete the pre-migration column fallbacks on the write paths only; keep all read-side `dynamicTable(...).select(...)` calls (needed to fetch expected versions/timestamps).
2. `src/routes/_authenticated/estimates.$estimateId.plan-room.tsx` (and any hook helpers under `src/components/estimates/plan-room/`) — call sites pass `operation_key` (mint with `crypto.randomUUID()` on gesture start, cache in a ref keyed by measurement/line id, release on definitive success, reuse on retry). Conflict-review already renders from the returned envelope; only the fetcher arguments change.
3. `src/lib/plan-room.functions.ts` seeder at L500–540 (Harbor demo `measurementRows`) — switched to the atomic RPC as a single `create` per row so a demo seed run from an authenticated session succeeds under the live grants. If the seeder is exclusively invoked from an admin/service path, leave a comment noting this and skip.
4. No changes to `plan-scope-brief-review.functions.ts`, `plan-room-assembly.functions.ts`, `estimates.functions.ts`, `estimate-commercial.functions.ts` — grep confirms those files only *read* the two tables (verified: writes now live only in `plan-room.functions.ts`).

## Tests

New file `scripts/plan-room-rpc-wiring.test.ts` (Vitest, source-wiring style used elsewhere in the repo, e.g. `scripts/team-role-containment.test.ts`):

1. `createTakeoffMeasurement` source contains `mutate_estimate_takeoff_measurement_atomic` and does **not** contain `.insert(` against `estimate_takeoff_measurements`.
2. Same for `updateTakeoffMeasurement` / `deleteTakeoffMeasurement` (action strings `'update'` / `'delete'`).
3. `recalculateTakeoffSheet` source contains `recalculate_estimate_takeoff_sheet_atomic` and passes `p_expected_scale_revision`.
4. `syncTakeoffQuantityToLine` source contains `sync_estimate_takeoff_quantity_atomic` with `p_expected_updated_at`.
5. `buildEstimateLineFromMeasurements` source contains both `create_estimate_line_items_atomic` and `link_estimate_takeoff_group_atomic` in that order, and does not contain `.insert(` against `estimate_line_items` or `.update(` on `estimate_takeoff_measurements`.
6. Each of the six input validators includes `operation_key: z.string()…` — asserted by regex on the file source.
7. Runtime unit test with a fake `context.supabase.rpc` spy: invoking each handler forwards the exact argument object shape (keys and presence of `p_operation_key`, `p_expected_version`/`p_expected_updated_at`/`p_expected_scale_revision`, `p_force_manual`, `p_force_unit`) and returns the RPC payload unchanged.
8. Operation-key retention: two sequential calls to a handler with the same `operation_key` forward that same value both times; only on the success path does the client release (asserted via the returned envelope shape).

## Validation gate

- `bunx eslint src/lib/plan-room.functions.ts src/routes/_authenticated/estimates.$estimateId.plan-room.tsx scripts/plan-room-rpc-wiring.test.ts`
- `bunx vitest run scripts/plan-room-rpc-wiring.test.ts scripts/team-role-containment.test.ts` (nearest sibling suite; add module-specific `npm run test:estimating` if it exists)
- `bunx tsgo --noEmit`
- `bun run build`
- `npm run smoke:phase0`

## Explicit non-goals / open QA to report

- No migration created or applied; the RPCs already exist in live and match the signatures in `src/integrations/supabase/types.ts`.
- RLS/grants unchanged.
- No publish.
- Live authenticated-role QA that must be run manually after merge: (a) create takeoff on Harbor sheet → returns measurement with `operation_key` released; (b) edit takeoff geometry → recalculates; (c) delete takeoff → underlying line quantity syncs; (d) recalculate whole sheet after scale change; (e) group-link two measurements into a new line; (f) same gesture attempted twice offline → server dedupes by `operation_key`.

## Risk / assumption to correct if wrong

Assumption: the six named RPCs return either a success payload or a conflict envelope shape already understood by the existing conflict-review dialog (that dialog was built for the atomic mutations shipped elsewhere). If a handler currently transforms the direct-DML result into a distinct shape the UI depends on, the RPC-mode result will be normalized in the handler to match — no UI code churn.
