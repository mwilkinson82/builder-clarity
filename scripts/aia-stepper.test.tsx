// GETTINGPAID3 regression: the AIA path guides instead of hides. The stepper
// keeps every step present, routes out-of-sequence generate clicks to the
// blocking step instead of no-oping, and requires one explicit confirm when
// overbilled lines are present. Mounts the real component the builder uses.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import { AiaApplicationStepper } from "@/components/billing/AiaApplicationStepper";
import type { AiaBuilderSnapshot } from "@/lib/aia-builder-steps";
import type { OverbilledLine } from "@/lib/aia-math";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const OVERBILLED: OverbilledLine = {
  item: "0100",
  description: "Sitework",
  scheduledValueCents: 10_000_00,
  totalCompletedStoredCents: 10_880_00,
  percentComplete: 108.8,
  overageCents: 880_00,
};

let root: Root | null = null;
let container: HTMLElement | null = null;

function mount(
  snapshot: AiaBuilderSnapshot,
  overbilled: OverbilledLine[],
  handlers: {
    onGenerate?: () => void;
    onImportSov?: () => void;
    onSetOutputFormat?: (f: "invoice" | "aia_g702") => void;
    onBillOwner?: () => void;
  } = {},
  props: { invoiceExists?: boolean } = {},
) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <AiaApplicationStepper
        snapshot={snapshot}
        overbilled={overbilled}
        canImport
        onSetOutputFormat={handlers.onSetOutputFormat ?? (() => {})}
        onImportSov={handlers.onImportSov ?? (() => {})}
        onGenerate={handlers.onGenerate ?? (() => {})}
        onBillOwner={handlers.onBillOwner}
        invoiceExists={props.invoiceExists}
        billableAmountLabel="$1,000.00"
      />,
    );
  });
}

function generateButton(): HTMLButtonElement {
  const buttons = Array.from(container!.querySelectorAll("button")) as HTMLButtonElement[];
  const match = buttons.find((btn) =>
    /Download AIA|Confirm & download/.test(btn.textContent ?? ""),
  );
  if (!match) throw new Error("generate button not found");
  return match;
}

function billButton(): HTMLButtonElement {
  const buttons = Array.from(container!.querySelectorAll("button")) as HTMLButtonElement[];
  const match = buttons.find((btn) =>
    /Bill the owner|Confirm & bill|^Billing/.test(btn.textContent ?? ""),
  );
  if (!match) throw new Error("bill button not found");
  return match;
}

function click(button: HTMLButtonElement) {
  act(() => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

const READY: AiaBuilderSnapshot = {
  outputFormat: "aia_g702",
  lineCount: 12,
  linesWithActivity: 5,
  overbilledCount: 0,
};

test("clean SOV generates on a single click, no confirm and no overbilling banner", () => {
  const onGenerate = vi.fn();
  mount(READY, [], { onGenerate });
  expect(container?.textContent).not.toMatch(/over 100%/i);
  click(generateButton());
  expect(onGenerate).toHaveBeenCalledTimes(1);
});

test("overbilled SOV requires one explicit confirm before generating", () => {
  const onGenerate = vi.fn();
  mount({ ...READY, overbilledCount: 1 }, [OVERBILLED], { onGenerate });
  // The named overbilling warning is visible up front.
  expect(container?.textContent).toMatch(/Sitework bills to 108\.8% of scheduled value/);

  const button = generateButton();
  click(button);
  // First click arms the confirm instead of generating.
  expect(onGenerate).not.toHaveBeenCalled();
  expect(generateButton().textContent).toMatch(/Confirm & download anyway/);

  // Second click generates.
  click(generateButton());
  expect(onGenerate).toHaveBeenCalledTimes(1);
});

test("out-of-sequence generate does not no-op: format not AIA never generates", () => {
  const onGenerate = vi.fn();
  mount({ ...READY, outputFormat: "invoice" }, [], { onGenerate });
  // The action is present (never absent) with an inline reason.
  expect(container?.textContent).toMatch(/Set this application's output to AIA G702\/G703/);
  click(generateButton());
  expect(onGenerate).not.toHaveBeenCalled();
});

test("no imported lines blocks generation with the SOV reason", () => {
  const onGenerate = vi.fn();
  mount({ ...READY, lineCount: 0 }, [], { onGenerate });
  expect(container?.textContent).toMatch(/Import your schedule of values first/);
  click(generateButton());
  expect(onGenerate).not.toHaveBeenCalled();
});

// The pay application IS the owner's bill: billing is one terminal action,
// available as soon as the application is ready — no "download the package
// first" dance. Recipient-confirmed Send from Receivables still starts A/R.
test("bill the owner is available as soon as the application is ready — no download-first", () => {
  const onBillOwner = vi.fn();
  mount(READY, [], { onBillOwner }); // hasGenerated NOT set
  expect(container?.textContent).toMatch(/Bill the owner — \$1,000\.00/);
  // The G702/G703 download sits beside it as the printed copy, not a gate.
  expect(container?.textContent).toMatch(/Download AIA G702\/G703/);
  click(billButton());
  expect(onBillOwner).toHaveBeenCalledTimes(1);
});

test("billing an overbilled application requires one explicit confirm", () => {
  const onBillOwner = vi.fn();
  mount({ ...READY, overbilledCount: 1 }, [OVERBILLED], { onBillOwner });
  const button = billButton();
  click(button);
  // First click arms the confirm instead of billing.
  expect(onBillOwner).not.toHaveBeenCalled();
  expect(billButton().textContent).toMatch(/Confirm & bill anyway/);
  // Second click bills.
  click(billButton());
  expect(onBillOwner).toHaveBeenCalledTimes(1);
});

// The Bill and Download overbilled confirms are INDEPENDENT: arming the
// co-located Download must never pre-confirm the money-committing Bill action
// (a single shared flag once let an overbilled receivable commit on one click).
test("download and bill keep independent overbilled confirms — no cross-arming", () => {
  const onBillOwner = vi.fn();
  const onGenerate = vi.fn();
  mount({ ...READY, overbilledCount: 1 }, [OVERBILLED], { onBillOwner, onGenerate });
  // Arm the download confirm.
  click(generateButton());
  expect(onGenerate).not.toHaveBeenCalled();
  expect(generateButton().textContent).toMatch(/Confirm & download anyway/);
  // The bill button is NOT armed by the download click.
  expect(billButton().textContent).toMatch(/Bill the owner/);
  expect(billButton().textContent).not.toMatch(/Confirm & bill/);
  // A first click on Bill arms it (does not commit) — it has its own confirm.
  click(billButton());
  expect(onBillOwner).not.toHaveBeenCalled();
  expect(billButton().textContent).toMatch(/Confirm & bill anyway/);
});

test("not ready (no imported lines) blocks billing with the SOV reason", () => {
  const onBillOwner = vi.fn();
  mount({ ...READY, lineCount: 0 }, [], { onBillOwner });
  expect(container?.textContent).toMatch(/Import your schedule of values first/);
  click(billButton());
  expect(onBillOwner).not.toHaveBeenCalled();
});

test("an application with an invoice shows the owner-billed state, no duplicate action", () => {
  const onBillOwner = vi.fn();
  mount(
    { ...READY, hasInvoice: true },
    [],
    { onBillOwner },
    {
      invoiceExists: true,
    },
  );
  expect(container?.textContent).toMatch(/Owner billed/);
  expect(() => billButton()).toThrow(); // the bill action is gone once billed
  expect(onBillOwner).not.toHaveBeenCalled();
});
