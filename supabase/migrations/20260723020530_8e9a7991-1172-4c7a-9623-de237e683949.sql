-- Fail-closed containment for the email queue RPC surface.
--
-- Clean-replay note: this migration lands BEFORE the runtime definitions of
-- public.email_queue_dispatch() and public.email_queue_wake() are captured
-- (see 20260723023551_021aedf3-...). Those two functions may therefore not
-- exist yet on a fresh replay, so their REVOKE/GRANT/assertion block is
-- guarded with to_regprocedure(). The four RPCs that DO exist by this point
-- (enqueue_email, read_email_batch, delete_email, move_to_dlq) remain under
-- strict, unconditional fail-closed containment and assertions.
--
-- The follow-up 20260723023551 migration creates dispatch/wake and applies
-- the same service-role-only posture + assertions to them directly, so end
-- state after chronological replay is identical to live.

-- 1. Strict containment for the four always-present RPCs.
DO $$
DECLARE
  strict_sigs text[] := ARRAY[
    'public.enqueue_email(text, jsonb)',
    'public.read_email_batch(text, integer, integer)',
    'public.delete_email(text, bigint)',
    'public.move_to_dlq(text, text, bigint, jsonb)'
  ];
  sig text;
  has_sandbox boolean;
BEGIN
  SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sandbox_exec') INTO has_sandbox;

  FOREACH sig IN ARRAY strict_sigs LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', sig);
    IF has_sandbox THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM sandbox_exec', sig);
    END IF;
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', sig);
  END LOOP;
END $$;

-- 2. Clean-replay-safe containment for dispatch/wake: only touch them if the
--    signature resolves. On live and on any replay that has already run
--    20260723023551, both exist and are contained here; on a fresh replay
--    that hasn't reached 23551 yet, this block is a no-op and 23551 will
--    apply the identical posture when it creates the functions.
DO $$
DECLARE
  conditional_sigs text[] := ARRAY[
    'public.email_queue_dispatch()',
    'public.email_queue_wake()'
  ];
  sig text;
  has_sandbox boolean;
BEGIN
  SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sandbox_exec') INTO has_sandbox;

  FOREACH sig IN ARRAY conditional_sigs LOOP
    IF to_regprocedure(sig) IS NULL THEN
      CONTINUE;
    END IF;
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', sig);
    IF has_sandbox THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM sandbox_exec', sig);
    END IF;
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', sig);
  END LOOP;
END $$;

-- 3. Strict fail-closed assertions for the four always-present RPCs.
DO $$
DECLARE
  strict_sigs text[] := ARRAY[
    'public.enqueue_email(text, jsonb)',
    'public.read_email_batch(text, integer, integer)',
    'public.delete_email(text, bigint)',
    'public.move_to_dlq(text, text, bigint, jsonb)'
  ];
  sig text;
BEGIN
  FOREACH sig IN ARRAY strict_sigs LOOP
    IF to_regprocedure(sig) IS NULL THEN
      RAISE EXCEPTION 'containment failed: expected function % missing', sig;
    END IF;
    IF has_function_privilege('anon', sig, 'EXECUTE') THEN
      RAISE EXCEPTION 'containment failed: anon still has EXECUTE on %', sig;
    END IF;
    IF has_function_privilege('authenticated', sig, 'EXECUTE') THEN
      RAISE EXCEPTION 'containment failed: authenticated still has EXECUTE on %', sig;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sandbox_exec')
       AND has_function_privilege('sandbox_exec', sig, 'EXECUTE') THEN
      RAISE EXCEPTION 'containment failed: sandbox_exec still has EXECUTE on %', sig;
    END IF;
    IF NOT has_function_privilege('service_role', sig, 'EXECUTE') THEN
      RAISE EXCEPTION 'containment failed: service_role lacks EXECUTE on %', sig;
    END IF;
  END LOOP;
END $$;

-- 4. Conditional assertions for dispatch/wake: if present at this point in
--    the replay, they MUST already be contained. If absent, defer to 23551.
DO $$
DECLARE
  conditional_sigs text[] := ARRAY[
    'public.email_queue_dispatch()',
    'public.email_queue_wake()'
  ];
  sig text;
BEGIN
  FOREACH sig IN ARRAY conditional_sigs LOOP
    IF to_regprocedure(sig) IS NULL THEN
      CONTINUE;
    END IF;
    IF has_function_privilege('anon', sig, 'EXECUTE') THEN
      RAISE EXCEPTION 'containment failed: anon still has EXECUTE on %', sig;
    END IF;
    IF has_function_privilege('authenticated', sig, 'EXECUTE') THEN
      RAISE EXCEPTION 'containment failed: authenticated still has EXECUTE on %', sig;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sandbox_exec')
       AND has_function_privilege('sandbox_exec', sig, 'EXECUTE') THEN
      RAISE EXCEPTION 'containment failed: sandbox_exec still has EXECUTE on %', sig;
    END IF;
    IF NOT has_function_privilege('service_role', sig, 'EXECUTE') THEN
      RAISE EXCEPTION 'containment failed: service_role lacks EXECUTE on %', sig;
    END IF;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
