// Central sign-in / access-mode helper used by the _authenticated layout to
// distinguish four states after Supabase session verification:
//
//   internal_active — ensure_current_user_account returned an org id;
//     internal Outlet + activity heartbeat allowed.
//   client_only    — no internal org, but at least one active, bound
//     project_client_access row exists for this identity; the
//     /client/projects/:id client-portal route is allowed, root redirects
//     to that project
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
    const { supabase, userId } = context;

    try {
      // ensure_current_user_account is now history-safe: it returns NULL
      // instead of self-bootstrapping when a disabled-seat identity has
      // prior association history. Treat NULL as "no internal org".
      const { data: orgId, error: orgErr } = await supabase.rpc("ensure_current_user_account");
      if (orgErr) {
        return {
          kind: "lookup_error",
          message: "We couldn't verify your company access.",
        };
      }

      const { data: accessRows, error: accessErr } = await supabase
        .from("project_client_access")
        .select("project_id, status, client_user_id")
        .eq("status", "active")
        .eq("client_user_id", userId);
      if (accessErr) {
        return {
          kind: "lookup_error",
          message: "We couldn't verify your project access.",
        };
      }
      const clientProjectIds = [
        ...new Set(
          (accessRows ?? [])
            .filter((row) => row.status === "active" && row.project_id)
            .map((row) => row.project_id as string),
        ),
      ].sort((left, right) => left.localeCompare(right));

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
    } catch {
      return {
        kind: "lookup_error",
        message: "We couldn't verify your access.",
      };
    }
  });

// Path helpers so the layout and tests agree on what constitutes a
// "client portal" URL that must bypass the internal-only gate.
export const CLIENT_PORTAL_PREFIX = "/client/projects/";

export function clientProjectIdFromPath(pathname: string): string | null {
  if (!pathname.startsWith(CLIENT_PORTAL_PREFIX)) return null;
  const [pathOnly] = pathname.split(/[?#]/);
  const rest = pathOnly.slice(CLIENT_PORTAL_PREFIX.length).replace(/\/$/, "");
  if (!rest || rest.includes("/")) return null;
  return rest;
}

export function isClientPortalPath(pathname: string): boolean {
  return clientProjectIdFromPath(pathname) !== null;
}

export function clientPortalPathForProject(projectId: string): string {
  return `${CLIENT_PORTAL_PREFIX}${projectId}`;
}
