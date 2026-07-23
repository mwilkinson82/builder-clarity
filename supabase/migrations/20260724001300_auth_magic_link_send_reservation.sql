-- P0 MagicLink send reservation.
-- TRACKED FORWARD MIGRATION: intentionally unapplied. Apply only through the
-- Lovable Interconnector during the approved sign-in maintenance window.
--
-- One service-role RPC owns the "recent send?" check plus original pending-log
-- insert. An exact dedupe-key advisory transaction lock removes the race where
-- two requests could each issue a different one-time Auth token.

CREATE INDEX IF NOT EXISTS email_send_log_auth_dedupe_recent_idx
  ON public.email_send_log (
    (metadata ->> 'dedupe_key'),
    created_at DESC
  )
  WHERE status IN ('pending', 'sent');

CREATE OR REPLACE FUNCTION public.reserve_auth_magic_link_send(
  p_dedupe_key text,
  p_message_id text,
  p_template_name text,
  p_recipient_email text,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS TABLE (
  reserved boolean,
  id uuid,
  message_id text,
  status text,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_dedupe_key text := pg_catalog.btrim(
    pg_catalog.coalesce(p_dedupe_key, '')
  );
  v_message_id text := pg_catalog.btrim(
    pg_catalog.coalesce(p_message_id, '')
  );
  v_template_name text := pg_catalog.btrim(
    pg_catalog.coalesce(p_template_name, '')
  );
  v_recipient_email text := pg_catalog.lower(
    pg_catalog.btrim(pg_catalog.coalesce(p_recipient_email, ''))
  );
  v_metadata jsonb := pg_catalog.coalesce(p_metadata, '{}'::jsonb);
  v_id uuid;
  v_existing_message_id text;
  v_status text;
  v_created_at timestamptz;
  v_now timestamptz;
  v_rows integer;
BEGIN
  IF v_dedupe_key = '' OR pg_catalog.length(v_dedupe_key) > 1024 THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = 'A bounded MagicLink dedupe key is required.';
  END IF;
  IF v_message_id = '' OR pg_catalog.length(v_message_id) > 255 THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = 'A bounded MagicLink message id is required.';
  END IF;
  IF v_template_name <> 'auth-magic-link' THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = 'The reservation endpoint is limited to the Auth MagicLink template.';
  END IF;
  IF v_recipient_email = ''
    OR pg_catalog.length(v_recipient_email) > 254
    OR pg_catalog.strpos(v_recipient_email, '@') <= 1 THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = 'A valid bounded recipient is required.';
  END IF;
  IF pg_catalog.jsonb_typeof(v_metadata) <> 'object'
    OR pg_catalog.pg_column_size(v_metadata) > 16384
    OR EXISTS (
      SELECT 1
      FROM pg_catalog.jsonb_object_keys(v_metadata) AS metadata_key(key)
      WHERE pg_catalog.lower(metadata_key.key) IN (
        'authorization',
        'bearer',
        'password',
        'secret',
        'token',
        'token_hash',
        'hashed_token',
        'action_link',
        'confirmation_link'
      )
    ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = 'MagicLink audit metadata is not safe to persist.';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_dedupe_key, 5)
  );
  v_now := pg_catalog.clock_timestamp();

  SELECT
    send_log.id,
    send_log.message_id,
    send_log.status,
    send_log.created_at
  INTO
    v_id,
    v_existing_message_id,
    v_status,
    v_created_at
  FROM public.email_send_log AS send_log
  WHERE send_log.metadata ->> 'dedupe_key' = v_dedupe_key
    AND send_log.status IN ('pending', 'sent')
    AND send_log.created_at >= v_now - '30 seconds'::pg_catalog.interval
  ORDER BY send_log.created_at DESC, send_log.id DESC
  LIMIT 1;

  IF FOUND THEN
    RETURN QUERY SELECT
      false,
      v_id,
      v_existing_message_id,
      v_status,
      v_created_at;
    RETURN;
  END IF;

  INSERT INTO public.email_send_log (
    message_id,
    template_name,
    recipient_email,
    status,
    metadata,
    created_at
  )
  VALUES (
    v_message_id,
    v_template_name,
    v_recipient_email,
    'pending',
    v_metadata || pg_catalog.jsonb_build_object(
      'dedupe_key',
      v_dedupe_key
    ),
    v_now
  )
  RETURNING
    email_send_log.id,
    email_send_log.message_id,
    email_send_log.status,
    email_send_log.created_at
  INTO
    v_id,
    v_existing_message_id,
    v_status,
    v_created_at;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'MagicLink send reservation did not converge.';
  END IF;

  RETURN QUERY SELECT
    true,
    v_id,
    v_existing_message_id,
    v_status,
    v_created_at;
END;
$fn$;

-- Exact normalized Auth-user lookup for the server route. This replaces the
-- O(N) paginated Admin listUsers scan without exposing Auth identity to a
-- browser role.
CREATE OR REPLACE FUNCTION public.lookup_auth_user_by_email_exact(p_email text)
RETURNS TABLE (
  user_id uuid,
  email_confirmed boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_normalized_email text := pg_catalog.lower(
    pg_catalog.btrim(pg_catalog.coalesce(p_email, ''))
  );
  v_match_count bigint;
  v_user_id uuid;
  v_email_confirmed boolean;
BEGIN
  IF v_normalized_email = '' OR pg_catalog.length(v_normalized_email) > 254 THEN
    RETURN;
  END IF;

  SELECT pg_catalog.count(*) INTO v_match_count
  FROM auth.users AS auth_user
  WHERE pg_catalog.lower(pg_catalog.btrim(auth_user.email))
    = v_normalized_email;

  IF v_match_count > 1 THEN
    RAISE EXCEPTION USING ERRCODE = '23505',
      MESSAGE = 'Auth identity is ambiguous for this normalized email.';
  END IF;
  IF v_match_count = 0 THEN
    RETURN;
  END IF;

  SELECT auth_user.id, auth_user.email_confirmed_at IS NOT NULL
  INTO v_user_id, v_email_confirmed
  FROM auth.users AS auth_user
  WHERE pg_catalog.lower(pg_catalog.btrim(auth_user.email))
    = v_normalized_email
  ORDER BY auth_user.created_at ASC, auth_user.id ASC
  LIMIT 1;
  RETURN QUERY SELECT v_user_id, v_email_confirmed;
END;
$fn$;

REVOKE ALL ON FUNCTION public.reserve_auth_magic_link_send(
  text, text, text, text, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_auth_magic_link_send(
  text, text, text, text, jsonb
) TO service_role;
REVOKE ALL ON FUNCTION public.lookup_auth_user_by_email_exact(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lookup_auth_user_by_email_exact(text)
  TO service_role;

DO $verify$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'sandbox_exec') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION '
      || 'public.reserve_auth_magic_link_send(text,text,text,text,jsonb) '
      || 'FROM sandbox_exec';
    EXECUTE 'REVOKE ALL ON FUNCTION '
      || 'public.lookup_auth_user_by_email_exact(text) '
      || 'FROM sandbox_exec';
  END IF;

  IF pg_catalog.has_function_privilege(
    'anon',
    'public.reserve_auth_magic_link_send(text,text,text,text,jsonb)',
    'EXECUTE'
  ) OR pg_catalog.has_function_privilege(
    'authenticated',
    'public.reserve_auth_magic_link_send(text,text,text,text,jsonb)',
    'EXECUTE'
  ) OR NOT pg_catalog.has_function_privilege(
    'service_role',
    'public.reserve_auth_magic_link_send(text,text,text,text,jsonb)',
    'EXECUTE'
  ) OR pg_catalog.has_function_privilege(
    'anon',
    'public.lookup_auth_user_by_email_exact(text)',
    'EXECUTE'
  ) OR pg_catalog.has_function_privilege(
    'authenticated',
    'public.lookup_auth_user_by_email_exact(text)',
    'EXECUTE'
  ) OR NOT pg_catalog.has_function_privilege(
    'service_role',
    'public.lookup_auth_user_by_email_exact(text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'MagicLink reservation RPC grant containment failed';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'sandbox_exec')
    AND (
      pg_catalog.has_function_privilege(
        'sandbox_exec',
        'public.reserve_auth_magic_link_send(text,text,text,text,jsonb)',
        'EXECUTE'
      )
      OR pg_catalog.has_function_privilege(
        'sandbox_exec',
        'public.lookup_auth_user_by_email_exact(text)',
        'EXECUTE'
      )
    ) THEN
    RAISE EXCEPTION 'Sandbox MagicLink reservation execution remains enabled';
  END IF;
END;
$verify$;

NOTIFY pgrst, 'reload schema';
