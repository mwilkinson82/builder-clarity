-- COST PAYMENT DETAILS (field request, DB3T/Darian 2026-07-10): "would be cool
-- to mark paid but also be able to add how — wire, check, card — and then add
-- check number etc. and date paid." When a cost is marked paid, capture HOW it
-- was paid so the ledger reads like a real payment record.
--
-- Mirrors the receivables side (payment_ledger has payment_method + reference +
-- paid_at). Here `payment_reference` holds the check #/wire confirmation/ACH
-- trace — kept SEPARATE from `reference_number` (the vendor's invoice number,
-- what they billed us). `paid_date` is the real-world date money went out,
-- distinct from `paid_at` (the system stamp of when it was marked paid).
-- All nullable/defaulted + additive; idempotent. Migration desk applies this.

ALTER TABLE public.cost_actuals
  ADD COLUMN IF NOT EXISTS payment_method text NOT NULL DEFAULT '';
ALTER TABLE public.cost_actuals
  ADD COLUMN IF NOT EXISTS payment_reference text NOT NULL DEFAULT '';
ALTER TABLE public.cost_actuals
  ADD COLUMN IF NOT EXISTS paid_date date;

NOTIFY pgrst, 'reload schema';
