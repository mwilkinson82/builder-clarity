import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";

import { BillingInvoiceRowEditor } from "@/components/project/billing/BillingInvoiceRowEditor";
import type { PaymentDraft } from "@/lib/billing-local-store";
import type { BillingInvoiceRow, ProjectRow } from "@/lib/projects.functions";

vi.mock("@tanstack/react-start", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-start")>();
  return { ...actual, useServerFn: () => vi.fn() };
});

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const PROJECT = {
  id: "10000000-0000-4000-8000-000000000001",
  organization_id: "10000000-0000-4000-8000-000000000002",
  organization_name: "Test Builder",
  organization_logo_url: "",
  job_number: "2601",
  name: "Invoice Command Test",
  client: "Test Owner",
} as ProjectRow;

const DRAFT_INVOICE = {
  id: "20000000-0000-4000-8000-000000000001",
  project_id: PROJECT.id,
  billing_application_id: null,
  invoice_number: "INV-001",
  title: "July progress billing",
  issue_date: "2026-07-01",
  due_date: "2026-07-31",
  subtotal: 1_000,
  retainage: 0,
  total_due: 1_000,
  paid_amount: 0,
  status: "draft",
  client_visible: false,
  payment_enabled: false,
  payment_url: "",
  stripe_checkout_session_id: "",
  stripe_payment_intent_id: "",
  online_payment_status: "not_enabled",
  payment_link_sent_at: null,
  sent_at: null,
  sent_recipients: [],
  first_viewed_at: null,
  last_viewed_at: null,
  view_count: 0,
  collections_log: "",
  paid_at: null,
  notes: "",
  enabled_payment_methods: {},
  payment_events: [],
  created_at: "2026-07-01T00:00:00.000Z",
  updated_at: "2026-07-01T00:00:00.000Z",
} satisfies BillingInvoiceRow;

let root: Root | null = null;
let container: HTMLElement | null = null;

function renderEditor(input: {
  invoice?: BillingInvoiceRow;
  onPatch: (
    patch: Partial<BillingInvoiceRow>,
    options?: { idempotencyKey?: string; reason?: string },
  ) => Promise<boolean>;
}) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <BillingInvoiceRowEditor
        project={PROJECT}
        invoice={input.invoice ?? DRAFT_INVOICE}
        invoiceRecipients={[]}
        onPatch={input.onPatch}
        onDelete={() => {}}
        onRecordPayment={async (_payment: PaymentDraft) => {}}
        onReconcile={() => {}}
      />,
    );
  });
}

function setMoney(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  document.body.querySelectorAll("[data-radix-portal]").forEach((portal) => portal.remove());
  root = null;
  container = null;
});

describe("invoice amount command UI", () => {
  test("stages typing locally and commits exactly once on blur", async () => {
    const onPatch = vi.fn(async () => true);
    renderEditor({ onPatch });
    const amount = document.getElementById(
      `invoice-total-due-${DRAFT_INVOICE.id}`,
    ) as HTMLInputElement;

    act(() => {
      amount.focus();
      setMoney(amount, "1,250.00");
    });
    expect(onPatch).not.toHaveBeenCalled();
    await act(async () => {
      amount.blur();
      await Promise.resolve();
    });

    expect(onPatch).toHaveBeenCalledTimes(1);
    expect(onPatch.mock.calls[0][0]).toEqual({ total_due: 1_250 });
    expect(onPatch.mock.calls[0][1]?.idempotencyKey).toMatch(/^invoice:/);
  });

  test("retains a failed draft and reuses the same key on retry", async () => {
    const onPatch = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    renderEditor({ onPatch });
    const amount = document.getElementById(
      `invoice-total-due-${DRAFT_INVOICE.id}`,
    ) as HTMLInputElement;

    act(() => {
      amount.focus();
      setMoney(amount, "1,275.00");
    });
    await act(async () => {
      amount.blur();
      await Promise.resolve();
    });
    expect(amount.value).toBe("1,275");

    await act(async () => {
      amount.focus();
      amount.blur();
      await Promise.resolve();
    });
    expect(onPatch).toHaveBeenCalledTimes(2);
    expect(onPatch.mock.calls[1][1]?.idempotencyKey).toBe(onPatch.mock.calls[0][1]?.idempotencyKey);
  });

  test("suppresses duplicate blur commits while the first command is pending", async () => {
    let finish: ((value: boolean) => void) | undefined;
    const onPatch = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    );
    renderEditor({ onPatch });
    const amount = document.getElementById(
      `invoice-total-due-${DRAFT_INVOICE.id}`,
    ) as HTMLInputElement;

    act(() => {
      amount.focus();
      setMoney(amount, "1,300.00");
      amount.blur();
    });
    expect(onPatch).toHaveBeenCalledTimes(1);
    expect(amount.disabled).toBe(true);

    act(() => {
      amount.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    expect(onPatch).toHaveBeenCalledTimes(1);

    await act(async () => {
      finish?.(true);
      await Promise.resolve();
    });
  });
});

test("issued invoice money is locked and finalized history cannot be deleted", () => {
  renderEditor({
    invoice: {
      ...DRAFT_INVOICE,
      status: "sent",
      client_visible: true,
      sent_at: "2026-07-01T10:00:00.000Z",
    },
    onPatch: async () => true,
  });
  const amount = document.getElementById(
    `invoice-total-due-${DRAFT_INVOICE.id}`,
  ) as HTMLInputElement;
  expect(amount.disabled).toBe(true);
  expect(document.body.textContent).toContain("Void invoice");
  expect(document.querySelector('[title="Delete unsent draft"]')).toBeNull();
});

test("pending Stripe checkout disables manual payment recording", () => {
  renderEditor({
    invoice: {
      ...DRAFT_INVOICE,
      status: "sent",
      client_visible: true,
      sent_at: "2026-07-01T10:00:00.000Z",
      online_payment_status: "pending",
      stripe_checkout_session_id: "cs_pending",
      payment_link_sent_at: new Date().toISOString(),
    },
    onPatch: async () => true,
  });
  const recordPayment = Array.from(document.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.trim() === "Record payment",
  ) as HTMLButtonElement;
  expect(recordPayment.disabled).toBe(true);
  expect(recordPayment.title).toContain("Stripe checkout is pending");
});
