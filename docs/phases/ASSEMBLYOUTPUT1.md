# ASSEMBLYOUTPUT1 — Confirmed assembly outputs reach estimate rows deliberately

## Outcome

A confirmed deterministic Assembly Workbench output can feed one estimate row only after the
estimator chooses the destination. The handoff does not let AI choose pricing, a cost-library item,
an estimate row, or a quantity.

## Trust contract

- Only a current, estimator-confirmed assembly can hand off an output.
- The database reloads the normalized output saved by `assembly-engine-v1`; it never trusts a
  client-supplied quantity, unit, formula, label, or estimate id.
- Output and destination units must match. A row already fed by measured takeoff geometry or another
  assembly output is rejected.
- A nonzero hand-entered quantity is never overwritten. The estimator must choose an empty row or
  create a new row.
- Cost-library pricing is optional and estimator-selected. A typed label creates a zero-priced row
  that is visibly marked for later pricing.
- One assembly output can feed one estimate row. One estimate row can receive one assembly output.
- Confirmed links, resyncs, stale states, and detaches append audit events.
- Changing the assembly, its trusted geometry, or the destination-row quantity or unit marks the
  handoff stale. Nothing silently resyncs.
- Detaching preserves the current row quantity as manual; it removes only the active source link.

## Workflow

1. Measure LF or SF with verified scale and estimator-placed geometry.
2. Confirm every assembly input and save the deterministic output set.
3. Select **Send to estimate** beside one saved output.
4. Choose a matching-unit existing row, a matching-unit cost-library item, or a new zero-priced row.
5. Review the source badge and resulting estimate total.
6. If the assembly later changes, review the stale handoff and explicitly resync or detach it.

## Release gate

1. Apply `20260716051641_assembly_output_handoff.sql` through the Lovable connector.
2. Verify both handoff tables are RLS enabled, authenticated users receive SELECT only, anon receives
   no table access, and both RPCs are revoked from PUBLIC and anon.
3. Confirm the handoff RPC rejects unauthenticated callers, unconfirmed or stale assemblies,
   cross-estimate rows, unit mismatches, measured-takeoff rows, nonzero manual quantities, and
   duplicate output or destination links.
4. On a disposable estimate, create a zero-priced row from one confirmed output and verify the
   server-stored quantity, source badge, current link, event, and estimate-total recalculation.
5. Edit the assembly and verify the handoff becomes stale without silently changing the row.
6. Resync, then detach. Confirm detach leaves the last quantity as manual and appends an event.
7. On Harbor, open the output picker without choosing a destination and confirm the total remains
   exactly `$1,606,136.70`.
