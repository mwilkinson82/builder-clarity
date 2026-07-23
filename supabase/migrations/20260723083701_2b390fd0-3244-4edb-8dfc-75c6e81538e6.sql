CREATE OR REPLACE FUNCTION public.email_queue_dispatch()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pgmq.q_auth_emails)
     AND NOT EXISTS (SELECT 1 FROM pgmq.q_transactional_emails) THEN
    BEGIN
      PERFORM pg_catalog.pg_advisory_xact_lock(7700000000000001);
      IF EXISTS (SELECT 1 FROM pgmq.q_auth_emails)
         OR EXISTS (SELECT 1 FROM pgmq.q_transactional_emails) THEN
        RETURN;
      END IF;
      PERFORM cron.unschedule('process-email-queue');
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'email_queue_dispatch: cron unschedule failed: %', SQLERRM;
    END;
    RETURN;
  END IF;

  IF (SELECT retry_after_until FROM public.email_send_state WHERE id = 1) > now() THEN
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := 'https://project--30e58105-16bb-4ec6-b870-93190cb1542c.lovable.app/lovable/email/queue/process',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Lovable-Context', 'cron',
      'Authorization', 'Bearer ' || (
        SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'email_queue_service_role_key'
      )
    ),
    body := '{}'::jsonb
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.email_queue_wake()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(7700000000000001);
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-email-queue') THEN
    BEGIN
      PERFORM cron.schedule('process-email-queue', '5 seconds', $cron$ SELECT public.email_queue_dispatch(); $cron$);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'email_queue_wake: cron schedule failed: %', SQLERRM;
    END;
  END IF;

  BEGIN
    PERFORM net.http_post(
      url := 'https://project--30e58105-16bb-4ec6-b870-93190cb1542c.lovable.app/lovable/email/queue/process',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Lovable-Context', 'cron',
        'Authorization', 'Bearer ' || (
          SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'email_queue_service_role_key'
        )
      ),
      body := '{}'::jsonb
    );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'email_queue_wake failed (enqueue preserved): %', SQLERRM;
  RETURN NULL;
END;
$function$;

DO $mig$
BEGIN
  IF to_regclass('pgmq.q_auth_emails') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS email_queue_wake_auth ON pgmq.q_auth_emails';
    EXECUTE 'CREATE TRIGGER email_queue_wake_auth AFTER INSERT ON pgmq.q_auth_emails FOR EACH STATEMENT EXECUTE FUNCTION public.email_queue_wake()';
  END IF;
  IF to_regclass('pgmq.q_transactional_emails') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS email_queue_wake_transactional ON pgmq.q_transactional_emails';
    EXECUTE 'CREATE TRIGGER email_queue_wake_transactional AFTER INSERT ON pgmq.q_transactional_emails FOR EACH STATEMENT EXECUTE FUNCTION public.email_queue_wake()';
  END IF;
END $mig$;

DO $mig$
DECLARE
  sigs text[] := ARRAY[
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
END $mig$;

DO $mig$
DECLARE
  sigs text[] := ARRAY['public.email_queue_dispatch()', 'public.email_queue_wake()'];
  sig text;
  has_sandbox boolean;
BEGIN
  FOREACH sig IN ARRAY sigs LOOP
    IF to_regprocedure(sig) IS NULL THEN
      RAISE EXCEPTION 'assertion failed: function % missing', sig;
    END IF;
    IF has_function_privilege('anon', sig, 'EXECUTE')
       OR has_function_privilege('authenticated', sig, 'EXECUTE')
       OR NOT has_function_privilege('service_role', sig, 'EXECUTE') THEN
      RAISE EXCEPTION 'assertion failed: privilege posture wrong for %', sig;
    END IF;
  END LOOP;

  SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sandbox_exec') INTO has_sandbox;
  IF has_sandbox THEN
    FOREACH sig IN ARRAY sigs LOOP
      IF has_function_privilege('sandbox_exec', sig, 'EXECUTE') THEN
        RAISE EXCEPTION 'assertion failed: sandbox_exec retains EXECUTE on %', sig;
      END IF;
    END LOOP;
  END IF;

  IF to_regclass('pgmq.q_auth_emails') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_trigger t
       JOIN pg_class c ON c.oid = t.tgrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'pgmq' AND c.relname = 'q_auth_emails'
         AND t.tgname = 'email_queue_wake_auth' AND NOT t.tgisinternal
     ) THEN
    RAISE EXCEPTION 'assertion failed: trigger email_queue_wake_auth missing';
  END IF;
  IF to_regclass('pgmq.q_transactional_emails') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_trigger t
       JOIN pg_class c ON c.oid = t.tgrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'pgmq' AND c.relname = 'q_transactional_emails'
         AND t.tgname = 'email_queue_wake_transactional' AND NOT t.tgisinternal
     ) THEN
    RAISE EXCEPTION 'assertion failed: trigger email_queue_wake_transactional missing';
  END IF;
END $mig$;

NOTIFY pgrst, 'reload schema';