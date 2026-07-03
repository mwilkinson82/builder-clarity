// Roles Phase 2: the capability model.
//
// Permissions are explicit per-member capability flags stored on the company
// membership row (organization_memberships.capabilities). Role labels remain
// as display labels and as PRESETS that pre-fill the flags. This module is
// the TypeScript mirror of the SQL source of truth
// (public.role_preset_capabilities in
// supabase/migrations/20260703070000_roles_capabilities_foundation.sql);
// scripts/roles-capability-parity-smoke.ts asserts the two stay in sync.

export type AccountRole = "owner" | "admin" | "executive" | "project_manager" | "member" | "viewer";

export type CapabilityKey =
  | "projects.view_assigned"
  | "projects.view_all"
  | "projects.manage"
  | "financials.view"
  | "billing.manage"
  | "estimating.write"
  | "cost_library.write"
  | "schedule.manage"
  | "crm.manage"
  | "company.manage_team"
  | "company.manage_settings"
  | "client_portal.manage";

export type CapabilitySet = Partial<Record<CapabilityKey, boolean>>;

export interface CapabilityDefinition {
  key: CapabilityKey;
  label: string;
  description: string;
}

export interface CapabilityGroup {
  group: string;
  items: CapabilityDefinition[];
}

// Plain contractor language: these labels and descriptions render in the UI.
export const CAPABILITY_GROUPS: CapabilityGroup[] = [
  {
    group: "Projects",
    items: [
      {
        key: "projects.view_assigned",
        label: "See assigned projects",
        description: "Open the projects this person has been added to.",
      },
      {
        key: "projects.view_all",
        label: "Access all company projects",
        description: "See every project in the company, not just assigned ones.",
      },
      {
        key: "projects.manage",
        label: "Edit project work",
        description:
          "Create projects and change project data: risks, change orders, daily logs, decisions.",
      },
    ],
  },
  {
    group: "Money",
    items: [
      {
        key: "financials.view",
        label: "See financials",
        description: "See dollar amounts: contract values, cost budgets, margins, billing totals.",
      },
      {
        key: "billing.manage",
        label: "Run billing",
        description: "Create and edit pay applications, invoices, and cost actuals.",
      },
    ],
  },
  {
    group: "Estimating",
    items: [
      {
        key: "estimating.write",
        label: "Build estimates",
        description: "Create and edit estimates, takeoffs, and plan room drawings.",
      },
      {
        key: "cost_library.write",
        label: "Edit cost library",
        description: "Change the shared cost library and markup defaults everyone prices from.",
      },
    ],
  },
  {
    group: "Schedule & sales",
    items: [
      {
        key: "schedule.manage",
        label: "Build schedules",
        description: "Create and update project schedules and delay records.",
      },
      {
        key: "crm.manage",
        label: "Work the pipeline",
        description: "Add and edit leads, opportunities, and follow-ups in the sales pipeline.",
      },
    ],
  },
  {
    group: "Company",
    items: [
      {
        key: "company.manage_team",
        label: "Manage people",
        description: "Invite people, change roles and access, disable accounts.",
      },
      {
        key: "company.manage_settings",
        label: "Manage company settings",
        description: "Edit the company profile, logo, and billing setup.",
      },
      {
        key: "client_portal.manage",
        label: "Manage client access",
        description: "Give clients read-only access to their project, or take it away.",
      },
    ],
  },
];

export const ALL_CAPABILITY_KEYS: CapabilityKey[] = CAPABILITY_GROUPS.flatMap((group) =>
  group.items.map((item) => item.key),
);

const FULL_SET: CapabilitySet = Object.fromEntries(
  ALL_CAPABILITY_KEYS.map((key) => [key, true]),
) as CapabilitySet;

// Mirrors public.role_preset_capabilities() exactly. Choosing a role preset
// in the UI fills the checkboxes with this set.
export const ROLE_PRESETS: Record<AccountRole, CapabilitySet> = {
  owner: { ...FULL_SET },
  admin: { ...FULL_SET },
  // Founder decision: executives see everything including financials, edit
  // nothing.
  executive: {
    "projects.view_assigned": true,
    "projects.view_all": true,
    "financials.view": true,
  },
  // Founder decision: PMs default to ASSIGNED projects; "Access all company
  // projects" is the explicit checkbox for broader PMs.
  project_manager: {
    "projects.view_assigned": true,
    "projects.manage": true,
    "financials.view": true,
    "billing.manage": true,
    "estimating.write": true,
    "schedule.manage": true,
    "crm.manage": true,
    "client_portal.manage": true,
  },
  member: {
    "projects.view_assigned": true,
    "financials.view": true,
    "estimating.write": true,
    "crm.manage": true,
  },
  // Founder decision: viewers are read-only on assigned projects, no
  // financials.
  viewer: {
    "projects.view_assigned": true,
  },
};

// Mirrors the seed in 20260703070000_roles_capabilities_foundation.sql: what
// an EXISTING membership row was given at cutover, i.e. what the row's role
// actually granted before capabilities existed. Also used as the in-app
// fallback for rows the migration has not reached yet (pre-apply deploys).
export function seedCapabilitiesForRole(role: AccountRole): CapabilitySet {
  if (role === "owner" || role === "admin" || role === "executive") {
    return { ...FULL_SET };
  }
  if (role === "project_manager") {
    return { ...ROLE_PRESETS.project_manager, "projects.view_all": true };
  }
  return { ...ROLE_PRESETS[role] };
}

export function normalizeCapabilities(value: unknown): CapabilitySet {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: CapabilitySet = {};
  for (const key of ALL_CAPABILITY_KEYS) {
    if ((value as Record<string, unknown>)[key] === true) result[key] = true;
  }
  return result;
}

export function hasCapability(capabilities: CapabilitySet, key: CapabilityKey): boolean {
  return capabilities[key] === true;
}

export function capabilitySetsEqual(a: CapabilitySet, b: CapabilitySet): boolean {
  return ALL_CAPABILITY_KEYS.every((key) => (a[key] === true) === (b[key] === true));
}

export function matchesPreset(capabilities: CapabilitySet, role: AccountRole): boolean {
  return capabilitySetsEqual(capabilities, ROLE_PRESETS[role]);
}

export const ROLE_LABELS: Record<AccountRole, string> = {
  owner: "Owner",
  admin: "Admin",
  executive: "Executive",
  project_manager: "Project manager",
  member: "Company member",
  viewer: "Viewer",
};

// Display label for a member: the clean preset name when the checkboxes match
// the preset, otherwise "Custom (based on <preset>)".
export function accessLabelForMember(role: AccountRole, capabilities: CapabilitySet): string {
  const roleLabel = ROLE_LABELS[role] ?? role;
  return matchesPreset(capabilities, role) ? roleLabel : `Custom (based on ${roleLabel})`;
}
