CREATE TABLE IF NOT EXISTS public.cost_library_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  external_id text NOT NULL DEFAULT '',

  csi_division varchar(8) NOT NULL,
  csi_code varchar(16) NOT NULL DEFAULT '',
  category varchar(64) NOT NULL DEFAULT '',

  description text NOT NULL,
  unit varchar(16) NOT NULL,

  material_cost_cents integer NOT NULL DEFAULT 0 CHECK (material_cost_cents >= 0),
  labor_cost_cents integer NOT NULL DEFAULT 0 CHECK (labor_cost_cents >= 0),

  crew_size numeric(5,1),
  productivity_per_hour numeric(10,2),

  synonyms jsonb NOT NULL DEFAULT '[]'::jsonb,
  keywords jsonb NOT NULL DEFAULT '[]'::jsonb,

  source varchar(32) NOT NULL DEFAULT 'system' CHECK (source IN ('system', 'user', 'imported')),
  base_region varchar(32) NOT NULL DEFAULT 'national',

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT cost_library_description_not_blank CHECK (length(trim(description)) > 0),
  CONSTRAINT cost_library_division_not_blank CHECK (length(trim(csi_division)) > 0),
  CONSTRAINT cost_library_unit_not_blank CHECK (length(trim(unit)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_cost_library_search
  ON public.cost_library_items
  USING gin(to_tsvector('english', description));

CREATE INDEX IF NOT EXISTS idx_cost_library_org_div
  ON public.cost_library_items(organization_id, csi_division);

CREATE INDEX IF NOT EXISTS idx_cost_library_org_category
  ON public.cost_library_items(organization_id, category);

CREATE UNIQUE INDEX IF NOT EXISTS cost_library_system_external_key
  ON public.cost_library_items(organization_id, external_id)
  WHERE source = 'system' AND external_id <> '';

DROP TRIGGER IF EXISTS cost_library_items_set_updated_at ON public.cost_library_items;
CREATE TRIGGER cost_library_items_set_updated_at
  BEFORE UPDATE ON public.cost_library_items
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TABLE IF NOT EXISTS public.estimates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,

  name text NOT NULL,
  description text NOT NULL DEFAULT '',

  opportunity_id uuid,
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,

  project_type varchar(32) NOT NULL DEFAULT 'commercial',
  region varchar(64) NOT NULL DEFAULT '',
  region_multiplier numeric(6,4) NOT NULL DEFAULT 1.0000,

  overhead_pct integer NOT NULL DEFAULT 1000,
  profit_pct integer NOT NULL DEFAULT 1000,
  contingency_pct integer NOT NULL DEFAULT 500,
  bond_pct integer NOT NULL DEFAULT 150,
  tax_pct integer NOT NULL DEFAULT 0,
  general_conditions_pct integer NOT NULL DEFAULT 0,
  custom_markups jsonb NOT NULL DEFAULT '[]'::jsonb,

  subtotal_material_cents bigint NOT NULL DEFAULT 0,
  subtotal_labor_cents bigint NOT NULL DEFAULT 0,
  subtotal_cents bigint NOT NULL DEFAULT 0,
  total_with_markups_cents bigint NOT NULL DEFAULT 0,

  status varchar(16) NOT NULL DEFAULT 'draft',

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT estimates_name_not_blank CHECK (length(trim(name)) > 0),
  CONSTRAINT estimates_status_check CHECK (status IN ('draft', 'final', 'awarded', 'lost')),
  CONSTRAINT estimates_markup_nonnegative CHECK (
    overhead_pct >= 0
    AND profit_pct >= 0
    AND contingency_pct >= 0
    AND bond_pct >= 0
    AND tax_pct >= 0
    AND general_conditions_pct >= 0
  ),
  CONSTRAINT estimates_totals_nonnegative CHECK (
    subtotal_material_cents >= 0
    AND subtotal_labor_cents >= 0
    AND subtotal_cents >= 0
    AND total_with_markups_cents >= 0
  )
);

DO $$
BEGIN
  IF to_regclass('public.pipeline_opportunities') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM pg_constraint
       WHERE conname = 'estimates_opportunity_id_fkey'
         AND conrelid = 'public.estimates'::regclass
     ) THEN
    ALTER TABLE public.estimates
      ADD CONSTRAINT estimates_opportunity_id_fkey
      FOREIGN KEY (opportunity_id)
      REFERENCES public.pipeline_opportunities(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_estimates_org_updated
  ON public.estimates(organization_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_estimates_project
  ON public.estimates(project_id)
  WHERE project_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_estimates_opportunity
  ON public.estimates(opportunity_id)
  WHERE opportunity_id IS NOT NULL;

DROP TRIGGER IF EXISTS estimates_set_updated_at ON public.estimates;
CREATE TRIGGER estimates_set_updated_at
  BEFORE UPDATE ON public.estimates
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TABLE IF NOT EXISTS public.estimate_line_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  estimate_id uuid NOT NULL REFERENCES public.estimates(id) ON DELETE CASCADE,

  csi_division varchar(8) NOT NULL DEFAULT '',
  cost_code varchar(32) NOT NULL DEFAULT '',

  description text NOT NULL,
  unit varchar(16) NOT NULL,
  quantity numeric(14,4) NOT NULL DEFAULT 0 CHECK (quantity >= 0),

  material_unit_cost_cents integer NOT NULL DEFAULT 0 CHECK (material_unit_cost_cents >= 0),
  labor_unit_cost_cents integer NOT NULL DEFAULT 0 CHECK (labor_unit_cost_cents >= 0),

  material_extended_cents bigint GENERATED ALWAYS AS (
    round(quantity * material_unit_cost_cents)::bigint
  ) STORED,
  labor_extended_cents bigint GENERATED ALWAYS AS (
    round(quantity * labor_unit_cost_cents)::bigint
  ) STORED,
  total_extended_cents bigint GENERATED ALWAYS AS (
    round(quantity * (material_unit_cost_cents + labor_unit_cost_cents))::bigint
  ) STORED,

  library_item_id uuid REFERENCES public.cost_library_items(id) ON DELETE SET NULL,

  scope_group text NOT NULL DEFAULT '',
  sort_order integer NOT NULL DEFAULT 0,
  notes text NOT NULL DEFAULT '',

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT estimate_line_description_not_blank CHECK (length(trim(description)) > 0),
  CONSTRAINT estimate_line_unit_not_blank CHECK (length(trim(unit)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_estimate_lines
  ON public.estimate_line_items(estimate_id, sort_order);

CREATE INDEX IF NOT EXISTS idx_estimate_lines_library_item
  ON public.estimate_line_items(library_item_id)
  WHERE library_item_id IS NOT NULL;

DROP TRIGGER IF EXISTS estimate_line_items_set_updated_at ON public.estimate_line_items;
CREATE TRIGGER estimate_line_items_set_updated_at
  BEFORE UPDATE ON public.estimate_line_items
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TABLE IF NOT EXISTS public.estimate_markup_defaults (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL UNIQUE REFERENCES public.organizations(id) ON DELETE CASCADE,

  overhead_pct integer NOT NULL DEFAULT 1000,
  profit_pct integer NOT NULL DEFAULT 1000,
  contingency_pct integer NOT NULL DEFAULT 500,
  bond_pct integer NOT NULL DEFAULT 150,
  tax_pct integer NOT NULL DEFAULT 0,
  general_conditions_pct integer NOT NULL DEFAULT 0,
  custom_markups jsonb NOT NULL DEFAULT '[]'::jsonb,

  default_region varchar(64) NOT NULL DEFAULT '',
  default_region_multiplier numeric(6,4) NOT NULL DEFAULT 1.0000,

  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT estimate_markup_defaults_nonnegative CHECK (
    overhead_pct >= 0
    AND profit_pct >= 0
    AND contingency_pct >= 0
    AND bond_pct >= 0
    AND tax_pct >= 0
    AND general_conditions_pct >= 0
  )
);

DROP TRIGGER IF EXISTS estimate_markup_defaults_set_updated_at ON public.estimate_markup_defaults;
CREATE TRIGGER estimate_markup_defaults_set_updated_at
  BEFORE UPDATE ON public.estimate_markup_defaults
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.cost_library_items TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.estimates TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.estimate_line_items TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.estimate_markup_defaults TO authenticated;

GRANT ALL ON public.cost_library_items TO service_role;
GRANT ALL ON public.estimates TO service_role;
GRANT ALL ON public.estimate_line_items TO service_role;
GRANT ALL ON public.estimate_markup_defaults TO service_role;

ALTER TABLE public.cost_library_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.estimates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.estimate_line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.estimate_markup_defaults ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cost_library_items_org_select ON public.cost_library_items;
CREATE POLICY cost_library_items_org_select
  ON public.cost_library_items
  FOR SELECT
  TO authenticated
  USING (public.is_org_member(organization_id));

DROP POLICY IF EXISTS cost_library_items_org_insert ON public.cost_library_items;
CREATE POLICY cost_library_items_org_insert
  ON public.cost_library_items
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_org_member(organization_id));

DROP POLICY IF EXISTS cost_library_items_user_update ON public.cost_library_items;
CREATE POLICY cost_library_items_user_update
  ON public.cost_library_items
  FOR UPDATE
  TO authenticated
  USING (public.can_manage_org(organization_id) AND source <> 'system')
  WITH CHECK (public.can_manage_org(organization_id) AND source <> 'system');

DROP POLICY IF EXISTS cost_library_items_user_delete ON public.cost_library_items;
CREATE POLICY cost_library_items_user_delete
  ON public.cost_library_items
  FOR DELETE
  TO authenticated
  USING (public.can_manage_org(organization_id) AND source <> 'system');

DROP POLICY IF EXISTS estimates_org_select ON public.estimates;
CREATE POLICY estimates_org_select
  ON public.estimates
  FOR SELECT
  TO authenticated
  USING (public.is_org_member(organization_id));

DROP POLICY IF EXISTS estimates_org_insert ON public.estimates;
CREATE POLICY estimates_org_insert
  ON public.estimates
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_org_member(organization_id) AND created_by = (SELECT auth.uid()));

DROP POLICY IF EXISTS estimates_org_update ON public.estimates;
CREATE POLICY estimates_org_update
  ON public.estimates
  FOR UPDATE
  TO authenticated
  USING (public.is_org_member(organization_id))
  WITH CHECK (public.is_org_member(organization_id));

DROP POLICY IF EXISTS estimates_org_delete ON public.estimates;
CREATE POLICY estimates_org_delete
  ON public.estimates
  FOR DELETE
  TO authenticated
  USING (public.is_org_member(organization_id));

DROP POLICY IF EXISTS estimate_line_items_org_select ON public.estimate_line_items;
CREATE POLICY estimate_line_items_org_select
  ON public.estimate_line_items
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.estimates e
      WHERE e.id = estimate_line_items.estimate_id
        AND public.is_org_member(e.organization_id)
    )
  );

DROP POLICY IF EXISTS estimate_line_items_org_insert ON public.estimate_line_items;
CREATE POLICY estimate_line_items_org_insert
  ON public.estimate_line_items
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.estimates e
      WHERE e.id = estimate_line_items.estimate_id
        AND public.is_org_member(e.organization_id)
    )
  );

DROP POLICY IF EXISTS estimate_line_items_org_update ON public.estimate_line_items;
CREATE POLICY estimate_line_items_org_update
  ON public.estimate_line_items
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.estimates e
      WHERE e.id = estimate_line_items.estimate_id
        AND public.is_org_member(e.organization_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.estimates e
      WHERE e.id = estimate_line_items.estimate_id
        AND public.is_org_member(e.organization_id)
    )
  );

DROP POLICY IF EXISTS estimate_line_items_org_delete ON public.estimate_line_items;
CREATE POLICY estimate_line_items_org_delete
  ON public.estimate_line_items
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.estimates e
      WHERE e.id = estimate_line_items.estimate_id
        AND public.is_org_member(e.organization_id)
    )
  );

DROP POLICY IF EXISTS estimate_markup_defaults_org_select ON public.estimate_markup_defaults;
CREATE POLICY estimate_markup_defaults_org_select
  ON public.estimate_markup_defaults
  FOR SELECT
  TO authenticated
  USING (public.is_org_member(organization_id));

DROP POLICY IF EXISTS estimate_markup_defaults_org_insert ON public.estimate_markup_defaults;
CREATE POLICY estimate_markup_defaults_org_insert
  ON public.estimate_markup_defaults
  FOR INSERT
  TO authenticated
  WITH CHECK (public.can_manage_org(organization_id));

DROP POLICY IF EXISTS estimate_markup_defaults_org_update ON public.estimate_markup_defaults;
CREATE POLICY estimate_markup_defaults_org_update
  ON public.estimate_markup_defaults
  FOR UPDATE
  TO authenticated
  USING (public.can_manage_org(organization_id))
  WITH CHECK (public.can_manage_org(organization_id));

DROP POLICY IF EXISTS estimate_markup_defaults_org_delete ON public.estimate_markup_defaults;
CREATE POLICY estimate_markup_defaults_org_delete
  ON public.estimate_markup_defaults
  FOR DELETE
  TO authenticated
  USING (public.can_manage_org(organization_id));
