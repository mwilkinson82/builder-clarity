-- VENDORS — org-level directory (field request, DB3T 2026-07-09 late: "i think
-- database for vendors should exist also just like subs and have this be a
-- dropdown... and can pick either vendors or subs").
--
-- One table, mirroring public.subcontractors exactly (same shape, same trigger,
-- same four RLS policies — is_org_member reads/creates, can_manage_org
-- edits/deletes, system rows immutable). The cost-entry form's Vendor field
-- becomes a pick-or-add over this directory PLUS the subcontractors directory;
-- cost_actuals.vendor stays a plain text column — the directory feeds the
-- picker, it does not become a foreign key (imported CSVs and legacy rows keep
-- working untouched).
--
-- Idempotent + portable. Migration desk applies this.

CREATE TABLE IF NOT EXISTS public.vendors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  trade text NOT NULL DEFAULT '',
  contact_name text NOT NULL DEFAULT '',
  contact_email text NOT NULL DEFAULT '',
  contact_phone text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  source varchar(32) NOT NULL DEFAULT 'user' CHECK (source IN ('system','user','imported')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vendors_name_not_blank CHECK (length(trim(name)) > 0)
);
CREATE INDEX IF NOT EXISTS vendors_org_idx ON public.vendors(organization_id);
CREATE UNIQUE INDEX IF NOT EXISTS vendors_org_name_unique
  ON public.vendors(organization_id, lower(trim(name)));

DROP TRIGGER IF EXISTS vendors_set_updated_at ON public.vendors;
CREATE TRIGGER vendors_set_updated_at
  BEFORE UPDATE ON public.vendors
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.vendors TO authenticated;
GRANT ALL ON public.vendors TO service_role;
ALTER TABLE public.vendors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vendors_org_select ON public.vendors;
CREATE POLICY vendors_org_select ON public.vendors
  FOR SELECT USING (public.is_org_member(organization_id));
DROP POLICY IF EXISTS vendors_org_insert ON public.vendors;
CREATE POLICY vendors_org_insert ON public.vendors
  FOR INSERT WITH CHECK (public.is_org_member(organization_id));
DROP POLICY IF EXISTS vendors_user_update ON public.vendors;
CREATE POLICY vendors_user_update ON public.vendors
  FOR UPDATE USING (public.can_manage_org(organization_id) AND source <> 'system')
  WITH CHECK (public.can_manage_org(organization_id) AND source <> 'system');
DROP POLICY IF EXISTS vendors_user_delete ON public.vendors;
CREATE POLICY vendors_user_delete ON public.vendors
  FOR DELETE USING (public.can_manage_org(organization_id) AND source <> 'system');
