import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";

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
  name: "Financial Integrity Test",
  client: "Test Owner",
} as ProjectRow;

const INVOICE = {
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
  status: "sent",
  client_visible: false,
  payment_enabled: false,
  payment_url: "",
  stripe_checkout_session_id: "",
  stripe_payment_intent_id: "",
  online_payment_status: "not_enabled",
  payment_link_sent_at: null,
  sent_at: "2026-07-01T00:00:00.000Z",
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

function button(label: string) {
  return Array.from(document.body.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.trim() === label,
  );
}

function renderEditor(onRecordPayment: (input: PaymentDraft) => Promise<void>) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <BillingInvoiceRowEditor
        project={PROJECT}
        invoice={INVOICE}
        invoiceRecipients={[]}
        onPatch={async () => true}
        onDelete={() => {}}
        onRecordPayment={onRecordPayment}
        onReconcile={() => {}}
      />,
    );
  });
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  document.body.querySelectorAll("[data-radix-portal]").forEach((portal) => portal.remove());
  root = null;
  container = null;
});

test("a failed manual payment keeps the draft and reuses its operation key on retry", async () => {
  const attempts: PaymentDraft[] = [];
  const record = vi
    .fn<(input: PaymentDraft) => Promise<void>>()
    .mockImplementationOnce(async (input) => {
      attempts.push(input);
      throw new Error("database timeout");
    })
    .mockImplementationOnce(async (input) => {
      attempts.push(input);
    });

  renderEditor(record);
  act(() => button("Record payment")?.click());

  await act(async () => {
    button("Save payment")?.click();
    await Promise.resolve();
  });

  expect(document.body.textContent).toContain("database timeout");
  expect(document.body.textContent).toContain("Your entries are still here");
  expect(button("Save payment")).toBeDefined();
  expect(attempts).toHaveLength(1);

  await act(async () => {
    button("Save payment")?.click();
    await Promise.resolve();
  });

  expect(attempts).toHaveLength(2);
  expect(attempts[1].idempotency_key).toBe(attempts[0].idempotency_key);
  expect(button("Save payment")).toBeUndefined();
});

test("opening a new payment operation creates a fresh idempotency key", async () => {
  const attempts: PaymentDraft[] = [];
  const record = vi.fn(async (input: PaymentDraft) => {
    attempts.push(input);
  });

  renderEditor(record);

  act(() => button("Record payment")?.click());
  await act(async () => {
    button("Save payment")?.click();
    await Promise.resolve();
  });
  act(() => button("Record payment")?.click());
  await act(async () => {
    button("Save payment")?.click();
    await Promise.resolve();
  });

  expect(attempts).toHaveLength(2);
  expect(attempts[1].idempotency_key).not.toBe(attempts[0].idempotency_key);
});

test("an invoice overpayment is explained and cannot be submitted", async () => {
  const record = vi.fn<(input: PaymentDraft) => Promise<void>>();
  renderEditor(record);
  act(() => button("Record payment")?.click());

  const amount = document.getElementById(`payment-amount-${INVOICE.id}`) as HTMLInputElement;
  expect(amount).toBeDefined();
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
      amount,
      "1,001.00",
    );
    amount.dispatchEvent(new Event("input", { bubbles: true }));
  });

  expect(document.body.textContent).toContain("overpayments require a separate unapplied-credit");
  expect(button("Save payment")?.hasAttribute("disabled")).toBe(true);

  await act(async () => {
    button("Save payment")?.click();
    await Promise.resolve();
  });
  expect(record).not.toHaveBeenCalled();
});
