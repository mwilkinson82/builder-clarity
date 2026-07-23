import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

const dailyWipMigration = read(
  "supabase/migrations/20260723021909_daily_wip_command_integrity.sql",
);
const certificationMigration = read(
  "supabase/migrations/20260723021911_production_sov_certification_integrity.sql",
);
const dailyWipFunctions = read("src/lib/daily-wip.functions.ts");
const productionForecastFunctions = read("src/lib/production-forecast.functions.ts");

describe("Daily WIP financial command boundary", () => {
  it("uses exact cents, optimistic versions, idempotency, and audit-preserving voids", () => {
    expect(dailyWipMigration).toContain("labor_rate_cents bigint");
    expect(dailyWipMigration).toContain("material_cost_cents bigint");
    expect(dailyWipMigration).toContain("equipment_cost_cents bigint");
    expect(dailyWipMigration).toContain("private.daily_wip_command_operations");
    expect(dailyWipMigration).toContain("public.daily_wip_entry_events");
    expect(dailyWipMigration).toMatch(
      /DISABLE TRIGGER daily_wip_entries_set_updated_at;[\s\S]*UPDATE public\.daily_wip_entries[\s\S]*ENABLE TRIGGER daily_wip_entries_set_updated_at;/,
    );
    expect(dailyWipMigration).toMatch(
      /v_before\.version <> p_expected_version[\s\S]*changed while you were editing/i,
    );
    expect(dailyWipMigration).toMatch(
      /CREATE OR REPLACE FUNCTION public\.void_daily_wip_entry_atomic[\s\S]*SET voided_at = now\(\)[\s\S]*event_type/i,
    );
    expect(dailyWipMigration).not.toMatch(
      /CREATE OR REPLACE FUNCTION public\.void_daily_wip_entry_atomic[\s\S]*DELETE FROM public\.daily_wip_entries/i,
    );
  });

  it("routes application saves and removals through the atomic RPCs", () => {
    expect(dailyWipFunctions).toContain('"save_daily_wip_entry_atomic"');
    expect(dailyWipFunctions).toContain('"void_daily_wip_entry_atomic"');
    expect(dailyWipFunctions).toContain("p_expected_version: expected_version");
    expect(dailyWipFunctions).not.toMatch(
      /export const deleteDailyWipEntry[\s\S]*\.delete\(\)[\s\S]*\.eq\("id"/,
    );
  });
});

describe("Production SOV certification financial boundary", () => {
  it("certifies only the locked absolute latest reviewed SOV source", () => {
    expect(certificationMigration).toMatch(
      /ORDER BY source\.entry_date DESC,[\s\S]*source\.wip_reviewed_at DESC,[\s\S]*source\.updated_at DESC,[\s\S]*source\.id DESC[\s\S]*LIMIT 1[\s\S]*FOR UPDATE/,
    );
    expect(certificationMigration).toMatch(
      /v_source\.id <> p_expected_source_wip_entry_id[\s\S]*v_source\.review_version <> p_expected_source_review_version/,
    );
    expect(certificationMigration).toContain("production-pace-v2-atomic");
    expect(certificationMigration).toContain("private.production_sov_certification_operations");
  });

  it("preserves invalid history and rejects stale certification handoffs at the database", () => {
    expect(certificationMigration).toContain("public.production_sov_certification_invalidations");
    expect(certificationMigration).toMatch(
      /INSERT INTO public\.production_sov_certification_invalidations[\s\S]*ON CONFLICT \(production_sov_certification_id\) DO NOTHING/,
    );
    expect(certificationMigration).toContain("tg_validate_production_sov_handoff_current");
    expect(certificationMigration).toContain("tg_invalidate_production_sov_after_wip_change");
    expect(certificationMigration).toContain("source_superseded_after_certification");
    expect(certificationMigration).toContain("v_certification.source_wip_review_version IS NULL");
    expect(certificationMigration).toMatch(
      /BEFORE INSERT ON public\.production_sov_billing_handoffs/,
    );
    expect(certificationMigration).toMatch(
      /REVOKE ALL ON TABLE public\.production_sov_certifications FROM authenticated;[\s\S]*GRANT SELECT/,
    );
  });

  it("routes the UI server action through the atomic certification RPC", () => {
    expect(productionForecastFunctions).toContain('"certify_production_sov_position_atomic"');
    expect(productionForecastFunctions).toContain(
      "p_expected_source_review_version: data.sourceReviewVersion",
    );
    expect(productionForecastFunctions).not.toMatch(
      /export const certifyProductionSovPosition[\s\S]*dynamicTable\([^)]*"production_sov_certifications"\)[\s\S]*\.insert\(/,
    );
  });
});
