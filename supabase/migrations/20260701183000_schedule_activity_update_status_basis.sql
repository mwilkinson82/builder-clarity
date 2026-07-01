ALTER TABLE public.schedule_activity_updates
  ADD COLUMN IF NOT EXISTS status_basis text NOT NULL DEFAULT 'planned_dates';

ALTER TABLE public.schedule_activity_updates
  DROP CONSTRAINT IF EXISTS schedule_activity_updates_status_basis_check;

ALTER TABLE public.schedule_activity_updates
  ADD CONSTRAINT schedule_activity_updates_status_basis_check
    CHECK (status_basis IN (
      'actual',
      'remaining_duration',
      'expected_finish',
      'planned_dates',
      'needs_update'
    ));

CREATE INDEX IF NOT EXISTS schedule_activity_updates_status_basis_idx
  ON public.schedule_activity_updates(project_id, status_basis, data_date DESC);
