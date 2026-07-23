// Central sign-in / access-mode helper used by the _authenticated layout to
// distinguish four states after Supabase session verification:
//
//   internal_active — ensure_current_user_account returned an org id;
//     internal Outlet + activity heartbeat allowed.
//   client_only    — no internal org, but at least one non-revoked
//     project_client_access row exists for this identity; the
//     /client/projects/:projectId portal route is allowed, root
//     redirects to that project once, and no internal chrome or
//     seedDemoIfEmpty runs.
//   no_active_company — signed in, association history / disabled seat
//     and no active internal or client access; renders a stable
//     "No active company access" screen with Sign out + support.
//   lookup_error   — transient DB failure; renders retry + sign out.
//
// Error messages returned to the client are sanitized: no raw Postgres
// text, no identifiers, no token/provider fragments — only a generic
// operator string so recovery UI has nothing sensitive to render.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type AccessMode =
  | { kind: "internal_active"; organizationId: string; clientProjectIds: string[] }
  | { kind: "client_only"; clientProjectIds: string[] }
  | { kind: "no_active_company" }
  | { kind: "lookup_error"; message: string };

const GENERIC_LOOKUP_ERROR = "We couldn't verify your account access. Please try again.";

export const resolveAccessMode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AccessMode> => {
    const { supabase } = context;

    try {
      // ensure_current_user_account is now history-safe: it returns NULL
      // instead of self-bootstrapping when a disabled-seat identity has
      // prior association history. Treat NULL as "no internal org".
      const { data: orgId, error: orgErr } = await supabase.rpc("ensure_current_user_account");
      if (orgErr) {
        // Do NOT surface orgErr.message — Postgres error text can leak
        // schema, RLS predicate details, or role names.
        return { kind: "lookup_error", message: GENERIC_LOOKUP_ERROR };
      }

      const { data: accessRows, error: accessErr } = await supabase
        .from("project_client_access")
        .select("project_id, status")
        .in("status", ["active", "pending"]);
      if (accessErr) {
        return { kind: "lookup_error", message: GENERIC_LOOKUP_ERROR };
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
    } catch {
      return { kind: "lookup_error", message: GENERIC_LOOKUP_ERROR };
    }
  });

// Path helpers so the layout and tests agree on what constitutes a
// "client portal" URL that must bypass the internal-only gate. The
// canonical route lives at src/routes/_authenticated/client.projects.$projectId.tsx,
// which resolves to /client/projects/:projectId.
export const CLIENT_PORTAL_PREFIX = "/client/projects/";

export function isClientPortalPath(pathname: string): boolean {
  if (!pathname.startsWith(CLIENT_PORTAL_PREFIX)) return false;
  const rest = pathname.slice(CLIENT_PORTAL_PREFIX.length);
  const [id] = rest.split(/[/?#]/);
  return Boolean(id);
}

export function clientPortalPathForProject(projectId: string): string {
  return `${CLIENT_PORTAL_PREFIX}${projectId}`;
}
