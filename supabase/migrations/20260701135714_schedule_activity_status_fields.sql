ALTER TABLE public.schedule_activities
  ADD COLUMN IF NOT EXISTS baseline_start_date date,
  ADD COLUMN IF NOT EXISTS baseline_finish_date date,
  ADD COLUMN IF NOT EXISTS forecast_start_date date,
  ADD COLUMN IF NOT EXISTS forecast_finish_date date,
  ADD COLUMN IF NOT EXISTS actual_start_date date,
  ADD COLUMN IF NOT EXISTS actual_finish_date date,
  ADD COLUMN IF NOT EXISTS remaining_duration_days integer;

ALTER TABLE public.schedule_activities
  DROP CONSTRAINT IF EXISTS schedule_activities_remaining_duration_days_check;

ALTER TABLE public.schedule_activities
  ADD CONSTRAINT schedule_activities_remaining_duration_days_check
  CHECK (
    remaining_duration_days IS NULL OR
    (remaining_duration_days >= 0 AND remaining_duration_days <= 5000)
  );

UPDATE public.schedule_activities
SET
  baseline_start_date = COALESCE(baseline_start_date, start_date),
  baseline_finish_date = COALESCE(baseline_finish_date, finish_date),
  forecast_start_date = COALESCE(forecast_start_date, start_date),
  forecast_finish_date = COALESCE(forecast_finish_date, finish_date),
  actual_start_date = CASE
    WHEN percent_complete > 0 THEN COALESCE(actual_start_date, start_date)
    ELSE actual_start_date
  END,
  actual_finish_date = CASE
    WHEN percent_complete >= 100 THEN COALESCE(actual_finish_date, finish_date)
    ELSE actual_finish_date
  END,
  remaining_duration_days = CASE
    WHEN percent_complete >= 100 THEN COALESCE(remaining_duration_days, 0)
    ELSE remaining_duration_days
  END;

CREATE INDEX IF NOT EXISTS schedule_activities_project_forecast_idx
  ON public.schedule_activities(project_id, forecast_start_date, forecast_finish_date);

CREATE INDEX IF NOT EXISTS schedule_activities_project_status_idx
  ON public.schedule_activities(project_id, percent_complete, remaining_duration_days);
