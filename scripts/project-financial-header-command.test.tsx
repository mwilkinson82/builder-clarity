import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";

import { EditFinancialsDialog } from "@/components/project/EditFinancialsDialog";
import type { Rollup } from "@/lib/ior";
import type { ProjectRow } from "@/lib/projects.functions";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260720195500_project_financial_header_concurrency.sql",
  ),
  "utf8",
);
const functionsSource = readFileSync(join(process.cwd(), "src/lib/projects.functions.ts"), "utf8");
const routeSource = readFileSync(
  join(process.cwd(), "src/routes/_authenticated/projects.$projectId.tsx"),
  "utf8",
);
const scheduleSource = readFileSync(
  join(process.cwd(), "src/components/schedule/ScheduleRiskTab.tsx"),
  "utf8",
);

const PROJECT_VERSION = "2026-07-20T03:00:00.000Z";
const PROJECT = {
  id: "10000000-0000-4000-8000-000000000001",
  updated_at: PROJECT_VERSION,
  organization_id: "10000000-0000-4000-8000-000000000002",
  organization_name: "Test Builder",
  organization_logo_url: "",
  job_number: "2601",
  name: "Project Header Test",
  client: "Test Owner",
  project_manager: "Test PM",
  original_contract: 1_000_000,
  original_cost_budget: 800_000,
  default_retainage_pct: 10,
  default_output_format: "invoice",
  schedule_variance_weeks: 0,
  phase: "Early",
  percent_complete: 0,
  hold_variance_note: "Initial hold posture",
  last_reviewed_at: null,
  next_review_at: null,
  forecast_completion_date: "2027-01-01",
  baseline_completion_date: "2027-01-01",
  last_review_summary: "",
  source_opportunity_id: null,
  archived_at: null,
  closed_at: null,
  budget_locked_at: null,
} satisfies ProjectRow;

const ROLLUP = Object.fromEntries(
  [
    "originalContract",
    "approvedCOContract",
    "currentSignedContract",
    "weightedPendingCOContract",
    "pendingCOContract",
    "forecastedFinalContract",
    "actualToDate",
    "ftc",
    "baseProjectedCost",
    "approvedCOCost",
    "weightedPendingCOCost",
    "forecastedFinalCost",
    "exposureHolds",
    "contingencyHold",
    "forecastedGPBeforeHolds",
    "indicatedGP",
    "originalGP",
    "currentSignedGP",
    "indicatedGPpct",
    "originalGPpct",
    "currentSignedGPpct",
    "gpAtRisk",
    "remainingCost",
  ].map((key) => [key, 0]),
) as unknown as Rollup;

describe("project financial-header SQL command", () => {
  test("makes the reviewed row version part of both retry evidence and the guarded update", () => {
    expect(migration).toMatch(/p_expected_updated_at timestamptz/i);
    expect(migration).toMatch(
      /jsonb_build_array\([\s\S]*p_project_id, p_patch, v_reason, p_expected_updated_at/i,
    );
    expect(migration).toMatch(
      /if found then[\s\S]*return v_existing\.result[\s\S]*if v_before\.updated_at is distinct from p_expected_updated_at/i,
    );
    expect(migration).toContain("errcode = '40001'");
    expect(migration).toMatch(
      /where project\.id = p_project_id\s+and project\.updated_at = p_expected_updated_at/i,
    );
    expect(migration).toMatch(
      /drop function if exists public\.update_project_financial_header_atomic\(\s*uuid, jsonb, text, text/i,
    );
  });

  test("passes a stable expected version and operation key from every ordinary caller", () => {
    expect(functionsSource).toContain("expectedUpdatedAt: z.string().datetime()");
    expect(functionsSource).toContain("p_expected_updated_at: data.expectedUpdatedAt");
    expect(functionsSource).toContain('.select("project_manager,updated_at")');
    expect(functionsSource).toMatch(
      /project-foundation[\s\S]*\.select\("updated_at"\)[\s\S]*p_expected_updated_at: expectedUpdatedAt/i,
    );
    expect(routeSource).toMatch(/onSave=\{\(attempt\) =>[\s\S]*finUpdate\.mutateAsync/i);
    expect(routeSource).toMatch(/projectId,[\s\S]*\.\.\.attempt/i);
    expect(scheduleSource).toContain("expectedUpdatedAt: project.updated_at");
    expect(scheduleSource).toMatch(
      /projectHeaderRetryKeys[\s\S]*project\.updated_at[\s\S]*JSON\.stringify\(patch\)/i,
    );
  });
});

let root: Root | null = null;
let container: HTMLElement | null = null;

function renderDialog(onSave: ComponentProps<typeof EditFinancialsDialog>["onSave"]) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <EditFinancialsDialog
        project={PROJECT}
        rollup={ROLLUP}
        guidance={{ ePct: 4, cPct: 3, eTarget: 10_000, cTarget: 7_500 }}
        onSave={onSave}
        pending={false}
      />,
    );
  });
}

function button(label: string) {
  return Array.from(document.body.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.trim() === label,
  ) as HTMLButtonElement | undefined;
}

function field(label: string, selector = "input") {
  const labelElement = Array.from(document.body.querySelectorAll("label")).find((candidate) =>
    candidate.textContent?.startsWith(label),
  );
  return labelElement?.parentElement?.querySelector(selector) as
    HTMLInputElement | HTMLTextAreaElement;
}

function changeText(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype =
    input instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  document.body.querySelectorAll("[data-radix-portal]").forEach((portal) => portal.remove());
  root = null;
  container = null;
});

test("a failed save keeps the full draft and reason, then reuses the same command on retry", async () => {
  let rejectFirst!: (error: Error) => void;
  const onSave = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectFirst = reject;
        }),
    )
    .mockResolvedValueOnce({ ok: true });
  renderDialog(onSave);
  act(() => button("Edit")?.click());
  await settle();

  const name = field("Project name") as HTMLInputElement;
  changeText(name, "Preserved project name");
  await settle();
  const reason = field("Protected-header change reason", "textarea") as HTMLTextAreaElement;
  changeText(reason, "Owner-approved baseline correction");

  act(() => button("Save changes")?.click());
  expect(button("Saving…")?.disabled).toBe(true);
  expect(button("Cancel")?.disabled).toBe(true);
  expect(name.disabled).toBe(true);
  rejectFirst(new Error("database response was lost"));
  await settle();

  expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
  expect(document.body.querySelector('[role="alert"]')?.textContent).toContain(
    "database response was lost",
  );
  expect(name.value).toBe("Preserved project name");
  expect(reason.value).toBe("Owner-approved baseline correction");
  expect(onSave).toHaveBeenCalledTimes(1);
  expect(onSave.mock.calls[0][0].expectedUpdatedAt).toBe(PROJECT_VERSION);
  expect(onSave.mock.calls[0][0].operationKey).toMatch(/^[0-9a-f-]{36}$/i);

  act(() => button("Save changes")?.click());
  await settle();

  expect(onSave).toHaveBeenCalledTimes(2);
  expect(onSave.mock.calls[1][0]).toEqual(onSave.mock.calls[0][0]);
  expect(document.body.querySelector('[role="dialog"]')).toBeNull();
});

test("editing after a failed attempt starts a new operation without changing the reviewed version", async () => {
  const onSave = vi.fn().mockRejectedValueOnce(new Error("validation failed"));
  onSave.mockResolvedValueOnce({ ok: true });
  renderDialog(onSave);
  act(() => button("Edit")?.click());
  await settle();

  const client = field("Client") as HTMLInputElement;
  changeText(client, "First client draft");
  act(() => button("Save changes")?.click());
  await settle();

  changeText(client, "Corrected client draft");
  act(() => button("Save changes")?.click());
  await settle();

  expect(onSave.mock.calls[1][0].operationKey).not.toBe(onSave.mock.calls[0][0].operationKey);
  expect(onSave.mock.calls[1][0].expectedUpdatedAt).toBe(PROJECT_VERSION);
  expect(onSave.mock.calls[1][0].patch.client).toBe("Corrected client draft");
});
