#!/usr/bin/env node
// Roles Phase 2 behavior-preservation proof.
//
// Asserts that the seeded capabilities produce IDENTICAL access to the
// pre-migration role behavior for every account_role across the full grid of
// (org membership status x project assignment x project-role x project
// ownership), for each rewritten helper:
//   can_read_project, can_manage_project, can_manage_org.
//
// The two deliberate, documented exceptions (stated in the migration header
// and the PR) are asserted EXPLICITLY — any other divergence fails the run:
//   1. project_manager gains read on unassigned company projects
//      (seeded projects.view_all closes audit Finding 1 by widening read to
//      match the write access PMs already had).
//   2. a DISABLED company member no longer keeps access through a leftover
//      active project assignment (the old helpers skipped the org-status
//      check on the assignment branch).
//
// Also pins the migration files and the TS mirror so the SQL presets, the
// seed, and src/lib/capabilities.ts cannot drift apart silently.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  ALL_CAPABILITY_KEYS,
  ROLE_PRESETS,
  seedCapabilitiesForRole,
  type AccountRole,
  type CapabilityKey,
  type CapabilitySet,
} from "../src/lib/capabilities.ts";

let passed = 0;
const fail = (message: string): never => {
  console.error(`✗ ${message}`);
  process.exit(1);
};
const ok = (message: string) => {
  passed += 1;
  console.log(`✓ ${message}`);
};

// --- scenario grid ----------------------------------------------------------

const ROLES: AccountRole[] = ["owner", "admin", "executive", "project_manager", "member", "viewer"];
type OrgStatus = "active" | "disabled" | "none";
type ProjectRole = "none" | "viewer" | "editor" | "manager" | "owner";
const ORG_STATUSES: OrgStatus[] = ["active", "disabled", "none"];
const PROJECT_ROLES: ProjectRole[] = ["none", "viewer", "editor", "manager", "owner"];

interface Scenario {
  role: AccountRole;
  orgStatus: OrgStatus;
  projectRole: ProjectRole;
  isProjectOwner: boolean;
}

const EDITOR_ROLES: ProjectRole[] = ["owner", "manager", "editor"];

// --- OLD behavior: the role-label helpers as they stood before this phase ---
// (final definitions from 20260623161515, verbatim logic; see docs/ROLES.md
// Phase 1 appendix)

function oldCanReadProject(s: Scenario): boolean {
  if (s.isProjectOwner) return true;
  if (s.orgStatus === "active" && ["owner", "admin", "executive"].includes(s.role)) return true;
  // Old assignment branch: any active project membership, NO org-status check.
  return s.projectRole !== "none";
}

function oldCanManageProject(s: Scenario): boolean {
  if (s.isProjectOwner) return true;
  if (
    s.orgStatus === "active" &&
    ["owner", "admin", "executive", "project_manager"].includes(s.role)
  ) {
    return true;
  }
  // Old assignment branch: project editor role, NO org-status check.
  return EDITOR_ROLES.includes(s.projectRole);
}

function oldCanManageOrg(s: Scenario): boolean {
  return s.orgStatus === "active" && ["owner", "admin", "executive"].includes(s.role);
}

// --- NEW behavior: capability-reading helpers over the SEEDED sets ----------
// (mirrors 20260703070100_roles_capability_enforcement.sql)

function hasCap(s: Scenario, caps: CapabilitySet, key: CapabilityKey): boolean {
  return s.orgStatus === "active" && caps[key] === true;
}

function newCanReadProject(s: Scenario, caps: CapabilitySet): boolean {
  if (s.isProjectOwner) return true;
  if (hasCap(s, caps, "projects.view_all")) return true;
  return hasCap(s, caps, "projects.view_assigned") && s.projectRole !== "none";
}

function newCanManageProject(s: Scenario, caps: CapabilitySet): boolean {
  if (s.isProjectOwner) return true;
  if (
    hasCap(s, caps, "projects.manage") &&
    (hasCap(s, caps, "projects.view_all") || s.projectRole !== "none")
  ) {
    return true;
  }
  return hasCap(s, caps, "projects.view_assigned") && EDITOR_ROLES.includes(s.projectRole);
}

function newCanManageOrg(s: Scenario, caps: CapabilitySet): boolean {
  return hasCap(s, caps, "company.manage_team") || hasCap(s, caps, "company.manage_settings");
}

// --- the documented exceptions ----------------------------------------------

function isFindingOneWidening(s: Scenario, helper: string): boolean {
  // PM gains read on unassigned projects it could already write to.
  return (
    helper === "can_read_project" &&
    s.role === "project_manager" &&
    s.orgStatus === "active" &&
    s.projectRole === "none" &&
    !s.isProjectOwner
  );
}

function isDisabledMemberLockout(s: Scenario, helper: string): boolean {
  // Old assignment branches ignored org status; new ones require an ACTIVE
  // membership row to carry the capability.
  if (s.orgStatus === "active" || s.isProjectOwner) return false;
  if (helper === "can_read_project") return s.projectRole !== "none";
  if (helper === "can_manage_project") return EDITOR_ROLES.includes(s.projectRole);
  return false;
}

// --- run the grid -------------------------------------------------------------

let comparisons = 0;
let wideningHits = 0;
let lockoutHits = 0;

for (const role of ROLES) {
  const caps = seedCapabilitiesForRole(role);
  for (const orgStatus of ORG_STATUSES) {
    for (const projectRole of PROJECT_ROLES) {
      for (const isProjectOwner of [false, true]) {
        const s: Scenario = { role, orgStatus, projectRole, isProjectOwner };
        const checks: Array<[string, boolean, boolean]> = [
          ["can_read_project", oldCanReadProject(s), newCanReadProject(s, caps)],
          ["can_manage_project", oldCanManageProject(s), newCanManageProject(s, caps)],
          ["can_manage_org", oldCanManageOrg(s), newCanManageOrg(s, caps)],
        ];
        for (const [helper, oldResult, newResult] of checks) {
          comparisons += 1;
          if (oldResult === newResult) continue;
          if (newResult && !oldResult && isFindingOneWidening(s, helper)) {
            wideningHits += 1;
            continue;
          }
          if (oldResult && !newResult && isDisabledMemberLockout(s, helper)) {
            lockoutHits += 1;
            continue;
          }
          fail(
            `${helper} diverges outside the documented exceptions for ${JSON.stringify(s)}: old=${oldResult} new=${newResult}`,
          );
        }
      }
    }
  }
}

assert.ok(comparisons > 300, "grid actually exercised");
ok(
  `seeded capabilities reproduce pre-migration role behavior across ${comparisons} scenario checks`,
);
assert.ok(wideningHits > 0, "Finding-1 widening exercised by the grid");
ok(
  `documented exception 1 (PM read widening) occurs exactly where declared (${wideningHits} cells)`,
);
assert.ok(lockoutHits > 0, "disabled-member lockout exercised by the grid");
ok(
  `documented exception 2 (disabled members lose leftover assignment access) occurs exactly where declared (${lockoutHits} cells)`,
);

// Executives keep full access at cutover (seed), while the go-forward preset
// is view-only — the two must differ or the founder decision was lost.
{
  const seed = seedCapabilitiesForRole("executive");
  assert.equal(seed["projects.manage"], true, "existing executives keep manage at cutover");
  assert.equal(
    ROLE_PRESETS.executive["projects.manage"],
    undefined,
    "the Executive PRESET is view-only",
  );
  assert.equal(ROLE_PRESETS.executive["financials.view"], true);
  assert.equal(
    ROLE_PRESETS.viewer["financials.view"],
    undefined,
    "Viewer preset has no financials",
  );
  assert.equal(
    ROLE_PRESETS.project_manager["projects.view_all"],
    undefined,
    "PM PRESET is assigned-only; view_all is the explicit broader-PM checkbox",
  );
  ok(
    "preset definitions encode the founder decisions (executive view-only, viewer no financials, PM assigned-first)",
  );
}

// --- pin the SQL so it cannot drift from the TS mirror -------------------------

const foundation = await readFile(
  new URL(
    "../supabase/migrations/20260703070000_roles_capabilities_foundation.sql",
    import.meta.url,
  ),
  "utf8",
);
const enforcement = await readFile(
  new URL(
    "../supabase/migrations/20260703070100_roles_capability_enforcement.sql",
    import.meta.url,
  ),
  "utf8",
);

for (const key of ALL_CAPABILITY_KEYS) {
  assert.ok(foundation.includes(`'${key}'`), `foundation migration defines capability ${key}`);
}
ok("foundation migration covers all 12 capability keys");

// Every TS preset flag must appear inside the matching SQL preset branch.
// Comment lines are stripped first so branch boundaries are unambiguous.
const foundationCode = foundation
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");
const sqlPresetBranch = (role: AccountRole): string => {
  const match = foundationCode.match(
    new RegExp(`WHEN '${role}' THEN jsonb_build_object\\(([\\s\\S]*?)\\)\\s*(?:WHEN|END)`),
  );
  if (!match) fail(`foundation migration is missing the ${role} preset branch`);
  return match![1];
};
for (const role of ROLES) {
  const branch = sqlPresetBranch(role);
  const sqlKeys = ALL_CAPABILITY_KEYS.filter((key) => branch.includes(`'${key}'`));
  const tsKeys = ALL_CAPABILITY_KEYS.filter((key) => ROLE_PRESETS[role][key] === true);
  assert.deepEqual(sqlKeys.sort(), tsKeys.sort(), `SQL and TS presets agree for ${role}`);
}
ok("SQL role_preset_capabilities matches src/lib/capabilities.ts for every role");

for (const pin of [
  /ADD COLUMN IF NOT EXISTS capabilities jsonb NOT NULL DEFAULT '\{\}'::jsonb/,
  /tg_membership_capabilities_default/,
  /\|\| jsonb_build_object\('projects\.view_all', true\)/,
  /WHERE capabilities = '\{\}'::jsonb/,
]) {
  assert.ok(pin.test(foundation), `foundation migration pins ${pin}`);
}
ok("foundation migration seeds behavior-preserving capabilities behind an idempotent guard");

for (const pin of [
  /has_org_capability\(p_org_id uuid, p_capability text\)/,
  /m\.capabilities @> jsonb_build_object\(p_capability, true\)/,
  /"company\.manage_team": true/,
  /"company\.manage_settings": true/,
  /has_org_capability\(p\.organization_id, 'projects\.view_all'\)/,
  /has_org_capability\(p\.organization_id, 'projects\.view_assigned'\)/,
  /has_org_capability\(p\.organization_id, 'projects\.manage'\)/,
  /can_view_financials/,
  /NULLIF\(v_invite\.capabilities, '\{\}'::jsonb\)/,
  /NOTIFY pgrst, 'reload schema'/,
]) {
  assert.ok(pin.test(enforcement), `enforcement migration pins ${pin}`);
}
ok(
  "enforcement migration rewrites the helpers against capabilities and propagates invite capabilities",
);

assert.ok(
  !/CREATE POLICY|DROP POLICY|ALTER POLICY/i.test(foundation + enforcement),
  "Phase 2 migrations must not touch any RLS policy (helpers keep their signatures)",
);
ok("no RLS policy is created, dropped, or altered — existing policies stand unchanged");

console.log(`\nRoles capability parity: ${passed} checks passed.`);
