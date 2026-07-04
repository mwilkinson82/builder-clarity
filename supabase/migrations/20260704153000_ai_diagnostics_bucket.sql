-- AITAKEOFF4 Task 3: dedicated private bucket for transient AI scan
-- diagnostics (deferred from AITAKEOFF3). Artifacts are written and read by
-- the server's service role only; the explicit policy mirrors the
-- diagnostics access rule (platform super admin) for any direct reads.
-- application/json stays in plan-room's allowlist for now — diagnostics from
-- the last ~24h still live there; removal rides a later cleanup.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'ai-diagnostics',
  'ai-diagnostics',
  false,
  52428800,
  ARRAY['image/png', 'application/json']::text[]
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS ai_diagnostics_super_admin_read ON storage.objects;
CREATE POLICY ai_diagnostics_super_admin_read
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (bucket_id = 'ai-diagnostics' AND public.is_super_admin());
