-- NOT EXECUTED by Codex.
-- Read-only maintenance preflight for historical Owner-seat corruption.
--
-- Required release evidence:
-- 0. Run this file through the Lovable maintenance connection before applying
--    any pending migration. Do not assume 20260722233000 (or its generated
--    duplicate) already ran; both predate 00900 and contain an older bounded
--    repair that must not run before this evidence is captured.
-- 1. Capture the candidate SELECT below before any repair.
-- 2. Review each exact membership_id and accepted_invite_id against company
--    ownership records. Do not bulk-demote or infer authority from email.
-- 3. If a repair is approved, execute that exact-row repair separately through
--    the Lovable maintenance connection and record the reviewer and reason.
-- 4. Run this file again and capture a zero-row candidate result plus the
--    unchanged legitimate organization creator/Owner rows.
-- 5. Only then apply migration 20260724000900 and the remaining Auth cutover.

BEGIN;
SET TRANSACTION READ ONLY;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

SELECT
  expected.version,
  EXISTS (
    SELECT 1
    FROM supabase_migrations.schema_migrations AS applied
    WHERE applied.version = expected.version
  ) AS already_applied
FROM (
  VALUES ('20260722233000'::text), ('20260722233042'::text)
) AS expected(version)
ORDER BY expected.version;

WITH owner_seat_candidates AS (
  SELECT
    membership.id AS membership_id,
    membership.organization_id,
    organization.name AS organization_name,
    organization.created_by AS organization_creator_user_id,
    creator.email AS organization_creator_email,
    membership.user_id AS owner_seat_user_id,
    seat_user.email AS owner_seat_email,
    membership.role AS current_role,
    membership.status AS current_status,
    membership.capabilities AS current_capabilities,
    membership.created_at AS membership_created_at,
    accepted_invite.id AS accepted_invite_id,
    accepted_invite.role AS invited_role,
    accepted_invite.capabilities AS invited_capabilities,
    accepted_invite.invited_by,
    inviter.email AS inviter_email,
    accepted_invite.accepted_at
  FROM public.organization_memberships AS membership
  JOIN public.organization_invites AS accepted_invite
    ON accepted_invite.organization_id = membership.organization_id
   AND accepted_invite.accepted_by = membership.user_id
   AND accepted_invite.status = 'accepted'
   AND accepted_invite.role <> 'owner'::public.account_role
   AND accepted_invite.accepted_at = membership.created_at
  JOIN public.organizations AS organization
    ON organization.id = membership.organization_id
  LEFT JOIN auth.users AS creator
    ON creator.id = organization.created_by
  LEFT JOIN auth.users AS seat_user
    ON seat_user.id = membership.user_id
  LEFT JOIN auth.users AS inviter
    ON inviter.id = accepted_invite.invited_by
  WHERE membership.role = 'owner'::public.account_role
    AND membership.status = 'active'::public.member_status
    AND organization.created_by IS DISTINCT FROM membership.user_id
)
SELECT *
FROM owner_seat_candidates
ORDER BY organization_id, membership_id, accepted_invite_id;

-- Non-blocking inventory: every other active, non-creator Owner remains
-- visible even when its timestamps do not prove the exact corruption
-- signature. "unmatched_review" is not auto-demoted or migration-blocking,
-- but must be included in the human ownership review.
SELECT
  membership.id AS membership_id,
  membership.organization_id,
  organization.name AS organization_name,
  organization.created_by AS organization_creator_user_id,
  membership.user_id AS owner_seat_user_id,
  seat_user.email AS owner_seat_email,
  membership.created_at,
  CASE
    WHEN EXISTS (
      SELECT 1
      FROM public.organization_invites AS accepted_invite
      WHERE accepted_invite.organization_id = membership.organization_id
        AND accepted_invite.accepted_by = membership.user_id
        AND accepted_invite.status = 'accepted'
        AND accepted_invite.role <> 'owner'::public.account_role
        AND accepted_invite.accepted_at = membership.created_at
    ) THEN 'exact_candidate'
    ELSE 'unmatched_review'
  END AS provenance_classification
FROM public.organization_memberships AS membership
JOIN public.organizations AS organization
  ON organization.id = membership.organization_id
LEFT JOIN auth.users AS seat_user
  ON seat_user.id = membership.user_id
WHERE membership.role = 'owner'::public.account_role
  AND membership.status = 'active'::public.member_status
  AND organization.created_by IS DISTINCT FROM membership.user_id
ORDER BY membership.organization_id, membership.id;

-- Positive control captured with the release record: organization creators
-- who still hold an active Owner seat are listed independently and are never
-- candidates for the repair gate above.
SELECT
  organization.id AS organization_id,
  organization.name AS organization_name,
  organization.created_by AS organization_creator_user_id,
  creator.email AS organization_creator_email,
  membership.id AS creator_owner_membership_id,
  membership.status,
  membership.created_at
FROM public.organizations AS organization
JOIN public.organization_memberships AS membership
  ON membership.organization_id = organization.id
 AND membership.user_id = organization.created_by
 AND membership.role = 'owner'::public.account_role
 AND membership.status = 'active'::public.member_status
LEFT JOIN auth.users AS creator
  ON creator.id = organization.created_by
ORDER BY organization.id, membership.id;

DO $verify$
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
        'Owner-seat preflight failed: %s exact rows still require reviewed repair.',
        v_candidate_count
      );
  END IF;
END;
$verify$;

ROLLBACK;
