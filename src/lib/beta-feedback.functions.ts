import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// "Flag an issue" beta feedback. Rows land in beta_feedback and get read
// directly from the database — no notification wiring in this phase.

type DynamicSupabaseError = { code?: string; message: string };
type DynamicSupabaseResult<T = unknown> = { data: T | null; error: DynamicSupabaseError | null };
type DynamicSupabaseQuery = PromiseLike<DynamicSupabaseResult> & {
  select(columns?: string): DynamicSupabaseQuery;
  insert(values: unknown): DynamicSupabaseQuery;
  eq(column: string, value: unknown): DynamicSupabaseQuery;
  order(column: string, options?: { ascending?: boolean }): DynamicSupabaseQuery;
};
type DynamicSupabaseClient = {
  from(relation: string): DynamicSupabaseQuery;
  rpc(fn: string): Promise<DynamicSupabaseResult<string>>;
};

const str = (value: unknown, fallback = "") => (value == null ? fallback : String(value));
const clean = (value: string, max = 500) => value.trim().slice(0, max);

// Same resolution as the estimating server functions: the ensured account
// org, overridden by the user's first active membership. The insert must
// satisfy the beta_feedback is_org_member RLS check.
async function feedbackOrganizationId(context: { supabase: unknown; userId: string }) {
  const supabase = context.supabase as unknown as DynamicSupabaseClient;
  const { data: ensuredOrganizationId, error: accountError } = await supabase.rpc(
    "ensure_current_user_account",
  );
  if (accountError) throw new Error(accountError.message);
  if (!ensuredOrganizationId) throw new Error("No Overwatch company workspace is available.");

  const { data: memberships, error: membershipsError } = await supabase
    .from("organization_memberships")
    .select("organization_id,status,created_at")
    .eq("user_id", context.userId)
    .eq("status", "active")
    .order("created_at", { ascending: true });
  if (membershipsError) throw new Error(membershipsError.message);
  const firstMembership = (memberships as Record<string, unknown>[] | null)?.find(
    (membership) => membership.organization_id,
  );
  return str(firstMembership?.organization_id, ensuredOrganizationId);
}

const submitBetaFeedbackInput = z.object({
  message: z.string().min(1).max(2000),
  route: z.string().max(500).optional().default(""),
  // Captured automatically by the dialog: estimate id, sheet id + number,
  // active tool, app commit sha — whatever the surface knows.
  context: z.record(z.string(), z.unknown()).optional().default({}),
});

export const submitBetaFeedback = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof submitBetaFeedbackInput>) =>
    submitBetaFeedbackInput.parse(input),
  )
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as unknown as DynamicSupabaseClient;
    const organizationId = await feedbackOrganizationId(context);
    const { error } = await supabase.from("beta_feedback").insert({
      organization_id: organizationId,
      created_by: context.userId,
      route: clean(data.route, 500),
      context: data.context,
      message: clean(data.message, 2000),
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
