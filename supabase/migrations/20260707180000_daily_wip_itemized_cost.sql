-- Daily WIP — itemize materials and equipment (Workspace B follow-up).
--
-- Founder intent: "Materials" and "Equipment" are dollar-value fields, but a PM
-- also needs to say WHAT the material/equipment was, not just a lump sum. So each
-- becomes a list of line items { description, amount }, and the existing
-- material_cost / equipment_cost columns stay as the cents-safe roll-up of those
-- items (they still feed billing and the daily totals — nothing downstream has to
-- learn about the item arrays).
--
-- Portable + additive: new columns default to an empty array, so every existing
-- row (which already has a material_cost / equipment_cost lump) keeps working —
-- the app renders the lump when the item list is empty.

ALTER TABLE public.daily_wip_entries
  ADD COLUMN IF NOT EXISTS material_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS equipment_items jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.daily_wip_entries.material_items IS
  'Line items [{ description, amount }] (amount in dollars). material_cost is their cents-safe sum.';
COMMENT ON COLUMN public.daily_wip_entries.equipment_items IS
  'Line items [{ description, amount }] (amount in dollars). equipment_cost is their cents-safe sum.';
