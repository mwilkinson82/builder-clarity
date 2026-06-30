CREATE TABLE IF NOT EXISTS public.pipeline_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  name text NOT NULL,
  account_type text NOT NULL DEFAULT 'client',
  market_sector text NOT NULL DEFAULT '',
  relationship_stage text NOT NULL DEFAULT 'prospect',
  relationship_health text NOT NULL DEFAULT 'unknown'
    CHECK (relationship_health IN ('strong', 'steady', 'watch', 'unknown')),
  website text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  address text NOT NULL DEFAULT '',
  source text NOT NULL DEFAULT '',
  owner_name text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  last_touch_at timestamptz,
  next_touch_at timestamptz,
  archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.pipeline_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  account_id uuid REFERENCES public.pipeline_accounts(id) ON DELETE SET NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  name text NOT NULL,
  title text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  role text NOT NULL DEFAULT '',
  influence_level text NOT NULL DEFAULT 'unknown'
    CHECK (influence_level IN ('decision_maker', 'influencer', 'technical', 'admin', 'unknown')),
  relationship_status text NOT NULL DEFAULT 'active'
    CHECK (relationship_status IN ('active', 'warm', 'cold', 'inactive')),
  notes text NOT NULL DEFAULT '',
  last_touch_at timestamptz,
  archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.pipeline_next_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  opportunity_id uuid REFERENCES public.pipeline_opportunities(id) ON DELETE CASCADE,
  account_id uuid REFERENCES public.pipeline_accounts(id) ON DELETE SET NULL,
  contact_id uuid REFERENCES public.pipeline_contacts(id) ON DELETE SET NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  completed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  owner_name text NOT NULL DEFAULT '',
  action_type text NOT NULL DEFAULT 'follow_up',
  priority text NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('low', 'normal', 'high')),
  title text NOT NULL,
  notes text NOT NULL DEFAULT '',
  due_date date,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    opportunity_id IS NOT NULL
    OR account_id IS NOT NULL
    OR contact_id IS NOT NULL
  )
);

ALTER TABLE public.pipeline_opportunities
  ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES public.pipeline_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS primary_contact_id uuid REFERENCES public.pipeline_contacts(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS pipeline_accounts_org_name_active_idx
  ON public.pipeline_accounts(organization_id, lower(name))
  WHERE archived = false;

CREATE INDEX IF NOT EXISTS pipeline_accounts_org_health_idx
  ON public.pipeline_accounts(organization_id, relationship_health)
  WHERE archived = false;

CREATE INDEX IF NOT EXISTS pipeline_contacts_org_account_idx
  ON public.pipeline_contacts(organization_id, account_id)
  WHERE archived = false;

CREATE UNIQUE INDEX IF NOT EXISTS pipeline_contacts_org_email_active_idx
  ON public.pipeline_contacts(organization_id, lower(email))
  WHERE email <> '' AND archived = false;

CREATE INDEX IF NOT EXISTS pipeline_next_actions_org_due_idx
  ON public.pipeline_next_actions(organization_id, due_date, priority)
  WHERE completed_at IS NULL;

CREATE INDEX IF NOT EXISTS pipeline_next_actions_opportunity_idx
  ON public.pipeline_next_actions(opportunity_id, due_date)
  WHERE completed_at IS NULL;

CREATE INDEX IF NOT EXISTS pipeline_next_actions_account_idx
  ON public.pipeline_next_actions(account_id, due_date)
  WHERE completed_at IS NULL;

CREATE INDEX IF NOT EXISTS pipeline_opportunities_account_idx
  ON public.pipeline_opportunities(organization_id, account_id)
  WHERE archived = false;

CREATE INDEX IF NOT EXISTS pipeline_opportunities_contact_idx
  ON public.pipeline_opportunities(organization_id, primary_contact_id)
  WHERE archived = false;

DROP TRIGGER IF EXISTS pipeline_accounts_set_updated_at
  ON public.pipeline_accounts;
CREATE TRIGGER pipeline_accounts_set_updated_at
  BEFORE UPDATE ON public.pipeline_accounts
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

DROP TRIGGER IF EXISTS pipeline_contacts_set_updated_at
  ON public.pipeline_contacts;
CREATE TRIGGER pipeline_contacts_set_updated_at
  BEFORE UPDATE ON public.pipeline_contacts
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

DROP TRIGGER IF EXISTS pipeline_next_actions_set_updated_at
  ON public.pipeline_next_actions;
CREATE TRIGGER pipeline_next_actions_set_updated_at
  BEFORE UPDATE ON public.pipeline_next_actions
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

ALTER TABLE public.pipeline_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pipeline_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pipeline_next_actions ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON public.pipeline_accounts TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.pipeline_contacts TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.pipeline_next_actions TO authenticated;
GRANT ALL ON public.pipeline_accounts TO service_role;
GRANT ALL ON public.pipeline_contacts TO service_role;
GRANT ALL ON public.pipeline_next_actions TO service_role;

DROP POLICY IF EXISTS pipeline_accounts_member_select ON public.pipeline_accounts;
CREATE POLICY pipeline_accounts_member_select
  ON public.pipeline_accounts
  FOR SELECT
  TO authenticated
  USING (public.is_org_member(organization_id));

DROP POLICY IF EXISTS pipeline_accounts_member_insert ON public.pipeline_accounts;
CREATE POLICY pipeline_accounts_member_insert
  ON public.pipeline_accounts
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_org_member(organization_id)
    AND (created_by IS NULL OR created_by = (SELECT auth.uid()))
  );

DROP POLICY IF EXISTS pipeline_accounts_member_update ON public.pipeline_accounts;
CREATE POLICY pipeline_accounts_member_update
  ON public.pipeline_accounts
  FOR UPDATE
  TO authenticated
  USING (public.is_org_member(organization_id))
  WITH CHECK (public.is_org_member(organization_id));

DROP POLICY IF EXISTS pipeline_contacts_member_select ON public.pipeline_contacts;
CREATE POLICY pipeline_contacts_member_select
  ON public.pipeline_contacts
  FOR SELECT
  TO authenticated
  USING (public.is_org_member(organization_id));

DROP POLICY IF EXISTS pipeline_contacts_member_insert ON public.pipeline_contacts;
CREATE POLICY pipeline_contacts_member_insert
  ON public.pipeline_contacts
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_org_member(organization_id)
    AND (created_by IS NULL OR created_by = (SELECT auth.uid()))
  );

DROP POLICY IF EXISTS pipeline_contacts_member_update ON public.pipeline_contacts;
CREATE POLICY pipeline_contacts_member_update
  ON public.pipeline_contacts
  FOR UPDATE
  TO authenticated
  USING (public.is_org_member(organization_id))
  WITH CHECK (public.is_org_member(organization_id));

DROP POLICY IF EXISTS pipeline_next_actions_member_select ON public.pipeline_next_actions;
CREATE POLICY pipeline_next_actions_member_select
  ON public.pipeline_next_actions
  FOR SELECT
  TO authenticated
  USING (public.is_org_member(organization_id));

DROP POLICY IF EXISTS pipeline_next_actions_member_insert ON public.pipeline_next_actions;
CREATE POLICY pipeline_next_actions_member_insert
  ON public.pipeline_next_actions
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_org_member(organization_id)
    AND (created_by IS NULL OR created_by = (SELECT auth.uid()))
  );

DROP POLICY IF EXISTS pipeline_next_actions_member_update ON public.pipeline_next_actions;
CREATE POLICY pipeline_next_actions_member_update
  ON public.pipeline_next_actions
  FOR UPDATE
  TO authenticated
  USING (public.is_org_member(organization_id))
  WITH CHECK (public.is_org_member(organization_id));

WITH client_accounts AS (
  SELECT DISTINCT
    organization_id,
    trim(client) AS name,
    trim(source) AS source,
    trim(assigned_to) AS owner_name
  FROM public.pipeline_opportunities
  WHERE trim(coalesce(client, '')) <> ''
),
inserted_accounts AS (
  INSERT INTO public.pipeline_accounts (
    organization_id,
    name,
    account_type,
    relationship_stage,
    source,
    owner_name,
    notes
  )
  SELECT
    organization_id,
    name,
    'client',
    'prospect',
    source,
    owner_name,
    'Backfilled from existing pipeline opportunities.'
  FROM client_accounts source_accounts
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.pipeline_accounts existing
    WHERE existing.organization_id = source_accounts.organization_id
      AND lower(existing.name) = lower(source_accounts.name)
      AND existing.archived = false
  )
  RETURNING id, organization_id, name
)
UPDATE public.pipeline_opportunities opportunity
SET account_id = account.id
FROM public.pipeline_accounts account
WHERE opportunity.account_id IS NULL
  AND opportunity.organization_id = account.organization_id
  AND lower(trim(opportunity.client)) = lower(account.name);

WITH source_contacts AS (
  SELECT DISTINCT ON (
    opportunity.organization_id,
    lower(nullif(trim(opportunity.client_contact_email), '')),
    lower(nullif(trim(opportunity.client_contact_name), ''))
  )
    opportunity.organization_id,
    opportunity.account_id,
    trim(opportunity.client_contact_name) AS name,
    trim(opportunity.client_contact_email) AS email,
    trim(opportunity.client_contact_phone) AS phone
  FROM public.pipeline_opportunities opportunity
  WHERE trim(coalesce(opportunity.client_contact_name, '')) <> ''
     OR trim(coalesce(opportunity.client_contact_email, '')) <> ''
),
inserted_contacts AS (
  INSERT INTO public.pipeline_contacts (
    organization_id,
    account_id,
    name,
    email,
    phone,
    role,
    influence_level,
    relationship_status,
    notes
  )
  SELECT
    organization_id,
    account_id,
    coalesce(nullif(name, ''), email, 'Client contact'),
    coalesce(email, ''),
    coalesce(phone, ''),
    'Client contact',
    'influencer',
    'active',
    'Backfilled from existing pipeline opportunity contact fields.'
  FROM source_contacts contact_source
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.pipeline_contacts existing
    WHERE existing.organization_id = contact_source.organization_id
      AND existing.archived = false
      AND (
        (coalesce(contact_source.email, '') <> '' AND lower(existing.email) = lower(contact_source.email))
        OR (
          coalesce(contact_source.email, '') = ''
          AND lower(existing.name) = lower(coalesce(nullif(contact_source.name, ''), contact_source.email, 'Client contact'))
          AND existing.account_id IS NOT DISTINCT FROM contact_source.account_id
        )
      )
  )
  RETURNING id, organization_id, account_id, name, email
)
UPDATE public.pipeline_opportunities opportunity
SET primary_contact_id = contact.id
FROM public.pipeline_contacts contact
WHERE opportunity.primary_contact_id IS NULL
  AND opportunity.organization_id = contact.organization_id
  AND (
    (trim(coalesce(opportunity.client_contact_email, '')) <> '' AND lower(trim(opportunity.client_contact_email)) = lower(contact.email))
    OR (
      trim(coalesce(opportunity.client_contact_email, '')) = ''
      AND trim(coalesce(opportunity.client_contact_name, '')) <> ''
      AND lower(trim(opportunity.client_contact_name)) = lower(contact.name)
      AND opportunity.account_id IS NOT DISTINCT FROM contact.account_id
    )
  );
