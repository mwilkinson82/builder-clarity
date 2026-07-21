import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";

import { ExposureAllocationPanel } from "@/components/project/ExposureAllocationPanel";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

type PanelProps = ComponentProps<typeof ExposureAllocationPanel>;
type Allocate = PanelProps["onAllocate"];
type AllocationAttempt = Parameters<Allocate>[0];
type Update = PanelProps["onUpdateAllocation"];
type UpdateAttempt = Parameters<Update>[0];
type Remove = PanelProps["onRemoveAllocation"];
type RemoveAttempt = Parameters<Remove>[0];

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

function renderPanel({
  onAllocate,
  onUpdateAllocation = () => Promise.resolve(),
  onRemoveAllocation = () => Promise.resolve(),
  allocations = [],
}: {
  onAllocate: Allocate;
  onUpdateAllocation?: Update;
  onRemoveAllocation?: Remove;
  allocations?: PanelProps["allocations"];
}) {
  const exposure = {
    id: "33333333-3333-4333-8333-333333333333",
    project_id: "11111111-1111-4111-8111-111111111111",
    title: "Window delivery risk",
    description: "Acceleration may be required",
    status: "active",
    hold_class: "E-Hold",
    dollar_exposure: 10_000,
  } as PanelProps["exposures"][number];
  const bucket = {
    id: "55555555-5555-4555-8555-555555555555",
    project_id: "11111111-1111-4111-8111-111111111111",
    cost_code: "08-500",
    bucket: "Windows",
  } as PanelProps["buckets"][number];

  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() =>
    root!.render(
      <ExposureAllocationPanel
        exposures={[exposure]}
        buckets={[bucket]}
        allocations={allocations}
        onAllocate={onAllocate}
        onUpdateAllocation={onUpdateAllocation}
        onRemoveAllocation={onRemoveAllocation}
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

test("a failed exposure allocation retains its draft and operation key until retry succeeds", async () => {
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

  renderPanel({ onAllocate });
  act(() => button("Choose a cost code")?.click());
  await settle();
  act(() => document.body.querySelector<HTMLElement>('[role="option"]')?.click());
  await settle();

  const amountInput = document.body.querySelector<HTMLInputElement>('input[inputmode="decimal"]');
  expect(amountInput?.value).toContain("10,000");

  act(() => button("Allocate")?.click());
  expect(button("Allocate")?.hasAttribute("disabled")).toBe(true);
  rejectFirst(new Error("allocation transaction timed out"));
  await settle();

  expect(document.body.textContent).toContain("allocation transaction timed out");
  expect(button("08-500")).toBeDefined();
  expect(amountInput?.value).toContain("10,000");

  act(() => button("Allocate")?.click());
  await settle();

  expect(attempts).toHaveLength(2);
  expect(attempts[0].operationKey).toMatch(
    /^exposure-allocation:33333333-3333-4333-8333-333333333333:create:/,
  );
  expect(attempts[1].operationKey).toBe(attempts[0].operationKey);
  expect(button("Choose a cost code")).toBeDefined();
  expect(document.body.textContent).not.toContain("allocation transaction timed out");
});

test("failed update and delete commands retain their versions and operation keys for retry", async () => {
  const allocation = {
    id: "99999999-9999-4999-8999-999999999999",
    project_id: "11111111-1111-4111-8111-111111111111",
    exposure_id: "33333333-3333-4333-8333-333333333333",
    cost_bucket_id: "55555555-5555-4555-8555-555555555555",
    cost_code: "08-500",
    amount: 5_000,
    version: 7,
    created_at: "2026-07-20T00:00:00.000Z",
    updated_at: "2026-07-20T00:00:00.000Z",
  } satisfies PanelProps["allocations"][number];
  const updateAttempts: UpdateAttempt[] = [];
  const removeAttempts: RemoveAttempt[] = [];
  const onUpdateAllocation = vi.fn<Update>(async (input) => {
    updateAttempts.push(input);
    if (updateAttempts.length === 1) throw new Error("stale update response");
  });
  const onRemoveAllocation = vi.fn<Remove>(async (input) => {
    removeAttempts.push(input);
    if (removeAttempts.length === 1) throw new Error("delete response lost");
  });

  renderPanel({
    onAllocate: () => Promise.resolve(),
    onUpdateAllocation,
    onRemoveAllocation,
    allocations: [allocation],
  });

  act(() =>
    document.body.querySelector<HTMLButtonElement>('[aria-label="Edit allocation"]')?.click(),
  );
  await settle();
  act(() => button("Save")?.click());
  await settle();
  expect(document.body.textContent).toContain("stale update response");
  expect(
    document.body.querySelector<HTMLInputElement>('input[inputmode="decimal"]')?.value,
  ).toContain("5,000");
  act(() => button("Save")?.click());
  await settle();
  expect(updateAttempts).toHaveLength(2);
  expect(updateAttempts[0].expectedVersion).toBe(7);
  expect(updateAttempts[1].expectedVersion).toBe(7);
  expect(updateAttempts[1].operationKey).toBe(updateAttempts[0].operationKey);
  expect(document.body.querySelector('[aria-label="Cancel allocation edit"]')).toBeNull();

  act(() =>
    document.body.querySelector<HTMLButtonElement>('[aria-label="Remove allocation"]')?.click(),
  );
  await settle();
  expect(document.body.textContent).toContain("delete response lost");
  act(() =>
    document.body.querySelector<HTMLButtonElement>('[aria-label="Remove allocation"]')?.click(),
  );
  await settle();
  expect(removeAttempts).toHaveLength(2);
  expect(removeAttempts[0].expectedVersion).toBe(7);
  expect(removeAttempts[1].expectedVersion).toBe(7);
  expect(removeAttempts[1].operationKey).toBe(removeAttempts[0].operationKey);
});
