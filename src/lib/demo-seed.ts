// Harbor Residence demo opt-out logic (hotfix: demo hides on delete, never
// reseeds). Pure and import-free so the smoke harness can exercise it.
//
// The demo seeders run ensure-on-load, so a hard-deleted demo project would
// simply come back. The founder's chosen design is hidden-not-deleted:
// deleting the demo archives it, and an ARCHIVED demo row is the durable
// "this company opted out" signal every demo ensure-path must respect.

export const HARBOR_DEMO_JOB_NUMBER = "DEMO-HARBOR";
export const HARBOR_DEMO_NAME = "Harbor Residence";
export const HARBOR_DEMO_CLIENT = "Private Luxury Residence";

// Harbor is the product walkthrough, not a decorative sample project. Every
// operational workflow needs enough connected evidence to make its real
// controls usable. This fixture gives Daily WIP -> CPM a stable, believable
// decision: the active drywall activity is 40% in CPM while the PM-reviewed
// field evidence recommends 52%.
export const HARBOR_DEMO_CPM_WALKTHROUGH = {
  scheduleActivityCode: "09-020",
  costCode: "0900",
  entryDate: "2026-06-11",
  activity: "Drywall hang and finish — second floor",
  fieldPercent: 50,
  reviewedPercent: 52,
  quantity: 2_600,
  unit: "SF",
  targetProductionRate: 25,
  crewCount: 2,
  peoplePerCrew: 4,
  hoursPerPerson: 8,
  blendedLaborRate: 110,
  reviewedAt: "2026-06-11T20:30:00.000Z",
  note: "Harbor onboarding walkthrough: PM reviewed the superintendent's drywall progress and linked it to the active CPM activity.",
} as const;

const normalizeDemoText = (value: unknown) =>
  typeof value === "string" ? value.trim().toLowerCase() : "";

export const isHarborDemoProjectName = (name: unknown) => {
  const normalizedName = normalizeDemoText(name);
  return (
    normalizedName === HARBOR_DEMO_NAME.toLowerCase() ||
    normalizedName.includes(HARBOR_DEMO_NAME.toLowerCase())
  );
};

export const isHarborDemoProject = (project: Record<string, unknown> | null | undefined) => {
  if (!project) return false;
  const jobNumber = normalizeDemoText(project.job_number);
  const client = normalizeDemoText(project.client);

  return (
    isHarborDemoProjectName(project.name) ||
    jobNumber === HARBOR_DEMO_JOB_NUMBER.toLowerCase() ||
    jobNumber.includes("harbor") ||
    client === HARBOR_DEMO_CLIENT.toLowerCase()
  );
};

// What a demo seeder may do given the company's Harbor demo project row
// (null when none exists). The lookup feeding this MUST include archived
// rows — filtering them out is exactly the bug that resurrected the demo.
export type HarborDemoSeedAction = "seed" | "ensure" | "skip";

export const harborDemoSeedAction = (
  project: { archived_at?: unknown } | null | undefined,
): HarborDemoSeedAction => {
  if (!project) return "seed";
  return project.archived_at ? "skip" : "ensure";
};

// Pure finder for ensure paths that scan a company's project list: returns
// the Harbor demo row whether or not it is archived, so the caller sees the
// opt-out instead of treating the demo as missing.
export const findHarborDemoProject = <T extends Record<string, unknown>>(
  projects: readonly T[] | null | undefined,
): T | null => (projects ?? []).find((project) => isHarborDemoProject(project)) ?? null;
