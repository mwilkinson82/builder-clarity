-- P0 historical Owner-seat preflight.
-- TRACKED FORWARD MIGRATION: intentionally unapplied. Apply only through the
-- Lovable Interconnector during the approved sign-in maintenance window.
--
-- This gate is read-only. It never guesses at a demotion. A non-creator whose
-- active Owner seat was originally created by accepting a non-Owner invite
-- must be reviewed and repaired by exact membership id with recorded
-- before/after evidence before the Auth cutover can continue.

DO $preflight$
DECLARE
  v_candidate_count bigint;
BEGIN
  SELECT pg_catalog.count(*) INTO v_candidate_count
  FROM public.organization_memberships AS membership
  JOIN public.organization_invites AS accepted_invite
    ON accepted_invite.organization_id = membership.organization_id
   AND accepted_invite.accepted_by = membership.user_id
   AND accepted_invite.status = 'accepted'
   AND accepted_invite.role <> 'owner'::public.account_role
   AND accepted_invite.accepted_at = membership.created_at
  JOIN public.organizations AS organization
    ON organization.id = membership.organization_id
  WHERE membership.role = 'owner'::public.account_role
    AND membership.status = 'active'::public.member_status
    AND organization.created_by IS DISTINCT FROM membership.user_id;

  IF v_candidate_count > 0 THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = pg_catalog.format(
        'Auth cutover blocked: %s active Owner seats require exact-row provenance review. Run supabase/verification/20260724000900_auth_p0_owner_seat_preflight.sql.',
        v_candidate_count
      );
  END IF;
END;
$preflight$;
