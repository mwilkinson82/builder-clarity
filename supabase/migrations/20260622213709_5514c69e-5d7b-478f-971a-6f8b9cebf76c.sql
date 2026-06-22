ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS job_number text NOT NULL DEFAULT '';

ALTER TABLE public.cost_buckets
  ADD COLUMN IF NOT EXISTS source_type text NOT NULL DEFAULT 'original_sov',
  ADD COLUMN IF NOT EXISTS source_date date,
  ADD COLUMN IF NOT EXISTS source_note text NOT NULL DEFAULT '';

ALTER TABLE public.schedule_risks
  ADD COLUMN IF NOT EXISTS dollar_exposure numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS probability numeric NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS schedule_impact_weeks numeric,
  ADD COLUMN IF NOT EXISTS owner text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS due_date date,
  ADD COLUMN IF NOT EXISTS response_path public.response_path NOT NULL DEFAULT 'recover',
  ADD COLUMN IF NOT EXISTS hold_class public.hold_class NOT NULL DEFAULT 'E-Hold',
  ADD COLUMN IF NOT EXISTS linked_exposure_id uuid REFERENCES public.exposures(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.billing_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  application_number text NOT NULL DEFAULT '', invoice_number text NOT NULL DEFAULT '',
  submitted_date date, due_date date, billing_period text NOT NULL DEFAULT '',
  contract_amount numeric NOT NULL DEFAULT 0, change_order_amount numeric NOT NULL DEFAULT 0,
  amount_billed numeric NOT NULL DEFAULT 0, paid_to_date numeric NOT NULL DEFAULT 0,
  retainage numeric NOT NULL DEFAULT 0, status text NOT NULL DEFAULT 'draft',
  notes text NOT NULL DEFAULT '', sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.billing_applications TO authenticated;
GRANT ALL ON public.billing_applications TO service_role;
ALTER TABLE public.billing_applications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS billing_applications_owner_via_project ON public.billing_applications;
CREATE POLICY billing_applications_owner_via_project ON public.billing_applications FOR ALL
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id=billing_applications.project_id AND p.owner_id=auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id=billing_applications.project_id AND p.owner_id=auth.uid()));
DROP TRIGGER IF EXISTS billing_applications_set_updated_at ON public.billing_applications;
CREATE TRIGGER billing_applications_set_updated_at BEFORE UPDATE ON public.billing_applications FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE INDEX IF NOT EXISTS billing_applications_project_id_idx ON public.billing_applications(project_id);

DO $$ BEGIN CREATE TYPE public.account_role AS ENUM ('owner','admin','executive','project_manager','member','viewer'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.member_status AS ENUM ('pending','active','disabled'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.invite_status AS ENUM ('pending','accepted','revoked','expired'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.project_member_role AS ENUM ('owner','manager','editor','viewer'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.subscription_plans (
  code text PRIMARY KEY, name text NOT NULL, monthly_price_cents integer NOT NULL DEFAULT 0,
  project_limit integer, seat_limit integer, storage_limit_mb integer, daily_report_limit_per_month integer,
  is_public boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL DEFAULT '', full_name text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '', company_title text NOT NULL DEFAULT '',
  avatar_url text NOT NULL DEFAULT '', default_organization_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, slug text NOT NULL DEFAULT '',
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  plan_code text NOT NULL DEFAULT 'contractor_circle_free' REFERENCES public.subscription_plans(code),
  billing_status text NOT NULL DEFAULT 'contractor_circle_grant',
  stripe_customer_id text NOT NULL DEFAULT '', stripe_subscription_id text NOT NULL DEFAULT '',
  project_limit integer NOT NULL DEFAULT 10, seat_limit integer NOT NULL DEFAULT 25,
  storage_limit_mb integer NOT NULL DEFAULT 10240, daily_report_limit_per_month integer NOT NULL DEFAULT 1000,
  contractor_circle_grant boolean NOT NULL DEFAULT true, trial_ends_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='profiles_default_organization_fkey') THEN
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_default_organization_fkey FOREIGN KEY (default_organization_id) REFERENCES public.organizations(id) ON DELETE SET NULL;
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS public.organization_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.account_role NOT NULL DEFAULT 'member',
  status public.member_status NOT NULL DEFAULT 'active',
  invited_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  invited_email text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id)
);
CREATE TABLE IF NOT EXISTS public.organization_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  email text NOT NULL, role public.account_role NOT NULL DEFAULT 'project_manager',
  status public.invite_status NOT NULL DEFAULT 'pending',
  invited_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  accepted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  accepted_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT (now()+interval '14 days'),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.project_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.project_member_role NOT NULL DEFAULT 'viewer',
  status public.member_status NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, user_id)
);
INSERT INTO public.subscription_plans (code,name,monthly_price_cents,project_limit,seat_limit,storage_limit_mb,daily_report_limit_per_month,is_public) VALUES
  ('contractor_circle_free','Contractor Circle Grant',0,10,25,10240,1000,false),
  ('starter','Overwatch Starter',19900,10,10,10240,1000,true),
  ('growth','Overwatch Growth',49900,50,25,51200,5000,true)
ON CONFLICT (code) DO UPDATE SET name=EXCLUDED.name, monthly_price_cents=EXCLUDED.monthly_price_cents, project_limit=EXCLUDED.project_limit, seat_limit=EXCLUDED.seat_limit, storage_limit_mb=EXCLUDED.storage_limit_mb, daily_report_limit_per_month=EXCLUDED.daily_report_limit_per_month, is_public=EXCLUDED.is_public, updated_at=now();

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS project_manager text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS hold_variance_note text NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS organizations_created_by_idx ON public.organizations(created_by);
CREATE INDEX IF NOT EXISTS organization_memberships_user_idx ON public.organization_memberships(user_id);
CREATE INDEX IF NOT EXISTS organization_memberships_org_idx ON public.organization_memberships(organization_id);
CREATE INDEX IF NOT EXISTS organization_invites_org_idx ON public.organization_invites(organization_id);
CREATE UNIQUE INDEX IF NOT EXISTS organization_invites_pending_email_idx ON public.organization_invites(organization_id, lower(email)) WHERE status='pending';
CREATE INDEX IF NOT EXISTS project_memberships_project_idx ON public.project_memberships(project_id);
CREATE INDEX IF NOT EXISTS project_memberships_user_idx ON public.project_memberships(user_id);
CREATE INDEX IF NOT EXISTS projects_organization_id_idx ON public.projects(organization_id);

GRANT SELECT ON public.subscription_plans TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organizations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organization_memberships TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organization_invites TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_memberships TO authenticated;
GRANT ALL ON public.subscription_plans TO service_role;
GRANT ALL ON public.profiles TO service_role;
GRANT ALL ON public.organizations TO service_role;
GRANT ALL ON public.organization_memberships TO service_role;
GRANT ALL ON public.organization_invites TO service_role;
GRANT ALL ON public.project_memberships TO service_role;

ALTER TABLE public.subscription_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_memberships ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_org_member(p_org_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (SELECT 1 FROM public.organization_memberships m WHERE m.organization_id=p_org_id AND m.user_id=auth.uid() AND m.status='active');
$$;
CREATE OR REPLACE FUNCTION public.can_manage_org(p_org_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (SELECT 1 FROM public.organization_memberships m WHERE m.organization_id=p_org_id AND m.user_id=auth.uid() AND m.status='active' AND m.role IN ('owner','admin','executive'));
$$;
CREATE OR REPLACE FUNCTION public.can_create_project_in_org(p_org_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (SELECT 1 FROM public.organization_memberships m WHERE m.organization_id=p_org_id AND m.user_id=auth.uid() AND m.status='active' AND m.role IN ('owner','admin','executive','project_manager'));
$$;
CREATE OR REPLACE FUNCTION public.can_read_project(p_project_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id=p_project_id AND (
    p.owner_id=auth.uid()
    OR EXISTS (SELECT 1 FROM public.organization_memberships m WHERE m.organization_id=p.organization_id AND m.user_id=auth.uid() AND m.status='active' AND m.role IN ('owner','admin','executive'))
    OR EXISTS (SELECT 1 FROM public.project_memberships pm WHERE pm.project_id=p.id AND pm.user_id=auth.uid() AND pm.status='active')
  ));
$$;
CREATE OR REPLACE FUNCTION public.can_manage_project(p_project_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id=p_project_id AND (
    p.owner_id=auth.uid()
    OR EXISTS (SELECT 1 FROM public.organization_memberships m WHERE m.organization_id=p.organization_id AND m.user_id=auth.uid() AND m.status='active' AND m.role IN ('owner','admin','executive','project_manager'))
    OR EXISTS (SELECT 1 FROM public.project_memberships pm WHERE pm.project_id=p.id AND pm.user_id=auth.uid() AND pm.status='active' AND pm.role IN ('owner','manager','editor'))
  ));
$$;
REVOKE ALL ON FUNCTION public.is_org_member(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_manage_org(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_create_project_in_org(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_read_project(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_manage_project(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_org_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_org(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_create_project_in_org(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_read_project(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_project(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.ensure_user_account(p_user_id uuid, p_email text, p_full_name text DEFAULT '') RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_org_id uuid; v_invite record; v_org_name text;
BEGIN
  INSERT INTO public.profiles (id,email,full_name) VALUES (p_user_id, coalesce(p_email,''), coalesce(p_full_name,''))
  ON CONFLICT (id) DO UPDATE SET email=EXCLUDED.email, full_name=COALESCE(NULLIF(public.profiles.full_name,''), EXCLUDED.full_name), updated_at=now();
  FOR v_invite IN SELECT * FROM public.organization_invites i WHERE lower(i.email)=lower(coalesce(p_email,'')) AND i.status='pending' AND i.expires_at>now() LOOP
    INSERT INTO public.organization_memberships (organization_id,user_id,role,status,invited_by,invited_email)
    VALUES (v_invite.organization_id,p_user_id,v_invite.role,'active',v_invite.invited_by,v_invite.email)
    ON CONFLICT (organization_id,user_id) DO UPDATE SET role=CASE WHEN public.organization_memberships.role IN ('owner','admin') THEN public.organization_memberships.role ELSE EXCLUDED.role END,
      status='active', invited_by=COALESCE(public.organization_memberships.invited_by,EXCLUDED.invited_by),
      invited_email=COALESCE(NULLIF(public.organization_memberships.invited_email,''),EXCLUDED.invited_email), updated_at=now();
    UPDATE public.organization_invites SET status='accepted', accepted_by=p_user_id, accepted_at=now(), updated_at=now() WHERE id=v_invite.id;
    IF v_org_id IS NULL THEN v_org_id := v_invite.organization_id; END IF;
  END LOOP;
  IF v_org_id IS NULL THEN
    SELECT m.organization_id INTO v_org_id FROM public.organization_memberships m WHERE m.user_id=p_user_id AND m.status='active' ORDER BY (m.role='owner') DESC, m.created_at ASC LIMIT 1;
  END IF;
  IF v_org_id IS NULL THEN
    v_org_name := trim(coalesce(nullif(split_part(coalesce(p_email,''),'@',2),''),'Overwatch Team'));
    IF v_org_name='' THEN v_org_name:='Overwatch Team'; END IF;
    INSERT INTO public.organizations (name, created_by) VALUES (initcap(replace(v_org_name,'.',' ')), p_user_id) RETURNING id INTO v_org_id;
    INSERT INTO public.organization_memberships (organization_id,user_id,role,status) VALUES (v_org_id,p_user_id,'owner','active') ON CONFLICT (organization_id,user_id) DO NOTHING;
  END IF;
  UPDATE public.profiles SET default_organization_id=COALESCE(default_organization_id,v_org_id), updated_at=now() WHERE id=p_user_id;
  RETURN v_org_id;
END; $$;

CREATE OR REPLACE FUNCTION public.ensure_current_user_account() RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_user_id uuid; v_email text; v_full_name text;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT u.email, COALESCE(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name','') INTO v_email, v_full_name FROM auth.users u WHERE u.id=v_user_id;
  RETURN public.ensure_user_account(v_user_id, v_email, v_full_name);
END; $$;

CREATE OR REPLACE FUNCTION public.tg_projects_ensure_organization() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_email text; v_full_name text;
BEGIN
  IF NEW.organization_id IS NULL THEN
    SELECT u.email, COALESCE(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name','') INTO v_email, v_full_name FROM auth.users u WHERE u.id=NEW.owner_id;
    NEW.organization_id := public.ensure_user_account(NEW.owner_id, v_email, v_full_name);
  END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.tg_projects_owner_membership() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NEW.organization_id IS NOT NULL AND NEW.owner_id IS NOT NULL THEN
    INSERT INTO public.organization_memberships (organization_id,user_id,role,status) VALUES (NEW.organization_id, NEW.owner_id, 'owner','active') ON CONFLICT (organization_id,user_id) DO NOTHING;
    INSERT INTO public.project_memberships (project_id,user_id,role,status) VALUES (NEW.id, NEW.owner_id, 'owner','active') ON CONFLICT (project_id,user_id) DO NOTHING;
  END IF;
  RETURN NEW;
END; $$;

REVOKE ALL ON FUNCTION public.ensure_user_account(uuid,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ensure_current_user_account() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_current_user_account() TO authenticated;

DROP TRIGGER IF EXISTS projects_ensure_organization ON public.projects;
CREATE TRIGGER projects_ensure_organization BEFORE INSERT ON public.projects FOR EACH ROW EXECUTE FUNCTION public.tg_projects_ensure_organization();
DROP TRIGGER IF EXISTS projects_owner_membership ON public.projects;
CREATE TRIGGER projects_owner_membership AFTER INSERT ON public.projects FOR EACH ROW EXECUTE FUNCTION public.tg_projects_owner_membership();

DROP TRIGGER IF EXISTS subscription_plans_set_updated_at ON public.subscription_plans;
CREATE TRIGGER subscription_plans_set_updated_at BEFORE UPDATE ON public.subscription_plans FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
DROP TRIGGER IF EXISTS profiles_set_updated_at ON public.profiles;
CREATE TRIGGER profiles_set_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
DROP TRIGGER IF EXISTS organizations_set_updated_at ON public.organizations;
CREATE TRIGGER organizations_set_updated_at BEFORE UPDATE ON public.organizations FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
DROP TRIGGER IF EXISTS organization_memberships_set_updated_at ON public.organization_memberships;
CREATE TRIGGER organization_memberships_set_updated_at BEFORE UPDATE ON public.organization_memberships FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
DROP TRIGGER IF EXISTS organization_invites_set_updated_at ON public.organization_invites;
CREATE TRIGGER organization_invites_set_updated_at BEFORE UPDATE ON public.organization_invites FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
DROP TRIGGER IF EXISTS project_memberships_set_updated_at ON public.project_memberships;
CREATE TRIGGER project_memberships_set_updated_at BEFORE UPDATE ON public.project_memberships FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

DO $$
DECLARE v_user record; v_org_id uuid; v_project record;
BEGIN
  FOR v_user IN SELECT u.id, u.email, COALESCE(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name','') AS full_name FROM auth.users u LOOP
    v_org_id := public.ensure_user_account(v_user.id, v_user.email, v_user.full_name);
    UPDATE public.projects SET organization_id=v_org_id WHERE owner_id=v_user.id AND organization_id IS NULL;
  END LOOP;
  FOR v_project IN SELECT id, owner_id, organization_id FROM public.projects WHERE organization_id IS NOT NULL LOOP
    INSERT INTO public.organization_memberships (organization_id,user_id,role,status) VALUES (v_project.organization_id, v_project.owner_id, 'owner','active') ON CONFLICT (organization_id,user_id) DO NOTHING;
    INSERT INTO public.project_memberships (project_id,user_id,role,status) VALUES (v_project.id, v_project.owner_id, 'owner','active') ON CONFLICT (project_id,user_id) DO NOTHING;
  END LOOP;
END $$;

DROP POLICY IF EXISTS subscription_plans_read ON public.subscription_plans;
CREATE POLICY subscription_plans_read ON public.subscription_plans FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS profiles_self_read ON public.profiles;
CREATE POLICY profiles_self_read ON public.profiles FOR SELECT TO authenticated USING (
  id=auth.uid() OR EXISTS (SELECT 1 FROM public.organization_memberships mine JOIN public.organization_memberships theirs ON theirs.organization_id=mine.organization_id WHERE mine.user_id=auth.uid() AND mine.status='active' AND theirs.user_id=profiles.id AND theirs.status='active'));
DROP POLICY IF EXISTS profiles_self_insert ON public.profiles;
CREATE POLICY profiles_self_insert ON public.profiles FOR INSERT TO authenticated WITH CHECK (id=auth.uid());
DROP POLICY IF EXISTS profiles_self_update ON public.profiles;
CREATE POLICY profiles_self_update ON public.profiles FOR UPDATE TO authenticated USING (id=auth.uid()) WITH CHECK (id=auth.uid());

DROP POLICY IF EXISTS organizations_member_read ON public.organizations;
CREATE POLICY organizations_member_read ON public.organizations FOR SELECT TO authenticated USING (public.is_org_member(id));
DROP POLICY IF EXISTS organizations_create_own ON public.organizations;
CREATE POLICY organizations_create_own ON public.organizations FOR INSERT TO authenticated WITH CHECK (created_by=auth.uid());
DROP POLICY IF EXISTS organizations_manage ON public.organizations;
CREATE POLICY organizations_manage ON public.organizations FOR UPDATE TO authenticated USING (public.can_manage_org(id)) WITH CHECK (public.can_manage_org(id));
DROP POLICY IF EXISTS organizations_delete ON public.organizations;
CREATE POLICY organizations_delete ON public.organizations FOR DELETE TO authenticated USING (public.can_manage_org(id));

DROP POLICY IF EXISTS organization_memberships_member_read ON public.organization_memberships;
CREATE POLICY organization_memberships_member_read ON public.organization_memberships FOR SELECT TO authenticated USING (user_id=auth.uid() OR public.is_org_member(organization_id));
DROP POLICY IF EXISTS organization_memberships_manage_insert ON public.organization_memberships;
CREATE POLICY organization_memberships_manage_insert ON public.organization_memberships FOR INSERT TO authenticated WITH CHECK (public.can_manage_org(organization_id));
DROP POLICY IF EXISTS organization_memberships_manage_update ON public.organization_memberships;
CREATE POLICY organization_memberships_manage_update ON public.organization_memberships FOR UPDATE TO authenticated USING (public.can_manage_org(organization_id)) WITH CHECK (public.can_manage_org(organization_id));
DROP POLICY IF EXISTS organization_memberships_manage_delete ON public.organization_memberships;
CREATE POLICY organization_memberships_manage_delete ON public.organization_memberships FOR DELETE TO authenticated USING (public.can_manage_org(organization_id));

DROP POLICY IF EXISTS organization_invites_member_read ON public.organization_invites;
CREATE POLICY organization_invites_member_read ON public.organization_invites FOR SELECT TO authenticated USING (public.is_org_member(organization_id));
DROP POLICY IF EXISTS organization_invites_manage_insert ON public.organization_invites;
CREATE POLICY organization_invites_manage_insert ON public.organization_invites FOR INSERT TO authenticated WITH CHECK (public.can_manage_org(organization_id));
DROP POLICY IF EXISTS organization_invites_manage_update ON public.organization_invites;
CREATE POLICY organization_invites_manage_update ON public.organization_invites FOR UPDATE TO authenticated USING (public.can_manage_org(organization_id)) WITH CHECK (public.can_manage_org(organization_id));
DROP POLICY IF EXISTS organization_invites_manage_delete ON public.organization_invites;
CREATE POLICY organization_invites_manage_delete ON public.organization_invites FOR DELETE TO authenticated USING (public.can_manage_org(organization_id));

DROP POLICY IF EXISTS project_memberships_read ON public.project_memberships;
CREATE POLICY project_memberships_read ON public.project_memberships FOR SELECT TO authenticated USING (user_id=auth.uid() OR public.can_read_project(project_id));
DROP POLICY IF EXISTS project_memberships_manage_insert ON public.project_memberships;
CREATE POLICY project_memberships_manage_insert ON public.project_memberships FOR INSERT TO authenticated WITH CHECK (public.can_manage_project(project_id));
DROP POLICY IF EXISTS project_memberships_manage_update ON public.project_memberships;
CREATE POLICY project_memberships_manage_update ON public.project_memberships FOR UPDATE TO authenticated USING (public.can_manage_project(project_id)) WITH CHECK (public.can_manage_project(project_id));
DROP POLICY IF EXISTS project_memberships_manage_delete ON public.project_memberships;
CREATE POLICY project_memberships_manage_delete ON public.project_memberships FOR DELETE TO authenticated USING (public.can_manage_project(project_id));

DROP POLICY IF EXISTS projects_team_select ON public.projects;
CREATE POLICY projects_team_select ON public.projects FOR SELECT TO authenticated USING (public.can_read_project(id));
DROP POLICY IF EXISTS projects_team_insert ON public.projects;
CREATE POLICY projects_team_insert ON public.projects FOR INSERT TO authenticated WITH CHECK (owner_id=auth.uid() AND organization_id IS NOT NULL AND public.can_create_project_in_org(organization_id));
DROP POLICY IF EXISTS projects_team_update ON public.projects;
CREATE POLICY projects_team_update ON public.projects FOR UPDATE TO authenticated USING (public.can_manage_project(id)) WITH CHECK (public.can_manage_project(id));
DROP POLICY IF EXISTS projects_team_delete ON public.projects;
CREATE POLICY projects_team_delete ON public.projects FOR DELETE TO authenticated USING (public.can_manage_project(id));

DROP POLICY IF EXISTS exposures_team_select ON public.exposures;
CREATE POLICY exposures_team_select ON public.exposures FOR SELECT TO authenticated USING (public.can_read_project(project_id));
DROP POLICY IF EXISTS exposures_team_insert ON public.exposures;
CREATE POLICY exposures_team_insert ON public.exposures FOR INSERT TO authenticated WITH CHECK (public.can_manage_project(project_id));
DROP POLICY IF EXISTS exposures_team_update ON public.exposures;
CREATE POLICY exposures_team_update ON public.exposures FOR UPDATE TO authenticated USING (public.can_manage_project(project_id)) WITH CHECK (public.can_manage_project(project_id));
DROP POLICY IF EXISTS exposures_team_delete ON public.exposures;
CREATE POLICY exposures_team_delete ON public.exposures FOR DELETE TO authenticated USING (public.can_manage_project(project_id));

DROP POLICY IF EXISTS change_orders_team_select ON public.change_orders;
CREATE POLICY change_orders_team_select ON public.change_orders FOR SELECT TO authenticated USING (public.can_read_project(project_id));
DROP POLICY IF EXISTS change_orders_team_insert ON public.change_orders;
CREATE POLICY change_orders_team_insert ON public.change_orders FOR INSERT TO authenticated WITH CHECK (public.can_manage_project(project_id));
DROP POLICY IF EXISTS change_orders_team_update ON public.change_orders;
CREATE POLICY change_orders_team_update ON public.change_orders FOR UPDATE TO authenticated USING (public.can_manage_project(project_id)) WITH CHECK (public.can_manage_project(project_id));
DROP POLICY IF EXISTS change_orders_team_delete ON public.change_orders;
CREATE POLICY change_orders_team_delete ON public.change_orders FOR DELETE TO authenticated USING (public.can_manage_project(project_id));

DROP POLICY IF EXISTS cost_buckets_team_select ON public.cost_buckets;
CREATE POLICY cost_buckets_team_select ON public.cost_buckets FOR SELECT TO authenticated USING (public.can_read_project(project_id));
DROP POLICY IF EXISTS cost_buckets_team_insert ON public.cost_buckets;
CREATE POLICY cost_buckets_team_insert ON public.cost_buckets FOR INSERT TO authenticated WITH CHECK (public.can_manage_project(project_id));
DROP POLICY IF EXISTS cost_buckets_team_update ON public.cost_buckets;
CREATE POLICY cost_buckets_team_update ON public.cost_buckets FOR UPDATE TO authenticated USING (public.can_manage_project(project_id)) WITH CHECK (public.can_manage_project(project_id));
DROP POLICY IF EXISTS cost_buckets_team_delete ON public.cost_buckets;
CREATE POLICY cost_buckets_team_delete ON public.cost_buckets FOR DELETE TO authenticated USING (public.can_manage_project(project_id));

DROP POLICY IF EXISTS decisions_team_select ON public.decisions;
CREATE POLICY decisions_team_select ON public.decisions FOR SELECT TO authenticated USING (public.can_read_project(project_id));
DROP POLICY IF EXISTS decisions_team_insert ON public.decisions;
CREATE POLICY decisions_team_insert ON public.decisions FOR INSERT TO authenticated WITH CHECK (public.can_manage_project(project_id));
DROP POLICY IF EXISTS decisions_team_update ON public.decisions;
CREATE POLICY decisions_team_update ON public.decisions FOR UPDATE TO authenticated USING (public.can_manage_project(project_id)) WITH CHECK (public.can_manage_project(project_id));
DROP POLICY IF EXISTS decisions_team_delete ON public.decisions;
CREATE POLICY decisions_team_delete ON public.decisions FOR DELETE TO authenticated USING (public.can_manage_project(project_id));

DROP POLICY IF EXISTS reviews_team_select ON public.reviews;
CREATE POLICY reviews_team_select ON public.reviews FOR SELECT TO authenticated USING (public.can_read_project(project_id));
DROP POLICY IF EXISTS reviews_team_insert ON public.reviews;
CREATE POLICY reviews_team_insert ON public.reviews FOR INSERT TO authenticated WITH CHECK (public.can_manage_project(project_id));
DROP POLICY IF EXISTS reviews_team_update ON public.reviews;
CREATE POLICY reviews_team_update ON public.reviews FOR UPDATE TO authenticated USING (public.can_manage_project(project_id)) WITH CHECK (public.can_manage_project(project_id));
DROP POLICY IF EXISTS reviews_team_delete ON public.reviews;
CREATE POLICY reviews_team_delete ON public.reviews FOR DELETE TO authenticated USING (public.can_manage_project(project_id));

DROP POLICY IF EXISTS schedule_milestones_team_select ON public.schedule_milestones;
CREATE POLICY schedule_milestones_team_select ON public.schedule_milestones FOR SELECT TO authenticated USING (public.can_read_project(project_id));
DROP POLICY IF EXISTS schedule_milestones_team_insert ON public.schedule_milestones;
CREATE POLICY schedule_milestones_team_insert ON public.schedule_milestones FOR INSERT TO authenticated WITH CHECK (public.can_manage_project(project_id));
DROP POLICY IF EXISTS schedule_milestones_team_update ON public.schedule_milestones;
CREATE POLICY schedule_milestones_team_update ON public.schedule_milestones FOR UPDATE TO authenticated USING (public.can_manage_project(project_id)) WITH CHECK (public.can_manage_project(project_id));
DROP POLICY IF EXISTS schedule_milestones_team_delete ON public.schedule_milestones;
CREATE POLICY schedule_milestones_team_delete ON public.schedule_milestones FOR DELETE TO authenticated USING (public.can_manage_project(project_id));

DROP POLICY IF EXISTS schedule_risks_team_select ON public.schedule_risks;
CREATE POLICY schedule_risks_team_select ON public.schedule_risks FOR SELECT TO authenticated USING (public.can_read_project(project_id));
DROP POLICY IF EXISTS schedule_risks_team_insert ON public.schedule_risks;
CREATE POLICY schedule_risks_team_insert ON public.schedule_risks FOR INSERT TO authenticated WITH CHECK (public.can_manage_project(project_id));
DROP POLICY IF EXISTS schedule_risks_team_update ON public.schedule_risks;
CREATE POLICY schedule_risks_team_update ON public.schedule_risks FOR UPDATE TO authenticated USING (public.can_manage_project(project_id)) WITH CHECK (public.can_manage_project(project_id));
DROP POLICY IF EXISTS schedule_risks_team_delete ON public.schedule_risks;
CREATE POLICY schedule_risks_team_delete ON public.schedule_risks FOR DELETE TO authenticated USING (public.can_manage_project(project_id));

DROP POLICY IF EXISTS billing_applications_team_select ON public.billing_applications;
CREATE POLICY billing_applications_team_select ON public.billing_applications FOR SELECT TO authenticated USING (public.can_read_project(project_id));
DROP POLICY IF EXISTS billing_applications_team_insert ON public.billing_applications;
CREATE POLICY billing_applications_team_insert ON public.billing_applications FOR INSERT TO authenticated WITH CHECK (public.can_manage_project(project_id));
DROP POLICY IF EXISTS billing_applications_team_update ON public.billing_applications;
CREATE POLICY billing_applications_team_update ON public.billing_applications FOR UPDATE TO authenticated USING (public.can_manage_project(project_id)) WITH CHECK (public.can_manage_project(project_id));
DROP POLICY IF EXISTS billing_applications_team_delete ON public.billing_applications;
CREATE POLICY billing_applications_team_delete ON public.billing_applications FOR DELETE TO authenticated USING (public.can_manage_project(project_id));

ALTER TABLE public.exposures
  ADD COLUMN IF NOT EXISTS released_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS release_note text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS release_updated_at timestamptz;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='exposures_released_amount_nonnegative') THEN
    ALTER TABLE public.exposures ADD CONSTRAINT exposures_released_amount_nonnegative CHECK (released_amount >= 0);
  END IF;
END $$;

ALTER TABLE public.schedule_risks
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS inactive_reason text NOT NULL DEFAULT '';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='schedule_risks_status_check') THEN
    ALTER TABLE public.schedule_risks ADD CONSTRAINT schedule_risks_status_check CHECK (status IN ('active','inactive','completed'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.schedule_updates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  update_number integer NOT NULL, update_date date NOT NULL DEFAULT current_date,
  baseline_completion_date date, forecast_completion_date date NOT NULL,
  variance_weeks numeric NOT NULL DEFAULT 0, movement_weeks numeric NOT NULL DEFAULT 0,
  notes text NOT NULL DEFAULT '', created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, update_number)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.schedule_updates TO authenticated;
GRANT ALL ON public.schedule_updates TO service_role;
ALTER TABLE public.schedule_updates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS schedule_updates_team_select ON public.schedule_updates;
CREATE POLICY schedule_updates_team_select ON public.schedule_updates FOR SELECT TO authenticated USING (public.can_read_project(project_id));
DROP POLICY IF EXISTS schedule_updates_team_insert ON public.schedule_updates;
CREATE POLICY schedule_updates_team_insert ON public.schedule_updates FOR INSERT TO authenticated WITH CHECK (public.can_manage_project(project_id));
DROP POLICY IF EXISTS schedule_updates_team_update ON public.schedule_updates;
CREATE POLICY schedule_updates_team_update ON public.schedule_updates FOR UPDATE TO authenticated USING (public.can_manage_project(project_id)) WITH CHECK (public.can_manage_project(project_id));
DROP POLICY IF EXISTS schedule_updates_team_delete ON public.schedule_updates;
CREATE POLICY schedule_updates_team_delete ON public.schedule_updates FOR DELETE TO authenticated USING (public.can_manage_project(project_id));
DROP TRIGGER IF EXISTS schedule_updates_set_updated_at ON public.schedule_updates;
CREATE TRIGGER schedule_updates_set_updated_at BEFORE UPDATE ON public.schedule_updates FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE INDEX IF NOT EXISTS schedule_updates_project_id_update_number_idx ON public.schedule_updates(project_id, update_number DESC);

CREATE TABLE IF NOT EXISTS public.schedule_milestone_updates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  milestone_id uuid NOT NULL REFERENCES public.schedule_milestones(id) ON DELETE CASCADE,
  schedule_update_id uuid REFERENCES public.schedule_updates(id) ON DELETE SET NULL,
  update_number integer NOT NULL, baseline_date date, forecast_date date,
  variance_weeks numeric NOT NULL DEFAULT 0, status text NOT NULL DEFAULT 'on_track',
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (milestone_id, update_number)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.schedule_milestone_updates TO authenticated;
GRANT ALL ON public.schedule_milestone_updates TO service_role;
ALTER TABLE public.schedule_milestone_updates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS schedule_milestone_updates_team_select ON public.schedule_milestone_updates;
CREATE POLICY schedule_milestone_updates_team_select ON public.schedule_milestone_updates FOR SELECT TO authenticated USING (public.can_read_project(project_id));
DROP POLICY IF EXISTS schedule_milestone_updates_team_insert ON public.schedule_milestone_updates;
CREATE POLICY schedule_milestone_updates_team_insert ON public.schedule_milestone_updates FOR INSERT TO authenticated WITH CHECK (public.can_manage_project(project_id));
DROP POLICY IF EXISTS schedule_milestone_updates_team_update ON public.schedule_milestone_updates;
CREATE POLICY schedule_milestone_updates_team_update ON public.schedule_milestone_updates FOR UPDATE TO authenticated USING (public.can_manage_project(project_id)) WITH CHECK (public.can_manage_project(project_id));
DROP POLICY IF EXISTS schedule_milestone_updates_team_delete ON public.schedule_milestone_updates;
CREATE POLICY schedule_milestone_updates_team_delete ON public.schedule_milestone_updates FOR DELETE TO authenticated USING (public.can_manage_project(project_id));
DROP TRIGGER IF EXISTS schedule_milestone_updates_set_updated_at ON public.schedule_milestone_updates;
CREATE TRIGGER schedule_milestone_updates_set_updated_at BEFORE UPDATE ON public.schedule_milestone_updates FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE INDEX IF NOT EXISTS schedule_milestone_updates_project_id_update_number_idx ON public.schedule_milestone_updates(project_id, update_number DESC);

CREATE OR REPLACE FUNCTION public.tg_projects_calculate_schedule_variance() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF NEW.baseline_completion_date IS NULL OR NEW.forecast_completion_date IS NULL THEN
    NEW.schedule_variance_weeks := 0;
  ELSE
    NEW.schedule_variance_weeks := round(((NEW.forecast_completion_date - NEW.baseline_completion_date)::numeric)/7.0)::integer;
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS projects_calculate_schedule_variance ON public.projects;
CREATE TRIGGER projects_calculate_schedule_variance BEFORE INSERT OR UPDATE OF baseline_completion_date, forecast_completion_date ON public.projects FOR EACH ROW EXECUTE FUNCTION public.tg_projects_calculate_schedule_variance();

ALTER TABLE public.cost_buckets ADD COLUMN IF NOT EXISTS cost_code text NOT NULL DEFAULT '';
CREATE UNIQUE INDEX IF NOT EXISTS cost_buckets_project_cost_code_unique ON public.cost_buckets (project_id, lower(cost_code)) WHERE cost_code <> '';