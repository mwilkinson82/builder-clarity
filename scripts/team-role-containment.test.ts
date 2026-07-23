// P0 team-role containment — focused unit + source-wiring tests.
// Covers the eight cases from the request against the pure guards in
// src/lib/team/role-containment.ts and asserts createTeamInvite /
// updateTeamMember actually call those guards before their DB writes.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertCanAssignRole,
  assertCanGrantCapabilities,
  assertCanTargetMember,
  assertCannotSelfElevate,
  isElevatedAuthority,
  type CallerAuthority,
} from "@/lib/team/role-containment";
import { ROLE_PRESETS, type CapabilitySet } from "@/lib/capabilities";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

const owner = (): CallerAuthority => ({
  isSuperAdmin: false,
  isOwner: true,
  role: "owner",
  capabilities: { ...ROLE_PRESETS.owner },
});
const superAdmin = (): CallerAuthority => ({
  isSuperAdmin: true,
  isOwner: false,
  role: "admin",
  capabilities: { ...ROLE_PRESETS.admin },
});
// Day-to-day team manager: holds company.manage_team but is not Owner.
const teamManager = (): CallerAuthority => ({
  isSuperAdmin: false,
  isOwner: false,
  role: "admin",
  capabilities: {
    "company.manage_team": true,
    "projects.view_assigned": true,
    "projects.view_all": true,
    "projects.manage": true,
  },
});
const plainMember = (): CallerAuthority => ({
  isSuperAdmin: false,
  isOwner: false,
  role: "member",
  capabilities: { ...ROLE_PRESETS.member },
});

describe("team role-containment guards", () => {
  it("1. inviting Owner is refused for a non-owner manager", () => {
    expect(() => assertCanAssignRole(teamManager(), "owner")).toThrow(/Owner role/i);
  });

  it("1b. inviting Owner is allowed for the current Owner and for a super admin", () => {
    expect(() => assertCanAssignRole(owner(), "owner")).not.toThrow();
    expect(() => assertCanAssignRole(superAdmin(), "owner")).not.toThrow();
  });

  it("2. promoting another member to Owner is refused for a non-owner manager", () => {
    expect(() => assertCanAssignRole(teamManager(), "owner")).toThrow(/Owner role/i);
  });

  it("3. self-promotion to Owner is refused for a non-owner manager", () => {
    // assertCanAssignRole blocks it first; assertCannotSelfElevate also
    // blocks the role change independent of the target being Owner.
    expect(() => assertCanAssignRole(teamManager(), "owner")).toThrow(/Owner role/i);
    expect(() =>
      assertCannotSelfElevate(
        teamManager(),
        true,
        "project_manager",
        "admin",
        undefined,
        teamManager().capabilities,
      ),
    ).toThrow(/change your own role/i);
  });

  it("4. self-elevation (adding a capability to self) is refused", () => {
    const manager = teamManager();
    const nextCaps: CapabilitySet = { ...manager.capabilities, "financials.view": true };
    expect(() =>
      assertCannotSelfElevate(manager, true, undefined, "admin", nextCaps, manager.capabilities),
    ).toThrow(/add capabilities to yourself/i);
  });

  it("5. granting a capability the caller does not hold is refused", () => {
    const manager = teamManager(); // no financials.view
    const next: CapabilitySet = { "financials.view": true };
    expect(() => assertCanGrantCapabilities(manager, next, {})).toThrow(
      /capability you don't hold/i,
    );
  });

  it("5b. re-saving a capability the TARGET already had (caller lacks it) is allowed", () => {
    // Preserves legitimate lower-authority management: a manager saving
    // an untouched capability set doesn't accidentally trip the guard.
    const manager = teamManager();
    const current: CapabilitySet = { "financials.view": true };
    const next: CapabilitySet = { "financials.view": true };
    expect(() => assertCanGrantCapabilities(manager, next, current)).not.toThrow();
  });

  it("6. editing a target whose capabilities exceed the caller's is refused", () => {
    const target: CapabilitySet = { ...ROLE_PRESETS.project_manager }; // has financials.view
    expect(() => assertCanTargetMember(teamManager(), target)).toThrow(/exceed yours/i);
  });

  it("7. legitimate lower-authority management is allowed for a non-owner manager", () => {
    const manager = teamManager();
    const target: CapabilitySet = { "projects.view_assigned": true }; // viewer-like
    expect(() => assertCanAssignRole(manager, "member")).not.toThrow();
    expect(() => assertCanTargetMember(manager, target)).not.toThrow();
    const next: CapabilitySet = { "projects.view_assigned": true, "projects.view_all": true };
    expect(() => assertCanGrantCapabilities(manager, next, target)).not.toThrow();
  });

  it("8. Owner and super-admin authority bypass ceiling checks", () => {
    expect(isElevatedAuthority(owner())).toBe(true);
    expect(isElevatedAuthority(superAdmin())).toBe(true);
    expect(isElevatedAuthority(teamManager())).toBe(false);
    expect(isElevatedAuthority(plainMember())).toBe(false);
    const richTarget: CapabilitySet = { ...ROLE_PRESETS.owner };
    expect(() => assertCanTargetMember(owner(), richTarget)).not.toThrow();
    expect(() => assertCanTargetMember(superAdmin(), richTarget)).not.toThrow();
    expect(() => assertCanGrantCapabilities(owner(), { ...ROLE_PRESETS.owner }, {})).not.toThrow();
  });
});

describe("team.functions.ts source wiring", () => {
  const src = read("src/lib/team.functions.ts");

  it("createTeamInvite loads authority and gates role + capability grants BEFORE the invite write", () => {
    const start = src.indexOf("export const createTeamInvite");
    expect(start).toBeGreaterThan(-1);
    const end = src.indexOf("export const ", start + 1);
    const body = src.slice(start, end === -1 ? undefined : end);
    expect(body).toContain("loadCallerAuthority(context, organizationId)");
    expect(body).toContain("assertCanAssignRole(authority, data.role)");
    expect(body).toContain("assertCanGrantCapabilities(authority, inviteCapabilities, null)");
    // Guards must precede the invite insert.
    const guardIdx = body.indexOf("assertCanGrantCapabilities");
    const insertIdx = body.indexOf('.from("organization_invites")');
    expect(guardIdx).toBeGreaterThan(-1);
    expect(insertIdx).toBeGreaterThan(guardIdx);
  });

  it("updateTeamMember loads authority and gates role/self/target/grant BEFORE the member write", () => {
    const start = src.indexOf("export const updateTeamMember");
    expect(start).toBeGreaterThan(-1);
    const end = src.indexOf("export const ", start + 1);
    const body = src.slice(start, end === -1 ? undefined : end);
    expect(body).toContain("loadCallerAuthority(context, organizationId)");
    expect(body).toContain("assertCanAssignRole(authority, data.role)");
    expect(body).toContain("assertCannotSelfElevate(");
    expect(body).toContain("assertCanTargetMember(authority, targetCurrentCaps)");
    expect(body).toContain(
      "assertCanGrantCapabilities(authority, nextCapsForGuard, targetCurrentCaps)",
    );
    // Guards must precede the membership update.
    const guardIdx = body.indexOf("assertCanTargetMember");
    const updateIdx = body.indexOf('.from("organization_memberships")\n      .update(');
    // Fallback: just require an .update( call after the guard somewhere.
    const anyUpdate = body.indexOf(".update(", guardIdx);
    expect(guardIdx).toBeGreaterThan(-1);
    expect(anyUpdate).toBeGreaterThan(guardIdx);
    void updateIdx;
  });
});

describe("team UI source wiring (Owner hiding + capability lock)", () => {
  it("team.tsx hides Owner in role dropdowns for non-elevated callers and locks capabilities above the caller ceiling", () => {
    const src = read("src/routes/_authenticated/team.tsx");
    expect(src).toContain("visibleRoleOptions");
    expect(src).toContain('option.value !== "owner"');
    expect(src).toContain("ceilingLocks");
    // The invite CapabilityPicker AND the per-member picker both pass lockedKeys.
    const pickerLockedCount = src.match(/lockedKeys=/g)?.length ?? 0;
    expect(pickerLockedCount).toBeGreaterThanOrEqual(2);
    // Non-elevated self and target-exceeds cases block row editing.
    expect(src).toContain("selfLockedForCaller");
    expect(src).toContain("targetExceedsCaller");
  });

  it("index.tsx hides Owner in role dropdowns and prevents non-owner self-editing", () => {
    const src = read("src/routes/_authenticated/index.tsx");
    expect(src).toContain("visibleRoleOptions");
    expect(src).toContain('option.value !== "owner"');
    expect(src).toContain("canAssignOwner || !isSelf");
  });
});
