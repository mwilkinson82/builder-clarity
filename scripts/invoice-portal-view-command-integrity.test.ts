import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260720174000_invoice_command_integrity.sql"),
  "utf8",
);
const portal = readFileSync(join(process.cwd(), "src/lib/client-portal.functions.ts"), "utf8");
const route = readFileSync(
  join(process.cwd(), "src/routes/_authenticated/client.projects.$projectId.tsx"),
  "utf8",
);

describe("audited invoice portal-view command", () => {
  it("keeps service-role invoice DML revoked and uses the narrow view RPC", () => {
    expect(migration).toContain(
      "revoke insert, update, delete on public.billing_invoices from authenticated, service_role",
    );
    expect(migration).toContain("function public.record_billing_invoice_portal_view_atomic");
    expect(migration).toMatch(
      /grant execute on function public\.record_billing_invoice_portal_view_atomic\([\s\S]*?\) to service_role/i,
    );
    expect(portal).toContain('admin.rpc("record_billing_invoice_portal_view_atomic"');
    expect(portal).not.toMatch(
      /admin[\s\S]{0,400}from\("billing_invoices"\)[\s\S]{0,400}\.update\(/,
    );
  });

  it("deduplicates stable view events with immutable full evidence", () => {
    expect(migration).toContain("billing_invoice_portal_view_commands_project_event_unique");
    expect(migration).toContain("billing_invoice_portal_view_commands_immutable");
    expect(migration).toContain("request_fingerprint");
    expect(migration).toContain("viewer_user_id");
    expect(migration).toContain("viewer_email");
    expect(migration).toContain("user_agent");
    expect(migration).toContain(
      "This portal-view event key was already used for different evidence",
    );
    expect(route).toContain("invoiceViewEventKeys");
    expect(route).toContain("portal-view:${globalThis.crypto.randomUUID()}");
    expect(route).toContain("data: { invoiceId, viewEventKey }");
  });

  it("updates first, last, and count monotonically only for a real client", () => {
    expect(migration).toContain("Only an issued, client-visible invoice can record a portal view");
    expect(migration).toContain("client_access.can_view_billing");
    expect(migration).toContain("Internal team invoice opens are not client-view evidence");
    expect(migration).toContain("else least(invoice.first_viewed_at, v_viewed_at)");
    expect(migration).toContain("last_viewed_at = greatest(");
    expect(migration).toContain("view_count = invoice.view_count + 1");
    expect(migration).toContain("status = case when invoice.status = 'sent' then 'viewed'");
  });
});
