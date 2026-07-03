CREATE TYPE public.stripe_mode AS ENUM ('test', 'live');

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS stripe_mode public.stripe_mode NOT NULL DEFAULT 'test';

COMMENT ON COLUMN public.organizations.stripe_mode IS
  'Which Stripe environment this org uses for outbound Checkout / Connect API calls. Webhook verification tries both test and live signing secrets regardless.';