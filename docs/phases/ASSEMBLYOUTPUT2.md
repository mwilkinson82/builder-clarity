# ASSEMBLYOUTPUT2 — Estimate-side assembly source trace

## Outcome

An estimator can audit an assembly-fed worksheet quantity without hunting through the Plan Room.
The quantity cell names the exact deterministic output, its saved quantity, its formula version,
and whether the handoff is current or stale. Selecting the trace opens the originating takeoff and
its Assembly Workbench.

## Trust contract

- The estimate loader reads assembly links through the existing SELECT-only, RLS-protected table.
- Source labels, quantities, formula versions, and stale state come from the database link, not from
  client-authored notes.
- A current trace states which confirmed output feeds the row.
- A stale trace says **Assembly needs review** even if a manual edit changed the row's quantity
  source; stale provenance is never hidden by that edit.
- The trace opens the exact trusted measurement by immutable measurement id. It creates no AI
  operation, quantity, price, link, resync, or estimate change.
- Environments waiting for the assembly-output migration retain the generic Assembly badge instead
  of failing the estimate workspace.

## Release gate

1. Open an estimate row currently fed by an assembly output and confirm the trace shows the output
   label, saved quantity/unit, and `assembly-engine-v1`.
2. Select the trace and confirm Plan Room opens the originating sheet, selects the exact takeoff,
   and exposes the confirmed Assembly Workbench.
3. Make a disposable assembly link stale and confirm the estimate row reads **Assembly needs
   review** without silently resyncing.
4. Confirm opening current and stale traces creates no link event and changes no estimate total.
5. Confirm Harbor remains exactly `$1,606,136.70`.
