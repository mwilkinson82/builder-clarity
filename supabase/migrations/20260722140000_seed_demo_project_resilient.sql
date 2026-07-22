-- Make the demo-seed trigger resilient: a seed failure must NEVER abort the
-- new user's auth.users insert.
--
-- seed_demo_project() runs AFTER INSERT ON auth.users. Before this, any failure
-- inside it (e.g. a change_orders insert missing the overwatch.change_order_write
-- command GUC, SQLSTATE 23514) aborted the auth.users transaction — which took
-- down ALL sign-ups and invites, and via pooled connections poisoned unrelated
-- magic-link generation for existing users too (the 2026-07-22 outage). The root
-- GUC bug was fixed in 20260722120000; this is defense-in-depth so the class of
-- failure can't recur: wrap the body in an exception handler that logs and lets
-- sign-up proceed without the demo.
--
-- Applied by transforming the live definition in-place (the body is taken from
-- pg_get_functiondef, never re-typed) so the seed logic is preserved verbatim.
-- Idempotent: skips if already wrapped; aborts loudly if the anchor is missing
-- rather than silently no-op'ing.

DO $migration$
DECLARE
  old_def text;
  new_def text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO old_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'seed_demo_project';

  IF old_def IS NULL THEN
    RAISE NOTICE 'seed_demo_project() not present; nothing to harden';
    RETURN;
  END IF;

  IF position('seed_demo_project skipped for user' IN old_def) > 0 THEN
    RAISE NOTICE 'seed_demo_project() already resilient; skipping';
    RETURN;
  END IF;

  new_def := replace(
    old_def,
    E'\n  RETURN NEW;\nEND $function$',
    E'\n  RETURN NEW;\nEXCEPTION\n  WHEN OTHERS THEN\n'
    || E'    -- A demo-seed failure must NEVER abort the user''s auth.users insert\n'
    || E'    -- (that takes down ALL sign-up/invite). Log and let sign-up proceed\n'
    || E'    -- without the demo project.\n'
    || E'    RAISE WARNING ''seed_demo_project skipped for user %: %'', NEW.id, SQLERRM;\n'
    || E'    RETURN NEW;\nEND $function$'
  );

  IF new_def = old_def THEN
    RAISE EXCEPTION
      'seed_demo_project resilience patch: RETURN NEW/END anchor not found — aborting rather than silently no-op';
  END IF;

  EXECUTE new_def;
  RAISE NOTICE 'seed_demo_project() wrapped with a failure-tolerant exception handler';
END
$migration$;
