import { readFileSync } from "node:fs";
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";

import { SubcontractFinancialReadState } from "@/components/project/SubcontractFinancialReadState";
import { readProjectSubcontracts } from "@/lib/subcontracts.functions";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const RELATIONS = [
  "subcontracts",
  "subcontract_allocations",
  "subcontract_payments",
  "subcontract_documents",
  "subcontract_change_orders",
  "subcontract_payment_allocations",
] as const;

type QueryResult = {
  data: unknown;
  error: { code?: string; message: string } | null;
};

function fakeSupabase(overrides: Partial<Record<(typeof RELATIONS)[number], QueryResult>> = {}) {
  return {
    from(relation: (typeof RELATIONS)[number]) {
      const query = {
        select: () => query,
        eq: () => query,
        order: () => query,
        then<TResult1 = QueryResult, TResult2 = never>(
          onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
          onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
        ) {
          const result = overrides[relation] ?? { data: [], error: null };
          return Promise.resolve(result).then(onfulfilled, onrejected);
        },
      };
      return query;
    },
  };
}

describe("subcontract financial server reads", () => {
  test("preserves a legitimate empty project as six empty collections", async () => {
    await expect(readProjectSubcontracts(fakeSupabase(), PROJECT_ID)).resolves.toEqual({
      subcontracts: [],
      allocations: [],
      payments: [],
      documents: [],
      change_orders: [],
      payment_allocations: [],
    });
  });

  test("fails closed when one financial relation is missing", async () => {
    const client = fakeSupabase({
      subcontract_payments: {
        data: null,
        error: {
          code: "PGRST205",
          message: "Could not find the table public.subcontract_payments in the schema cache",
        },
      },
    });

    await expect(readProjectSubcontracts(client, PROJECT_ID)).rejects.toThrow(
      /Financial totals and actions are blocked until setup is complete/,
    );
  });

  test("surfaces database errors instead of replacing the ledger with empty arrays", async () => {
    const client = fakeSupabase({
      subcontract_payments: {
        data: null,
        error: {
          code: "42501",
          message: "permission denied for table subcontract_payments",
        },
      },
    });

    await expect(readProjectSubcontracts(client, PROJECT_ID)).rejects.toThrow(
      /Subcontract financials could not be loaded.*permission denied/s,
    );
  });

  test("rejects null success payloads and malformed monetary values", async () => {
    await expect(
      readProjectSubcontracts(
        fakeSupabase({ subcontract_allocations: { data: null, error: null } }),
        PROJECT_ID,
      ),
    ).rejects.toThrow(/Invalid relation: subcontract_allocations/);

    await expect(
      readProjectSubcontracts(
        fakeSupabase({
          subcontracts: {
            data: [
              {
                id: "subcontract-1",
                project_id: PROJECT_ID,
                subcontractor_id: "subcontractor-1",
                contract_value: "not-a-number",
                retainage_pct: 10,
                status: "executed",
              },
            ],
            error: null,
          },
        }),
        PROJECT_ID,
      ),
    ).rejects.toThrow(/Invalid field: subcontracts.contract_value/);
  });

  test("requires an explicit payment lifecycle instead of defaulting missing status to paid", async () => {
    const client = fakeSupabase({
      subcontract_payments: {
        data: [
          {
            id: "payment-1",
            project_id: PROJECT_ID,
            subcontract_id: "subcontract-1",
            amount: 500,
            retainage_held: 50,
            payment_date: "2026-07-20",
          },
        ],
        error: null,
      },
    });

    await expect(readProjectSubcontracts(client, PROJECT_ID)).rejects.toThrow(
      /Invalid field: subcontract_payments.status/,
    );
  });
});

let root: Root | null = null;
let container: HTMLElement | null = null;

function renderState(props: ComponentProps<typeof SubcontractFinancialReadState>) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<SubcontractFinancialReadState {...props} />));
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("subcontract financial read UI", () => {
  test("shows an actionable blocking error and retries without rendering a false zero", () => {
    const retry = vi.fn();
    renderState({ error: new Error("Database connection interrupted."), onRetry: retry });

    expect(document.body.querySelector('[role="alert"]')).not.toBeNull();
    expect(document.body.textContent).toContain("Subcontract financials unavailable");
    expect(document.body.textContent).toContain("Database connection interrupted.");
    expect(document.body.textContent).toContain("blocked instead of showing a false zero");
    expect(document.body.textContent).not.toContain("$0");

    act(() => {
      Array.from(document.body.querySelectorAll("button"))
        .find((button) => button.textContent === "Retry")
        ?.click();
    });
    expect(retry).toHaveBeenCalledTimes(1);
  });

  test("announces loading and disables a retry already in progress", () => {
    renderState({ loading: true });
    expect(document.body.querySelector('[role="status"]')?.textContent).toContain(
      "Loading subcontract financials",
    );

    act(() =>
      root?.render(
        <SubcontractFinancialReadState error={new Error("offline")} retrying onRetry={() => {}} />,
      ),
    );
    const retrying = Array.from(document.body.querySelectorAll("button")).find(
      (button) => button.textContent === "Retrying…",
    );
    expect(retrying?.hasAttribute("disabled")).toBe(true);
  });
});

describe("direct subcontract financial consumers", () => {
  test.each([
    ["src/routes/_authenticated/projects.$projectId.tsx", "subcontractsQuery"],
    ["src/components/project/SubcontractorsWorkspace.tsx", "projectQuery"],
    ["src/components/billing/BillingEnhancements.tsx", "projectSubcontractsQuery"],
    ["src/components/outcome/DailyWipWorkspace.tsx", "projectSubsQuery"],
    ["src/components/outcome/DailyLogWorkLines.tsx", "projectSubsQuery"],
  ])("%s blocks on %s errors and provides retry", (path, queryName) => {
    const source = readFileSync(path, "utf8");
    expect(source).toContain("SubcontractFinancialReadState");
    expect(source).toContain(`${queryName}.isError`);
    expect(source).toContain(`${queryName}.refetch()`);
  });
});
