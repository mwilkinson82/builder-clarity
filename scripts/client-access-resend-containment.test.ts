import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildClientAccessGrantWrite,
  findExactNormalizedEmailRow,
} from "@/lib/client-portal/access-grant-containment";

const base = {
  project_id: "project-1",
  contact_id: "contact-1",
  email: "client@example.com",
  role: "client" as const,
  invited_by: "manager-1",
};

describe("client access resend/regrant containment", () => {
  it("matches client identities exactly when valid emails contain SQL wildcard characters", () => {
    const rows = [
      { id: "underscore", email: "Client_One@Example.com" },
      { id: "different", email: "clientXone@example.com" },
      { id: "percent", email: "client%ops@example.com" },
    ];

    expect(findExactNormalizedEmailRow(rows, "client_one@example.com", "client access")?.id).toBe(
      "underscore",
    );
    expect(findExactNormalizedEmailRow(rows, "clientxone@example.com", "client access")?.id).toBe(
      "different",
    );
    expect(findExactNormalizedEmailRow(rows, "client%ops@example.com", "client access")?.id).toBe(
      "percent",
    );
  });

  it("fails closed when duplicate normalized client identities already exist", () => {
    expect(() =>
      findExactNormalizedEmailRow(
        [
          { id: "first", email: "Client@Example.com" },
          { id: "second", email: "client@example.com" },
        ],
        "client@example.com",
        "client access",
      ),
    ).toThrow(/multiple active client access records/i);
  });

  it("an existing active bound row preserves status, binding, acceptance, and module flags", () => {
    const activeRow = {
      id: "access-1",
      ...base,
      status: "active",
      client_user_id: "client-user-1",
      accepted_by: "client-user-1",
      accepted_at: "2026-07-23T00:00:00.000Z",
      can_view_change_orders: false,
      can_view_daily_reports: true,
      can_view_billing: true,
      can_view_selections: true,
    };

    const saved = {
      ...activeRow,
      ...buildClientAccessGrantWrite(base, activeRow.id),
    };

    expect(saved).toMatchObject({
      status: "active",
      client_user_id: "client-user-1",
      accepted_by: "client-user-1",
      accepted_at: "2026-07-23T00:00:00.000Z",
      can_view_change_orders: false,
      can_view_daily_reports: true,
      can_view_billing: true,
      can_view_selections: true,
    });
  });

  it("an existing pending row remains pending without resetting its module choices", () => {
    const pendingRow = {
      id: "access-2",
      ...base,
      status: "pending",
      client_user_id: null,
      accepted_by: null,
      accepted_at: null,
      can_view_change_orders: true,
      can_view_daily_reports: true,
      can_view_billing: false,
      can_view_selections: true,
    };

    const saved = {
      ...pendingRow,
      ...buildClientAccessGrantWrite(base, pendingRow.id),
    };

    expect(saved).toMatchObject({
      status: "pending",
      client_user_id: null,
      accepted_by: null,
      accepted_at: null,
      can_view_change_orders: true,
      can_view_daily_reports: true,
      can_view_billing: false,
      can_view_selections: true,
    });
  });

  it("only a genuinely new access row receives pending/default module values", () => {
    expect(buildClientAccessGrantWrite(base, null)).toEqual({
      ...base,
      status: "pending",
      can_view_change_orders: true,
      can_view_daily_reports: false,
      can_view_billing: false,
    });
  });

  it("sending a replacement MagicLink updates last_sent_at without demoting the access row", () => {
    const workspace = readFileSync(
      resolve(process.cwd(), "src/components/outcome/ClientPortalWorkspace.tsx"),
      "utf8",
    );
    const start = workspace.indexOf("const sendLinkMutation");
    const end = workspace.indexOf("const accessPermissionMutation", start);
    const block = workspace.slice(start, end);

    expect(block).toContain("sendOverwatchMagicLink");
    expect(block).toContain("last_sent_at:");
    expect(block).not.toContain('status: "pending"');
  });

  it("the server uses a preservation patch for existing access and defaults only on insert", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/lib/client-portal.functions.ts"),
      "utf8",
    );
    const start = source.indexOf("export const grantClientProjectAccess");
    const end = source.indexOf("export const updateClientProjectAccess", start);
    const block = source.slice(start, end);

    expect(block).toContain("buildClientAccessGrantWrite(");
    expect(block).toContain("existingAccess?.id");
    expect(block).toContain("findExactNormalizedEmailRow(");
    expect(block).not.toContain(".ilike(");
    expect(source).not.toContain('.ilike("email", email)');
  });
});
