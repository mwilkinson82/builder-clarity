-- Exemplar echo check (AITAKEOFF2 Task 0) — the one expected migration.
-- The scan prompt now requires the model to describe the exemplar symbol
-- before returning matches. Storing that line makes exemplar corruption
-- visible forever: a founder reading "a small green dot" instead of
-- "circular brush with radial spokes" sees the pipeline bug instantly.

ALTER TABLE public.ai_operations
  ADD COLUMN IF NOT EXISTS exemplar_description text;

COMMENT ON COLUMN public.ai_operations.exemplar_description IS
  'One-line model description of the exemplar crop it was sent (echo check). NULL until the first tile of the scan responds.';
