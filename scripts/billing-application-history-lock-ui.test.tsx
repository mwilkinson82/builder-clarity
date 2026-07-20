import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";

import { BillingApplicationRowEditor } from "@/components/project/billing/BillingApplicationRowEditor";
import type { BillingApplicationRow } from "@/lib/projects.functions";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const APPLICATION = {
  id: "10000000-0000-4000-8000-000000000001",
  project_id: "10000000-0000-4000-8000-000000000002",
  application_number: "APP-004",
  invoice_number: "INV-004",
  submitted_date: "2026-07-01",
  due_date: "2026-07-31",
  billing_period: "July 2026",
  contract_amount: 100_000,
  change_order_amount: 5_000,
  amount_billed: 25_000,
  paid_to_date: 10_000,
  retainage: 2_500,
  has_line_detail: false,
  total_retainage_held: 2_500,
  retainage_released_this_period: 0,
  status: "draft",
  output_format: "invoice",
  notes: "",
  sort_order: 4,
  status_events: [],
} satisfies BillingApplicationRow;

let root: Root | null = null;
let container: HTMLElement | null = null;

function renderEditor(
  status: BillingApplicationRow["status"],
  onPatch = vi.fn<
    (patch: Partial<BillingApplicationRow>) => void | boolean | Promise<void | boolean>
  >(),
) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <BillingApplicationRowEditor
        app={{ ...APPLICATION, status }}
        onPatch={onPatch}
        onCreateInvoice={() => undefined}
        onDelete={() => undefined}
      />,
    );
  });
  return onPatch;
}

async function openStatusMenu() {
  const trigger = document.body.querySelector<HTMLButtonElement>(
    'button[aria-label="Billing application status"]',
  );
  expect(trigger).not.toBeNull();
  act(() => trigger!.click());
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return Array.from(document.body.querySelectorAll<HTMLElement>('[role="option"]'));
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  document.body.querySelectorAll("[data-radix-portal]").forEach((portal) => portal.remove());
  root = null;
  container = null;
});

test("submitted applications lock financial history, hide delete, and only allow rejection", async () => {
  const onPatch = renderEditor("submitted");

  expect(document.body.textContent).toContain("Submitted billing history is locked");
  expect(document.body.querySelector('button[aria-label="Delete billing application"]')).toBeNull();

  const financialInputs = Array.from(document.body.querySelectorAll<HTMLInputElement>("input"));
  expect(financialInputs.length).toBeGreaterThanOrEqual(9);
  expect(financialInputs.every((input) => input.readOnly)).toBe(true);

  const contractAmount = document.body.querySelector<HTMLInputElement>(
    'input[aria-label="Contract amount"]',
  );
  act(() => {
    contractAmount!.value = "999,999";
    contractAmount!.dispatchEvent(new Event("input", { bubbles: true }));
    contractAmount!.dispatchEvent(new Event("blur", { bubbles: true }));
  });
  expect(onPatch).not.toHaveBeenCalled();

  const options = await openStatusMenu();
  expect(options.map((option) => option.textContent?.trim())).toEqual(["Submitted", "Rejected"]);
});

test.each([
  ["draft", ["Draft", "Submitted"], true],
  ["rejected", ["Rejected", "Draft"], false],
] as const)(
  "%s applications stay editable and expose only their valid lifecycle action",
  async (status, expectedOptions, canDelete) => {
    renderEditor(status);
    expect(document.body.textContent).not.toContain("billing history is locked");
    const deleteButton = document.body.querySelector(
      'button[aria-label="Delete billing application"]',
    );
    if (canDelete) expect(deleteButton).not.toBeNull();
    else expect(deleteButton).toBeNull();
    expect(
      document.body.querySelector<HTMLInputElement>('input[aria-label="Contract amount"]')
        ?.readOnly,
    ).toBe(false);

    const options = await openStatusMenu();
    expect(options.map((option) => option.textContent?.trim())).toEqual([...expectedOptions]);
    expect(document.body.textContent).not.toContain("Partial · from payments");
    expect(document.body.textContent).not.toContain("Paid · from payments");
  },
);

test.each([
  ["Contract amount", "contract_amount", "123456.78", 123_456.78],
  ["Approved change order amount", "change_order_amount", "-5000.25", -5_000.25],
  ["Application amount", "amount_billed", "32100.45", 32_100.45],
  ["Retainage held", "retainage", "3210.05", 3_210.05],
] as const)(
  "%s drafts locally and emits one atomic patch on blur",
  async (label, field, enteredValue, expectedValue) => {
    const onPatch = renderEditor("draft");
    const input = document.body.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
    expect(input).not.toBeNull();
    const valueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )?.set;

    act(() => {
      input!.focus();
      valueSetter?.call(input, enteredValue);
      input!.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(onPatch).not.toHaveBeenCalled();

    await act(async () => {
      input!.blur();
      await Promise.resolve();
    });
    expect(onPatch).toHaveBeenCalledTimes(1);
    expect(onPatch).toHaveBeenLastCalledWith({ [field]: expectedValue });

    // A repeated blur is the same user intent, not a second write command.
    act(() => {
      input!.focus();
      input!.blur();
    });
    expect(onPatch).toHaveBeenCalledTimes(1);
  },
);

test("a failed financial commit keeps the draft retryable and suppresses duplicate pending blur", async () => {
  const resolvers: Array<(result: boolean) => void> = [];
  const onPatch = vi.fn(() => new Promise<boolean>((resolve) => resolvers.push(resolve)));
  renderEditor("draft", onPatch);
  const input = document.body.querySelector<HTMLInputElement>(
    'input[aria-label="Application amount"]',
  );
  const status = document.body.querySelector<HTMLButtonElement>(
    'button[aria-label="Billing application status"]',
  );
  const valueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )?.set;

  act(() => {
    input!.focus();
    valueSetter?.call(input, "30000");
    input!.dispatchEvent(new Event("input", { bubbles: true }));
    input!.blur();
  });

  expect(onPatch).toHaveBeenCalledTimes(1);
  expect(onPatch).toHaveBeenLastCalledWith({ amount_billed: 30_000 });
  expect(input!.readOnly).toBe(true);
  expect(status!.disabled).toBe(true);

  // A second blur before the first response cannot issue a competing command.
  act(() => {
    input!.focus();
    input!.blur();
  });
  expect(onPatch).toHaveBeenCalledTimes(1);

  await act(async () => {
    resolvers[0](false);
    await Promise.resolve();
  });
  expect(input!.readOnly).toBe(false);
  expect(status!.disabled).toBe(false);

  // The committed ref did not advance on failure, so the exact same staged
  // value can be retried without another edit gesture.
  act(() => {
    input!.focus();
    input!.blur();
  });
  expect(onPatch).toHaveBeenCalledTimes(2);
  await act(async () => {
    resolvers[1](true);
    await Promise.resolve();
  });

  act(() => {
    input!.focus();
    input!.blur();
  });
  expect(onPatch).toHaveBeenCalledTimes(2);
});

test.each(["partial", "paid"] as const)(
  "%s applications are permanently locked and cannot be manually transitioned",
  (status) => {
    renderEditor(status);

    expect(document.body.textContent).toContain("Certified billing and payment history is locked.");
    expect(
      document.body.querySelector('button[aria-label="Delete billing application"]'),
    ).toBeNull();
    expect(
      document.body.querySelector<HTMLButtonElement>(
        'button[aria-label="Billing application status"]',
      )?.disabled,
    ).toBe(true);
    expect(
      Array.from(document.body.querySelectorAll<HTMLInputElement>("input")).every(
        (input) => input.readOnly,
      ),
    ).toBe(true);
  },
);
