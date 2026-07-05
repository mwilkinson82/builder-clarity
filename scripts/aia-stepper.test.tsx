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
  } = {},
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
