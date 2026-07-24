# Overwatch enterprise release gate

No release is complete because the source builds. The release must pass the code
contracts, the Lovable database and publication contracts, and the exact
authenticated customer gestures affected by the change.

## 1. Pull-request gate

The `Release contracts` check runs on every pull request to `main`, every push to
`main`, and manual dispatch. CI pins Node and Bun, installs the committed
`bun.lock` with `bun install --frozen-lockfile`, proves the install did not rewrite
`bun.lock` or `package.json`, and reports the actual runtime and critical package
versions used by the gate.

`bun run gate:pr` is blocking and runs:

- changed-file ESLint, with application/test-source lint inventoried separately
  (generated, generated-seed, and vendored sources excluded) so old debt cannot
  hide a new error or be misrepresented as a new product defect;
- explicitly named auth callback/MagicLink, team authorization, Plan Room,
  financial command/ledger, and email-queue migration-order suites;
- TypeScript, the production build, Phase 0 contracts, and the complete Vitest
  suite;
- a post-build check that fails if the generated route manifest is stale;
- a post-build deployment-coherence check that requires the built server worker
  to invoke both audited Daily WIP RPCs, rejects a direct-DML worker, and requires
  the project client asset to send `expected_version` plus `operation_key` for
  both save and void across the GitHub/local `.output` and Lovable `dist`
  production layouts;
- the estimating, AI takeoff, CPM, demo, CRM, billing, budget, subcontract,
  compliance, submittal, Daily WIP, AIA, role, and schedule domain smokes.

All child Node processes receive `NODE_OPTIONS=--max-old-space-size=8192`.

## 2. GitHub merge protection

As of July 23, 2026, `main` has no branch protection, no ruleset, and no existing
Actions workflow. Land this workflow and let `Release contracts` finish
successfully once before selecting it as a required status check. GitHub's UI
cannot select a check context it has never observed; requiring an unproven or
misnamed context through the API can deadlock merges without proving the gate.

After the first green run:

1. require a pull request before merging;
2. require `Release contracts`;
3. require the branch to be current before merge;
4. block force pushes and branch deletion;
5. prevent direct pushes to `main`, including administrator bypass unless a
   documented break-glass event is active.

Protection is not part of this source patch and must not be enabled until the
workflow exists on GitHub and its exact check name has been observed.

## 3. Lovable database gate

Apply database changes only through the Lovable Interconnector. A migration file
in Git is not evidence that production changed. A schema-dependent release
remains incomplete until the controlling Lovable Cloud database proves the
required columns, constraints, RLS policies, function bodies, grants, and
migration ledger state.

High-risk migrations must fail closed in their own transaction. Their assertions
must raise and roll back if the intended financial invariant or privilege
boundary is absent.

## 4. Lovable publication gate

Merge and publish through Lovable. Do not use a Vercel deployment as proof.

Run `bun run gate:live` only after Lovable reports the release published. The
live gate rejects Vercel hostnames and requires:

1. the expected GitHub `main` SHA;
2. a fresh `git ls-remote` proving that SHA is still GitHub `origin/main`;
3. the `data-commit-sha` marker on `builder-clarity.lovable.app`;
4. the same marker on `overwatch.alpcontractorcircle.com`;
5. the hashed, one-year immutable project client asset referenced by the public
   project route contains the versioned Daily WIP save and void contract;
6. the custom-domain Phase 0 routes.

Override the defaults only when the controlling Lovable project changes:

```sh
OVERWATCH_EXPECTED_COMMIT=<40-character-main-sha> \
OVERWATCH_LOVABLE_URL=https://builder-clarity.lovable.app \
OVERWATCH_CUSTOM_DOMAIN=https://overwatch.alpcontractorcircle.com \
bun run gate:live
```

## 5. Authenticated browser gate

Automation does not replace the user journey. Maintain a resettable QA company
with owner, admin, project-manager, member, client, disabled, and invited
accounts. Exercise every reachable route at 320, 360, 390, 768, 1280, and 1536
pixels.

For every route and role, verify:

- authorized routes render and forbidden routes refuse access;
- primary controls produce the expected persisted state change;
- destructive controls confirm intent and reconcile after refresh;
- no page or dialog clips, horizontally overflows, renders broken assets, or
  produces unexpected console, page, 4xx, or 5xx errors;
- refresh, back/forward, duplicate submission, retry, and concurrency do not
  corrupt state;
- financial actions preserve cents, authority, idempotency, journals, and ledger
  totals;
- fresh, repeated, expired, already-used, disabled-user, and invite MagicLinks
  end in the correct organization and role without redirect or exchange loops.

Do not call a release complete from source assertions alone. Reproduce the exact
customer gesture against the exact production DOM target.

## 6. Sign-In P0 maintenance window checklist

Treat this cutover as **incomplete** until the maintenance-window sequence below
has finished and its evidence has been captured. Database application, source
merge, and production publication must all run through the Lovable
Interconnector. Do not use local `psql`, Supabase CLI, Vercel, or a direct GitHub
merge as a substitute.

The code release depends on the new finalizer, authority, lookup, and reservation
RPCs. Apply and verify the database first; publish the code only after the
schema gate is green. Never run the new code against the old schema.

1. **Freeze and announce.** Announce the window, pause invitations/client-link
   sends and bulk provisioning, identify the previous production SHA, and
   prevent a second release from entering Lovable.
2. **Snapshot and inventory through Lovable.** Take the platform-approved
   database snapshot and export the migration ledger plus the relevant rows from
   `organizations`, `organization_memberships`, `organization_invites`,
   `project_client_access`, `projects`, `project_members`, and `profiles`.
3. **Prove the exact candidate.** Record the candidate GitHub `main` SHA and
   confirm Lovable contains these migrations in this exact order:
   - `20260724000000_account_provisioning_history_containment.sql`
   - `20260724000900_auth_p0_owner_seat_preflight.sql`
   - `20260724001000_auth_p0_provisioning_authorization_lockdown.sql`
   - `20260724001100_auth_p0_client_active_binding_lockdown.sql`
   - `20260724001200_auth_p0_authority_mutation_guards.sql`
   - `20260724001300_auth_magic_link_send_reservation.sql`
   - `20260724001400_auth_p0_sandbox_execute_revocation.sql`
   - `20260724001500_auth_p0_final_connector_acl_seal.sql`
4. **Run the read-only Owner-seat preflight before any write.** Through the
   Lovable maintenance connection, run
   `supabase/verification/20260724000900_auth_p0_owner_seat_preflight.sql`.
   Capture its migration-ledger, exact-candidate, unmatched-review, and
   creator-Owner control result sets. Record a disposition for every active
   non-creator Owner row: approved legitimate co-owner with provenance, or an
   exact-row repair through Lovable with before/after rows and reviewer/reason.
   If any row is unresolved, **stop**. Rerun until the exact non-Owner-invite
   candidate result is zero and every unmatched-review row has an approved
   disposition. Never bulk-demote or infer ownership by email.
5. **Apply the first seven database migrations one at a time through Lovable.**
   Apply `20260724000000` through `20260724001400` in the order above and capture
   each Lovable migration result and ledger entry. Reserve `20260724001500` for
   the final database operation after the rollback harness and read-only
   contract audit. Stop on the first error. Do not publish code while any
   migration is missing, partially reported, or unverifiable.
6. **Run the rollback-only proof harness.** Through the same maintenance
   connection, run
   `supabase/verification/20260724001000_auth_p0_transaction_rollback_harness.sql`.
   Require every assertion to pass and the final transaction to `ROLLBACK`.
   Record the output; the harness must never leave canary state behind. The
   Lovable read-only database connector can restore its `sandbox_exec` grants
   after a query completes, so this harness is deliberately run before the final
   connector ACL seal.
7. **Verify database contracts before the final connector seal.** At minimum,
   prove:
   - both Auth-user provisioning triggers are absent;
   - ordinary login cannot create an organization, Owner seat, or accept an
     invite;
   - exact invite and client-access finalizers are executable by
     `authenticated` but not `anon`;
   - active client access requires `client_user_id = accepted_by = auth.uid()`;
   - legacy active client rows with a non-null binding and null `accepted_by`
     were repaired to that same user; unbound/conflicting rows caused an abort;
   - authenticated raw membership INSERT/UPDATE/DELETE is denied and the
     bounded authority RPC remains available;
   - MagicLink Auth lookup and atomic send reservation are executable only by
     `service_role`;
   - project `owner_id` is attribution, not authorization, and project creation
     grants only the scoped project-manager role.
8. **Apply the final connector ACL seal and stop querying the database.** Apply
   `20260724001500_auth_p0_final_connector_acl_seal.sql` once through Lovable as
   the last database operation. Require its in-transaction `$seal_and_verify$`
   block to prove that `sandbox_exec` retains no direct or inherited `EXECUTE`
   on the complete 28-function Auth/authorization surface. Do not call the
   Lovable database-query connector after this migration; doing so recreates the
   operational grants that the seal removes.
9. **Merge and publish the exact code SHA through Lovable.** Only after steps
   1–8 are green, let Lovable merge the reviewed code and publish it. Record the
   Lovable commit, build result, published SHA, and migration state separately.
10. **Run production sign-in canaries against both Lovable domains.** Use
    resettable accounts and prove:

    - a known existing but unconfirmed Auth identity receives a MagicLink rather
      than being recreated or reinvited;
    - a genuinely new exact invite lands in the intended organization, role, and
      default organization; a second pending invite for the same email is
      untouched;
    - repeat login, refresh, expired link, and already-used link show a stable
      recovery path without a redirect/query loop or stale-session rescue;
    - a disabled-only seat reaches "No active company access" and creates no
      organization or Owner seat;
    - resending an existing invite still works at the seat ceiling, while a new
      invite is refused;
    - resending/regranting an active bound client preserves active status,
      binding, acceptance, and module permissions;
    - pending client access is unreadable until the exact callback binds it;
    - company-seat disable and client-access revoke take effect on the next
      server-authorized operation in an already-open session.

11. **Close only with production proof.** Run `bun run gate:live`, require the
    candidate SHA on both `builder-clarity.lovable.app` and
    `overwatch.alpcontractorcircle.com`, and attach canary results plus relevant
    4xx/5xx/auth-log review. Resume invitations only after this evidence is
    complete.

### Stop and recovery conditions

- A failed migration must roll back its own transaction. Stop the cutover and
  leave the prior production code published.
- Do **not** reapply `20260722233000`; it restores the privilege-minting account
  resolver this cutover removes.
- Do not operate a mixed state (new code/old schema or old code/partially
  restored schema). If a failure occurs after schema application, keep the
  maintenance window closed and either correct forward through Lovable or
  coordinate a full database-snapshot restore and previous-code publication as
  one recovery operation.
- Any unexpected Owner seat, wrong organization/default, active-client
  demotion, invitation loop, raw membership write, missing RPC/grant, or
  production-SHA mismatch is a release blocker.
