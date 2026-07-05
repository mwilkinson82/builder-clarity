import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// The seeded demo project every workspace gets. It must NOT count as the user having
// created a real project of their own — onboarding is about their first real job.
const DEMO_JOB_NUMBER = "DEMO-HARBOR";

export interface OnboardingStatus {
  /** A non-demo project the user created exists. */
  hasProject: boolean;
  /** A real project has schedule-of-values cost buckets. */
  hasScheduleOfValues: boolean;
  /** A real project has at least one pay application. */
  hasPayApplication: boolean;
  /** A real project to deep-link the billing steps to (falls back to any project). */
  firstProjectId: string | null;
}

/**
 * Cheap existence checks that drive the first-run checklist (ONBOARDING1). Self-checking
 * from live data so the checklist never lies about what's done. Billing sub-queries are
 * advisory — an error there degrades to "not done" rather than breaking the home page.
 */
export const getOnboardingStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<OnboardingStatus> => {
    const { error: accountError } = await context.supabase.rpc("ensure_current_user_account");
    if (accountError) throw new Error(accountError.message);

    const { data: rawProjects, error } = await context.supabase
      .from("projects")
      .select("id,job_number")
      .is("archived_at", null)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);

    const projects = (rawProjects ?? []) as { id: string; job_number: string | null }[];
    const realProjects = projects.filter((p) => p.job_number !== DEMO_JOB_NUMBER);
    const firstProject = realProjects[0] ?? projects[0] ?? null;
    const realIds = realProjects.map((p) => p.id);

    let hasScheduleOfValues = false;
    let hasPayApplication = false;
    if (realIds.length > 0) {
      const [bucketsRes, appsRes] = await Promise.all([
        context.supabase.from("cost_buckets").select("id").in("project_id", realIds).limit(1),
        context.supabase
          .from("billing_applications")
          .select("id")
          .in("project_id", realIds)
          .limit(1),
      ]);
      hasScheduleOfValues = !bucketsRes.error && (bucketsRes.data?.length ?? 0) > 0;
      hasPayApplication = !appsRes.error && (appsRes.data?.length ?? 0) > 0;
    }

    return {
      hasProject: realProjects.length > 0,
      hasScheduleOfValues,
      hasPayApplication,
      firstProjectId: firstProject?.id ?? null,
    };
  });
