// Behavioral vitest for the magic-link handler (P0 finding 1).
//
// The old regex/source tests still guard call-site shape. These tests
// INVOKE handleMagicLinkRequest with spies and assert that the
// authorization gate runs BEFORE any provisioning / email side effect —
// createAuthUser, generateMagicLink, insertEmailSendLog, and sendEmail
// must all remain at zero calls for every rejection path an invite
// context can produce.

import { describe, expect, it, vi } from "vitest";
import {
  handleMagicLinkRequest,
  type MagicLinkDeps,
} from "@/lib/auth/magic-link-handler";

function buildDeps(overrides: Partial<MagicLinkDeps> = {}): MagicLinkDeps {
  return {
    now: () => 1_700_000_000_000,
    randomUUID: () => "11111111-1111-1111-1111-111111111111",
    isProd: false,
    apiKey: "test-key",
    supabaseUrl: "http://localhost:54321",
    supabasePublishableKey: "pub",
    resolveRedirect: () => ({
      ok: true,
      redirectTo: "http://localhost:8080/auth/callback",
    }),
    getAuthUserFromBearer: vi.fn(async () => ({ user: { id: "user-1" }, error: null })),
    fetchInviteById: vi.fn(async () => null),
    callerHasManageTeam: vi.fn(async () => false),
    findRecentSend: vi.fn(async () => null),
    createAuthUser: vi.fn(async () => ({ error: null })),
    generateMagicLink: vi.fn(async () => ({ hashedToken: "hash", error: null })),
    insertEmailSendLog: vi.fn(async () => {}),
    updateEmailSendLogStatus: vi.fn(async () => {}),
    sendEmail: vi.fn(async () => {}),
    ...overrides,
  };
}

function expectNoSideEffects(deps: MagicLinkDeps) {
  expect(deps.findRecentSend).not.toHaveBeenCalled();
  expect(deps.createAuthUser).not.toHaveBeenCalled();
  expect(deps.generateMagicLink).not.toHaveBeenCalled();
  expect(deps.insertEmailSendLog).not.toHaveBeenCalled();
  expect(deps.sendEmail).not.toHaveBeenCalled();
}

const REQ_URL = "http://localhost:8080/api/auth/magic-link";

describe("magic-link handler — invite authorization gate", () => {
  it("A. company_invite without inviteId returns 400 and performs no side effects", async () => {
    const deps = buildDeps();
    const result = await handleMagicLinkRequest({
      requestUrl: REQ_URL,
      body: { email: "invitee@example.com", context: "company_invite" },
      authorizationHeader: "Bearer good",
      deps,
    });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
    expectNoSideEffects(deps);
  });

  it("B. invite context without Bearer returns 401 and performs no side effects", async () => {
    const deps = buildDeps();
    const result = await handleMagicLinkRequest({
      requestUrl: REQ_URL,
      body: {
        email: "invitee@example.com",
        context: "company_invite",
        inviteId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      },
      authorizationHeader: null,
      deps,
    });
    expect(result.status).toBe(401);
    expectNoSideEffects(deps);
    expect(deps.getAuthUserFromBearer).not.toHaveBeenCalled();
  });

  it("C. invalid bearer session returns 401 and performs no side effects", async () => {
    const deps = buildDeps({
      getAuthUserFromBearer: vi.fn(async () => ({ user: null, error: { code: "bad" } })),
    });
    const result = await handleMagicLinkRequest({
      requestUrl: REQ_URL,
      body: {
        email: "invitee@example.com",
        context: "company_invite",
        inviteId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      },
      authorizationHeader: "Bearer bad",
      deps,
    });
    expect(result.status).toBe(401);
    expectNoSideEffects(deps);
  });

  it("D. missing invite row returns 409 and performs no side effects", async () => {
    const deps = buildDeps({ fetchInviteById: vi.fn(async () => null) });
    const result = await handleMagicLinkRequest({
      requestUrl: REQ_URL,
      body: {
        email: "invitee@example.com",
        context: "company_invite",
        inviteId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      },
      authorizationHeader: "Bearer good",
      deps,
    });
    expect(result.status).toBe(409);
    expectNoSideEffects(deps);
  });

  it("E. mismatched invite email returns 409 and performs no side effects", async () => {
    const deps = buildDeps({
      fetchInviteById: vi.fn(async () => ({
        id: "inv-1",
        organization_id: "org-1",
        email: "different@example.com",
        status: "pending",
        expires_at: new Date(1_700_000_100_000).toISOString(),
        invited_by: "user-1",
        role: "member",
      })),
    });
    const result = await handleMagicLinkRequest({
      requestUrl: REQ_URL,
      body: {
        email: "invitee@example.com",
        context: "company_invite",
        inviteId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      },
      authorizationHeader: "Bearer good",
      deps,
    });
    expect(result.status).toBe(409);
    expectNoSideEffects(deps);
  });

  it("F. expired invite returns 409 and performs no side effects", async () => {
    const deps = buildDeps({
      fetchInviteById: vi.fn(async () => ({
        id: "inv-1",
        organization_id: "org-1",
        email: "invitee@example.com",
        status: "pending",
        expires_at: new Date(1_600_000_000_000).toISOString(),
        invited_by: "user-1",
        role: "member",
      })),
    });
    const result = await handleMagicLinkRequest({
      requestUrl: REQ_URL,
      body: {
        email: "invitee@example.com",
        context: "company_invite",
        inviteId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      },
      authorizationHeader: "Bearer good",
      deps,
    });
    expect(result.status).toBe(409);
    expectNoSideEffects(deps);
  });

  it("G. unauthorized caller (not inviter, no manage_team) returns 403 and performs no side effects", async () => {
    const deps = buildDeps({
      fetchInviteById: vi.fn(async () => ({
        id: "inv-1",
        organization_id: "org-1",
        email: "invitee@example.com",
        status: "pending",
        expires_at: new Date(1_700_000_100_000).toISOString(),
        invited_by: "someone-else",
        role: "member",
      })),
      callerHasManageTeam: vi.fn(async () => false),
    });
    const result = await handleMagicLinkRequest({
      requestUrl: REQ_URL,
      body: {
        email: "invitee@example.com",
        context: "company_invite",
        inviteId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      },
      authorizationHeader: "Bearer good",
      deps,
    });
    expect(result.status).toBe(403);
    expectNoSideEffects(deps);
  });

  it("H. authorized caller (invite.invited_by = caller) proceeds and sends", async () => {
    const deps = buildDeps({
      fetchInviteById: vi.fn(async () => ({
        id: "inv-1",
        organization_id: "org-1",
        email: "invitee@example.com",
        status: "pending",
        expires_at: new Date(1_700_000_100_000).toISOString(),
        invited_by: "user-1",
        role: "member",
      })),
    });
    const result = await handleMagicLinkRequest({
      requestUrl: REQ_URL,
      body: {
        email: "invitee@example.com",
        context: "company_invite",
        inviteId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      },
      authorizationHeader: "Bearer good",
      deps,
    });
    expect(result.ok).toBe(true);
    expect(deps.createAuthUser).toHaveBeenCalledTimes(1);
    expect(deps.generateMagicLink).toHaveBeenCalledTimes(1);
    expect(deps.insertEmailSendLog).toHaveBeenCalledTimes(1);
    expect(deps.sendEmail).toHaveBeenCalledTimes(1);
  });

  it("I. login context never accepts inviteId path and never calls createAuthUser", async () => {
    const deps = buildDeps();
    const result = await handleMagicLinkRequest({
      requestUrl: REQ_URL,
      body: { email: "user@example.com", context: "login" },
      authorizationHeader: null,
      deps,
    });
    expect(result.ok).toBe(true);
    expect(deps.getAuthUserFromBearer).not.toHaveBeenCalled();
    expect(deps.fetchInviteById).not.toHaveBeenCalled();
    expect(deps.createAuthUser).not.toHaveBeenCalled();
    expect(deps.sendEmail).toHaveBeenCalledTimes(1);
  });

  it("J. client_portal context never calls createAuthUser", async () => {
    const deps = buildDeps();
    const result = await handleMagicLinkRequest({
      requestUrl: REQ_URL,
      body: { email: "client@example.com", context: "client_portal" },
      authorizationHeader: null,
      deps,
    });
    expect(result.ok).toBe(true);
    expect(deps.createAuthUser).not.toHaveBeenCalled();
    expect(deps.sendEmail).toHaveBeenCalledTimes(1);
  });

  it("K. recent-send shortcut only runs after the invite gate passes", async () => {
    const deps = buildDeps({
      fetchInviteById: vi.fn(async () => null),
      findRecentSend: vi.fn(async () => ({ id: "log-1", status: "sent" })),
    });
    const result = await handleMagicLinkRequest({
      requestUrl: REQ_URL,
      body: {
        email: "invitee@example.com",
        context: "company_invite",
        inviteId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      },
      authorizationHeader: "Bearer good",
      deps,
    });
    expect(result.status).toBe(409);
    expect(deps.findRecentSend).not.toHaveBeenCalled();
  });

  it("L. non-duplicate createUser error aborts before generateLink/email", async () => {
    const deps = buildDeps({
      fetchInviteById: vi.fn(async () => ({
        id: "inv-1",
        organization_id: "org-1",
        email: "invitee@example.com",
        status: "pending",
        expires_at: new Date(1_700_000_100_000).toISOString(),
        invited_by: "user-1",
        role: "member",
      })),
      createAuthUser: vi.fn(async () => ({ error: { message: "database is on fire" } })),
    });
    const result = await handleMagicLinkRequest({
      requestUrl: REQ_URL,
      body: {
        email: "invitee@example.com",
        context: "company_invite",
        inviteId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      },
      authorizationHeader: "Bearer good",
      deps,
    });
    expect(result.ok).toBe(false);
    expect(deps.generateMagicLink).not.toHaveBeenCalled();
    expect(deps.sendEmail).not.toHaveBeenCalled();
  });

  it("M. bearer token never appears in the response body or logs", async () => {
    const logs: string[] = [];
    const deps = buildDeps({
      logError: (msg, meta) => logs.push(msg + " " + JSON.stringify(meta ?? {})),
      logInfo: (msg, meta) => logs.push(msg + " " + JSON.stringify(meta ?? {})),
      getAuthUserFromBearer: vi.fn(async () => {
        throw new Error("boom");
      }),
    });
    const bearer = "super-secret-bearer-value";
    const result = await handleMagicLinkRequest({
      requestUrl: REQ_URL,
      body: {
        email: "invitee@example.com",
        context: "company_invite",
        inviteId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      },
      authorizationHeader: `Bearer ${bearer}`,
      deps,
    });
    expect(JSON.stringify(result.body)).not.toContain(bearer);
    expect(logs.join("\n")).not.toContain(bearer);
  });
});
