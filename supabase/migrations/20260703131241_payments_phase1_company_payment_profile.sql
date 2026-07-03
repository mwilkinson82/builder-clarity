-- Payments Phase 1 (Tier 0): company payment profile.
-- The company's own remittance details -- the direct bank rail that never
-- depends on Stripe. Holds bank/wire instructions, the remittance memo
-- template, company-level payment method defaults, the card-fee pass-through
-- toggle, and the Stripe amount threshold (invoices above it hide Stripe
-- methods unless deliberately overridden per invoice).
--
-- Access: ONLY members holding billing.manage or company.manage_settings can
-- read or write. Clients never read this table directly -- the client portal
-- server function attaches remittance details per invoice when direct bank
-- transfer is enabled on that invoice.

CREATE TABLE IF NOT EXISTS public.organization_payment_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL UNIQUE REFERENCES public.organizations(id) ON DELETE CASCADE,
  bank_name text NOT NULL DEFAULT '',
  routing_number text NOT NULL DEFAULT '',
  account_number text NOT NULL DEFAULT '',
  wire_instructions text NOT NULL DEFAULT '',
  remittance_memo_template text NOT NULL DEFAULT 'Reference: Invoice {number}',
  default_payment_methods jsonb NOT NULL DEFAULT '{"direct_bank": true, "card": true, "ach_debit": true}'::jsonb,
  card_fee_pass_through boolean NOT NULL DEFAULT false,
  stripe_amount_threshold_cents bigint NOT NULL DEFAULT 2500000,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS organization_payment_profiles_org_idx
  ON public.organization_payment_profiles (organization_id);

DROP TRIGGER IF EXISTS organization_payment_profiles_set_updated_at
  ON public.organization_payment_profiles;
CREATE TRIGGER organization_payment_profiles_set_updated_at
  BEFORE UPDATE ON public.organization_payment_profiles
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

ALTER TABLE public.organization_payment_profiles ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.organization_payment_profiles TO authenticated;

-- billing.manage OR company.manage_settings, per the founder-approved model.
DROP POLICY IF EXISTS organization_payment_profiles_billing_select
  ON public.organization_payment_profiles;
CREATE POLICY organization_payment_profiles_billing_select
  ON public.organization_payment_profiles
  FOR SELECT TO authenticated
  USING (
    public.has_org_capability(organization_id, 'billing.manage')
    OR public.has_org_capability(organization_id, 'company.manage_settings')
  );

DROP POLICY IF EXISTS organization_payment_profiles_billing_insert
  ON public.organization_payment_profiles;
CREATE POLICY organization_payment_profiles_billing_insert
  ON public.organization_payment_profiles
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_org_capability(organization_id, 'billing.manage')
    OR public.has_org_capability(organization_id, 'company.manage_settings')
  );

DROP POLICY IF EXISTS organization_payment_profiles_billing_update
  ON public.organization_payment_profiles;
CREATE POLICY organization_payment_profiles_billing_update
  ON public.organization_payment_profiles
  FOR UPDATE TO authenticated
  USING (
    public.has_org_capability(organization_id, 'billing.manage')
    OR public.has_org_capability(organization_id, 'company.manage_settings')
  )
  WITH CHECK (
    public.has_org_capability(organization_id, 'billing.manage')
    OR public.has_org_capability(organization_id, 'company.manage_settings')
  );

DROP POLICY IF EXISTS organization_payment_profiles_billing_delete
  ON public.organization_payment_profiles;
CREATE POLICY organization_payment_profiles_billing_delete
  ON public.organization_payment_profiles
  FOR DELETE TO authenticated
  USING (
    public.has_org_capability(organization_id, 'billing.manage')
    OR public.has_org_capability(organization_id, 'company.manage_settings')
  );
