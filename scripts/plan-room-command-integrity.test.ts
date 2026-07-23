import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  planRoomOperationFingerprint,
  releasePlanRoomOperationKey,
  retainPlanRoomOperationKey,
} from "@/lib/plan-room-operation-keys";

const server = readFileSync(join(process.cwd(), "src/lib/plan-room.functions.ts"), "utf8");
const workspace = readFileSync(
  join(process.cwd(), "src/components/estimates/plan-room/PlanRoomWorkspace.tsx"),
  "utf8",
);
const aiAssist = readFileSync(
  join(process.cwd(), "src/components/estimates/plan-room/useAiAssist.ts"),
  "utf8",
);
const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260720202000_plan_room_measurement_command_integrity.sql",
  ),
  "utf8",
);
const estimateCreationMigration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260720201000_estimate_creation_command_integrity.sql"),
  "utf8",
);

function block(source: string, start: string, end: string) {
  const startAt = source.indexOf(start);
  const endAt = source.indexOf(end, startAt + start.length);
  expect(startAt, `missing source marker: ${start}`).toBeGreaterThanOrEqual(0);
  expect(endAt, `missing source marker: ${end}`).toBeGreaterThan(startAt);
  return source.slice(startAt, endAt);
}

describe("Plan Room measurement command integrity", () => {
  it("uses the live versioned mutation RPC for create, update, and delete", () => {
    const create = block(
      server,
      "export const createTakeoffMeasurement",
      "export const updateTakeoffMeasurement",
    );
    const update = block(
      server,
      "export const updateTakeoffMeasurement",
      "export const recalculateSheetTakeoffs",
    );
    const remove = block(
      server,
      "export const deleteTakeoffMeasurement",
      "async function syncTakeoffQuantityToLine",
    );

    for (const source of [create, update, remove]) {
      expect(source).toContain('"mutate_estimate_takeoff_measurement_atomic"');
      expect(source).toContain("p_operation_key:");
      expect(source).not.toMatch(
        /dynamicTable\(context\.supabase, "estimate_takeoff_measurements"\)[\s\S]*\.(insert|update|delete)\(/,
      );
    }
    expect(create).toContain('p_action: "create"');
    expect(create).toContain("p_expected_version: null");
    expect(update).toContain('p_action: "update"');
    expect(update).toContain("p_expected_version: data.expected_version");
    expect(remove).toContain('p_action: "delete"');
    expect(remove).toContain("p_expected_version: data.expected_version");
  });

  it("recalculates a whole sheet in one scale-versioned command", () => {
    const recalculate = block(
      server,
      "export const recalculateSheetTakeoffs",
      "export const deleteTakeoffMeasurement",
    );
    expect(recalculate).toContain('"recalculate_estimate_takeoff_sheet_atomic"');
    expect(recalculate).toContain("p_expected_scale_revision: data.expected_scale_revision");
    expect(recalculate).toContain("p_operation_key: data.operation_key");
    expect(recalculate).not.toMatch(/for \(const raw/);
    expect(recalculate).not.toMatch(/\.update\(/);
  });

  it("creates the estimate line through financial authority, then replay-safely links the group", () => {
    const createLine = block(
      server,
      "export const createLineItemForTakeoffs",
      "export const syncTakeoffToEstimateLine",
    );
    expect(createLine).toContain('"create_estimate_line_items_atomic"');
    expect(createLine).toContain('"link_estimate_takeoff_group_atomic"');
    expect(createLine).toContain("p_expected_versions: data.expected_versions");
    expect(createLine.match(/p_operation_key: data\.operation_key/g)).toHaveLength(2);
    expect(createLine).not.toMatch(
      /dynamicTable\(context\.supabase, "estimate_line_items"\)[\s\S]*\.insert\(/,
    );
    expect(createLine).not.toMatch(
      /dynamicTable\(context\.supabase, "estimate_takeoff_measurements"\)[\s\S]*\.update\(/,
    );
  });

  it("pins the exact live RPC authorization and idempotency contracts", () => {
    expect(migration).toMatch(
      /create or replace function public\.mutate_estimate_takeoff_measurement_atomic\([\s\S]*p_expected_version integer[\s\S]*p_operation_key text/i,
    );
    expect(migration).toContain("where operation.changed_by = v_user_id");
    expect(migration).toContain(
      "return v_existing.result || jsonb_build_object('deduplicated', true)",
    );
    expect(migration).toContain("not public.can_manage_estimate(p_estimate_id)");
    expect(migration).toContain("Final or converted estimate takeoffs are immutable");
    expect(migration).toMatch(
      /grant execute on function public\.mutate_estimate_takeoff_measurement_atomic[\s\S]*to authenticated, service_role/i,
    );
    expect(estimateCreationMigration).toContain(
      "grant execute on function public.create_estimate_line_items_atomic(uuid, jsonb, text)",
    );
  });
});

describe("Plan Room caller-owned retry keys", () => {
  it("retains a key after failure and rotates only after authoritative success", () => {
    const retained = new Map<string, string>();
    const fingerprint = planRoomOperationFingerprint("measurement-update", {
      id: "measurement-1",
      version: 4,
      patch: { label: "Corridor wall" },
    });
    const first = retainPlanRoomOperationKey(retained, fingerprint);
    expect(retainPlanRoomOperationKey(retained, fingerprint)).toBe(first);
    releasePlanRoomOperationKey(retained, first);
    expect(retainPlanRoomOperationKey(retained, fingerprint)).not.toBe(first);
  });

  it("wires versions and retained keys through human and AI measurement paths", () => {
    expect(workspace).toContain("takeoffCommandOperationKeysRef");
    expect(workspace).toContain("expectedMeasurementVersions");
    expect(workspace).toContain("expected_version: measurement.version");
    expect(workspace).toContain("expected_scale_revision: sheet.scale_revision");
    expect(workspace).toContain("linkTakeoffGroupFn");
    expect(workspace).toContain("syncLineMutation.mutate({ lineId })");
    expect(workspace).not.toMatch(
      /for \(const id of measurementIds\)[\s\S]{0,240}updateMeasurementFn/,
    );
    expect(aiAssist).toContain("measurementOperationKeysRef");
    expect(aiAssist).toContain("expected_version: existing.version");
    expect(aiAssist).toContain("version: result.measurement.version");
  });
});
