// GETTINGPAID2 regression: the portal "Viewed" stamp must fire ONLY on an
// explicit invoice open. The production bug: the recording derivation fell
// back to the display default (`?? visibleInvoices[0]`), so ANY portal visit
// — daily reports, change orders — silently stamped the client's first
// invoice as viewed, and collections were delayed on a view that never
// happened. This mounts the REAL hook the route uses (useInvoiceViewSignal)
// and asserts the founder's scenarios: no selection -> no call; select -> one
// call with that id; switch -> one call each; revisit -> deduped.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import { useInvoiceViewSignal } from "@/lib/portal-view-signal";

// React 19 requires an explicit opt-in before act() is usable.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const INVOICES = ["invoice-a", "invoice-b", "invoice-c"];

function PortalBillingHarness({
  selectedInvoiceId,
  record,
}: {
  selectedInvoiceId: string | null;
  record: (invoiceId: string) => Promise<unknown>;
}) {
  // Exactly the route's wiring: selection state in, visible invoice ids in,
  // fire-and-forget recorder out. The display default (first invoice) is a
  // separate concern that must never reach the hook.
  useInvoiceViewSignal(selectedInvoiceId, INVOICES, record);
  return <div data-testid="portal-billing" />;
}

let root: Root | null = null;
let container: HTMLElement | null = null;

function mount(selectedInvoiceId: string | null, record: (id: string) => Promise<unknown>) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(<PortalBillingHarness selectedInvoiceId={selectedInvoiceId} record={record} />);
  });
}

function rerender(selectedInvoiceId: string | null, record: (id: string) => Promise<unknown>) {
  act(() => {
    root!.render(<PortalBillingHarness selectedInvoiceId={selectedInvoiceId} record={record} />);
  });
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

test("portal visit with invoices present but no selection records nothing", () => {
  const record = vi.fn().mockResolvedValue(null);
  mount(null, record);
  // A re-render without a selection (e.g. reading daily reports) still
  // records nothing — the display default never feeds the recorder.
  rerender(null, record);
  expect(record).not.toHaveBeenCalled();
});

test("explicitly opening an invoice records exactly once with that id", () => {
  const record = vi.fn().mockResolvedValue(null);
  mount(null, record);
  expect(record).not.toHaveBeenCalled();

  rerender("invoice-b", record);
  expect(record).toHaveBeenCalledTimes(1);
  expect(record).toHaveBeenCalledWith("invoice-b");

  // Unrelated re-renders of the same selection do not double-record.
  rerender("invoice-b", record);
  expect(record).toHaveBeenCalledTimes(1);
});

test("switching invoices records one call each; revisits are deduped", () => {
  const record = vi.fn().mockResolvedValue(null);
  mount(null, record);

  rerender("invoice-a", record);
  rerender("invoice-c", record);
  expect(record.mock.calls.map((call) => call[0])).toEqual(["invoice-a", "invoice-c"]);

  // Revisit within the same visit: already recorded, no new call.
  rerender("invoice-a", record);
  rerender("invoice-c", record);
  expect(record).toHaveBeenCalledTimes(2);
});

test("a selection that is not in the visible list never records", () => {
  const record = vi.fn().mockResolvedValue(null);
  mount("invoice-that-does-not-exist", record);
  expect(record).not.toHaveBeenCalled();
});

test("a failed record call never breaks the portal render", () => {
  const record = vi.fn().mockRejectedValue(new Error("offline"));
  mount("invoice-a", record);
  expect(record).toHaveBeenCalledTimes(1);
  expect(container?.querySelector('[data-testid="portal-billing"]')).not.toBeNull();
});
