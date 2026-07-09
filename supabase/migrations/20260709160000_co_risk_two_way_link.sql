-- CO ↔ RISK TWO-WAY LINK (Claims/CO/Risk arc — slice 1).
--
-- A change order and a risk-tally exposure can describe the same underlying
-- event from two angles: the CO is the contract instrument, the exposure is the
-- at-risk dollar we carry until it resolves. This adds a plain cross-reference so
-- a CO can be "tagged as a risk" and a risk "tagged as a change order," and each
-- row can find its counterpart.
--
-- It is a REFERENCE ONLY — no forecast / rollup math changes. The exposure keeps
-- whatever dollar value the user assigns at link time (carry the full CO value,
-- or their own number). Linking never moves money by itself.
--
-- Mirrors the existing linked_exposure_id convention on schedule_risks and
-- decisions. Both FKs are ON DELETE SET NULL, so deleting either side just clears
-- the other's pointer — no orphan rows, no cascade into unrelated data.
--
-- Idempotent + portable. Migration desk applies this.

ALTER TABLE public.change_orders
  ADD COLUMN IF NOT EXISTS linked_exposure_id uuid
  REFERENCES public.exposures(id) ON DELETE SET NULL;

ALTER TABLE public.exposures
  ADD COLUMN IF NOT EXISTS linked_change_order_id uuid
  REFERENCES public.change_orders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS change_orders_linked_exposure_idx
  ON public.change_orders(linked_exposure_id);
CREATE INDEX IF NOT EXISTS exposures_linked_change_order_idx
  ON public.exposures(linked_change_order_id);
