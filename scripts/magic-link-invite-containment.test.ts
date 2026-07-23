import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const apiRoute = readFileSync(
  resolve(process.cwd(), "src/routes/api/auth/magic-link.ts"),
  "utf8",
);
// P0 refactor: the authorization gate + provisioning body now lives in the
// injectable handler so behavioral vitests can invoke it with spies. Source
// assertions inspect the handler alongside the thin transport route.
const handler = readFileSync(
  resolve(process.cwd(), "src/lib/auth/magic-link-handler.ts"),
  "utf8",
);
const clientHelper = readFileSync(
  resolve(process.cwd(), "src/lib/auth/magic-link.ts"),
  "utf8",
);
const teamCaller = readFileSync(
  resolve(process.cwd(), "src/routes/_authenticated/team.tsx"),
  "utf8",
);
const portfolioCaller = readFileSync(
  resolve(process.cwd(), "src/routes/_authenticated/index.tsx"),
  "utf8",
);

// P0 finding 1: invite-context provisioning must be bound to a proven, exact
// pending invite the authenticated caller is authorized to send. These
// source-level assertions guard the containment structure so that any future
// refactor cannot silently reopen the "context alone confers provisioning"
// path that caused the incident.

describe("magic-link invite-context containment — client helper", () => {
  it("requires inviteId on the input contract for invite contexts", () => {
    // Discriminated union: invite contexts REQUIRE inviteId at the type
    // layer, non-invite contexts never accept it.
    expect(clientHelper).toContain("InviteMagicLinkInput");
    expect(clientHelper).toMatch(/context:\s*"company_invite"\s*\|\s*"portfolio_invite";\s*\n\s*inviteId:\s*string;/);
    expect(clientHelper).toMatch(/INVITE_CONTEXTS[\s\S]*company_invite[\s\S]*portfolio_invite/);
    expect(clientHelper).toContain(
      "An invite id is required to send an invite magic link.",
    );
  });

  it("attaches the caller's bearer token only for invite contexts", () => {
    expect(clientHelper).toContain("supabase.auth.getSession()");
    expect(clientHelper).toMatch(/headers\.Authorization\s*=\s*`Bearer \$\{token\}`/);
    expect(clientHelper).toContain("You must be signed in to send an invite.");
  });
});

describe("magic-link invite-context containment — API route + handler", () => {
  it("requires an authenticated bearer session before any provisioning", () => {
    expect(handler).toContain("You must be signed in to send an invite.");
    expect(handler).toContain("getAuthUserFromBearer");
    // The invite gate MUST run BEFORE createUser / generateLink / email code.
    const gateIdx = handler.indexOf("Invite-context authorization gate");
    const createUserIdx = handler.indexOf("createAuthUser(");
    const generateLinkIdx = handler.indexOf("generateMagicLink(");
    const emailLogIdx = handler.indexOf("insertEmailSendLog(");
    const sendEmailIdx = handler.indexOf("sendEmail(");
    expect(gateIdx).toBeGreaterThan(0);
    for (const idx of [createUserIdx, generateLinkIdx, emailLogIdx, sendEmailIdx]) {
      expect(idx).toBeGreaterThan(gateIdx);
    }
  });

  it("looks up the exact invite row and verifies email/status/expiry", () => {
    // The route wires the fetchInviteById dependency to the exact
    // organization_invites row for parsed.data.inviteId.
    expect(apiRoute).toMatch(/\.from\(\s*"organization_invites"\s*\)/);
    expect(apiRoute).toMatch(/\.eq\(\s*"id"\s*,\s*inviteId\s*\)/);
    expect(handler).toContain("This invite belongs to a different email address.");
    expect(handler).toContain("This invitation is no longer pending.");
    expect(handler).toContain("This invitation has expired.");
    expect(handler).toContain("That invitation could not be found.");
  });

  it("verifies the caller is invited_by OR holds company.manage_team", () => {
    expect(handler).toContain("inviteRow.invited_by === callerId");
    expect(handler).toContain("callerHasManageTeam");
    expect(apiRoute).toContain('"has_org_capability"');
    expect(apiRoute).toContain('p_capability: "company.manage_team"');
    expect(handler).toContain(
      "You do not have permission to send this invitation.",
    );
  });

  it("does not derive provisioning from context alone", () => {
    // The invite gate returns before any of these side effects when the
    // authorization check fails; the string checks below prove the gate is
    // wired to fail-closed jsonError() returns.
    expect(handler).toMatch(/if \(!parsed\.data\.inviteId\) \{[\s\S]*?jsonError\(/);
    expect(handler).toMatch(/if \(!authorizationHeader\?\.startsWith\("Bearer "\)\) \{[\s\S]*?jsonError\(/);
  });

  it("keeps redirect allowlist and hashed-token confirmation intact", () => {
    expect(handler).toContain("resolveMagicLinkRedirect");
    expect(handler).toContain("buildMagicLinkConfirmationUrl");
    expect(apiRoute).toContain("hashed_token");
  });
});

describe("magic-link callers pass the exact created invite id", () => {
  it("Team screen forwards createTeamInvite result.invite.id", () => {
    expect(teamCaller).toMatch(
      /sendOverwatchMagicLink\(\{[\s\S]*?context:\s*"company_invite"[\s\S]*?inviteId:\s*[a-zA-Z0-9_.]+\.invite\.id/,
    );
  });

  it("Portfolio invite UI forwards createTeamInvite result.invite.id", () => {
    expect(portfolioCaller).toMatch(
      /sendOverwatchMagicLink\(\{[\s\S]*?context:\s*"portfolio_invite"[\s\S]*?inviteId:\s*[a-zA-Z0-9_.]+\.invite\.id/,
    );
  });
});
});
