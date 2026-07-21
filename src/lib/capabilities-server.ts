// Phase 3 authorization batch: shared server-side capability guards.
//
// Every guard follows the house pattern documented in docs/ROLES.md
// (Appendix D): the primary check is the SECURITY DEFINER RPC
// public.has_org_capability(org, capability) — which already passes for
// super admins — with a defined fallback for the pre-migration window where
// that RPC is not deployed yet. The default fallback is can_manage_org (the
// same coarse bundle those surfaces rode on before the split); project-scoped
// module guards fall back to can_manage_project, which is the check those
// writes rode on pre-split. Fallbacks only run when the capability RPC is
// MISSING — a capability explicitly returning false is a denial, never a
// fallback.
//
// The database remains the authority (RLS + command RPCs, retargeted in the
// parallel migration batch); these guards exist so API callers get a clear,
// early, plain-English refusal instead of an opaque RLS error.

import { CAPABILITY_GROUPS, type CapabilityKey } from "@/lib/capabilities";

type DynamicError = { code?: string; message?: string } | null;
type DynamicResult<T = unknown> = { data: T | null; error: DynamicError };
type DynamicQuery = PromiseLike<DynamicResult> & {
  select(columns?: string): DynamicQuery;
  eq(column: string, value: unknown): DynamicQuery;
  maybeSingle(): Promise<DynamicResult>;
};
type DynamicClient = {
  from(relation: string): DynamicQuery;
  rpc(fn: string, args?: Record<string, unknown>): Promise<DynamicResult>;
};

const client = (supabase: unknown) => supabase as DynamicClient;

const CAPABILITY_LABELS = Object.fromEntries(
  CAPABILITY_GROUPS.flatMap((group) => group.items.map((item) => [item.key, item.label])),
) as Record<CapabilityKey, string>;

// Plain-English activity phrases for refusal messages ("Your access does not
// include X — ask an admin for the "…" capability.").
const CAPABILITY_ACTIONS: Record<CapabilityKey, string> = {
  "projects.view_assigned": "viewing assigned projects",
  "projects.view_all": "viewing all company projects",
  "projects.manage": "editing project work",
  "financials.view": "viewing financial details",
  "billing.manage": "running billing",
  "estimating.write": "building estimates",
  "cost_library.write": "editing the cost library",
  "schedule.manage": "editing project schedules",
  "crm.manage": "working the sales pipeline",
  "company.manage_team": "managing people",
  "company.manage_settings": "managing company settings",
  "client_portal.manage": "managing client access",
};

export function capabilityDeniedMessage(capability: CapabilityKey): string {
  return `Your access does not include ${CAPABILITY_ACTIONS[capability]} — ask an admin for the "${CAPABILITY_LABELS[capability]}" capability.`;
}

/**
 * "RPC not deployed yet" detection for the pre-migration fallback branch.
 * Code-based only: PGRST202 (PostgREST cannot find the function in its schema
 * cache) and 42883 (Postgres undefined_function). A permission-denied error is
 * 42501 and reads "permission denied for function <fn>" — it MUST NOT be
 * treated as missing: that is a real denial, and the guard has to fail closed
 * (throw), never route to a coarser can_manage_org / can_manage_project check.
 * The message branch is a belt-and-suspenders for older PostgREST shapes that
 * omit the code but carry the canonical "could not find the function" phrase —
 * which the 42501 wording never contains.
 */
export function isMissingRpcError(error: DynamicError, fn: string): boolean {
  if (!error) return false;
  if (error.code === "PGRST202" || error.code === "42883") return true;
  const message = (error.message ?? "").toLowerCase();
  return message.includes("could not find the function") && message.includes(fn.toLowerCase());
}

/**
 * Capability lookup via public.has_org_capability.
 * Returns true/false, or null when the RPC is not deployed yet
 * (pre-migration window) so the caller can apply the documented fallback.
 */
export async function hasOrgCapability(
  supabase: unknown,
  organizationId: string,
  capability: CapabilityKey,
): Promise<boolean | null> {
  const { data, error } = await client(supabase).rpc("has_org_capability", {
    p_org_id: organizationId,
    p_capability: capability,
  });
  if (error) {
    if (isMissingRpcError(error, "has_org_capability")) return null;
    throw new Error(error.message);
  }
  return Boolean(data);
}

/**
 * Require an org-level capability. Throws a plain-English refusal when the
 * caller does not hold it. When the capability RPC is missing
 * (pre-migration), falls back to `options.fallback` if provided, otherwise
 * to can_manage_org — the documented house pattern.
 */
export async function requireOrgCapability(
  supabase: unknown,
  organizationId: string,
  capability: CapabilityKey,
  options: { fallback?: () => Promise<boolean>; message?: string } = {},
): Promise<void> {
  const allowed = await hasOrgCapability(supabase, organizationId, capability);
  if (allowed === true) return;
  if (allowed === null) {
    const fallback =
      options.fallback ??
      (async () => {
        const res = await client(supabase).rpc("can_manage_org", { p_org_id: organizationId });
        if (res.error) throw new Error(res.error.message);
        return Boolean(res.data);
      });
    if (await fallback()) return;
  }
  throw new Error(options.message ?? capabilityDeniedMessage(capability));
}

/**
 * Require a module capability scoped to a project (schedule.manage,
 * client_portal.manage, …). Resolution order:
 *
 * 1. project owner always passes (matches every DB helper);
 * 2. has_org_capability(project org, capability) — super admins pass here;
 * 3. capability RPC missing (pre-migration) → fall back to can_manage_project
 *    (these module writes rode on projects.manage before the split);
 * 4. capability RPC deployed and explicitly false → REFUSE.
 *
 * The org capability is MANDATORY. The matching DB helpers
 * (can_manage_schedule / can_manage_billing / can_manage_client_access) each
 * require has_org_capability AND can_manage_project, so an active per-project
 * owner/manager/editor assignment does NOT substitute for the capability.
 * Honoring assignments here (the removed `allowProjectAssignmentRoles`
 * behavior) made the app admit callers the DB then rejected with an opaque RLS
 * error — this guard now matches the DB (intended tightening; the PM/owner/
 * admin presets that legitimately manage these modules all carry the flags).
 * Project scoping is still enforced: the project SELECT below runs on the
 * caller's RLS-bound client (can_read_project), so a caller who cannot see the
 * project is refused before any capability check.
 */
export async function requireProjectOrgCapability(
  context: { supabase: unknown; userId: string },
  projectId: string,
  capability: CapabilityKey,
  options: { message?: string } = {},
): Promise<void> {
  const projectRes = await client(context.supabase)
    .from("projects")
    .select("id,organization_id,owner_id")
    .eq("id", projectId)
    .maybeSingle();
  if (projectRes.error) throw new Error(projectRes.error.message);
  const project = (projectRes.data ?? null) as {
    organization_id?: string | null;
    owner_id?: string | null;
  } | null;
  if (!project) throw new Error("Project not found or not accessible.");
  if (project.owner_id && project.owner_id === context.userId) return;
  const organizationId = project.organization_id ?? "";
  if (!organizationId) throw new Error("This project is not attached to an Overwatch company.");

  const allowed = await hasOrgCapability(context.supabase, organizationId, capability);
  if (allowed === true) return;
  if (allowed === null) {
    // Pre-migration window: preserve the pre-split behavior (these writes
    // rode on projects.manage via can_manage_project).
    const res = await client(context.supabase).rpc("can_manage_project", {
      p_project_id: projectId,
    });
    if (res.error) throw new Error(res.error.message);
    if (res.data) return;
    throw new Error(options.message ?? capabilityDeniedMessage(capability));
  }

  // Capability RPC deployed and explicitly returned false. A per-project
  // assignment does NOT substitute for the org capability (see the header
  // note) — refuse plainly so the app matches the DB helper.
  throw new Error(options.message ?? capabilityDeniedMessage(capability));
}
