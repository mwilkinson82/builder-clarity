-- Run after Lovable applies 20260717165334_allow_resend_crm_provider.sql.
-- Expected: one row whose constraint definition contains lovable_email,
-- resend, and demo.

select
  conname,
  pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'public.crm_outbound_messages'::regclass
  and conname = 'crm_outbound_messages_provider_check';
