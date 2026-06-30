# Overwatch Estimating Release Checklist

Use this checklist to ship the estimating module without mixing in unrelated Pipeline or Billing WIP.

## Live Main Gate

`main` publishes through Lovable. Do not push this build-out directly to `main` until the estimating migration is applied in the Lovable-managed Supabase environment and signed-in QA has passed. Keep the release isolated to the estimating files unless Pipeline CRM or Billing WIP are explicitly included.

## Migration Scope

Apply in this order only when the target Supabase project is confirmed:

1. `supabase/migrations/20260629222000_estimating_module.sql`

Apply `supabase/migrations/20260629213000_pipeline_crm.sql` only if Pipeline CRM is part of the same release.

Hold `supabase/migrations/20260629233000_billing_wip_foundation.sql` unless Billing WIP is intentionally included.

## Supabase Gate

1. Confirm the connected Supabase account can list migrations for project `ehotrggjfkxejktsgdor`.
2. Apply the estimating migration.
3. Run `supabase/verification/20260629222000_estimating_module.sql`.
4. Confirm all four estimating tables exist, RLS is enabled, authenticated/service_role grants are present, and policies include select/insert/update/delete coverage.

## Lovable Gate

1. Confirm Lovable has applied `supabase/migrations/20260629222000_estimating_module.sql` to the managed Supabase project.
2. Confirm the Lovable publish target is still tracking the intended GitHub `main` branch.
3. Deploy only after the Supabase gate is green; the UI expects the estimating tables to exist.

## App Gate

Run locally:

```bash
npx tsc --noEmit --pretty false
npm run build
npx prettier --check src/lib/estimates.functions.ts src/lib/estimate-pdf.ts src/components/estimates/EstimateWorkspace.tsx src/routes/_authenticated/estimates.tsx src/routes/_authenticated/estimates.\$estimateId.tsx src/routes/_authenticated/cost-library.tsx src/routeTree.gen.ts
git diff --check
```

## Signed-In QA

Use a real authenticated Overwatch account after the migration is live:

1. Open `/estimates`.
2. Create a new estimate with a named region.
3. Open the estimate workspace and add a manual line item.
4. Search/select at least one cost-library item from autocomplete.
5. Change quantity, material, labor, and markup percentages; confirm totals update.
6. Drag a row to reorder it.
7. Export CSV and PDF.
8. Save markup defaults.
9. Push the estimate into a project/SOV and confirm the project financial summary updates.
10. Open `/cost-library`, add a user item, edit it, and delete it.

## Known Current Blocker

The Supabase connector currently returns `You do not have permission to perform this action` for project `ehotrggjfkxejktsgdor`, so remote migration application and signed-in database QA are blocked until the connector account has project access.
