-- SUB PAYMENT METHOD (field request, Darian/DB3T 2026-07-10, follow-up to the
-- cost-side #273): capture HOW a sub pay app was paid — wire/check/card — when
-- marking it paid, mirroring the cost ledger. The pay date (payment_date) and
-- the check #/reference (reference) columns already exist on this table; only
-- the method is new. Additive/idempotent; migration desk applies this.

ALTER TABLE public.subcontract_payments
  ADD COLUMN IF NOT EXISTS payment_method text NOT NULL DEFAULT '';

NOTIFY pgrst, 'reload schema';
