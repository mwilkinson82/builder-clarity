-- CHANGE ORDER STRUCTURED FIELDS (CO enhancements).
--
-- A change order carries more than money + reason: how it's priced (lump sum vs.
-- T&M vs. unit price vs. allowance), how many calendar days it adds to the
-- schedule, who asked for it, and when it was first initiated. These four
-- columns capture that so the CO log reads like a real change-order register.
--
-- Additive + idempotent: every column is ADD COLUMN IF NOT EXISTS with a safe
-- default and no backfill. Pre-migration rows read through the app's SAFE
-- DEFAULTS in the CO mapper, so a project loads fine before this lands.
-- No RLS changes (columns inherit the change_orders table policies).

ALTER TABLE public.change_orders
  ADD COLUMN IF NOT EXISTS pricing_method text NOT NULL DEFAULT 'lump_sum',
  ADD COLUMN IF NOT EXISTS schedule_impact_days integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS requested_by text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS date_initiated date;

DO $$
BEGIN
  ALTER TABLE public.change_orders
    ADD CONSTRAINT change_orders_pricing_method_check
    CHECK (pricing_method IN ('lump_sum', 'time_and_materials', 'unit_price', 'allowance', 'other'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

NOTIFY pgrst, 'reload schema';
