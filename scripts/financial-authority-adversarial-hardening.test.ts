import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260720191111_financial_authority_adversarial_hardening.sql",
  ),
  "utf8",
);
const projects = readFileSync(join(process.cwd(), "src/lib/projects.functions.ts"), "utf8");
const estimates = readFileSync(join(process.cwd(), "src/lib/estimates.functions.ts"), "utf8");
const projectHome = readFileSync(
  join(process.cwd(), "src/routes/_authenticated/index.tsx"),
  "utf8",
);
const projectRoute = readFileSync(
  join(process.cwd(), "src/routes/_authenticated/projects.$projectId.tsx"),
  "utf8",
);
const scheduleRisk = readFileSync(
  join(process.cwd(), "src/components/schedule/ScheduleRiskTab.tsx"),
  "utf8",
);
const headerDialog = readFileSync(
  join(process.cwd(), "src/components/project/EditFinancialsDialog.tsx"),
  "utf8",
);
const estimateWorkspace = readFileSync(
  join(process.cwd(), "src/components/estimates/EstimateWorkspace.tsx"),
  "utf8",
);

function block(source: string, start: string, end: string) {
  const startAt = source.indexOf(start);
  const endAt = source.indexOf(end, startAt + start.length);
  expect(startAt, `missing source marker: ${start}`).toBeGreaterThanOrEqual(0);
  expect(endAt, `missing source marker: ${end}`).toBeGreaterThan(startAt);
  return source.slice(startAt, endAt);
}

describe("safe accounting range and immutable evidence", () => {
  it("rejects fractional, negative, and unsafe cents before aggregate casts", () => {
    const validator = block(
      migration,
      "create or replace function public.assert_safe_accounting_cents",
      "create or replace function public.reject_financial_journal_mutation",
    );
    expect(validator).toContain("9007199254740991");
    expect(validator).toContain("p_cents <> trunc(p_cents)");
    expect(validator).toContain("not p_allow_negative and p_cents < 0");
    expect(migration).toContain("Estimate line extension");
    expect(migration).toContain("Project forecast aggregate");
    expect(migration).toContain("Subcontract payment aggregate");
    expect(migration).toMatch(/v_total > 9007199254740991 - v_markup_amount/i);
  });

  it("makes journals append-only, parent-restricting, and actor-decoupled", () => {
    for (const table of [
      "budget_command_operations",
      "estimate_sov_conversion_operations",
      "budget_money_repairs",
      "estimate_import_operations",
      "project_financial_operations",
      "project_financial_overrides",
      "estimate_line_operations",
    ]) {
      expect(migration).toContain(`${table}_immutable`);
    }
    expect(migration).toMatch(
      /project_financial_operations_project_id_fkey[\s\S]*on delete restrict/i,
    );
    expect(migration).toMatch(
      /estimate_line_operations_estimate_id_fkey[\s\S]*on delete restrict/i,
    );
    expect(migration).toContain(
      "drop constraint if exists budget_command_operations_changed_by_fkey",
    );
    expect(migration).toContain(
      "drop constraint if exists estimate_import_operations_created_by_fkey",
    );
    expect(migration).not.toMatch(/add constraint [^\n]*(changed_by|created_by)[^\n]*foreign key/i);
  });

  it("does not expose trigger-only functions as callable RPCs", () => {
    const triggerFunctions = [
      "tg_validate_project_safe_money",
      "tg_validate_cost_bucket_safe_money",
      "tg_validate_cost_bucket_safe_aggregate",
      "tg_validate_subcontract_safe_money",
      "tg_validate_subcontract_payment_safe_money",
      "tg_validate_subcontract_payment_safe_aggregate",
      "tg_validate_subcontract_allocation_safe_money",
      "tg_enforce_keyed_subcontract_payment_immutability",
      "tg_protect_project_financial_authority",
      "tg_validate_estimate_line_safe_money",
      "tg_lock_estimate_line_parent",
      "tg_freeze_estimate_financial_content",
    ];
    for (const functionName of triggerFunctions) {
      expect(migration).toMatch(
        new RegExp(
          `revoke all on function public\\.${functionName} \\(\\)[\\s\\S]{0,80}from public, anon, authenticated, service_role`,
          "i",
        ),
      );
    }
  });
});

describe("client-stable project command retries", () => {
  it("requires caller operation keys and never mints them in server handlers", () => {
    const create = block(projects, "const createProjectInput", "const updateFinancialsInput");
    const update = block(projects, "const updateFinancialsInput", "const projectIdInput");
    const lock = block(
      projects,
      "export const lockProjectBudget",
      "export const listBudgetOverrides",
    );
    expect(create).toContain("operationKey: z.string().uuid()");
    expect(create).toContain("p_operation_key: data.operationKey");
    expect(update).toContain("operationKey: z.string().uuid()");
    expect(update).toContain("p_operation_key: data.operationKey");
    expect(lock).toContain("operationKey: z.string().uuid()");
    expect(lock).toContain("p_operation_key: data.operationKey");
    expect(create).not.toContain("crypto.randomUUID()");
    expect(update).not.toContain("crypto.randomUUID()");
    expect(lock).not.toContain("crypto.randomUUID()");
  });

  it("rotates UI keys only after an authoritative success", () => {
    expect(projectHome).toContain("createOperationKeyRef.current");
    expect(projectHome).toMatch(
      /onSuccess:[\s\S]{0,120}createOperationKeyRef\.current = crypto\.randomUUID\(\)/,
    );
    // Budget lock: the route holds a stable ref key, rotates it only after the
    // server confirms the lock, and a failed attempt retries with the same key.
    expect(projectRoute).toContain("budgetLockOperationKeyRef.current");
    expect(projectRoute).toMatch(
      /onSuccess:[\s\S]{0,160}budgetLockOperationKeyRef\.current = crypto\.randomUUID\(\)/,
    );
    expect(projectRoute).not.toMatch(/onError:[\s\S]{0,180}budgetLockOperationKeyRef\.current\s*=/);
    // Project-header edits: EditFinancialsDialog owns a per-draft key. It is
    // minted when the draft opens/resets, reused verbatim on a retry after a
    // failed save (the catch path never rotates it), and replaced only when
    // the user edits the draft — a genuinely new intent — or the save
    // succeeds and the draft resets. Behavior is executed end-to-end in
    // project-financial-header-command.test.tsx; these markers pin the shape.
    expect(headerDialog).toContain(
      "const [operationKey, setOperationKey] = useState(newProjectHeaderOperationKey)",
    );
    expect(headerDialog).not.toMatch(/catch[\s\S]{0,240}setOperationKey/);
    // Schedule-risk header patches: per-intent stable keys, cleared only after
    // the server accepts the patch; onError leaves the key so retry replays
    // the identical command.
    expect(scheduleRisk).toContain("projectHeaderRetryKeys.current");
    expect(scheduleRisk).toMatch(/onSuccess:[\s\S]{0,200}projectHeaderRetryKeys\.current\.delete/);
    expect(scheduleRisk).not.toMatch(
      /onError:[\s\S]{0,240}projectHeaderRetryKeys\.current\.(set|delete)/,
    );
  });
});

describe("estimate lifecycle and atomic revision commands", () => {
  it("freezes final/converted estimate money and keyed subcontract requests", () => {
    expect(migration).toContain("Final or converted estimate financial content is immutable");
    expect(migration).toMatch(
      /create trigger estimates_freeze_financial_content[\s\S]*before update or delete on public\.estimates/i,
    );
    expect(migration).toMatch(
      /create trigger subcontract_payments_keyed_immutable[\s\S]*before update or delete on public\.subcontract_payments/i,
    );
    expect(migration).toContain("A keyed subcontract payment is immutable");
  });

  it("makes line update/delete retry keys caller-owned, including delete-after-loss", () => {
    const update = block(estimates, "export const updateLineItem", "export const deleteLineItem");
    const remove = block(estimates, "export const deleteLineItem", "export const reorderLineItems");
    expect(update).toContain("p_operation_key: data.operation_key");
    expect(remove).toContain("p_estimate_id: data.estimate_id");
    expect(remove).toContain("p_operation_key: data.operation_key");
    expect(update).not.toContain("crypto.randomUUID()");
    expect(remove).not.toContain("crypto.randomUUID()");

    const deleteRpc = block(
      migration,
      "create or replace function public.delete_estimate_line_item_atomic",
      "create or replace function public.reorder_estimate_line_items_atomic",
    );
    expect(deleteRpc.indexOf("from public.estimate_line_operations operation")).toBeLessThan(
      deleteRpc.indexOf("from public.estimate_line_items line"),
    );
    expect(deleteRpc).toContain("p_estimate_id uuid");
  });

  it("reorders the complete worksheet in one transaction with optimistic concurrency", () => {
    const handler = block(
      estimates,
      "export const reorderLineItems",
      "export const duplicateEstimate",
    );
    expect(handler).toContain('"reorder_estimate_line_items_atomic"');
    expect(handler).toContain("p_expected_item_ids: data.expected_item_ids");
    expect(handler).toContain("p_operation_key: data.operation_key");
    expect(handler).not.toMatch(/for \(let index/);
    expect(handler).not.toContain('"update_estimate_line_item_atomic"');

    const rpc = block(
      migration,
      "create or replace function public.reorder_estimate_line_items_atomic",
      "alter table public.estimate_line_operations",
    );
    expect(rpc).toContain("for update");
    expect(rpc).toContain("v_current_item_ids is distinct from p_expected_item_ids");
    expect(rpc).toContain("errcode = '40001'");
    expect(rpc).toMatch(
      /update public\.estimate_line_items line[\s\S]*from unnest\(p_item_ids\) with ordinality/i,
    );
    expect(rpc).toContain("p_item_ids @> v_current_item_ids");
    expect(rpc).toContain("'line_reorder'");
  });

  it("retains the same client key after failure and releases it after success", () => {
    expect(estimateWorkspace).toContain("retainOperationKey");
    expect(estimateWorkspace).toContain("releaseOperationKey");
    expect(estimateWorkspace).toMatch(
      /onSuccess:[\s\S]{0,180}releaseOperationKey\(lineOperationKeysRef\.current, payload\.operation_key\)/,
    );
    expect(estimateWorkspace).not.toMatch(
      /onError:[\s\S]{0,180}releaseOperationKey\(lineOperationKeysRef\.current/,
    );

    const retained = new Map<string, string>();
    const keyFor = (fingerprint: string) => {
      const existing = retained.get(fingerprint);
      if (existing) return existing;
      const created = crypto.randomUUID();
      retained.set(fingerprint, created);
      return created;
    };
    const first = keyFor("same request");
    expect(keyFor("same request")).toBe(first);
    retained.delete("same request");
    expect(keyFor("same request")).not.toBe(first);
  });
});
