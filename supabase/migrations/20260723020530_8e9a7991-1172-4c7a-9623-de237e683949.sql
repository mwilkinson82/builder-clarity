DO $$
DECLARE
  sigs text[] := ARRAY[
    'public.enqueue_email(text, jsonb)',
    'public.read_email_batch(text, integer, integer)',
    'public.delete_email(text, bigint)',
    'public.move_to_dlq(text, text, bigint, jsonb)',
    'public.email_queue_dispatch()',
    'public.email_queue_wake()'
  ];
  sig text;
  has_sandbox boolean;
BEGIN
  SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sandbox_exec') INTO has_sandbox;

  FOREACH sig IN ARRAY sigs LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', sig);
    IF has_sandbox THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM sandbox_exec', sig);
    END IF;
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', sig);
  END LOOP;
END $$;

-- Fail-closed assertions
DO $$
DECLARE
  sigs text[] := ARRAY[
    'public.enqueue_email(text, jsonb)',
    'public.read_email_batch(text, integer, integer)',
    'public.delete_email(text, bigint)',
    'public.move_to_dlq(text, text, bigint, jsonb)',
    'public.email_queue_dispatch()',
    'public.email_queue_wake()'
  ];
  sig text;
BEGIN
  FOREACH sig IN ARRAY sigs LOOP
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