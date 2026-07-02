-- Records the takeoff unit that fed each line's last sync, alongside the
-- Phase 1 provenance columns (takeoff_quantity / takeoff_synced_at). When
-- takeoff_unit disagrees with the line's unit, the sync only happened through
-- an explicit user override of the unit-mismatch guard, so the override is
-- durably recorded in the sync metadata.

ALTER TABLE public.estimate_line_items
  ADD COLUMN IF NOT EXISTS takeoff_unit varchar(16);
