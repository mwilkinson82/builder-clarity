-- SUB PAYMENT COMPLIANCE OVERRIDE (field request, Darian/DB3T 2026-07-10):
-- "let me mark it paid without confirming lien waivers or insurance, or at
-- least ping me to override it." Marshall's call (2026-07-10): keep the hard
-- gate as the default, but allow a per-payment override that REQUIRES a typed
-- reason and records who/why/when — a deliberate, audited escape hatch, not a
-- silent bypass.
--
-- A non-empty compliance_override_reason means this pay app was paid despite a
-- failing lien-waiver/insurance gate. Additive + idempotent; desk applies this.

ALTER TABLE public.subcontract_payments
  ADD COLUMN IF NOT EXISTS compliance_override_reason text NOT NULL DEFAULT '';
ALTER TABLE public.subcontract_payments
  ADD COLUMN IF NOT EXISTS compliance_overridden_by uuid REFERENCES auth.users(id);
ALTER TABLE public.subcontract_payments
  ADD COLUMN IF NOT EXISTS compliance_overridden_at timestamptz;

NOTIFY pgrst, 'reload schema';
