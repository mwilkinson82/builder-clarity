// Behavioral vitest for the magic-link handler (P0 corrections).
//
// Invokes handleMagicLinkRequest with spies and asserts the invite
// authorization gate runs BEFORE any provisioning / email side effect.
// createAuthUser, generateMagicLink, insertEmailSendLog, and sendEmail
// must all remain at zero calls for every rejection path an invite
// context can produce.
//
// Also enforces:
//   - AND-gate: invited_by = caller AND live company.manage_team
//   - Documented Supabase duplicate-user CODE allowlist
//     (email_exists, user_already_exists) — not message heuristics
//   - Invite audit metadata (invite_id, organization_id, inviter_id) on
//     both success and failure email_send_log rows
//   - Bearer token never leaks to response body, logs, or metadata
//   - Runtime Zod rejection of inviteId with non-invite context

import { describe, expect, it, vi } from "vitest";
import {
  DUPLICATE_USER_CODES,
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
    getAuthUserFromBearer: vi.fn(async () => ({
      user: { id: "user-1" },
      error: null,
    })),
    fetchInviteById: vi.fn(async () => null),
    callerHasManageTeam: vi.fn(async () => true),
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

const inviteBody = {
  email: "invitee@example.com",
  context: "company_invite" as const,
  inviteId: INVITE_ID,
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
      fetchInviteById: vi.fn(async () =>
        goodInvite({ email: "  DIFFERENT@example.com " }),
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
      fetchInviteById: vi.fn(async () =>
        goodInvite({ expires_at: new Date(nowMs).toISOString() }),
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
    // must not even fire — no bearer round-trip against RLS for a
    // caller who is provably not the inviter.
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

  it("H. valid fresh invite (BOTH invited_by AND manage_team) proceeds with exact call order and counts", async () => {
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
      createAuthUser: vi.fn(async () => {
        calls.push("createAuthUser");
        return { error: null };
      }),
      generateMagicLink: vi.fn(async () => {
        calls.push("generateMagicLink");
        return { hashedToken: "hash", error: null };
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
      "createAuthUser",
      "generateMagicLink",
      "insertEmailSendLog",
      "sendEmail",
      "updateEmailSendLogStatus",
    ]);
    expect(deps.createAuthUser).toHaveBeenCalledTimes(1);
    expect(deps.generateMagicLink).toHaveBeenCalledTimes(1);
    expect(deps.insertEmailSendLog).toHaveBeenCalledTimes(1);
    expect(deps.sendEmail).toHaveBeenCalledTimes(1);
    expect(deps.updateEmailSendLogStatus).toHaveBeenCalledWith(
      expect.any(String),
      "sent",
    );

    // Audit metadata is persisted on the success email_send_log row and
    // bearer never appears.
    const logCall = (
      deps.insertEmailSendLog as unknown as { mock: { calls: unknown[][] } }
    ).mock.calls[0][0] as { metadata?: Record<string, unknown> };
    expect(logCall.metadata).toMatchObject({
      invite_id: INVITE_ID,
      organization_id: ORG_ID,
      inviter_id: "user-1",
    });
    expect(JSON.stringify(logCall)).not.toContain("good");
  });

  it("H2. documented duplicate-user code (email_exists) is swallowed and the send proceeds", async () => {
    const deps = buildDeps({
      fetchInviteById: vi.fn(async () => goodInvite()),
      createAuthUser: vi.fn(async () => ({
        error: { message: "A user with this email already exists", code: "email_exists" },
      })),
    });
    const result = await handleMagicLinkRequest({
      requestUrl: REQ_URL,
      body: inviteBody,
      authorizationHeader: "Bearer good",
      deps,
    });
    expect(result.ok).toBe(true);
    expect(deps.generateMagicLink).toHaveBeenCalledTimes(1);
    expect(deps.sendEmail).toHaveBeenCalledTimes(1);
  });

  it("H3. documented duplicate-user code (user_already_exists) is also swallowed", async () => {
    const deps = buildDeps({
      fetchInviteById: vi.fn(async () => goodInvite()),
      createAuthUser: vi.fn(async () => ({
        error: { message: "duplicate", code: "user_already_exists" },
      })),
    });
    const result = await handleMagicLinkRequest({
      requestUrl: REQ_URL,
      body: inviteBody,
      authorizationHeader: "Bearer good",
      deps,
    });
    expect(result.ok).toBe(true);
    expect(deps.sendEmail).toHaveBeenCalledTimes(1);
  });

  it("H4. false-positive 'does not exist' message with a non-duplicate code aborts (no message heuristics)", async () => {
    // Prior implementation matched /already|registered|exist/i and would
    // swallow this. Code-based allowlist must NOT.
    const deps = buildDeps({
      fetchInviteById: vi.fn(async () => goodInvite()),
      createAuthUser: vi.fn(async () => ({
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
    expect(deps.generateMagicLink).not.toHaveBeenCalled();
    expect(deps.sendEmail).not.toHaveBeenCalled();
    // Original error code is preserved on the response and in the
    // failure email_send_log metadata.
    expect((result as { body: { code?: string } }).body.code).toBe(
      "internal_server_error",
    );
    const failureRow = (
      deps.insertEmailSendLog as unknown as { mock: { calls: unknown[][] } }
    ).mock.calls[0][0] as { metadata?: Record<string, unknown>; status: string };
    expect(failureRow.status).toBe("failed");
    expect(failureRow.metadata).toMatchObject({
      error_code: "internal_server_error",
      invite_id: INVITE_ID,
      organization_id: ORG_ID,
    });
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

  it("L. non-duplicate createUser error aborts before generateLink/email", async () => {
    const deps = buildDeps({
      fetchInviteById: vi.fn(async () => goodInvite()),
      createAuthUser: vi.fn(async () => ({
        error: { message: "database is on fire", code: "internal_server_error" },
      })),
    });
    const result = await handleMagicLinkRequest({
      requestUrl: REQ_URL,
      body: inviteBody,
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
