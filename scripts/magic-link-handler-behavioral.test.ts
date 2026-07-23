// Behavioral vitest for the magic-link handler (P0 corrections).
//
// Invokes handleMagicLinkRequest with spies and asserts:
//   - the invite / client_portal authorization gate runs BEFORE any
//     provisioning or email side effect;
//   - generateMagicLink is the SOLE auth-user creation boundary
//     (there is no separate createAuthUser step);
//   - documented Supabase duplicate-user codes are swallowed by CODE
//     (email_exists, user_already_exists) — never by message heuristics;
//   - login never generates a link or sends email for an unknown email
//     (fail-closed existing-user lookup);
//   - client_portal requires Bearer + exact clientAccessId + status not
//     revoked + caller currently holds client_portal.manage;
//   - failure paths preserve provider code in audit metadata but return
//     a generic client-safe message (no provider code/message leaks);
//   - bearer token never appears in the response body or logs.
//
// The migration that lands finalize_invite_acceptance is tracked and
// UNAPPLIED; see docs/RELEASE_GATE.md §6 for the apply checklist.

import { describe, expect, it, vi } from "vitest";
import {
  DUPLICATE_USER_CODES,
  handleMagicLinkRequest,
  type MagicLinkDeps,
} from "@/lib/auth/magic-link-handler";

const CLIENT_ACCESS_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";

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
    getAuthUserFromBearer: vi.fn(async () => ({
      user: { id: "user-1" },
      error: null,
    })),
    fetchInviteById: vi.fn(async () => null),
    callerHasManageTeam: vi.fn(async () => true),
    fetchClientAccessById: vi.fn(async () => null),
    callerHasClientAccessManagement: vi.fn(async () => true),
    lookupExistingAuthUser: vi.fn(async () => ({ id: "existing-user-1" })),
    findRecentSend: vi.fn(async () => null),
    generateMagicLink: vi.fn(async () => ({
      hashedToken: "hash",
      userId: "user-1",
      error: null,
    })),
    insertEmailSendLog: vi.fn(async () => {}),
    updateEmailSendLogStatus: vi.fn(async () => {}),
    updateEmailSendLogFailed: vi.fn(async () => {}),
    sendEmail: vi.fn(async () => {}),
    ...overrides,
  };
}

function expectNoSideEffects(deps: MagicLinkDeps) {
  expect(deps.findRecentSend).not.toHaveBeenCalled();
  expect(deps.generateMagicLink).not.toHaveBeenCalled();
  expect(deps.insertEmailSendLog).not.toHaveBeenCalled();
  expect(deps.sendEmail).not.toHaveBeenCalled();
}

const REQ_URL = "http://localhost:8080/api/auth/magic-link";
const INVITE_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const ORG_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

function goodInvite(overrides: Record<string, unknown> = {}) {
  return {
    id: INVITE_ID,
    organization_id: ORG_ID,
    email: "invitee@example.com",
    status: "pending",
    expires_at: new Date(1_700_000_100_000).toISOString(),
    invited_by: "user-1",
    role: "member",
    ...overrides,
  };
}

function goodClientAccess(overrides: Record<string, unknown> = {}) {
  return {
    id: CLIENT_ACCESS_ID,
    project_id: "dddddddd-dddd-dddd-dddd-dddddddddddd",
    organization_id: ORG_ID,
    email: "client@example.com",
    status: "pending",
    ...overrides,
  };
}

const inviteBody = {
  email: "invitee@example.com",
  context: "company_invite" as const,
  inviteId: INVITE_ID,
};

const clientPortalBody = {
  email: "client@example.com",
  context: "client_portal" as const,
  clientAccessId: CLIENT_ACCESS_ID,
};

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

  it("A2. non-invite context with inviteId is rejected at the runtime Zod layer", async () => {
    const deps = buildDeps();
    const result = await handleMagicLinkRequest({
      requestUrl: REQ_URL,
      body: { email: "user@example.com", context: "login", inviteId: INVITE_ID },
      authorizationHeader: null,
      deps,
    });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
    expect(result.body.success).toBe(false);
    expectNoSideEffects(deps);
    expect(deps.getAuthUserFromBearer).not.toHaveBeenCalled();
    expect(deps.fetchInviteById).not.toHaveBeenCalled();
  });

  it("B. invite context without Bearer returns 401 and performs no side effects", async () => {
    const deps = buildDeps();
    const result = await handleMagicLinkRequest({
      requestUrl: REQ_URL,
      body: inviteBody,
      authorizationHeader: null,
      deps,
    });
    expect(result.status).toBe(401);
    expectNoSideEffects(deps);
    expect(deps.getAuthUserFromBearer).not.toHaveBeenCalled();
  });

  it("C. invalid bearer session returns 401 and performs no side effects", async () => {
    const deps = buildDeps({
      getAuthUserFromBearer: vi.fn(async () => ({
        user: null,
        error: { code: "bad" },
      })),
    });
    const result = await handleMagicLinkRequest({
      requestUrl: REQ_URL,
      body: inviteBody,
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
      body: inviteBody,
      authorizationHeader: "Bearer good",
      deps,
    });
    expect(result.status).toBe(409);
    expectNoSideEffects(deps);
  });

  it("E. mismatched invite email returns 409 (case + whitespace normalized) and performs no side effects", async () => {
    const deps = buildDeps({
      fetchInviteById: vi.fn(async () => goodInvite({ email: "  DIFFERENT@example.com " })),
    });
    const result = await handleMagicLinkRequest({
      requestUrl: REQ_URL,
      body: inviteBody,
      authorizationHeader: "Bearer good",
      deps,
    });
    expect(result.status).toBe(409);
    expectNoSideEffects(deps);
  });

  it("E2. accepted invite returns 409 and performs no side effects", async () => {
    const deps = buildDeps({
      fetchInviteById: vi.fn(async () => goodInvite({ status: "accepted" })),
    });
    const result = await handleMagicLinkRequest({
      requestUrl: REQ_URL,
      body: inviteBody,
      authorizationHeader: "Bearer good",
      deps,
    });
    expect(result.status).toBe(409);
    expectNoSideEffects(deps);
  });

  it("E3. revoked invite returns 409 and performs no side effects", async () => {
    const deps = buildDeps({
      fetchInviteById: vi.fn(async () => goodInvite({ status: "revoked" })),
    });
    const result = await handleMagicLinkRequest({
      requestUrl: REQ_URL,
      body: inviteBody,
      authorizationHeader: "Bearer good",
      deps,
    });
    expect(result.status).toBe(409);
    expectNoSideEffects(deps);
  });

  it("F. expired invite returns 409 and performs no side effects", async () => {
    const deps = buildDeps({
      fetchInviteById: vi.fn(async () =>
        goodInvite({ expires_at: new Date(1_600_000_000_000).toISOString() }),
      ),
    });
    const result = await handleMagicLinkRequest({
      requestUrl: REQ_URL,
      body: inviteBody,
      authorizationHeader: "Bearer good",
      deps,
    });
    expect(result.status).toBe(409);
    expectNoSideEffects(deps);
  });

  it("F2. expiry == now() counts as expired (strict >) and performs no side effects", async () => {
    const nowMs = 1_700_000_000_000;
    const deps = buildDeps({
      now: () => nowMs,
      fetchInviteById: vi.fn(async () => goodInvite({ expires_at: new Date(nowMs).toISOString() })),
    });
    const result = await handleMagicLinkRequest({
      requestUrl: REQ_URL,
      body: inviteBody,
      authorizationHeader: "Bearer good",
      deps,
    });
    expect(result.status).toBe(409);
    expectNoSideEffects(deps);
  });

  it("G. invited_by mismatch returns 403 even if caller HAS manage_team — no side effects", async () => {
    const deps = buildDeps({
      fetchInviteById: vi.fn(async () => goodInvite({ invited_by: "someone-else" })),
      callerHasManageTeam: vi.fn(async () => true),
    });
    const result = await handleMagicLinkRequest({
      requestUrl: REQ_URL,
      body: inviteBody,
      authorizationHeader: "Bearer good",
      deps,
    });
    expect(result.status).toBe(403);
    // AND-gate: invited_by check happens first, so capability lookup
    // must not even fire.
    expect(deps.callerHasManageTeam).not.toHaveBeenCalled();
    expectNoSideEffects(deps);
  });

  it("G2. invited_by matches but caller LOST capability returns 403 — no side effects (demoted inviter)", async () => {
    const deps = buildDeps({
      fetchInviteById: vi.fn(async () => goodInvite()),
      callerHasManageTeam: vi.fn(async () => false),
    });
    const result = await handleMagicLinkRequest({
      requestUrl: REQ_URL,
      body: inviteBody,
      authorizationHeader: "Bearer good",
      deps,
    });
    expect(result.status).toBe(403);
    expect(deps.callerHasManageTeam).toHaveBeenCalledTimes(1);
    expectNoSideEffects(deps);
  });

  it("G3. capability lookup error returns 500 and performs no side effects", async () => {
    const deps = buildDeps({
      fetchInviteById: vi.fn(async () => goodInvite()),
      callerHasManageTeam: vi.fn(async () => {
        throw new Error("rpc down");
      }),
    });
    const result = await handleMagicLinkRequest({
      requestUrl: REQ_URL,
      body: inviteBody,
      authorizationHeader: "Bearer good",
      deps,
    });
    expect(result.status).toBe(500);
    expectNoSideEffects(deps);
  });

  it("H. valid fresh invite (BOTH invited_by AND manage_team) proceeds; generateMagicLink is the sole creation boundary", async () => {
    const calls: string[] = [];
    const deps = buildDeps({
      fetchInviteById: vi.fn(async () => {
        calls.push("fetchInviteById");
        return goodInvite();
      }),
      callerHasManageTeam: vi.fn(async () => {
        calls.push("callerHasManageTeam");
        return true;
      }),
      findRecentSend: vi.fn(async () => {
        calls.push("findRecentSend");
        return null;
      }),
      generateMagicLink: vi.fn(async () => {
        calls.push("generateMagicLink");
        return { hashedToken: "hash", userId: "auth-user-1", error: null };
      }),
      insertEmailSendLog: vi.fn(async () => {
        calls.push("insertEmailSendLog");
      }),
      sendEmail: vi.fn(async () => {
        calls.push("sendEmail");
      }),
      updateEmailSendLogStatus: vi.fn(async () => {
        calls.push("updateEmailSendLogStatus");
      }),
    });

    const result = await handleMagicLinkRequest({
      requestUrl: REQ_URL,
      body: inviteBody,
      authorizationHeader: "Bearer good",
      deps,
    });

    expect(result.ok).toBe(true);
    expect(calls).toEqual([
      "fetchInviteById",
      "callerHasManageTeam",
      "findRecentSend",
      "generateMagicLink",
      "insertEmailSendLog",
      "sendEmail",
      "updateEmailSendLogStatus",
    ]);
    expect(deps.generateMagicLink).toHaveBeenCalledTimes(1);
    // generateMagicLink used with kind:"invite" — that IS the creation boundary.
    expect(deps.generateMagicLink).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "invite" }),
    );
    // The exact clicked invite_id is baked into redirectTo so the
    // auth callback can finalize the correct invite.
    const linkArgs = (deps.generateMagicLink as unknown as { mock: { calls: unknown[][] } }).mock
      .calls[0][0] as { redirectTo: string };
    expect(linkArgs.redirectTo).toContain(`invite_id=${INVITE_ID}`);
    expect(deps.insertEmailSendLog).toHaveBeenCalledTimes(1);
    expect(deps.sendEmail).toHaveBeenCalledTimes(1);
    expect(deps.updateEmailSendLogStatus).toHaveBeenCalledWith(
      expect.any(String),
      "sent",
      expect.any(Object),
    );

    // Audit metadata on the success email_send_log row; bearer never appears.
    const logCall = (deps.insertEmailSendLog as unknown as { mock: { calls: unknown[][] } }).mock
      .calls[0][0] as { metadata?: Record<string, unknown> };
    expect(logCall.metadata).toMatchObject({
      invite_id: INVITE_ID,
      organization_id: ORG_ID,
      inviter_id: "user-1",
    });
    expect(JSON.stringify(logCall)).not.toContain("good");
  });

  it("H2. duplicate-user code (email_exists) triggers exact re-resolve + retry as kind:'magiclink' — send proceeds", async () => {
    // Provider rejected creation because the user already exists.
    // Handler must NOT trust any link returned in that response —
    // it re-resolves the exact user via paginated lookup and issues
    // a fresh generateMagicLink with kind:"magiclink".
    const generateMagicLink = vi
      .fn()
      .mockResolvedValueOnce({
        hashedToken: null,
        userId: null,
        error: { message: "already exists", code: "email_exists" },
      })
      .mockResolvedValueOnce({
        hashedToken: "hash2",
        userId: "existing-user-1",
        error: null,
      });
    const lookupExistingAuthUser = vi.fn(async () => ({ id: "existing-user-1" }));
    const deps = buildDeps({
      fetchInviteById: vi.fn(async () => goodInvite()),
      generateMagicLink,
      lookupExistingAuthUser,
    });
    const result = await handleMagicLinkRequest({
      requestUrl: REQ_URL,
      body: inviteBody,
      authorizationHeader: "Bearer good",
      deps,
    });
    expect(result.ok).toBe(true);
    expect(lookupExistingAuthUser).toHaveBeenCalledWith("invitee@example.com");
    expect(generateMagicLink).toHaveBeenCalledTimes(2);
    expect(generateMagicLink.mock.calls[0][0]).toMatchObject({ kind: "invite" });
    expect(generateMagicLink.mock.calls[1][0]).toMatchObject({ kind: "magiclink" });
    expect(deps.sendEmail).toHaveBeenCalledTimes(1);
  });

  it("H3. duplicate-user code (user_already_exists) — same re-resolve + magiclink retry path", async () => {
    const generateMagicLink = vi
      .fn()
      .mockResolvedValueOnce({
        hashedToken: null,
        userId: null,
        error: { message: "duplicate", code: "user_already_exists" },
      })
      .mockResolvedValueOnce({
        hashedToken: "hash2",
        userId: "existing-user-1",
        error: null,
      });
    const deps = buildDeps({
      fetchInviteById: vi.fn(async () => goodInvite()),
      generateMagicLink,
      lookupExistingAuthUser: vi.fn(async () => ({ id: "existing-user-1" })),
    });
    const result = await handleMagicLinkRequest({
      requestUrl: REQ_URL,
      body: inviteBody,
      authorizationHeader: "Bearer good",
      deps,
    });
    expect(result.ok).toBe(true);
    expect(generateMagicLink).toHaveBeenCalledTimes(2);
    expect(generateMagicLink.mock.calls[1][0]).toMatchObject({ kind: "magiclink" });
    expect(deps.sendEmail).toHaveBeenCalledTimes(1);
  });

  it("H3b. duplicate-user code with UNRESOLVED lookup aborts — no send, generic error, no provider code leak", async () => {
    const generateMagicLink = vi.fn(async () => ({
      hashedToken: null,
      userId: null,
      error: { message: "already exists", code: "email_exists" },
    }));
    const deps = buildDeps({
      fetchInviteById: vi.fn(async () => goodInvite()),
      generateMagicLink,
      lookupExistingAuthUser: vi.fn(async () => null),
    });
    const result = await handleMagicLinkRequest({
      requestUrl: REQ_URL,
      body: inviteBody,
      authorizationHeader: "Bearer good",
      deps,
    });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(500);
    expect(deps.sendEmail).not.toHaveBeenCalled();
    expect(generateMagicLink).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result.body)).not.toContain("email_exists");
  });

  it("H4. non-duplicate generateLink error aborts, records failure, and does NOT leak provider code to the client", async () => {
    // Prior implementation matched /already|registered|exist/i and would
    // swallow this. Code-based allowlist must NOT — and the client
    // response must NOT expose the internal provider code either.
    const deps = buildDeps({
      fetchInviteById: vi.fn(async () => goodInvite()),
      generateMagicLink: vi.fn(async () => ({
        hashedToken: null,
        userId: null,
        error: {
          message: "database instance does not exist",
          code: "internal_server_error",
        },
      })),
    });
    const result = await handleMagicLinkRequest({
      requestUrl: REQ_URL,
      body: inviteBody,
      authorizationHeader: "Bearer good",
      deps,
    });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(500);
    expect(deps.sendEmail).not.toHaveBeenCalled();
    // Provider message and code MUST NOT appear on the client response.
    const bodyJson = JSON.stringify(result.body);
    expect(bodyJson).not.toContain("internal_server_error");
    expect(bodyJson).not.toContain("database instance does not exist");
    // Failure row IS inserted and carries the provider code + invite audit.
    const failureRow = (deps.insertEmailSendLog as unknown as { mock: { calls: unknown[][] } }).mock
      .calls[0][0] as { metadata?: Record<string, unknown>; status: string };
    expect(failureRow.status).toBe("failed");
    expect(failureRow.metadata).toMatchObject({
      error_code: "internal_server_error",
      invite_id: INVITE_ID,
      organization_id: ORG_ID,
    });
  });

  it("I. login context for an UNKNOWN email returns generic success and generates no link / sends no email", async () => {
    // Public login must never provision an unknown auth user, and the
    // response must not enumerate accounts.
    const deps = buildDeps({
      lookupExistingAuthUser: vi.fn(async () => null),
    });
    const result = await handleMagicLinkRequest({
      requestUrl: REQ_URL,
      body: { email: "stranger@example.com", context: "login" },
      authorizationHeader: null,
      deps,
    });
    expect(result.ok).toBe(true);
    expect(deps.lookupExistingAuthUser).toHaveBeenCalledTimes(1);
    expect(deps.getAuthUserFromBearer).not.toHaveBeenCalled();
    expect(deps.fetchInviteById).not.toHaveBeenCalled();
    expect(deps.generateMagicLink).not.toHaveBeenCalled();
    expect(deps.insertEmailSendLog).not.toHaveBeenCalled();
    expect(deps.sendEmail).not.toHaveBeenCalled();
  });

  it("I2. login context for a KNOWN email proceeds with kind:'magiclink' (never kind:'invite')", async () => {
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
    expect(deps.generateMagicLink).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "magiclink" }),
    );
    expect(deps.sendEmail).toHaveBeenCalledTimes(1);
  });

  it("J. client_portal without Bearer / clientAccessId is rejected with no side effects", async () => {
    const depsNoBearer = buildDeps();
    const r1 = await handleMagicLinkRequest({
      requestUrl: REQ_URL,
      body: clientPortalBody,
      authorizationHeader: null,
      deps: depsNoBearer,
    });
    expect(r1.status).toBe(401);
    expectNoSideEffects(depsNoBearer);

    const depsNoId = buildDeps();
    const r2 = await handleMagicLinkRequest({
      requestUrl: REQ_URL,
      body: { email: "client@example.com", context: "client_portal" },
      authorizationHeader: "Bearer good",
      deps: depsNoId,
    });
    expect(r2.ok).toBe(false);
    expect(r2.status).toBe(400);
    expectNoSideEffects(depsNoId);
  });

  it("J2. client_portal with revoked access row returns 409 and performs no side effects", async () => {
    const deps = buildDeps({
      fetchClientAccessById: vi.fn(async () => goodClientAccess({ status: "revoked" })),
    });
    const result = await handleMagicLinkRequest({
      requestUrl: REQ_URL,
      body: clientPortalBody,
      authorizationHeader: "Bearer good",
      deps,
    });
    expect(result.status).toBe(409);
    expectNoSideEffects(deps);
  });

  it("J3. client_portal without client_portal.manage on the project org returns 403 — no side effects", async () => {
    const deps = buildDeps({
      fetchClientAccessById: vi.fn(async () => goodClientAccess()),
      callerHasClientAccessManagement: vi.fn(async () => false),
    });
    const result = await handleMagicLinkRequest({
      requestUrl: REQ_URL,
      body: clientPortalBody,
      authorizationHeader: "Bearer good",
      deps,
    });
    expect(result.status).toBe(403);
    expectNoSideEffects(deps);
  });

  it("J4. valid client_portal proceeds with kind:'magiclink' (never invite), bakes client_access_id into redirectTo", async () => {
    const deps = buildDeps({
      fetchClientAccessById: vi.fn(async () => goodClientAccess()),
      lookupExistingAuthUser: vi.fn(async () => ({ id: "existing-client-1" })),
    });
    const result = await handleMagicLinkRequest({
      requestUrl: REQ_URL,
      body: clientPortalBody,
      authorizationHeader: "Bearer good",
      deps,
    });
    expect(result.ok).toBe(true);
    expect(deps.lookupExistingAuthUser).toHaveBeenCalledWith("client@example.com");
    expect(deps.generateMagicLink).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "magiclink" }),
    );
    const linkArgs = (deps.generateMagicLink as unknown as { mock: { calls: unknown[][] } }).mock
      .calls[0][0] as { redirectTo: string };
    expect(linkArgs.redirectTo).toContain(`client_access_id=${CLIENT_ACCESS_ID}`);
    expect(deps.sendEmail).toHaveBeenCalledTimes(1);
  });

  it("J5. client_portal for an UNKNOWN email returns 409 and performs no side effects (never creates users)", async () => {
    const deps = buildDeps({
      fetchClientAccessById: vi.fn(async () => goodClientAccess()),
      lookupExistingAuthUser: vi.fn(async () => null),
    });
    const result = await handleMagicLinkRequest({
      requestUrl: REQ_URL,
      body: clientPortalBody,
      authorizationHeader: "Bearer good",
      deps,
    });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(409);
    expect(deps.lookupExistingAuthUser).toHaveBeenCalledWith("client@example.com");
    expect(deps.generateMagicLink).not.toHaveBeenCalled();
    expect(deps.sendEmail).not.toHaveBeenCalled();
    expect(deps.insertEmailSendLog).not.toHaveBeenCalled();
  });

  it("K. recent-send shortcut only runs AFTER the invite gate passes", async () => {
    const deps = buildDeps({
      fetchInviteById: vi.fn(async () => null),
      findRecentSend: vi.fn(async () => ({ id: "log-1", status: "sent" })),
    });
    const result = await handleMagicLinkRequest({
      requestUrl: REQ_URL,
      body: inviteBody,
      authorizationHeader: "Bearer good",
      deps,
    });
    expect(result.status).toBe(409);
    expect(deps.findRecentSend).not.toHaveBeenCalled();
  });

  it("K2. recent-send dedupe key discriminates on the exact invite id (different invite is NOT suppressed)", async () => {
    // findRecentSend receives a dedupeKey that includes the target
    // invite id, so a link for invite B cannot be suppressed by a
    // recent send for invite A.
    const seen: string[] = [];
    const deps = buildDeps({
      fetchInviteById: vi.fn(async () => goodInvite()),
      findRecentSend: vi.fn(async ({ dedupeKey }) => {
        seen.push(dedupeKey);
        return null;
      }),
    });
    await handleMagicLinkRequest({
      requestUrl: REQ_URL,
      body: inviteBody,
      authorizationHeader: "Bearer good",
      deps,
    });
    expect(seen[0]).toContain(INVITE_ID);
    expect(seen[0]).toContain("company_invite");
  });

  it("L. send failure updates the ORIGINAL pending row to failed (never inserts a second pending row)", async () => {
    const deps = buildDeps({
      fetchInviteById: vi.fn(async () => goodInvite()),
      sendEmail: vi.fn(async () => {
        throw new Error("smtp exploded");
      }),
    });
    const result = await handleMagicLinkRequest({
      requestUrl: REQ_URL,
      body: inviteBody,
      authorizationHeader: "Bearer good",
      deps,
    });
    expect(result.ok).toBe(false);
    // Exactly one pending row inserted, then flipped to failed via update.
    expect(deps.insertEmailSendLog).toHaveBeenCalledTimes(1);
    const pendingRow = (deps.insertEmailSendLog as unknown as { mock: { calls: unknown[][] } }).mock
      .calls[0][0] as { status: string };
    expect(pendingRow.status).toBe("pending");
    expect(deps.updateEmailSendLogFailed).toHaveBeenCalledTimes(1);
    // Provider message must NOT leak to the client body.
    expect(JSON.stringify(result.body)).not.toContain("smtp exploded");
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
      body: inviteBody,
      authorizationHeader: `Bearer ${bearer}`,
      deps,
    });
    expect(JSON.stringify(result.body)).not.toContain(bearer);
    expect(logs.join("\n")).not.toContain(bearer);
  });

  it("N. duplicate-code allowlist exports exactly the documented Supabase codes", () => {
    expect(Array.from(DUPLICATE_USER_CODES).sort()).toEqual([
      "email_exists",
      "user_already_exists",
    ]);
  });
});
