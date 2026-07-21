import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const component = readFileSync(
  join(process.cwd(), "src/components/billing/BillingEnhancements.tsx"),
  "utf8",
);
const source = readFileSync(join(process.cwd(), "src/lib/billing.functions.ts"), "utf8");
const projectRoute = readFileSync(
  join(process.cwd(), "src/routes/_authenticated/projects.$projectId.tsx"),
  "utf8",
);

function componentBlock(start: string, end: string) {
  const startAt = component.indexOf(start);
  const endAt = component.indexOf(end, startAt + start.length);
  expect(startAt, `missing component marker: ${start}`).toBeGreaterThanOrEqual(0);
  expect(endAt, `missing component marker: ${end}`).toBeGreaterThan(startAt);
  return component.slice(startAt, endAt);
}

function sourceBlock(start: string, end: string) {
  const startAt = source.indexOf(start);
  const endAt = source.indexOf(end, startAt + start.length);
  expect(startAt, `missing source marker: ${start}`).toBeGreaterThanOrEqual(0);
  expect(endAt, `missing source marker: ${end}`).toBeGreaterThan(startAt);
  return source.slice(startAt, endAt);
}

describe("cost UI command completion", () => {
  it("awaits every parent write callback before closing or clearing a draft", () => {
    const panel = componentBlock(
      "export function ProjectCostTrackingPanel",
      "export function WipAnalysisPanel",
    );

    expect(panel).toMatch(/onImportCostActuals:[\s\S]{0,300}Promise</);
    expect(panel).toMatch(/onVoidCostActual:[^;]*Promise</);
    expect(panel).toMatch(/onSetCostActualStatus:[\s\S]{0,220}Promise</);
    expect(panel).toMatch(/await\s+onCreateCostActual\(/);
    expect(panel).toMatch(/await\s+onUpdateCostActual\(/);
    expect(panel).toMatch(/await\s+onImportCostActuals\(/);
    expect(panel).toMatch(/await\s+onVoidCostActual\(/);
    expect(panel).toMatch(/await\s+onSetCostActualStatus\(/);

    const save = componentBlock("const save = async () =>", "const advanceDraft = async");
    const resetAt = save.lastIndexOf("resetCostForm()");
    const catchAt = save.lastIndexOf("catch");
    expect(resetAt).toBeGreaterThan(catchAt);
  });

  it("never reports paid or closes the payment dialog before the atomic payment succeeds", () => {
    const panel = componentBlock(
      "export function ProjectCostTrackingPanel",
      "export function WipAnalysisPanel",
    );
    const confirm = componentBlock("const confirmPaid", "const vendorNames");

    expect(confirm).toMatch(/async/);
    expect(confirm).toMatch(/await\s+recordPaymentMutation\.mutateAsync\(/);
    expect(confirm).not.toMatch(/onSetCostActualStatus\([^)]*"paid"/);
    expect(panel).not.toMatch(/settlementReady\)[\s\S]{0,180}onSetCostActualStatus\([^)]*paid/);

    const mutation = componentBlock("const recordPaymentMutation", "const openPayDialog");
    expect(mutation).toMatch(/onError:[\s\S]*toast\.error/);
    expect(mutation).not.toMatch(/onError:[\s\S]{0,220}setPayingCost\(null\)/);
    const closeAfterAwait =
      confirm.indexOf("setPayingCost(null)") > confirm.indexOf("await recordPaymentMutation") ||
      /onSuccess:[\s\S]*setPayingCost\(null\)/.test(mutation);
    expect(closeAfterAwait).toBe(true);
  });

  it("settles a just-edited draft from the saved amount instead of stale query data", () => {
    const advance = componentBlock("const advanceDraft = async", "const importCsv");
    const savedRowAt = advance.indexOf("const savedRow");
    const resetAt = advance.indexOf("resetCostForm()", savedRowAt);
    const openAt = advance.indexOf("openPayDialog(savedRow)", savedRowAt);

    expect(savedRowAt).toBeGreaterThanOrEqual(0);
    expect(advance).toMatch(/const savedRow\s*=\s*\{[\s\S]{0,220}amount:\s*draft\.amount/);
    expect(advance).toMatch(
      /const savedRow\s*=\s*\{[\s\S]{0,260}amount_cents:\s*dollarsToCents\(draft\.amount\)/,
    );
    expect(openAt).toBeGreaterThan(resetAt);
  });

  it("hides paid edit and void actions and explains every settlement lock", () => {
    const editableDefinition = componentBlock(
      "const editableStatus =",
      "const settlementLocksFacts =",
    );
    expect(editableDefinition).toMatch(/actual\.status\s*===\s*"draft"/);
    expect(editableDefinition).toMatch(/actual\.status\s*===\s*"approved"/);
    expect(editableDefinition).toMatch(/actual\.status\s*===\s*"committed"/);
    expect(editableDefinition).not.toMatch(/actual\.status\s*===\s*"paid"/);

    const rowActions = componentBlock(
      "const settlementLocksFacts =",
      '{actual.status === "paid" &&',
    );
    expect(rowActions).toMatch(/settlement\.cashPaidCents\s*>\s*0\s*\|\|\s*linkedNonvoidCredit/);
    expect(rowActions).toMatch(/append-only cash settlement/);
    expect(rowActions).toMatch(/Resolve the linked supplier credit/);
    expect(rowActions).toMatch(/disabled=\{savingCost\s*\|\|\s*editLockReason\s*!==\s*null\}/);
    expect(rowActions).toMatch(/disabled=\{savingCost\s*\|\|\s*voidLockReason\s*!==\s*null\}/);
    expect(rowActions).toMatch(
      /editableStatus\s*&&\s*\(editLockReason\s*\|\|\s*voidLockReason\)[\s\S]{0,180}\{editLockReason\s*\?\?\s*voidLockReason\}/,
    );
    expect(rowActions).toMatch(
      /canCloseStaleDraftCredit[\s\S]{0,500}voidLockReason\s*=\s*canCloseStaleDraftCredit\s*\?\s*null\s*:\s*editLockReason/,
    );
  });

  it("retains failed payment, cost, and import drafts for retry", () => {
    const panel = componentBlock(
      "export function ProjectCostTrackingPanel",
      "export function WipAnalysisPanel",
    );
    const save = componentBlock("const save = async () =>", "const advanceDraft = async");
    const importCsv = componentBlock("const importCsv", "return (");

    expect(save).toMatch(/catch[\s\S]{0,500}return/);
    expect(importCsv).toMatch(/catch|\.catch\(/);
    expect(importCsv).not.toMatch(/catch[\s\S]{0,300}resetCostForm\(\)/);
    expect(panel).toMatch(/Payment did not save|payment[^\n]*(?:failed|error)/i);
    expect(projectRoute).toMatch(/Cost import did not save|import[^\n]*(?:failed|error)/i);
  });

  it("uses promise-returning mutations at the route boundary so child awaits are real", () => {
    for (const callback of [
      "onCreateCostActual",
      "onImportCostActuals",
      "onVoidCostActual",
      "onSetCostActualStatus",
      "onUpdateCostActual",
    ]) {
      expect(projectRoute).toMatch(new RegExp(`${callback}=[\\s\\S]{0,260}\\.mutateAsync\\(`));
    }
  });
});

describe("stable cost operation keys", () => {
  it("passes one stable key through create, update, transition, void, import, and payment", () => {
    for (const [start, end, rpc] of [
      [
        "export const recordCostActualPayment",
        "const saveCostBudgetItemInput",
        "record_cost_actual_payment_atomic",
      ],
      ["export const createCostActual", "const updateCostActualInput", "create_cost_actual_atomic"],
      [
        "export const updateCostActual",
        "const setCostActualStatusInput",
        "update_cost_actual_atomic",
      ],
      [
        "export const setCostActualStatus",
        "const importCostActualsInput",
        "transition_cost_actual_atomic",
      ],
      ["export const importCostActuals", "const voidCostActualInput", "import_cost_actuals_atomic"],
      [
        "export const voidCostActual",
        "export const listPortfolioBilling",
        "void_cost_actual_atomic",
      ],
    ] as const) {
      const block = sourceBlock(start, end);
      expect(block).toContain(`"${rpc}"`);
      expect(block).toMatch(
        /p_(?:operation|idempotency)_key:\s*data\.(?:operation|idempotency)_key/,
      );
    }
  });

  it("reuses keys after failure and rotates them only after success or a new user intent", () => {
    const panel = componentBlock(
      "export function ProjectCostTrackingPanel",
      "export function WipAnalysisPanel",
    );
    expect(panel).toMatch(/crypto\.randomUUID\(\)/);
    expect(panel).toMatch(/(?:operation|idempotency)Key/i);

    const mutation = componentBlock("const recordPaymentMutation", "const openPayDialog");
    expect(mutation).toMatch(/(?:operation|idempotency)_key/);
    expect(mutation).not.toMatch(/crypto\.randomUUID\(\)/);

    const confirm = componentBlock("const confirmPaid", "const vendorNames");
    expect(confirm).toMatch(/(?:operation|idempotency)_key/);
    expect(confirm).not.toMatch(/crypto\.randomUUID\(\)/);

    const save = componentBlock("const save = async () =>", "const advanceDraft = async");
    expect(save).toMatch(/(?:operation|idempotency)_key/);
    expect(save).not.toMatch(
      /catch[\s\S]{0,500}(?:operation|idempotency)Key[^\n]*(?:randomUUID|new)/i,
    );
  });

  it("fails closed when the cost settlement schema is unavailable", () => {
    const details = sourceBlock(
      "export const getCostLedgerDetails",
      "const recordCostActualPaymentInput",
    );
    expect(details).not.toMatch(/settlementReady\s*=\s*!isMissingRestRelation/);
    expect(details).not.toMatch(/payments:\s*settlementReady\s*\?/);
    expect(details).toMatch(/requireFinancialQuery|throw\s+new\s+Error/);
  });
});
