import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";

import { SubcontractCard } from "@/components/project/SubcontractCard";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

type CardProps = ComponentProps<typeof SubcontractCard>;
type OnPay = CardProps["onPay"];
type PayAttempt = Parameters<OnPay>;
type OnUpdatePayment = CardProps["onUpdatePayment"];
type UpdateAttempt = Parameters<OnUpdatePayment>;

let root: Root | null = null;
let container: HTMLElement | null = null;

function button(label: string) {
  return Array.from(document.body.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.trim() === label,
  );
}

function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
  act(() => {
    if (setter) setter.call(input, value);
    else input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function makePayment(overrides: Partial<CardProps["payments"][number]> = {}) {
  return {
    id: "payment-1",
    amount: 500,
    retainage_held: 50,
    payment_date: "2026-07-19",
    notes: "Pay app #1",
    status: "draft",
    exposure_id: null,
    ...overrides,
  } satisfies CardProps["payments"][number];
}

function renderCard(onPay: OnPay, overrides: Partial<CardProps> = {}) {
  const noop = () => {};
  const asyncNoop = async () => {};
  const props: CardProps = {
    subLabel: "Concrete Trade Partner",
    summary: {
      subcontract_id: "subcontract-1",
      committed: 50_000,
      paid: 0,
      retainageHeld: 0,
      netPaid: 0,
      remaining: 50_000,
      paidPct: 0,
      draftTotal: 0,
      approvedTotal: 0,
    },
    allocations: [],
    payments: [],
    buckets: [],
    allocatedTotal: 0,
    defaultRetainagePct: 10,
    onEditBuyout: noop,
    onAllocate: noop,
    onUpdateAllocation: noop,
    onUpdateProductionBenchmark: noop,
    onRemoveAllocation: noop,
    changeOrders: [],
    exposures: [],
    onRecordChangeOrder: noop,
    onSetChangeOrderExposure: noop,
    onRemoveChangeOrder: noop,
    onPay,
    onSetPaymentExposure: noop,
    onUpdatePayment: asyncNoop,
    onSetPaymentStage: noop,
    onMarkPaid: noop,
    onRemovePayment: noop,
    paymentSplits: [],
    onSaveSplit: noop,
    waivers: [],
    gatingEnabled: false,
    onAttachWaiver: noop,
    onDetachWaiver: noop,
    onUploadWaiverForPayment: noop,
    onViewWaiverDoc: noop,
    onRemoveSub: noop,
    documents: [],
    onUploadDoc: noop,
    onViewDoc: noop,
    onSetActiveDoc: noop,
    onRemoveDoc: noop,
    ...overrides,
  };

  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<SubcontractCard {...props} />));
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  document.body.querySelectorAll("[data-radix-portal]").forEach((portal) => portal.remove());
  root = null;
  container = null;
});

test("a failed pay app keeps its draft and operation key, then closes only after retry succeeds", async () => {
  const attempts: PayAttempt[] = [];
  let rejectFirst!: (error: Error) => void;
  const onPay = vi.fn<OnPay>((...args) => {
    attempts.push(args);
    if (attempts.length === 1) {
      return new Promise<void>((_resolve, reject) => {
        rejectFirst = reject;
      });
    }
    return Promise.resolve();
  });

  renderCard(onPay);
  act(() => button("Record pay app")?.click());

  const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]');
  const amount = dialog?.querySelector<HTMLInputElement>('input[inputmode="decimal"]') ?? null;
  const notes =
    dialog?.querySelector<HTMLInputElement>('input[placeholder^="Description"]') ?? null;
  expect(amount).not.toBeNull();
  expect(notes).not.toBeNull();
  typeInto(amount!, "1250");
  typeInto(notes!, "Pay app #3 foundations");

  act(() => button("Save draft")?.click());
  expect(button("Saving…")).toBeDefined();
  expect(button("Saving…")?.hasAttribute("disabled")).toBe(true);
  expect(amount?.disabled).toBe(true);
  expect(button("Cancel")?.hasAttribute("disabled")).toBe(true);

  rejectFirst(new Error("database timeout"));
  await settle();

  expect(document.body.textContent).toContain("database timeout");
  expect(document.body.textContent).toContain("Your entries are still here");
  expect(button("Save draft")).toBeDefined();
  expect(amount?.value).toBe("1,250");
  expect(notes?.value).toBe("Pay app #3 foundations");
  expect(attempts).toHaveLength(1);

  act(() => button("Save draft")?.click());
  await settle();

  expect(attempts).toHaveLength(2);
  expect(attempts[1][6]).toBe(attempts[0][6]);
  expect(attempts[0][6]).toMatch(/^subcontract-payment:/);
  expect(button("Save draft")).toBeUndefined();
  expect(document.body.textContent).not.toContain("Record pay application");
});

test("opening a new pay app creates a fresh operation key", async () => {
  const attempts: PayAttempt[] = [];
  const onPay = vi.fn<OnPay>(async (...args) => {
    attempts.push(args);
  });

  renderCard(onPay);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    act(() => button("Record pay app")?.click());
    const amount = document.body
      .querySelector<HTMLElement>('[role="dialog"]')
      ?.querySelector<HTMLInputElement>('input[inputmode="decimal"]');
    typeInto(amount!, "100");
    act(() => button("Save draft")?.click());
    await settle();
  }

  expect(attempts).toHaveLength(2);
  expect(attempts[1][6]).not.toBe(attempts[0][6]);
});

test("editing a failed payment draft starts a new operation instead of reusing a key with new details", async () => {
  const attempts: PayAttempt[] = [];
  const onPay = vi.fn<OnPay>(async (...args) => {
    attempts.push(args);
    if (attempts.length === 1) throw new Error("amount needs review");
  });

  renderCard(onPay);
  act(() => button("Record pay app")?.click());
  const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]');
  const amount = dialog?.querySelector<HTMLInputElement>('input[inputmode="decimal"]');
  typeInto(amount!, "100");
  act(() => button("Save draft")?.click());
  await settle();

  expect(document.body.textContent).toContain("amount needs review");
  typeInto(amount!, "125");
  expect(document.body.textContent).not.toContain("amount needs review");
  act(() => button("Save draft")?.click());
  await settle();

  expect(attempts).toHaveLength(2);
  expect(attempts[1][0]).toBe(125);
  expect(attempts[1][6]).not.toBe(attempts[0][6]);
});

test("a failed draft edit stays open with its values and disables the form while saving", async () => {
  const attempts: UpdateAttempt[] = [];
  let rejectFirst!: (error: Error) => void;
  const onUpdatePayment = vi.fn<OnUpdatePayment>((...args) => {
    attempts.push(args);
    if (attempts.length === 1) {
      return new Promise<void>((_resolve, reject) => {
        rejectFirst = reject;
      });
    }
    return Promise.resolve();
  });

  renderCard(async () => {}, {
    payments: [makePayment()],
    onUpdatePayment,
  });

  act(() => document.body.querySelector<HTMLButtonElement>('[aria-label="Edit payment"]')?.click());
  const paymentRow = document.body.querySelector("li");
  const amount = paymentRow?.querySelector<HTMLInputElement>('input[inputmode="decimal"]');
  const paymentDate = paymentRow?.querySelector<HTMLInputElement>('input[type="date"]');
  const notes = paymentRow?.querySelector<HTMLInputElement>('input[placeholder^="Description"]');

  expect(amount).not.toBeNull();
  expect(paymentDate).not.toBeNull();
  expect(notes).not.toBeNull();
  typeInto(amount!, "725.25");
  typeInto(notes!, "Corrected draft amount");

  act(() => button("Save")?.click());
  expect(button("Saving…")).toBeDefined();
  expect(button("Saving…")?.hasAttribute("disabled")).toBe(true);
  expect(amount?.disabled).toBe(true);
  expect(paymentDate?.disabled).toBe(true);
  expect(notes?.disabled).toBe(true);
  expect(document.body.querySelector<HTMLButtonElement>('[aria-label="Cancel"]')?.disabled).toBe(
    true,
  );

  rejectFirst(new Error("could not lock draft"));
  await settle();

  expect(document.body.textContent).toContain("could not lock draft");
  expect(document.body.textContent).toContain("Your changes are still here");
  expect(amount?.value).toBe("725.25");
  expect(notes?.value).toBe("Corrected draft amount");
  expect(button("Save")).toBeDefined();

  act(() => button("Save")?.click());
  await settle();

  expect(attempts).toHaveLength(2);
  expect(attempts[0]).toEqual([
    "payment-1",
    {
      amount: 725.25,
      retainageHeld: 50,
      paymentDate: "2026-07-19",
      notes: "Corrected draft amount",
    },
  ]);
  expect(attempts[1]).toEqual(attempts[0]);
  expect(button("Save")).toBeUndefined();
  expect(document.body.textContent).not.toContain("Your changes are still here");
});

test("only draft payments expose edit and remove actions", () => {
  renderCard(async () => {}, {
    payments: [
      makePayment({ id: "draft-payment", status: "draft", notes: "Editable draft" }),
      makePayment({ id: "approved-payment", status: "approved", notes: "Approved record" }),
      makePayment({ id: "paid-payment", status: "paid", notes: "Paid record" }),
    ],
  });

  const editButtons = document.body.querySelectorAll<HTMLButtonElement>(
    '[aria-label="Edit payment"]',
  );
  const removeButtons = document.body.querySelectorAll<HTMLButtonElement>(
    '[aria-label="Remove payment"]',
  );

  expect(editButtons).toHaveLength(1);
  expect(removeButtons).toHaveLength(1);
  expect(editButtons[0].closest("li")?.textContent).toContain("Editable draft");
  expect(removeButtons[0].closest("li")?.textContent).toContain("Editable draft");
  expect(document.body.textContent).toContain("Approved record");
  expect(document.body.textContent).toContain("Paid record");
});
