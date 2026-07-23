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

The forward migration that closes the disabled-seat + demo-trigger findings
is staged unapplied at
`supabase/verification/20260723210000_account_provisioning_history_containment.sql`.
Apply only during a scheduled maintenance window:

1. **Announce** the window in the ops channel and pause any bulk user-provisioning
   automation.
2. **Snapshot** the current `public.organizations`, `public.organization_memberships`,
   `public.organization_invites`, `public.project_client_access`, and
   `public.profiles` tables (or take a full DB snapshot per platform policy).
3. **Move** the SQL file to `supabase/migrations/` using a timestamp later than
   every currently-applied migration. Do NOT rename in-place; the platform ignores
   `supabase/verification/`.
4. **Apply** with the standard migration path (Lovable Cloud pickup or `psql` by
   an operator with DB credentials). Re-run is safe (CREATE OR REPLACE / DROP IF
   EXISTS only).
5. **Verify** immediately after apply:
   - `on_auth_user_created` no longer exists on `auth.users`.
   - `has_function_privilege('authenticated','public.ensure_user_account(uuid,text,text)','EXECUTE')` returns `false`.
   - `has_function_privilege('authenticated','public.ensure_current_user_account()','EXECUTE')` returns `true`.
6. **Behavioral sanity**: sign in as a disabled-only-seat account. The user must
   land on the "No active company access" screen — NOT a new personal company —
   and no fresh `organizations` row for that user should appear.
7. **Rollback plan**: if verification fails, re-apply `20260722233000` to restore
   the prior `ensure_user_account`. The auth trigger drop is idempotent; if
   demo-seeding is required, re-enable the org-scoped `seedDemoIfEmpty` bootstrap
   in code before rolling back.
