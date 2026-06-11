
-- 1) Change order type
ALTER TABLE public.change_orders
  ADD COLUMN IF NOT EXISTS co_type text NOT NULL DEFAULT 'other';

-- 2) Schedule milestones
CREATE TABLE IF NOT EXISTS public.schedule_milestones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  baseline_date date,
  forecast_date date,
  status text NOT NULL DEFAULT 'on_track',
  delay_reason text NOT NULL DEFAULT '',
  owner text NOT NULL DEFAULT '',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.schedule_milestones TO authenticated;
GRANT ALL ON public.schedule_milestones TO service_role;
ALTER TABLE public.schedule_milestones ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners manage their schedule milestones"
  ON public.schedule_milestones FOR ALL
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.owner_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.owner_id = auth.uid()));
CREATE TRIGGER schedule_milestones_updated_at
  BEFORE UPDATE ON public.schedule_milestones
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- 3) Schedule risks
CREATE TABLE IF NOT EXISTS public.schedule_risks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  kind text NOT NULL,
  title text NOT NULL,
  detail text NOT NULL DEFAULT '',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.schedule_risks TO authenticated;
GRANT ALL ON public.schedule_risks TO service_role;
ALTER TABLE public.schedule_risks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners manage their schedule risks"
  ON public.schedule_risks FOR ALL
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.owner_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.owner_id = auth.uid()));
CREATE TRIGGER schedule_risks_updated_at
  BEFORE UPDATE ON public.schedule_risks
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
