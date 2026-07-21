import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

// Source-marker pins for the app-layer half of the Phase 3 authz batch. These
// guard three defect classes an adversarial re-verification confirmed after the
// first fix pass — each is a silent-return regression (a lockout or a leak that
// shallow QA misses), so a text-level invariant is the cheap insurance.

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("Phase 3 authz — app-layer guard invariants", () => {
  it("every estimates read-path seeder is best-effort (a flagless preset must never 500 the list)", () => {
    // create_estimate_atomic's body is retargeted onto estimating.write, so all
    // three seeders can raise 42501 for a Viewer/Executive who happens to load
    // the estimates or master-sheets screen first. Each must swallow so the list
    // still returns. (The high-severity miss was ensureHarborSampleMasterSheet.)
    const src = read("src/lib/estimates.functions.ts");
    for (const seeder of [
      "ensureCostLibrarySeeded",
      "ensureHarborDemoEstimate",
      "ensureHarborSampleMasterSheet",
    ]) {
      const start = src.indexOf(`async function ${seeder}(`);
      expect(start, `${seeder} not found`).toBeGreaterThan(-1);
      // Body up to the next top-level "async function" declaration.
      const nextDecl = src.indexOf("\nasync function ", start + 1);
      const body = src.slice(start, nextDecl === -1 ? undefined : nextDecl);
      expect(body, `${seeder} must open a try block`).toContain("try {");
      expect(body, `${seeder} must swallow errors best-effort`).toMatch(
        /catch \(error\) \{[\s\S]*console\.error\([\s\S]*best-effort/,
      );
    }
  });

  it("the canonical-demo protection write goes through the service-role client, not the caller", () => {
    // is_canonical_demo & friends are REVOKE'd from authenticated; only the
    // service role may mark the protected sample. The write must use supabaseAdmin.
    const src = read("src/lib/estimates.functions.ts");
    const protect = src.slice(src.indexOf("is_canonical_demo: true"));
    const owningUpdate = src.lastIndexOf(
      'dynamicTable(supabaseAdmin, "estimates")',
      src.indexOf("is_canonical_demo: true"),
    );
    expect(owningUpdate, "canonical protection write must be on supabaseAdmin").toBeGreaterThan(-1);
    expect(protect).toContain("canonical_expected_total_cents");
  });

  it("effectiveCapabilities honors an explicit empty set as no-caps, preset only on NULL", () => {
    // An explicit {} is the documented "no capabilities" state and the DB agrees
    // (has_org_capability returns false); falling back to the role preset would
    // leak the roster's real flags to a deliberately-zeroed admin.
    const src = read("src/lib/team.functions.ts");
    expect(src).toContain("if (row.capabilities == null) return seedCapabilitiesForRole(row.role)");
    // the old bug: preset whenever the normalized set was empty
    expect(src).not.toContain("if (Object.keys(explicit).length > 0) return explicit");
  });

  it("all four missing-RPC matchers fail closed on permission-denied (never treat 42501 as missing)", () => {
    // A loose `function <fn>` substring match catches "permission denied for
    // function <fn>" (42501) and routes a real denial to a coarser fallback.
    // Every matcher must key on codes + the "could not find the function" phrase.
    const files = [
      "src/lib/capabilities-server.ts",
      "src/lib/team.functions.ts",
      "src/lib/payments.functions.ts",
      "src/lib/stripe.server.ts",
    ];
    for (const f of files) {
      const src = read(f);
      expect(src, `${f} matcher must use the canonical phrase`).toContain(
        "could not find the function",
      );
      expect(
        src,
        `${f} must not classify 42501 as missing via a bare function-name substring`,
      ).not.toMatch(/message\.includes\(`function \$\{fn\}`\)/);
    }
  });
});
