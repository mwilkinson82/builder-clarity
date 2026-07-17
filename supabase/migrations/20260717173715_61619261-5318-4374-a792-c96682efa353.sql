-- CRM email can use the verified OverWatch Resend account while preserving
-- Lovable delivery as a fallback. Harbor demo sends are recorded locally and
-- never call either provider.

alter table public.crm_outbound_messages
  drop constraint if exists crm_outbound_messages_provider_check;

alter table public.crm_outbound_messages
  add constraint crm_outbound_messages_provider_check
  check (provider in ('lovable_email', 'resend', 'demo'));

comment on column public.crm_outbound_messages.provider is
  'Delivery path: direct Resend, Lovable fallback, or a non-delivering Harbor demo simulation.';

notify pgrst, 'reload schema';