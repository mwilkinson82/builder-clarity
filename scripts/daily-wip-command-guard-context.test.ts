import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

const originalBoundary = read(
  "supabase/migrations/20260723115340_ceb0a640-4b93-4d97-b6d2-d765d1013e64.sql",
);
const guardFix = read(
  "supabase/migrations/20260723133206_daily_wip_command_guard_execution_context.sql",
);

describe("Daily WIP command guard execution context", () => {
  it("runs as invoker so raw roles stay distinguishable from postgres-owned command RPCs", () => {
    expect(guardFix).toMatch(
      /CREATE OR REPLACE FUNCTION public\.tg_guard_daily_wip_command_write\(\)[\s\S]*SECURITY INVOKER/i,
    );
    expect(guardFix).not.toMatch(
      /CREATE OR REPLACE FUNCTION public\.tg_guard_daily_wip_command_write\(\)[\s\S]*SECURITY DEFINER/i,
    );
    expect(guardFix).toMatch(
      /IF current_user = 'postgres'[\s\S]*AND current_setting\('overwatch\.daily_wip_command_write', true\) = 'on'/i,
    );
    expect(guardFix).not.toMatch(
      /current_user = 'postgres'[\s\S]*OR current_setting\('overwatch\.daily_wip_command_write'/i,
    );
  });

  it("keeps both audited command RPCs definer-owned and transaction-marked", () => {
    for (const name of ["save_daily_wip_entry_atomic", "void_daily_wip_entry_atomic"]) {
      expect(originalBoundary).toMatch(
        new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?SECURITY DEFINER`, "i"),
      );
    }
    expect(
      originalBoundary.match(/set_config\('overwatch\.daily_wip_command_write', 'on', true\)/g),
    ).toHaveLength(2);
  });

  it("continues blocking raw real-project writes and preserves the exact Harbor fixture exception", () => {
    expect(guardFix).toContain(
      "RAISE EXCEPTION 'Daily WIP must be changed through the audited command workflow.'",
    );
    expect(guardFix).toMatch(
      /SELECT project\.job_number = 'DEMO-HARBOR'[\s\S]*IF NOT coalesce\(v_is_demo, false\)/i,
    );
    expect(guardFix).toContain("Daily WIP demo money must resolve to exact cents.");
    expect(guardFix).toContain("NEW.labor_rate_cents := round(NEW.labor_rate * 100)::bigint;");
    expect(guardFix).toContain(
      "NEW.material_cost_cents := round(NEW.material_cost * 100)::bigint;",
    );
    expect(guardFix).toContain(
      "NEW.equipment_cost_cents := round(NEW.equipment_cost * 100)::bigint;",
    );
    expect(guardFix).toContain(
      "NEW.version := CASE WHEN TG_OP = 'INSERT' THEN 1 ELSE OLD.version + 1 END;",
    );
  });

  it("does not expose the trigger function as an authenticated or service-role RPC", () => {
    expect(guardFix).toMatch(
      /REVOKE ALL ON FUNCTION public\.tg_guard_daily_wip_command_write\(\)[\s\S]*FROM PUBLIC, anon, authenticated, service_role/i,
    );
  });

  it("removes table-wide bypass privileges while retaining the row-level verbs", () => {
    expect(guardFix).toMatch(/REVOKE ALL ON TABLE public\.daily_wip_entries FROM PUBLIC, anon/i);
    expect(guardFix).toMatch(
      /REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLE public\.daily_wip_entries[\s\S]*FROM authenticated, service_role/i,
    );
    expect(guardFix).toMatch(
      /GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public\.daily_wip_entries[\s\S]*TO authenticated, service_role/i,
    );
    expect(guardFix).toContain(
      "RAISE EXCEPTION 'Unsafe Daily WIP table privileges remain after hardening.'",
    );
  });
});
