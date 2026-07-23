// P0 team-role containment (Roles Phase 2+): the day-to-day
// company.manage_team holder is NOT the Owner. A non-owner team manager
// invites and edits within their own authority — they may not mint or
// promote Owners, edit themselves, grant capabilities they don't hold, or
// touch a member whose capabilities already exceed theirs.
//
// Rules enforced (mirrors the request):
//   1. Only a current active Owner or super admin may invite Owner or
//      promote anyone to Owner.
//   2. A non-owner team manager may not change their own role or add
//      capabilities to themselves. Removing their own company.manage_team
//      is blocked by the existing guard in updateTeamMember.
//   3. A non-owner may not grant capabilities they do not currently hold,
//      and may not modify a member whose effective capabilities exceed
//      theirs.
//
// The DB is the eventual authority (a maintenance-window RPC migration
// will re-target these writes); these guards give the app an early,
// plain-English refusal instead of a silent RLS bounce.

import {
  ALL_CAPABILITY_KEYS,
  type AccountRole,
  type CapabilitySet,
} from "@/lib/capabilities";

export interface CallerAuthority {
  isSuperAdmin: boolean;
  isOwner: boolean;
  role: AccountRole | null;
  capabilities: CapabilitySet;
}

/**
 * "Highest authority" bypass: current active Owner OR super admin. Only
 * these callers may mint Owners, promote to Owner, or edit a member whose
 * capabilities exceed the day-to-day manager ceiling.
 */
export function isElevatedAuthority(authority: CallerAuthority): boolean {
  return authority.isSuperAdmin || authority.isOwner;
}

export function assertCanAssignRole(
  authority: CallerAuthority,
  role: AccountRole | undefined,
): void {
  if (role !== "owner") return;
  if (isElevatedAuthority(authority)) return;
  throw new Error(
    "Only a current company Owner or Overwatch admin can assign the Owner role.",
  );
}

/**
 * Non-owners can't modify a member whose effective capabilities exceed
 * theirs — that member is above their authority ceiling.
 */
export function assertCanTargetMember(
  authority: CallerAuthority,
  targetCurrentCaps: CapabilitySet,
): void {
  if (isElevatedAuthority(authority)) return;
  for (const key of ALL_CAPABILITY_KEYS) {
    if (targetCurrentCaps[key] === true && authority.capabilities[key] !== true) {
      throw new Error(
        "You can't change this person's access — their capabilities exceed yours. Ask an Owner.",
      );
    }
  }
}

/**
 * Non-owners can't grant capabilities they don't hold themselves. Only
 * the newly-granted keys are checked against the caller's ceiling —
 * capabilities the target already had aren't being granted.
 */
export function assertCanGrantCapabilities(
  authority: CallerAuthority,
  nextCaps: CapabilitySet,
  currentCaps: CapabilitySet | null,
): void {
  if (isElevatedAuthority(authority)) return;
  for (const key of ALL_CAPABILITY_KEYS) {
    if (nextCaps[key] !== true) continue;
    if (currentCaps?.[key] === true) continue;
    if (authority.capabilities[key] !== true) {
      throw new Error(
        "You can't grant a capability you don't hold yourself.",
      );
    }
  }
}

/**
 * Self-elevation guard for non-owners: no self role change, no adding
 * capabilities to self. (Removing your own company.manage_team is blocked
 * by the existing guard in updateTeamMember.)
 */
export function assertCannotSelfElevate(
  authority: CallerAuthority,
  isSelf: boolean,
  nextRole: AccountRole | undefined,
  currentRole: AccountRole,
  nextCaps: CapabilitySet | undefined,
  currentCaps: CapabilitySet,
): void {
  if (!isSelf) return;
  if (isElevatedAuthority(authority)) return;
  if (nextRole && nextRole !== currentRole) {
    throw new Error("You can't change your own role.");
  }
  if (nextCaps) {
    for (const key of ALL_CAPABILITY_KEYS) {
      if (nextCaps[key] === true && currentCaps[key] !== true) {
        throw new Error("You can't add capabilities to yourself.");
      }
    }
  }
}
