import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const projectsSource = readFileSync(join(process.cwd(), "src/lib/projects.functions.ts"), "utf8");
const estimatesSource = readFileSync(join(process.cwd(), "src/lib/estimates.functions.ts"), "utf8");
const estimateWorkspace = readFileSync(
  join(process.cwd(), "src/components/estimates/EstimateWorkspace.tsx"),
  "utf8",
);
const budgetDrawer = readFileSync(
  join(process.cwd(), "src/components/outcome/BudgetLineDrawer.tsx"),
  "utf8",
);
const importSheet = readFileSync(
  join(process.cwd(), "src/components/outcome/ImportSOVSheet.tsx"),
  "utf8",
);
const projectRoute = readFileSync(
  join(process.cwd(), "src/routes/_authenticated/projects.$projectId.tsx"),
  "utf8",
);
const migration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260720183243_budget_sov_authority_commands.sql"),
  "utf8",
);

function block(source: string, start: string, end: string) {
  const startAt = source.indexOf(start);
  const endAt = source.indexOf(end, startAt + start.length);
  expect(startAt, `missing source marker: ${start}`).toBeGreaterThanOrEqual(0);
  expect(endAt, `missing source marker: ${end}`).toBeGreaterThan(startAt);
  return source.slice(startAt, endAt);
}

describe("budget and SOV command authority", () => {
  it("routes every interactive bucket mutation through one retry-safe RPC", () => {
    const update = block(projectsSource, "export const updateBucket", "const createBucketInput");
    const create = block(projectsSource, "export const createBucket", "export const deleteBucket");
    const remove = block(projectsSource, "export const deleteBucket", "/*\n * Bucket writes");

    expect(update).toContain('"update_cost_bucket_atomic"');
    expect(update).toContain("p_operation_key: data.operation_key");
    expect(create).toContain('"create_cost_bucket_atomic"');
    expect(create).toContain("p_payload: bucket");
    expect(remove).toContain('"delete_cost_bucket_atomic"');
    expect(remove).toContain("p_project_id: data.projectId");
    expect(projectsSource).not.toContain("export const recordBudgetOverride");
  });

  it("makes replace/append import, history, and project baseline one command", () => {
    const importHandler = block(
      projectsSource,
      "export const importCostBuckets",
      "// ---------------- DEMO SEED",
    );
    expect(importHandler).toContain('"import_cost_buckets_atomic"');
    expect(importHandler).toContain("p_operation_key: data.operation_key");
    expect(importHandler).not.toMatch(
      /dynamicTable\([^)]*cost_buckets[^)]*\)[\s\S]*\.(delete|insert|upsert)\(/,
    );
    expect(importHandler).not.toMatch(/dynamicTable\([^)]*sov_imports[^)]*\)[\s\S]*\.insert\(/);

    expect(migration).toMatch(
      /revoke\s+insert,\s*update,\s*delete on table public\.sov_imports[\s\S]*drop policy if exists sov_imports_team_insert/i,
    );
    expect(migration).toMatch(
      /create or replace function public\.import_cost_buckets_atomic[\s\S]*delete from public\.cost_buckets[\s\S]*insert into public\.sov_imports[\s\S]*insert into public\.budget_command_operations/i,
    );
  });

  it("converts an estimate to an existing or new project in one database transaction", () => {
    const internal = block(
      estimatesSource,
      "async function convertEstimateToSovInternal",
      "export const convertEstimateToSOV",
    );
    const newProject = estimatesSource.slice(
      estimatesSource.indexOf("export const convertEstimateToProject"),
    );
    expect(internal).toContain('"convert_estimate_to_sov_atomic"');
    expect(internal).toContain("p_operation_key: operationKey");
    expect(newProject).not.toMatch(/dynamicTable\([^)]*projects[^)]*\)[\s\S]*\.insert\(/);
    expect(newProject).not.toMatch(
      /dynamicTable\([^)]*cost_buckets[^)]*\)[\s\S]*\.(delete|insert)\(/,
    );

    const rpc = block(
      migration,
      "create or replace function public.convert_estimate_to_sov_atomic",
      "revoke all on function public.update_cost_bucket_atomic",
    );
    expect(rpc).toMatch(/for update/i);
    expect(rpc).toMatch(/insert into public\.projects/i);
    expect(rpc).toMatch(/delete from public\.cost_buckets/i);
    expect(rpc).toMatch(/insert into public\.cost_buckets/i);
    expect(rpc).toMatch(/update public\.estimates/i);
    expect(rpc).toMatch(/insert into public\.sov_imports/i);
    expect(rpc).toMatch(/insert into public\.budget_command_operations/i);
    expect(rpc).toMatch(/insert into public\.estimate_sov_conversion_operations/i);
    expect(rpc).toContain("This estimate is already linked to a project");
    expect(rpc).toContain("This estimate is linked to a different project");
    expect(rpc).not.toMatch(/exception\s+when[\s\S]*return/i);
  });

  it("reuses one operation key after a lost response and only rotates it after success", () => {
    const push = block(estimateWorkspace, "const pushMutation", "const saveDefaultsMutation");
    expect(push).toContain("pushOperationKeyRef.current");
    expect(push).toMatch(
      /onSuccess:[\s\S]*pushOperationKeyRef\.current\s*=\s*newEstimatePushOperationKey/,
    );
    expect(push).not.toMatch(/onError:[\s\S]{0,200}pushOperationKeyRef\.current\s*=/);

    expect(migration).toMatch(
      /constraint estimate_sov_conversion_estimate_key_unique[\s\S]*unique \(estimate_id, operation_key\)/i,
    );
    expect(migration).toMatch(
      /where operation\.estimate_id = v_estimate\.id[\s\S]*operation\.operation_key = p_operation_key[\s\S]*return v_existing\.result \|\| jsonb_build_object\('deduplicated', true\)/i,
    );
  });
});

describe("legacy cent normalization and durable constraints", () => {
  it("hard-fails missing or negative authority but deterministically repairs fractional cents", () => {
    expect(migration).toContain(
      "Budget authority upgrade blocked: cost-bucket money is negative or missing.",
    );
    expect(migration).toContain(
      "Budget authority upgrade blocked: project original cost budget is negative or missing.",
    );
    const repair = block(
      migration,
      "-- BEGIN budget-cent-largest-remainder-repair",
      "-- END budget-cent-largest-remainder-repair",
    );
    expect(repair).toContain("floor_cents");
    expect(repair).toContain("fractional_cents");
    expect(repair).toContain("target_cents");
    expect(repair).toContain("floor_total_cents");
    expect(repair).toMatch(
      /order by\s+scored\.fractional_cents desc,\s*scored\.sort_order,\s*scored\.bucket_id/i,
    );
    expect(repair).toContain("20260720183243-budget-sov-cent-normalization-v1");
    expect(repair).toMatch(/on conflict\s*\(migration_key, target_key\) do nothing/i);
  });

  it("records immutable old/new evidence and installs exact-cent checks after repair", () => {
    expect(migration).toMatch(/create table if not exists public\.budget_money_repairs/i);
    expect(migration).toMatch(
      /revoke all on table public\.budget_money_repairs\s+from\s+public,\s*anon,\s*authenticated/i,
    );
    const repairEnd = migration.indexOf("-- END budget-cent-largest-remainder-repair");
    const bucketCheck = migration.indexOf("add constraint cost_buckets_money_exact_cent_check");
    const projectCheck = migration.indexOf(
      "add constraint projects_original_cost_budget_exact_cent_check",
    );
    expect(bucketCheck).toBeGreaterThan(repairEnd);
    expect(projectCheck).toBeGreaterThan(repairEnd);
    expect(migration).toMatch(/contract_value \* 100 = trunc\s*\(contract_value \* 100\)/i);
    expect(migration).toMatch(
      /original_cost_budget \* 100 = trunc\s*\(original_cost_budget \* 100\)/i,
    );
  });
});

describe("financial reads and retry-preserving UI", () => {
  it("never converts an unread authoritative relation into an empty financial fact", () => {
    const costActuals = block(
      projectsSource,
      "export async function readCostActualsForBudget",
      "export const listCostActualsForBudget",
    );
    const allocations = block(
      projectsSource,
      "export async function readChangeOrderAllocations",
      "export const listChangeOrderAllocations",
    );
    const lock = block(
      projectsSource,
      "export async function readProjectBudgetLock",
      "const bucketInput",
    );
    expect(costActuals).toContain("requireFinancialRows");
    expect(costActuals).not.toMatch(/error[^\n]*return \[\]/);
    expect(allocations).toContain("requireFinancialRows");
    expect(allocations).not.toMatch(/error[^\n]*return \[\]/);
    expect(lock).toContain("No budget mutation is permitted");
    expect(lock).toContain("requireProjectBudgetLock");
  });

  it("keeps failed edit/import drafts visible and blocks derived UI on read failure", () => {
    expect(budgetDrawer).toMatch(/await onSave\(/);
    expect(budgetDrawer).toMatch(/await onDelete\(/);
    expect(budgetDrawer).toMatch(/role="alert"/);
    expect(importSheet).toMatch(/await onImport\(/);
    expect(importSheet).toMatch(/role="alert"/);
    expect(projectRoute).toContain("BudgetFinancialReadState");
    expect(projectRoute).toMatch(
      /const budgetFinancialQueries = \[[\s\S]*changeOrderAllocationsQuery,[\s\S]*costActualsQuery,[\s\S]*budgetOverridesQuery/,
    );
    expect(projectRoute).toMatch(/query\.isError \|\| !query\.data/);
    expect(projectRoute).toMatch(/error=\{failedBudgetFinancialQuery\.error\}/);
  });
});
