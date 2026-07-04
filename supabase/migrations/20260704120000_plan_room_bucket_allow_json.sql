-- AITAKEOFF3 Task 4: allow application/json in the plan-room bucket so the
-- AI scan diagnostics JSON sidecars (tile-*.json / verify-*.json) upload
-- alongside their PNGs. This records what the migration desk already applied
-- to production on 2026-07-04 — main stays truthful. Guarded and idempotent:
-- a bucket that already allows JSON (or does not exist) no-ops.
UPDATE storage.buckets
SET allowed_mime_types = allowed_mime_types || ARRAY['application/json']
WHERE id = 'plan-room'
  AND NOT ('application/json' = ANY(allowed_mime_types));
