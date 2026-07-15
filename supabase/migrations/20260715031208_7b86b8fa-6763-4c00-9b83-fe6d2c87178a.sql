-- Commercial entitlements: Free acquisition, $399 Pro, and Pro-equivalent
-- Contractor Circle access. Existing Circle/Hardcore companies are preserved;
-- only future self-serve companies default to Free.

ALTER TABLE public.subscription_plans
  ADD COLUMN IF NOT EXISTS monthly_ai_credits integer NOT NULL DEFAULT 0;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'subscription_plans_monthly_ai_credits_nonnegative'
      AND conrelid = 'public.subscription_plans'::regclass
  ) THEN
    ALTER TABLE public.subscription_plans
      ADD CONSTRAINT subscription_plans_monthly_ai_credits_nonnegative
      CHECK (monthly_ai_credits >= 0);
  END IF;
END $$;

INSERT INTO public.subscription_plans (
  code,
  name,
  monthly_price_cents,
  project_limit,
  seat_limit,
  storage_limit_mb,
  daily_report_limit_per_month,
  monthly_ai_credits,
  is_public,
  stripe_product_id,
  stripe_price_id,
  checkout_enabled
) VALUES
  ('free', 'OverWatch Free', 0, 1, 2, 1024, 50, 50, true, '', '', false),
  ('pro', 'OverWatch Pro', 39900, 25, 10, 25600, 1000, 500, true, 'prod_Ut3G95JuhW8x9i', 'price_1TtHC6JGLltOYaii8jAmLwbx', true),
  ('contractor_circle_free', 'Contractor Circle — OverWatch Pro included', 0, 25, 10, 25600, 1000, 500, false, '', '', false)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  monthly_price_cents = EXCLUDED.monthly_price_cents,
  project_limit = EXCLUDED.project_limit,
  seat_limit = EXCLUDED.seat_limit,
  storage_limit_mb = EXCLUDED.storage_limit_mb,
  daily_report_limit_per_month = EXCLUDED.daily_report_limit_per_month,
  monthly_ai_credits = EXCLUDED.monthly_ai_credits,
  is_public = EXCLUDED.is_public,
  stripe_product_id = EXCLUDED.stripe_product_id,
  stripe_price_id = EXCLUDED.stripe_price_id,
  checkout_enabled = EXCLUDED.checkout_enabled,
  updated_at = now();

-- Keep the legacy rows for historical references, but stop presenting them as
-- purchasable plans. There is one public paid plan now: Pro.
UPDATE public.subscription_plans
SET is_public = false,
    checkout_enabled = false,
    updated_at = now()
WHERE code IN ('starter', 'growth');

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS entitlement_source text NOT NULL DEFAULT 'free',
  ADD COLUMN IF NOT EXISTS entitlement_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS billing_grace_ends_at timestamptz,
  ADD COLUMN IF NOT EXISTS circle_entitlement_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS circle_entitlement_member_email text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS circle_entitlement_tier text NOT NULL DEFAULT '';

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'organizations_entitlement_source_check'
      AND conrelid = 'public.organizations'::regclass
  ) THEN
    ALTER TABLE public.organizations
      ADD CONSTRAINT organizations_entitlement_source_check
      CHECK (entitlement_source IN ('free', 'stripe', 'contractor_circle', 'admin'));
  END IF;
END $$;

-- Every existing rollout company keeps its current access as an administrative
-- grant. The Hub sync may positively match and annotate these companies, but a
-- failed or alternate-email lookup can never revoke their rollout access.
UPDATE public.organizations
SET entitlement_source = 'admin',
    plan_code = 'contractor_circle_free',
    billing_status = 'contractor_circle_grant',
    project_limit = 25,
    seat_limit = 10,
    storage_limit_mb = 25600,
    daily_report_limit_per_month = 1000,
    updated_at = now()
WHERE contractor_circle_grant IS TRUE;

COMMENT ON COLUMN public.organizations.circle_entitlement_checked_at IS
  'Last successful Contractor Circle Hub membership check. Failed lookups do not advance this timestamp or revoke access.';

COMMENT ON COLUMN public.organizations.circle_entitlement_member_email IS
  'Normalized active company-member email that matched Circle or Hardcore in the Hub.';

COMMENT ON COLUMN public.organizations.circle_entitlement_tier IS
  'Hub tier that currently supplies included OverWatch Pro access, normally circle or hardcore.';

ALTER TABLE public.organizations
  ALTER COLUMN plan_code SET DEFAULT 'free',
  ALTER COLUMN billing_status SET DEFAULT 'active',
  ALTER COLUMN project_limit SET DEFAULT 1,
  ALTER COLUMN seat_limit SET DEFAULT 2,
  ALTER COLUMN storage_limit_mb SET DEFAULT 1024,
  ALTER COLUMN daily_report_limit_per_month SET DEFAULT 50,
  ALTER COLUMN contractor_circle_grant SET DEFAULT false,
  ALTER COLUMN entitlement_source SET DEFAULT 'free';

-- The legacy ensure_user_account() function still contains rollout-era code
-- that tries to stamp every login as a Circle grant. This trigger makes the
-- entitlement source authoritative: a grant can only be enabled by changing
-- entitlement_source to contractor_circle in the same audited write.
CREATE OR REPLACE FUNCTION public.protect_organization_entitlement_source()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.contractor_circle_grant IS TRUE
     AND OLD.entitlement_source <> 'contractor_circle'
     AND NEW.entitlement_source IS NOT DISTINCT FROM OLD.entitlement_source THEN
    NEW.contractor_circle_grant := OLD.contractor_circle_grant;
    NEW.plan_code := OLD.plan_code;
    NEW.billing_status := OLD.billing_status;
    NEW.project_limit := OLD.project_limit;
    NEW.seat_limit := OLD.seat_limit;
    NEW.storage_limit_mb := OLD.storage_limit_mb;
    NEW.daily_report_limit_per_month := OLD.daily_report_limit_per_month;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.protect_organization_entitlement_source() FROM PUBLIC;

DROP TRIGGER IF EXISTS organizations_protect_entitlement_source ON public.organizations;
CREATE TRIGGER organizations_protect_entitlement_source
  BEFORE UPDATE ON public.organizations
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_organization_entitlement_source();

-- Monthly plan allowances live in the append-only credit ledger, so every
-- grant and every AI spend remains auditable. Legacy one-time signup grants
-- remain intact, but new companies receive the monthly allowance instead of
-- stacking a second 50-credit signup bonus in their first month.
DROP TRIGGER IF EXISTS tg_organizations_signup_credits ON public.organizations;
DROP TRIGGER IF EXISTS organizations_grant_signup_credits ON public.organizations;

ALTER TABLE public.credit_ledger
  DROP CONSTRAINT IF EXISTS credit_ledger_reason_check;

ALTER TABLE public.credit_ledger
  ADD CONSTRAINT credit_ledger_reason_check CHECK (
    reason IN (
      'signup_grant',
      'monthly_plan_grant',
      'purchase',
      'ai_count_scan',
      'refund',
      'admin_adjustment'
    )
  );

CREATE UNIQUE INDEX IF NOT EXISTS credit_ledger_monthly_plan_grant_key
  ON public.credit_ledger (organization_id, reference)
  WHERE reason = 'monthly_plan_grant';

CREATE OR REPLACE FUNCTION public.ensure_monthly_ai_credit_grant(p_organization_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org public.organizations%ROWTYPE;
  v_plan_code text;
  v_allowance integer := 0;
  v_reference text;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_org_member(p_organization_id) THEN
    RAISE EXCEPTION 'You do not have access to this OverWatch company.';
  END IF;

  SELECT * INTO v_org
  FROM public.organizations
  WHERE id = p_organization_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'OverWatch company not found.';
  END IF;

  IF NOT (
    v_org.contractor_circle_grant IS TRUE
    OR v_org.billing_status IN ('active', 'trialing', 'contractor_circle_grant')
    OR (
      v_org.billing_status = 'past_due'
      AND v_org.billing_grace_ends_at IS NOT NULL
      AND v_org.billing_grace_ends_at > now()
    )
  ) THEN
    RETURN 0;
  END IF;

  v_plan_code := CASE
    WHEN v_org.contractor_circle_grant IS TRUE THEN 'contractor_circle_free'
    ELSE v_org.plan_code
  END;

  SELECT COALESCE(monthly_ai_credits, 0)
  INTO v_allowance
  FROM public.subscription_plans
  WHERE code = v_plan_code;

  IF v_allowance <= 0 THEN
    RETURN 0;
  END IF;

  -- A paid upgrade receives its new plan allowance immediately; the plan code
  -- in the reference also preserves which entitlement produced the grant.
  v_reference := 'plan:' || v_plan_code || ':' || to_char(current_date, 'YYYY-MM');

  INSERT INTO public.credit_ledger (
    organization_id,
    delta,
    reason,
    reference,
    created_by
  ) VALUES (
    p_organization_id,
    v_allowance,
    'monthly_plan_grant',
    v_reference,
    auth.uid()
  )
  ON CONFLICT DO NOTHING;

  RETURN v_allowance;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_monthly_ai_credit_grant(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_monthly_ai_credit_grant(uuid) TO authenticated, service_role;

-- Enforce project capacity in Postgres as well as the server action so a
-- future import or alternate client cannot bypass the commercial limit. The
-- Harbor Residence sample does not consume a paid project slot.
CREATE OR REPLACE FUNCTION public.enforce_organization_project_limit()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_limit integer;
  v_active_projects integer;
BEGIN
  IF NEW.organization_id IS NULL
     OR NEW.archived_at IS NOT NULL
     OR NEW.job_number = 'DEMO-HARBOR' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.organization_id IS NOT DISTINCT FROM NEW.organization_id
     AND OLD.archived_at IS NULL
     AND OLD.job_number <> 'DEMO-HARBOR' THEN
    RETURN NEW;
  END IF;

  SELECT project_limit
  INTO v_limit
  FROM public.organizations
  WHERE id = NEW.organization_id
  FOR UPDATE;

  IF COALESCE(v_limit, 0) <= 0 THEN
    RETURN NEW;
  END IF;

  SELECT count(*)::integer
  INTO v_active_projects
  FROM public.projects
  WHERE organization_id = NEW.organization_id
    AND archived_at IS NULL
    AND job_number <> 'DEMO-HARBOR'
    AND (TG_OP = 'INSERT' OR id <> NEW.id);

  IF v_active_projects >= v_limit THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = format(
        'This OverWatch company is at its %s-active-project limit. Archive a project or upgrade to continue.',
        v_limit
      );
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_organization_project_limit() FROM PUBLIC;

DROP TRIGGER IF EXISTS projects_enforce_organization_limit ON public.projects;
CREATE TRIGGER projects_enforce_organization_limit
  BEFORE INSERT OR UPDATE OF organization_id, archived_at, job_number ON public.projects
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_organization_project_limit();

COMMENT ON COLUMN public.subscription_plans.monthly_ai_credits IS
  'AI estimating credits granted once per calendar month through the append-only credit ledger.';
COMMENT ON COLUMN public.organizations.entitlement_source IS
  'Authority for access: free signup, Stripe subscription, Contractor Circle Hub, or a logged admin override.';
COMMENT ON COLUMN public.organizations.entitlement_expires_at IS
  'Optional expiration for grant/trial access. NULL means no scheduled expiration.';
COMMENT ON COLUMN public.organizations.billing_grace_ends_at IS
  'End of paid-billing grace. Capacity-creating actions are blocked after this point; existing data remains readable.';

NOTIFY pgrst, 'reload schema';