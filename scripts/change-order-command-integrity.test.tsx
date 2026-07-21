import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";

import { ChangeOrdersTable } from "@/components/outcome/ChangeOrdersTable";
import type { ChangeOrderRow } from "@/lib/projects.functions";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260720152709_project_financial_integrity_atomicity.sql",
  ),
  "utf8",
);
const functionsSource = readFileSync(join(process.cwd(), "src/lib/projects.functions.ts"), "utf8");
const componentSource = readFileSync(
  join(process.cwd(), "src/components/outcome/ChangeOrdersTable.tsx"),
  "utf8",
);
const projectRouteSource = readFileSync(
  join(process.cwd(), "src/routes/_authenticated/projects.$projectId.tsx"),
  "utf8",
);

describe("change-order database authority", () => {
  test("forces financial creates, edits, and deletes through retry-safe commands", () => {
    expect(migration).toMatch(/create table if not exists public\.change_order_operations/i);
    expect(migration).toMatch(/unique \(project_id, operation_key\)/i);
    expect(migration).toContain(
      "Change orders must be created through the atomic change-order command.",
    );
    expect(migration).toContain(
      "Change-order financial details must be edited through the atomic change-order command.",
    );
    expect(migration).toContain(
      "Change orders must be removed through the atomic change-order command.",
    );
    expect(migration).toMatch(/create or replace function public\.create_change_order_atomic\(/i);
    expect(migration).toMatch(/create or replace function public\.update_change_order_atomic\(/i);
    expect(migration).toMatch(/create or replace function public\.delete_change_order_atomic\(/i);
    expect(migration).toMatch(
      /revoke insert, update, delete on public\.change_orders from authenticated, service_role/i,
    );
    expect(migration).toMatch(/revoke update \(linked_exposure_id, linked_claim_id\)/i);
    const metadataGrant = migration.match(
      /grant update \(([\s\S]*?)\) on public\.change_orders to authenticated, service_role;/i,
    )?.[1];
    expect(metadataGrant).toContain("client_visible");
    expect(metadataGrant).not.toContain("linked_exposure_id");
    expect(metadataGrant).not.toContain("linked_claim_id");
  });

  test("uses exact cents, optimistic concurrency, and immutable final decisions", () => {
    expect(migration).toMatch(/p_contract_amount_cents bigint[\s\S]*p_cost_amount_cents bigint/i);
    expect(migration).toContain(
      "This change order changed after you opened it. Refresh before saving.",
    );
    expect(migration).toContain(
      "This change order changed after you opened it. Refresh before deleting.",
    );
    expect(migration).toMatch(/if old\.status in \('Approved', 'Denied'\)/i);
    expect(migration).toContain(
      "A finalized change order is immutable. Create an offsetting correction instead.",
    );
    expect(migration).toMatch(/request_fingerprint is distinct from v_fingerprint/i);
    expect(migration).toContain("9007199254740991");
    expect(migration).toMatch(/change_orders_safe_cent_range_check/i);
    expect(migration).toMatch(/change_order_allocations_safe_cent_range_check/i);
    expect(migration).toContain("supported positive-cent accounting range");
  });

  test("links change orders atomically without cross-project or half-linked state", () => {
    expect(migration).toMatch(
      /create or replace function public\.link_change_order_exposure_atomic\(/i,
    );
    expect(migration).toMatch(
      /create or replace function public\.unlink_change_order_exposure_atomic\(/i,
    );
    expect(migration).toMatch(
      /create or replace function public\.link_claim_change_order_atomic\(/i,
    );
    expect(migration).toContain("Change order and exposure must belong to the same project.");
    expect(migration).toContain("Change order and claim must belong to the same project.");
    expect(migration).toMatch(/get diagnostics v_row_count = row_count/i);
    expect(functionsSource).toContain('"link_change_order_exposure_atomic"');
    expect(functionsSource).toContain('"unlink_change_order_exposure_atomic"');
    expect(functionsSource).toContain('"link_claim_change_order_atomic"');
  });

  test("the server never silently drops financial fields when schema is behind", () => {
    expect(functionsSource).not.toContain("stripCoStructuredColumns");
    expect(functionsSource).not.toContain("isMissingCoStructuredColumn");
    expect(functionsSource).toMatch(/dynamicRpc\([\s\S]*create_change_order_atomic/i);
    expect(functionsSource).toMatch(/dynamicRpc\([\s\S]*update_change_order_atomic/i);
    expect(functionsSource).toMatch(/dynamicRpc\([\s\S]*delete_change_order_atomic/i);
    expect(functionsSource).toContain("expectedUpdatedAt: z.string().datetime()");
    expect(functionsSource).toContain("Change-order direction and signed amounts disagree.");
    expect(functionsSource).not.toContain("Math.abs(dollarsToCents(row.contract_amount))");
    expect(functionsSource).toContain("harborDemoOperationGeneration");
    expect(functionsSource).toContain("metadata did not update the restored fixture");
    // "Delete project" is archive-only: financial journals RESTRICT parent
    // deletion at the database, so the server archives (sets archived_at) and
    // never issues a hard delete. The UI offers real projects Close/Archive
    // only; the demo's "Hide training project" says what it does.
    const deleteProjectBlock = functionsSource.slice(
      functionsSource.indexOf("export const deleteProject"),
      functionsSource.indexOf("// ---------------- EXPOSURES"),
    );
    expect(deleteProjectBlock).toContain("Archive is therefore the supported lifecycle");
    expect(deleteProjectBlock).toContain("archived_at");
    expect(deleteProjectBlock).not.toContain(".delete()");
    expect(projectRouteSource).toContain(
      "changeOrderCommittedVersions.current.delete(input.changeOrderId)",
    );
  });

  test("the UI waits for the command, confirms deletion, and fits constrained screens", () => {
    expect(componentSource).toMatch(
      /const saved = editingId[\s\S]*await onUpdate[\s\S]*await onCreate/i,
    );
    expect(componentSource).toMatch(/if \(saved\) setOpen\(false\)/i);
    expect(componentSource).toContain("Delete this pending change order?");
    expect(componentSource).toContain("Finalized change orders are immutable");
    expect(componentSource).toContain("max-h-[calc(100vh-2rem)] overflow-y-auto");
    expect(componentSource).toContain('Table className="min-w-[1120px]"');
    expect(componentSource).toContain("grid-cols-1 gap-3 sm:col-span-2 sm:grid-cols-3");
  });
});

let root: Root | null = null;
let container: HTMLElement | null = null;

const finalized: ChangeOrderRow = {
  id: "20000000-0000-4000-8000-000000000001",
  project_id: "10000000-0000-4000-8000-000000000001",
  number: "CO-001",
  description: "Final financial history",
  contract_amount: 1_000,
  cost_amount: 700,
  financial_direction: "addition",
  status: "Approved",
  probability: 100,
  owner: "PM",
  notes: "",
  co_type: "owner_change",
  pricing_method: "lump_sum",
  schedule_impact_days: 0,
  requested_by: "Owner",
  date_initiated: "2026-07-20",
  client_visible: false,
  client_status: "not_sent",
  client_notes: "",
  client_sent_at: null,
  client_decided_at: null,
  linked_exposure_id: null,
  linked_claim_id: null,
  created_at: "2026-07-20T00:00:00.000Z",
  updated_at: "2026-07-20T00:00:00.000Z",
};

function renderTable(input: {
  changeOrders?: ChangeOrderRow[];
  onCreate?: () => Promise<boolean>;
}) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <ChangeOrdersTable
        changeOrders={input.changeOrders ?? []}
        onCreate={input.onCreate ?? (async () => true)}
        onUpdate={async () => true}
        onDelete={async () => true}
      />,
    );
  });
}

function findButton(label: string, last = false) {
  const matches = Array.from(document.body.querySelectorAll("button")).filter((button) =>
    button.textContent?.includes(label),
  );
  return matches[last ? matches.length - 1 : 0] as HTMLButtonElement | undefined;
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  document.body.querySelectorAll("[data-radix-portal]").forEach((portal) => portal.remove());
  root = null;
  container = null;
});

test("finalized change orders cannot be edited or deleted from the UI", () => {
  renderTable({ changeOrders: [finalized] });
  expect(document.querySelector<HTMLButtonElement>('[aria-label="Edit CO-001"]')?.disabled).toBe(
    true,
  );
  expect(document.querySelector<HTMLButtonElement>('[aria-label="Delete CO-001"]')?.disabled).toBe(
    true,
  );
});

test("a failed create stays open with its entries so it can be retried", async () => {
  const onCreate = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  renderTable({ onCreate });
  act(() => findButton("Add change order")?.click());
  await settle();

  const descriptionLabel = Array.from(document.body.querySelectorAll("label")).find(
    (label) => label.textContent === "Description",
  );
  const description = descriptionLabel?.parentElement?.querySelector("input") as HTMLInputElement;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
      description,
      "Owner requested revision",
    );
    description.dispatchEvent(new Event("input", { bubbles: true }));
  });

  act(() => findButton("Add change order", true)?.click());
  await settle();
  expect(onCreate).toHaveBeenCalledTimes(1);
  expect(document.body.textContent).toContain("Add change order");
  expect(description.value).toBe("Owner requested revision");

  act(() => findButton("Add change order", true)?.click());
  await settle();
  expect(onCreate).toHaveBeenCalledTimes(2);
  expect(document.body.querySelector('[role="dialog"]')).toBeNull();
});

test("financial summaries count approved change orders and disclose pending and denied separately", () => {
  renderTable({
    changeOrders: [
      finalized,
      {
        ...finalized,
        id: "20000000-0000-4000-8000-000000000002",
        number: "CO-002",
        description: "Pending proposal",
        contract_amount: 500,
        cost_amount: 300,
        status: "Pending",
      },
      {
        ...finalized,
        id: "20000000-0000-4000-8000-000000000003",
        number: "CO-003",
        description: "Denied proposal",
        contract_amount: 200,
        cost_amount: 100,
        status: "Denied",
      },
    ],
  });

  const summary = Array.from(document.body.querySelectorAll("span")).find((element) =>
    element.textContent?.includes("approved net contract adjustment"),
  );
  expect(summary?.textContent).toContain("$1,000");
  expect(summary?.textContent).toContain("$500 pending");
  expect(summary?.textContent).toContain("$200 denied");
  expect(summary?.textContent).not.toContain("$1,700");
});

test("the change-order entry grid stacks on narrow screens", async () => {
  renderTable({});
  act(() => findButton("Add change order")?.click());
  await settle();

  const dialog = document.body.querySelector('[role="dialog"]');
  const responsiveGrid = Array.from(dialog?.querySelectorAll("div") ?? []).find(
    (element) =>
      element.classList.contains("grid-cols-1") && element.classList.contains("sm:grid-cols-3"),
  );
  expect(responsiveGrid).toBeTruthy();
});
