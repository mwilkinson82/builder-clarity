-- Daily WIP — link an entry to the CPM schedule activity it progressed (Workspace
-- B follow-up, slice 3).
--
-- Founder intent: the day's work should tie to both the SOV line (already carried
-- by cost_bucket_id → cost_buckets) AND the CPM schedule activity it moved. This
-- adds the schedule side: a nullable FK to public.schedule_activities so a PM can
-- tag the entry to a WBS activity, or leave it untagged.
--
-- Portable + additive: nullable, ON DELETE SET NULL (deleting a schedule activity
-- just unlinks the WIP entry, never cascades away the day's cost record). Guarded
-- so it no-ops where the columns/table already differ.

ALTER TABLE public.daily_wip_entries
  ADD COLUMN IF NOT EXISTS schedule_activity_id uuid
    REFERENCES public.schedule_activities(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS daily_wip_entries_schedule_activity_idx
  ON public.daily_wip_entries(schedule_activity_id);

COMMENT ON COLUMN public.daily_wip_entries.schedule_activity_id IS
  'The CPM schedule activity (public.schedule_activities) this day''s work progressed. Nullable = untagged.';
