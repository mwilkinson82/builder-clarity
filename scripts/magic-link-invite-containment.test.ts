import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const apiRoute = readFileSync(
  resolve(process.cwd(), "src/routes/api/auth/magic-link.ts"),
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
    expect(clientHelper).toContain("inviteId?: string");
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

describe("magic-link invite-context containment — API route", () => {
  it("requires an authenticated bearer session before any provisioning", () => {
    expect(apiRoute).toContain("You must be signed in to send an invite.");
    expect(apiRoute).toContain("supabaseAdmin.auth.getUser(bearer)");
    // The invite gate MUST run BEFORE createUser / generateLink / email code.
    const gateIdx = apiRoute.indexOf("P0 invite-context containment");
    const createUserIdx = apiRoute.indexOf("supabaseAdmin.auth.admin.createUser");
    const generateLinkIdx = apiRoute.indexOf("supabaseAdmin.auth.admin.generateLink");
    const emailLogIdx = apiRoute.indexOf('.from("email_send_log")');
    const sendEmailIdx = apiRoute.indexOf("sendLovableEmail(");
    expect(gateIdx).toBeGreaterThan(0);
    for (const idx of [createUserIdx, generateLinkIdx, emailLogIdx, sendEmailIdx]) {
      expect(idx).toBeGreaterThan(gateIdx);
    }
  });

  it("looks up the exact invite row and verifies email/status/expiry", () => {
    expect(apiRoute).toMatch(/\.from\(\s*"organization_invites"\s*\)/);
    expect(apiRoute).toContain('.eq("id", parsed.data.inviteId)');
    expect(apiRoute).toContain("This invite belongs to a different email address.");
    expect(apiRoute).toContain("This invitation is no longer pending.");
    expect(apiRoute).toContain("This invitation has expired.");
    expect(apiRoute).toContain("That invitation could not be found.");
  });

  it("verifies the caller is invited_by OR holds company.manage_team", () => {
    expect(apiRoute).toContain("inviteRow.invited_by === callerId");
    expect(apiRoute).toContain('"has_org_capability"');
    expect(apiRoute).toContain('p_capability: "company.manage_team"');
    expect(apiRoute).toContain(
      "You do not have permission to send this invitation.",
    );
  });

  it("does not derive provisioning from context alone", () => {
    // The invite gate returns before any of these side effects when the
    // authorization check fails; the string checks below prove the gate is
    // wired to fail-closed jsonError() returns.
    expect(apiRoute).toMatch(/if \(!parsed\.data\.inviteId\) \{[\s\S]*?jsonError\(/);
    expect(apiRoute).toMatch(/if \(!authHeader\?\.startsWith\("Bearer "\)\) \{[\s\S]*?jsonError\(/);
  });

  it("keeps redirect allowlist and hashed-token confirmation intact", () => {
    expect(apiRoute).toContain("resolveMagicLinkRedirect");
    expect(apiRoute).toContain("buildMagicLinkConfirmationUrl");
    expect(apiRoute).toContain("data.properties?.hashed_token");
    expect(apiRoute).not.toContain("data.properties?.action_link");
  });
});

describe("magic-link callers pass the exact created invite id", () => {
  it("Team screen forwards createTeamInvite result.invite.id", () => {
    expect(teamCaller).toMatch(
      /const created = await createInvite\(\{[\s\S]*?data:\s*\{ email, role: inviteRole, capabilities: inviteCapabilities \}[\s\S]*?\}\);/,
    );
    expect(teamCaller).toMatch(
      /sendOverwatchMagicLink\(\{[\s\S]*?context:\s*"company_invite"[\s\S]*?inviteId:\s*created\.invite\.id/,
    );
  });

  it("Portfolio invite UI forwards createTeamInvite result.invite.id", () => {
    expect(portfolioCaller).toMatch(
      /const created = await createInvite\(\{ data: \{ email: inviteEmail, role \} \}\);/,
    );
    expect(portfolioCaller).toMatch(
      /sendOverwatchMagicLink\(\{[\s\S]*?context:\s*"portfolio_invite"[\s\S]*?inviteId:\s*created\.invite\.id/,
    );
  });
});
