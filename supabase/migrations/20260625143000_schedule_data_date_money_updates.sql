ALTER TABLE public.schedule_updates
  ADD COLUMN IF NOT EXISTS data_date date,
  ADD COLUMN IF NOT EXISTS schedule_money_exposure numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS schedule_money_recovery numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS schedule_money_net numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS money_notes text NOT NULL DEFAULT '';

UPDATE public.schedule_updates
SET
  data_date = COALESCE(data_date, update_date),
  schedule_money_exposure = COALESCE(schedule_money_exposure, 0),
  schedule_money_recovery = COALESCE(schedule_money_recovery, 0),
  schedule_money_net = COALESCE(schedule_money_exposure, 0) - COALESCE(schedule_money_recovery, 0),
  money_notes = COALESCE(money_notes, '')
WHERE
  data_date IS NULL
  OR schedule_money_exposure IS NULL
  OR schedule_money_recovery IS NULL
  OR money_notes IS NULL
  OR schedule_money_net IS DISTINCT FROM COALESCE(schedule_money_exposure, 0) - COALESCE(schedule_money_recovery, 0);

ALTER TABLE public.schedule_updates
  ALTER COLUMN data_date SET DEFAULT current_date;

CREATE OR REPLACE FUNCTION public.tg_schedule_updates_data_date_money()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.data_date := COALESCE(NEW.data_date, NEW.update_date, current_date);
  NEW.update_date := COALESCE(NEW.update_date, NEW.data_date);
  NEW.schedule_money_exposure := COALESCE(NEW.schedule_money_exposure, 0);
  NEW.schedule_money_recovery := COALESCE(NEW.schedule_money_recovery, 0);
  NEW.schedule_money_net := NEW.schedule_money_exposure - NEW.schedule_money_recovery;
  NEW.money_notes := COALESCE(NEW.money_notes, '');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS schedule_updates_data_date_money ON public.schedule_updates;
CREATE TRIGGER schedule_updates_data_date_money
  BEFORE INSERT OR UPDATE ON public.schedule_updates
  FOR EACH ROW EXECUTE FUNCTION public.tg_schedule_updates_data_date_money();

CREATE INDEX IF NOT EXISTS schedule_updates_project_id_data_date_idx
  ON public.schedule_updates(project_id, data_date DESC);
