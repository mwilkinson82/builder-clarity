// Parent-level regression for the field workflow: a superintendent types a
// Daily Report and a Work put in place line, presses only the large report
// Save button, and the work line must reach daily_wip_entries before the report
// is considered saved. The work-line form also stays locked until the report
// mutation settles, closing the mid-save data-loss window.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const {
  deleteReportSpy,
  deleteWipSpy,
  listActivitiesSpy,
  listDirectorySpy,
  listProjectSubsSpy,
  listReportsSpy,
  listWipSpy,
  saveReportSpy,
  saveWipSpy,
} = vi.hoisted(() => ({
  deleteReportSpy: vi.fn(),
  deleteWipSpy: vi.fn(),
  listActivitiesSpy: vi.fn(),
  listDirectorySpy: vi.fn(),
  listProjectSubsSpy: vi.fn(),
  listReportsSpy: vi.fn(),
  listWipSpy: vi.fn(),
  saveReportSpy: vi.fn(),
  saveWipSpy: vi.fn(),
}));

vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn }));
vi.mock("@/lib/daily-reports.functions", () => ({
  deleteDailyReport: deleteReportSpy,
  listDailyReports: listReportsSpy,
  upsertDailyReport: saveReportSpy,
}));
vi.mock("@/lib/daily-wip.functions", () => ({
  deleteDailyWipEntry: deleteWipSpy,
  listDailyWipEntries: listWipSpy,
  listScheduleActivitiesForWip: listActivitiesSpy,
  saveDailyWipEntry: saveWipSpy,
}));
vi.mock("@/lib/subcontractors.functions", () => ({
  listSubcontractors: listDirectorySpy,
}));
vi.mock("@/lib/subcontracts.functions", () => ({
  listProjectSubcontracts: listProjectSubsSpy,
}));
vi.mock("@/components/outcome/DailyReportsCalendar", () => ({
  DailyReportsCalendar: ({
    today,
    onSelectDay,
  }: {
    today: string;
    onSelectDay: (date: string) => void;
  }) => (
    <button type="button" onClick={() => onSelectDay(today)}>
      Open today
    </button>
  ),
  formatShortDate: (date: string) => date,
  monthName: () => "July",
  shiftMonth: (month: string) => month,
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    storage: {
      from: () => ({
        createSignedUrl: vi.fn(),
        remove: vi.fn().mockResolvedValue({ error: null }),
        upload: vi.fn(),
      }),
    },
  },
}));
vi.mock("@/lib/daily-report-packet-pdf", () => ({
  downloadPdfBytes: vi.fn(),
  generateDailyReportPacketPdf: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { DailyReportsWorkspace } from "@/components/outcome/DailyReportsWorkspace";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const PROJECT_ID = "11111111-1111-1111-1111-111111111111";

let root: Root | null = null;
let container: HTMLElement | null = null;

function typeInto(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
  act(() => {
    if (setter) setter.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function buttonNamed(name: string) {
  return Array.from(container!.querySelectorAll("button")).find((button) =>
    button.textContent?.includes(name),
  );
}

beforeEach(() => {
  deleteReportSpy.mockReset().mockResolvedValue({ id: "report-1" });
  deleteWipSpy.mockReset().mockResolvedValue({ id: "wip-1" });
  listActivitiesSpy.mockReset().mockResolvedValue([]);
  listDirectorySpy.mockReset().mockResolvedValue([]);
  listProjectSubsSpy.mockReset().mockResolvedValue({
    subcontracts: [],
    allocations: [],
    payments: [],
    documents: [],
    change_orders: [],
    payment_allocations: [],
  });
  listReportsSpy.mockReset().mockResolvedValue([]);
  listWipSpy.mockReset().mockResolvedValue([]);
  saveReportSpy.mockReset();
  saveWipSpy.mockReset().mockResolvedValue({ id: "wip-1" });

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <QueryClientProvider client={client}>
        <DailyReportsWorkspace projectId={PROJECT_ID} />
      </QueryClientProvider>,
    );
  });
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

test("the large Daily Report Save persists the pending work line and locks it mid-save", async () => {
  let resolveReport!: () => void;
  saveReportSpy.mockImplementationOnce(
    ({ data }: { data: { report_date: string } }) =>
      new Promise((resolve) => {
        resolveReport = () =>
          resolve({
            id: "report-1",
            project_id: PROJECT_ID,
            report_date: data.report_date,
            author: "",
            weather: "",
            crew_count: 0,
            manpower: "",
            work_performed: "",
            delays: "",
            safety_notes: "",
            visitors: "",
            quality_notes: "",
            notes: "",
            attachment_name: "",
            attachment_path: "",
            attachment_type: "",
            attachment_manifest: [],
            attachment_count: 0,
            attachment_bytes: 0,
            client_visible: false,
            created_by: "user-1",
            created_at: "2026-07-13T12:00:00Z",
            updated_at: "2026-07-13T12:00:00Z",
          });
      }),
  );

  await settle();
  act(() => buttonNamed("Open today")!.click());

  const activity = container!.querySelector<HTMLInputElement>(
    'input[placeholder="e.g. Formed and poured north footings"]',
  );
  expect(activity).toBeTruthy();
  typeInto(activity!, "Framing at the north lobby");

  act(() => buttonNamed("Save daily report")!.click());
  await settle();

  expect(saveWipSpy).toHaveBeenCalledTimes(1);
  expect(saveReportSpy).toHaveBeenCalledTimes(1);
  expect(saveWipSpy.mock.invocationCallOrder[0]).toBeLessThan(
    saveReportSpy.mock.invocationCallOrder[0],
  );
  const wipPayload = (saveWipSpy.mock.calls[0][0] as { data: Record<string, unknown> }).data;
  expect(wipPayload.projectId).toBe(PROJECT_ID);
  expect(wipPayload.activity).toBe("Framing at the north lobby");
  expect(activity!.closest('[aria-disabled="true"]')?.hasAttribute("inert")).toBe(true);

  await act(async () => {
    resolveReport();
    await Promise.resolve();
  });
  await settle();
});

test("invalid attachments fail before a pending work line is committed", async () => {
  await settle();
  act(() => buttonNamed("Open today")!.click());

  const activity = container!.querySelector<HTMLInputElement>(
    'input[placeholder="e.g. Formed and poured north footings"]',
  );
  typeInto(activity!, "North lobby framing");

  const attachmentInput = container!.querySelector<HTMLInputElement>("#daily-report-file-input");
  const unsupported = new File(["not an approved attachment"], "jobsite.exe", {
    type: "application/octet-stream",
  });
  Object.defineProperty(attachmentInput!, "files", {
    configurable: true,
    value: [unsupported],
  });
  act(() => attachmentInput!.dispatchEvent(new Event("change", { bubbles: true })));

  act(() => buttonNamed("Save daily report")!.click());
  await settle();

  expect(saveWipSpy).not.toHaveBeenCalled();
  expect(saveReportSpy).not.toHaveBeenCalled();
});
