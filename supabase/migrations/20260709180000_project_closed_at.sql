-- Project close-out lifecycle: a "closed" job is DONE but still viewable (it
-- drops out of the active portfolio and its aggregates, into a collapsed "Closed
-- jobs" section). This is distinct from `archived_at` (archive = removed from the
-- portfolio entirely). null = open/active; a timestamp = closed.
--
-- Portable + guarded (ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS), no
-- seed, no enum. Agents don't apply migrations — application is via Lovable.
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS closed_at timestamptz;

CREATE INDEX IF NOT EXISTS projects_closed_at_idx ON public.projects (closed_at);
