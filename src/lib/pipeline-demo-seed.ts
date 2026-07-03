// CRM demo seeding decision (PR #76 follow-up). The Harbor demo project row
// doubles as the company's demo opt-out tombstone: an ARCHIVED demo row means
// "seed nothing", not "seed without the project link". Pure module (no
// env-dependent imports) so node-based smoke tests can exercise both branches.
import { harborDemoSeedAction } from "./demo-seed.ts";

export type CrmDemoSeedPlan =
  { action: "seed"; harborProjectId: string | null } | { action: "skip"; harborProjectId: null };

// Decides what the CRM demo seeder may do given the company's Harbor demo
// project row (null when none exists). The lookup feeding this MUST include
// archived rows — filtering them out is exactly the bug that resurrected the
// demo project in PR #76.
export const planCrmDemoSeed = (
  harborProject: { id?: unknown; archived_at?: unknown } | null | undefined,
): CrmDemoSeedPlan => {
  if (harborDemoSeedAction(harborProject) === "skip") {
    return { action: "skip", harborProjectId: null };
  }
  const id = harborProject?.id;
  return {
    action: "seed",
    harborProjectId: typeof id === "string" && id ? id : null,
  };
};
