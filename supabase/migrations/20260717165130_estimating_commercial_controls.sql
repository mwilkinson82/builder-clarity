-- Enterprise estimating commercial controls and cost-price provenance.

ALTER TABLE public.cost_library_items
  ADD COLUMN IF NOT EXISTS source_vendor text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS source_reference text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS effective_date date,
  ADD COLUMN IF NOT EXISTS expires_at date,
  ADD COLUMN IF NOT EXISTS verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS verified_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS escalation_pct integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS version_no integer NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS public.cost_library_price_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cost_library_item_id uuid NOT NULL REFERENCES public.cost_library_items(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  version_no integer NOT NULL,
  material_cost_cents bigint NOT NULL DEFAULT 0,
  labor_cost_cents bigint NOT NULL DEFAULT 0,
  labor_basis text NOT NULL DEFAULT 'per_unit',
  crew_size numeric,
  productivity_per_hour numeric,
  source_vendor text NOT NULL DEFAULT '',
  source_reference text NOT NULL DEFAULT '',
  effective_date date,
  expires_at date,
  escalation_pct integer NOT NULL DEFAULT 0,
  changed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cost_library_price_history_version_unique
    UNIQUE (cost_library_item_id, version_no)
);

CREATE INDEX IF NOT EXISTS cost_library_price_history_item_changed_idx
  ON public.cost_library_price_history(cost_library_item_id, changed_at DESC);

CREATE OR REPLACE FUNCTION public.tg_cost_library_price_history()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF ROW(
    NEW.material_cost_cents,
    NEW.labor_cost_cents,
    NEW.labor_basis,
    NEW.crew_size,
    NEW.productivity_per_hour,
    NEW.source_vendor,
    NEW.source_reference,
    NEW.effective_date,
    NEW.expires_at,
    NEW.escalation_pct
  ) IS DISTINCT FROM ROW(
    OLD.material_cost_cents,
    OLD.labor_cost_cents,
    OLD.labor_basis,
    OLD.crew_size,
    OLD.productivity_per_hour,
    OLD.source_vendor,
    OLD.source_reference,
    OLD.effective_date,
    OLD.expires_at,
    OLD.escalation_pct
  ) THEN
    INSERT INTO public.cost_library_price_history (
      cost_library_item_id,
      organization_id,
      version_no,
      material_cost_cents,
      labor_cost_cents,
      labor_basis,
      crew_size,
      productivity_per_hour,
      source_vendor,
      source_reference,
      effective_date,
      expires_at,
      escalation_pct,
      changed_by
    ) VALUES (
      OLD.id,
      OLD.organization_id,
      OLD.version_no,
      OLD.material_cost_cents,
      OLD.labor_cost_cents,
      OLD.labor_basis,
      OLD.crew_size,
      OLD.productivity_per_hour,
      OLD.source_vendor,
      OLD.source_reference,
      OLD.effective_date,
      OLD.expires_at,
      OLD.escalation_pct,
      auth.uid()
    ) ON CONFLICT (cost_library_item_id, version_no) DO NOTHING;
    NEW.version_no := OLD.version_no + 1;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cost_library_items_price_history ON public.cost_library_items;
CREATE TRIGGER cost_library_items_price_history
  BEFORE UPDATE ON public.cost_library_items
  FOR EACH ROW EXECUTE FUNCTION public.tg_cost_library_price_history();

CREATE TABLE IF NOT EXISTS public.estimate_commercial_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  estimate_id uuid NOT NULL REFERENCES public.estimates(id) ON DELETE CASCADE,
  note_type text NOT NULL CHECK (note_type IN ('assumption', 'exclusion', 'clarification')),
  description text NOT NULL CHECK (length(trim(description)) > 0),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.estimate_alternates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  estimate_id uuid NOT NULL REFERENCES public.estimates(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(trim(name)) > 0),
  description text NOT NULL DEFAULT '',
  amount_cents bigint NOT NULL DEFAULT 0,
  decision text NOT NULL DEFAULT 'pending' CHECK (decision IN ('pending', 'included', 'excluded')),
  sort_order integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.estimate_bid_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  estimate_id uuid NOT NULL REFERENCES public.estimates(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(trim(name)) > 0),
  scope text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'issued', 'leveled', 'awarded')),
  due_date date,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.estimate_vendor_quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  estimate_id uuid NOT NULL REFERENCES public.estimates(id) ON DELETE CASCADE,
  bid_package_id uuid REFERENCES public.estimate_bid_packages(id) ON DELETE SET NULL,
  vendor_name text NOT NULL CHECK (length(trim(vendor_name)) > 0),
  amount_cents bigint NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'received' CHECK (status IN ('invited', 'received', 'qualified', 'selected', 'declined')),
  inclusions text NOT NULL DEFAULT '',
  exclusions text NOT NULL DEFAULT '',
  received_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.estimate_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  estimate_id uuid NOT NULL REFERENCES public.estimates(id) ON DELETE CASCADE,
  version_no integer NOT NULL,
  name text NOT NULL,
  note text NOT NULL DEFAULT '',
  subtotal_cents bigint NOT NULL DEFAULT 0,
  total_cents bigint NOT NULL DEFAULT 0,
  estimate_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  line_items_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT estimate_versions_estimate_number_unique UNIQUE (estimate_id, version_no)
);

CREATE INDEX IF NOT EXISTS estimate_commercial_notes_estimate_idx
  ON public.estimate_commercial_notes(estimate_id, note_type, created_at);
CREATE INDEX IF NOT EXISTS estimate_alternates_estimate_idx
  ON public.estimate_alternates(estimate_id, sort_order, created_at);
CREATE INDEX IF NOT EXISTS estimate_bid_packages_estimate_idx
  ON public.estimate_bid_packages(estimate_id, status, created_at);
CREATE INDEX IF NOT EXISTS estimate_vendor_quotes_package_idx
  ON public.estimate_vendor_quotes(estimate_id, bid_package_id, amount_cents);
CREATE INDEX IF NOT EXISTS estimate_versions_estimate_idx
  ON public.estimate_versions(estimate_id, version_no DESC);

DROP TRIGGER IF EXISTS estimate_commercial_notes_set_updated_at ON public.estimate_commercial_notes;
CREATE TRIGGER estimate_commercial_notes_set_updated_at
  BEFORE UPDATE ON public.estimate_commercial_notes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS estimate_alternates_set_updated_at ON public.estimate_alternates;
CREATE TRIGGER estimate_alternates_set_updated_at
  BEFORE UPDATE ON public.estimate_alternates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS estimate_bid_packages_set_updated_at ON public.estimate_bid_packages;
CREATE TRIGGER estimate_bid_packages_set_updated_at
  BEFORE UPDATE ON public.estimate_bid_packages
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS estimate_vendor_quotes_set_updated_at ON public.estimate_vendor_quotes;
CREATE TRIGGER estimate_vendor_quotes_set_updated_at
  BEFORE UPDATE ON public.estimate_vendor_quotes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.cost_library_price_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.estimate_commercial_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.estimate_alternates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.estimate_bid_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.estimate_vendor_quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.estimate_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY cost_library_price_history_org_select ON public.cost_library_price_history
  FOR SELECT TO authenticated USING (public.is_org_member(organization_id));
CREATE POLICY cost_library_price_history_org_insert ON public.cost_library_price_history
  FOR INSERT TO authenticated WITH CHECK (public.can_manage_org(organization_id));

CREATE POLICY estimate_commercial_notes_select ON public.estimate_commercial_notes
  FOR SELECT TO authenticated USING (public.can_read_estimate(estimate_id));
CREATE POLICY estimate_commercial_notes_insert ON public.estimate_commercial_notes
  FOR INSERT TO authenticated WITH CHECK (public.can_manage_estimate(estimate_id));
CREATE POLICY estimate_commercial_notes_update ON public.estimate_commercial_notes
  FOR UPDATE TO authenticated USING (public.can_manage_estimate(estimate_id))
  WITH CHECK (public.can_manage_estimate(estimate_id));
CREATE POLICY estimate_commercial_notes_delete ON public.estimate_commercial_notes
  FOR DELETE TO authenticated USING (public.can_manage_estimate(estimate_id));

CREATE POLICY estimate_alternates_select ON public.estimate_alternates
  FOR SELECT TO authenticated USING (public.can_read_estimate(estimate_id));
CREATE POLICY estimate_alternates_insert ON public.estimate_alternates
  FOR INSERT TO authenticated WITH CHECK (public.can_manage_estimate(estimate_id));
CREATE POLICY estimate_alternates_update ON public.estimate_alternates
  FOR UPDATE TO authenticated USING (public.can_manage_estimate(estimate_id))
  WITH CHECK (public.can_manage_estimate(estimate_id));
CREATE POLICY estimate_alternates_delete ON public.estimate_alternates
  FOR DELETE TO authenticated USING (public.can_manage_estimate(estimate_id));

CREATE POLICY estimate_bid_packages_select ON public.estimate_bid_packages
  FOR SELECT TO authenticated USING (public.can_read_estimate(estimate_id));
CREATE POLICY estimate_bid_packages_insert ON public.estimate_bid_packages
  FOR INSERT TO authenticated WITH CHECK (public.can_manage_estimate(estimate_id));
CREATE POLICY estimate_bid_packages_update ON public.estimate_bid_packages
  FOR UPDATE TO authenticated USING (public.can_manage_estimate(estimate_id))
  WITH CHECK (public.can_manage_estimate(estimate_id));
CREATE POLICY estimate_bid_packages_delete ON public.estimate_bid_packages
  FOR DELETE TO authenticated USING (public.can_manage_estimate(estimate_id));

CREATE POLICY estimate_vendor_quotes_select ON public.estimate_vendor_quotes
  FOR SELECT TO authenticated USING (public.can_read_estimate(estimate_id));
CREATE POLICY estimate_vendor_quotes_insert ON public.estimate_vendor_quotes
  FOR INSERT TO authenticated WITH CHECK (public.can_manage_estimate(estimate_id));
CREATE POLICY estimate_vendor_quotes_update ON public.estimate_vendor_quotes
  FOR UPDATE TO authenticated USING (public.can_manage_estimate(estimate_id))
  WITH CHECK (public.can_manage_estimate(estimate_id));
CREATE POLICY estimate_vendor_quotes_delete ON public.estimate_vendor_quotes
  FOR DELETE TO authenticated USING (public.can_manage_estimate(estimate_id));

CREATE POLICY estimate_versions_select ON public.estimate_versions
  FOR SELECT TO authenticated USING (public.can_read_estimate(estimate_id));
CREATE POLICY estimate_versions_insert ON public.estimate_versions
  FOR INSERT TO authenticated WITH CHECK (public.can_manage_estimate(estimate_id));

GRANT SELECT, INSERT ON public.cost_library_price_history TO authenticated;
GRANT ALL ON public.cost_library_price_history TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.estimate_commercial_notes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.estimate_alternates TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.estimate_bid_packages TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.estimate_vendor_quotes TO authenticated;
GRANT SELECT, INSERT ON public.estimate_versions TO authenticated;
GRANT ALL ON public.estimate_commercial_notes TO service_role;
GRANT ALL ON public.estimate_alternates TO service_role;
GRANT ALL ON public.estimate_bid_packages TO service_role;
GRANT ALL ON public.estimate_vendor_quotes TO service_role;
GRANT ALL ON public.estimate_versions TO service_role;

REVOKE ALL ON FUNCTION public.tg_cost_library_price_history() FROM PUBLIC;

NOTIFY pgrst, 'reload schema';
