// Central sign-in / access-mode helper used by the _authenticated layout to
// distinguish four states after Supabase session verification:
//
//   internal_active — ensure_current_user_account returned an org id;
//     internal Outlet + activity heartbeat allowed.
//   client_only    — no internal org, but at least one non-revoked
//     project_client_access row exists for this identity; the /n/:id
//     client-portal route is allowed, root redirects to that project
//     once, and no internal chrome or seedDemoIfEmpty runs.
//   no_active_company — signed in, association history / disabled seat
//     and no active internal or client access; renders a stable
//     "No active company access" screen with Sign out + support.
//   lookup_error   — transient DB failure; renders retry + sign out.
//
// The helper never throws for expected states; it only propagates a
// generic lookup failure so the layout can render a retry surface
// instead of the disabled-access copy.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type AccessMode =
  | { kind: "internal_active"; organizationId: string; clientProjectIds: string[] }
  | { kind: "client_only"; clientProjectIds: string[] }
  | { kind: "no_active_company" }
  | { kind: "lookup_error"; message: string };

export const resolveAccessMode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AccessMode> => {
    const { supabase } = context;

    try {
      // ensure_current_user_account is now history-safe: it returns NULL
      // instead of self-bootstrapping when a disabled-seat identity has
      // prior association history. Treat NULL as "no internal org".
      const { data: orgId, error: orgErr } = await supabase.rpc(
        "ensure_current_user_account",
      );
      if (orgErr) {
        return { kind: "lookup_error", message: orgErr.message };
      }

      const { data: accessRows, error: accessErr } = await supabase
        .from("project_client_access")
        .select("project_id, status")
        .in("status", ["active", "pending"]);
      if (accessErr) {
        return { kind: "lookup_error", message: accessErr.message };
      }
      const clientProjectIds = (accessRows ?? [])
        .filter((r) => r.status === "active" || r.status === "pending")
        .map((r) => r.project_id as string);

      if (orgId) {
        return {
          kind: "internal_active",
          organizationId: orgId as string,
          clientProjectIds,
        };
      }
      if (clientProjectIds.length > 0) {
        return { kind: "client_only", clientProjectIds };
      }
      return { kind: "no_active_company" };
    } catch (error) {
      return {
        kind: "lookup_error",
        message: error instanceof Error ? error.message : "Access lookup failed.",
      };
    }
  });

// Path helpers so the layout and tests agree on what constitutes a
// "client portal" URL that must bypass the internal-only gate.
export const CLIENT_PORTAL_PREFIX = "/n/";

export function isClientPortalPath(pathname: string): boolean {
  if (!pathname.startsWith(CLIENT_PORTAL_PREFIX)) return false;
  const rest = pathname.slice(CLIENT_PORTAL_PREFIX.length);
  const [id] = rest.split(/[/?#]/);
  return Boolean(id);
}

export function clientPortalPathForProject(projectId: string): string {
  return `${CLIENT_PORTAL_PREFIX}${projectId}`;
}
