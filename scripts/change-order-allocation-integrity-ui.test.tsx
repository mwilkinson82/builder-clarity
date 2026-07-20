import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";

import { ChangeOrderAllocationPanel } from "@/components/billing/ChangeOrderAllocationPanel";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

type PanelProps = ComponentProps<typeof ChangeOrderAllocationPanel>;
type Allocate = PanelProps["onAllocate"];
type AllocationAttempt = Parameters<Allocate>[0];

let root: Root | null = null;
let container: HTMLElement | null = null;

function button(label: string) {
  return Array.from(document.body.querySelectorAll("button")).find((candidate) =>
    candidate.textContent?.includes(label),
  );
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function renderPanel(onAllocate: Allocate) {
  const changeOrder = {
    id: "co-1",
    number: "CO-7",
    description: "Owner-added entry canopy",
    status: "Approved",
    financial_direction: "addition",
    contract_amount: 12_500,
    cost_amount: 7_500,
  } as PanelProps["changeOrders"][number];
  const bucket = {
    id: "bucket-1",
    cost_code: "06-1000",
    bucket: "Rough carpentry",
  } as PanelProps["buckets"][number];

  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() =>
    root!.render(
      <ChangeOrderAllocationPanel
        changeOrders={[changeOrder]}
        buckets={[bucket]}
        allocations={[]}
        onAllocate={onAllocate}
        onRemoveAllocation={() => undefined}
      />,
    ),
  );
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  document.body.querySelectorAll("[data-radix-portal]").forEach((portal) => portal.remove());
  root = null;
  container = null;
});

test("a failed allocation keeps its values and operation key, then clears only after retry succeeds", async () => {
  const attempts: AllocationAttempt[] = [];
  let rejectFirst!: (error: Error) => void;
  const onAllocate = vi.fn<Allocate>((input) => {
    attempts.push(input);
    if (attempts.length === 1) {
      return new Promise<void>((_resolve, reject) => {
        rejectFirst = reject;
      });
    }
    return Promise.resolve();
  });

  renderPanel(onAllocate);
  act(() => button("Choose a cost code")?.click());
  await settle();
  act(() => document.body.querySelector<HTMLElement>('[role="option"]')?.click());
  await settle();

  act(() => button("Allocate")?.click());
  expect(button("Allocating…")?.hasAttribute("disabled")).toBe(true);
  rejectFirst(new Error("allocation transaction timed out"));
  await settle();

  expect(document.body.textContent).toContain("allocation transaction timed out");
  expect(document.body.textContent).toContain("Your entries are still here");
  expect(button("06-1000")).toBeDefined();

  act(() => button("Allocate")?.click());
  await settle();

  expect(attempts).toHaveLength(2);
  expect(attempts[0].idempotencyKey).toMatch(/^co-allocation:co-1:/);
  expect(attempts[1].idempotencyKey).toBe(attempts[0].idempotencyKey);
  expect(button("Choose a cost code")).toBeDefined();
  expect(document.body.textContent).not.toContain("allocation transaction timed out");
});
