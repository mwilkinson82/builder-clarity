-- Lovable-managed databases may grant API roles direct EXECUTE on newly
-- created public functions. Remove those direct grants explicitly so only the
-- two authenticated, authorization-checking entry points remain callable.

REVOKE ALL ON FUNCTION public.build_estimate_review_snapshot(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.estimate_review_snapshot_hash(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_estimate_review_state(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.record_estimate_review_activity(uuid, text, text)
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.get_estimate_review_state(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_estimate_review_activity(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_estimate_review_state(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_estimate_review_activity(uuid, text, text)
  TO service_role;

NOTIFY pgrst, 'reload schema';
