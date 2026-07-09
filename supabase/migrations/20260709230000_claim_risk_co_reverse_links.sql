-- CLAIM ↔ RISK / CO TWO-WAY TAGGING (Claims/CO/Risk arc — slice 5, final).
--
-- Slice 2 gave project_claims OUTGOING links (risk_exposure_id, change_order_id)
-- — the claim knows the risk it came from and the CO it resolved into. This adds
-- the REVERSE pointers so the risk tally and the change order can find their
-- claim too, and the linked state shows from either side:
--   exposures.linked_claim_id      → the claim this risk is tracked as
--   change_orders.linked_claim_id  → the claim this CO was promoted from
--
-- Reference only, mirroring the CO↔risk link from slice 1 (linked_exposure_id /
-- linked_change_order_id). Both FKs ON DELETE SET NULL so deleting the claim
-- just clears the other side's pointer.
--
-- Idempotent + portable. Migration desk applies this.

ALTER TABLE public.exposures
  ADD COLUMN IF NOT EXISTS linked_claim_id uuid
  REFERENCES public.project_claims(id) ON DELETE SET NULL;

ALTER TABLE public.change_orders
  ADD COLUMN IF NOT EXISTS linked_claim_id uuid
  REFERENCES public.project_claims(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS exposures_linked_claim_idx
  ON public.exposures(linked_claim_id);
CREATE INDEX IF NOT EXISTS change_orders_linked_claim_idx
  ON public.change_orders(linked_claim_id);

NOTIFY pgrst, 'reload schema';
