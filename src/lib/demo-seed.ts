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

// Each version represents the canonical fixture contract for one operational
// Harbor module. Versions only move forward when a module adapter changes.
// The order is dependency-aware so a downstream fixture never runs before its
// real prerequisites exist.
export const HARBOR_DEMO_MODULES = [
  { key: "project-foundation", version: 1, dependsOn: [] },
  { key: "budget-sov", version: 1, dependsOn: ["project-foundation"] },
  {
    key: "ior-commercial-position",
    version: 1,
    dependsOn: ["project-foundation", "budget-sov"],
  },
  {
    key: "subcontract-buyout",
    version: 1,
    dependsOn: ["project-foundation", "budget-sov", "ior-commercial-position"],
  },
  { key: "cpm-schedule", version: 1, dependsOn: ["project-foundation"] },
  {
    key: "daily-reports-wip",
    version: 1,
    dependsOn: ["budget-sov", "subcontract-buyout", "cpm-schedule"],
  },
  {
    key: "daily-wip-cpm-evidence",
    version: 1,
    dependsOn: ["budget-sov", "cpm-schedule", "daily-reports-wip"],
  },
  {
    key: "production-control",
    version: 1,
    dependsOn: ["subcontract-buyout", "daily-reports-wip", "daily-wip-cpm-evidence"],
  },
  {
    key: "billing-workspace",
    version: 1,
    dependsOn: ["budget-sov", "production-control"],
  },
  { key: "inspections", version: 1, dependsOn: ["project-foundation"] },
  { key: "claims", version: 1, dependsOn: ["project-foundation"] },
] as const;

// These are the stable business facts that connect Harbor's commercial
// walkthrough. They are exported so focused smoke coverage can verify the
// lesson contract without importing the server-function bundle.
export const HARBOR_DEMO_COMMERCIAL_WORKFLOW = {
  billingApplicationNumber: "Pay App 2 — Draft",
  productionCostCode: "1500",
  productionMeasure: "LF",
  productionTargetRate: 7.5,
  productionPeriod: {
    start: "2026-07-11",
    end: "2026-07-13",
  },
  subcontractors: [
    {
      key: "electrical",
      name: "ALP Electric",
      trade: "Electrical",
      costCode: "1500",
      buyout: 125_000,
      plannedQuantity: 25_000,
      unit: "LF",
      benchmarkLaborRate: 110,
    },
    {
      key: "concrete",
      name: "Ironclad Concrete Co.",
      trade: "Concrete",
      costCode: "0300",
      buyout: 145_000,
      plannedQuantity: 1_800,
      unit: "CY",
      benchmarkLaborRate: 110,
    },
    {
      key: "drywall",
      name: "Summit Drywall & Finishes",
      trade: "Drywall",
      costCode: "0900",
      buyout: 156_000,
      plannedQuantity: 12_000,
      unit: "SF",
      benchmarkLaborRate: 110,
    },
  ],
} as const;

export type HarborDemoModuleKey = (typeof HARBOR_DEMO_MODULES)[number]["key"];
export type HarborDemoModuleOperation = "ensure" | "reset";
export type HarborDemoModuleStatus = "missing" | "upgrade" | "current" | "failed";

export interface HarborDemoModuleVersionRow {
  module_key: string;
  applied_version: number;
  status: "ready" | "failed";
}

export interface HarborDemoModulePlanItem {
  key: HarborDemoModuleKey;
  targetVersion: number;
  appliedVersion: number;
  status: HarborDemoModuleStatus;
  dependsOn: readonly HarborDemoModuleKey[];
}

export const planHarborDemoModules = (
  rows: readonly HarborDemoModuleVersionRow[] | null | undefined,
): HarborDemoModulePlanItem[] => {
  const rowByKey = new Map((rows ?? []).map((row) => [row.module_key, row]));

  return HARBOR_DEMO_MODULES.map((module) => {
    const row = rowByKey.get(module.key);
    const appliedVersion = Math.max(0, Number(row?.applied_version) || 0);
    const status: HarborDemoModuleStatus = !row
      ? "missing"
      : row.status === "failed"
        ? "failed"
        : appliedVersion < module.version
          ? "upgrade"
          : "current";

    return {
      key: module.key,
      targetVersion: module.version,
      appliedVersion,
      status,
      dependsOn: module.dependsOn,
    };
  });
};

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
