// Regression: the Daily Report "Save" must commit a work line the super typed
// into "Work put in place" but never pressed "Add line" on. The production bug
// (commit 5f1c4e2): the parent report Save never invoked the child
// DailyLogWorkLines mutation, so that draft was destroyed when the editor
// closed on save — Daily WIP then queried daily_wip_entries and correctly found
// nothing, because the row was never inserted. Supers lost real quantities
// (junction boxes, conduit LF, wire LF) with no error shown.
//
// The fix gives the child an imperative `flushPendingLine()` that the report
// Save awaits. This mounts the REAL DailyLogWorkLines, types an activity
// WITHOUT pressing "Add line", then calls that flush and asserts the work-line
// save fires with the typed values — and that an empty compose form flushes to
// a no-op (a plain report save must not write a phantom line).

import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

// Spies must exist before vi.mock's hoisted factory runs.
const { saveSpy, listSpy, listActivitiesSpy, deleteSpy } = vi.hoisted(() => ({
  saveSpy: vi.fn(),
  listSpy: vi.fn(),
  listActivitiesSpy: vi.fn(),
  deleteSpy: vi.fn(),
}));

// useServerFn(fn) normally returns a client caller; in the test it IS the fn,
// so the component's saveEntry({ data }) call lands directly on our spy.
vi.mock("@tanstack/react-start", () => ({
  useServerFn: (fn: unknown) => fn,
}));
vi.mock("@/lib/daily-wip.functions", () => ({
  saveDailyWipEntry: saveSpy,
  listDailyWipEntries: listSpy,
  listScheduleActivitiesForWip: listActivitiesSpy,
  deleteDailyWipEntry: deleteSpy,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import {
  DailyLogWorkLines,
  type DailyLogWorkLinesHandle,
} from "@/components/outcome/DailyLogWorkLines";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const PROJECT_ID = "11111111-1111-1111-1111-111111111111";
const REPORT_DATE = "2026-07-13";

let root: Root | null = null;
let container: HTMLElement | null = null;

function mount(ref: React.RefObject<DailyLogWorkLinesHandle | null>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <QueryClientProvider client={client}>
        <DailyLogWorkLines ref={ref} projectId={PROJECT_ID} reportDate={REPORT_DATE} buckets={[]} />
      </QueryClientProvider>,
    );
  });
}

// Set a React-controlled input the way a real keystroke does (native setter +
// input event), so the component's onChange runs and the draft updates.
function typeInto(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
  act(() => {
    if (setter) {
      setter.call(el, value);
    } else {
      el.value = value;
    }
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  saveSpy.mockReset().mockResolvedValue({ id: "row-1" });
  listSpy.mockReset().mockResolvedValue([]);
  listActivitiesSpy.mockReset().mockResolvedValue([]);
  deleteSpy.mockReset().mockResolvedValue({ id: "x" });
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

test("report Save flushes a typed work line that was never 'Add line'-d", async () => {
  const ref = createRef<DailyLogWorkLinesHandle>();
  mount(ref);

  const activity = container!.querySelector<HTMLInputElement>(
    'input[placeholder="e.g. Formed and poured north footings"]',
  );
  expect(activity, "compose form Activity input is present").toBeTruthy();

  // The super types the day's work but does NOT press "Add line".
  typeInto(activity!, "Electrical rough-in — 24 junction boxes");
  expect(ref.current!.hasPendingLine()).toBe(true);

  // The report Save awaits this flush.
  await act(async () => {
    await ref.current!.flushPendingLine();
  });

  expect(saveSpy).toHaveBeenCalledTimes(1);
  const payload = (saveSpy.mock.calls[0][0] as { data: Record<string, unknown> }).data;
  expect(payload.activity).toBe("Electrical rough-in — 24 junction boxes");
  expect(payload.entry_date).toBe(REPORT_DATE);
  expect(payload.projectId).toBe(PROJECT_ID);
});

test("Add line and report Save share one in-flight insert", async () => {
  let resolveSave!: (value: { id: string }) => void;
  saveSpy.mockImplementationOnce(
    () =>
      new Promise<{ id: string }>((resolve) => {
        resolveSave = resolve;
      }),
  );
  const ref = createRef<DailyLogWorkLinesHandle>();
  mount(ref);

  const activity = container!.querySelector<HTMLInputElement>(
    'input[placeholder="e.g. Formed and poured north footings"]',
  );
  typeInto(activity!, "North lobby electrical rough-in");

  const addLine = Array.from(container!.querySelectorAll("button")).find((button) =>
    button.textContent?.includes("Add line"),
  );
  act(() => addLine!.click());

  let reportFlush!: Promise<void>;
  act(() => {
    reportFlush = ref.current!.flushPendingLine();
  });
  await Promise.resolve();
  expect(saveSpy).toHaveBeenCalledTimes(1);

  await act(async () => {
    resolveSave({ id: "row-1" });
    await reportFlush;
  });
  expect(saveSpy).toHaveBeenCalledTimes(1);
});

test("flush is a no-op when the compose form is empty (no phantom line)", async () => {
  const ref = createRef<DailyLogWorkLinesHandle>();
  mount(ref);

  expect(ref.current!.hasPendingLine()).toBe(false);
  await act(async () => {
    await ref.current!.flushPendingLine();
  });

  expect(saveSpy).not.toHaveBeenCalled();
});
