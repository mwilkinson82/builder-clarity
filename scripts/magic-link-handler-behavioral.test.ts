// Behavioral vitest for the magic-link handler (P0 corrections).
//
// Invokes handleMagicLinkRequest with spies and asserts:
//   - the invite / client_portal authorization gate runs BEFORE any
//     provisioning or email side effect;
//   - generateMagicLink is the SOLE auth-user creation boundary
//     (there is no separate createAuthUser step);
//   - existing invitees use magiclink, genuinely new invitees use invite,
//     and documented duplicate-user races retry exactly once as magiclink;
//   - login never generates a link or sends email for an unknown email
//     (fail-closed existing-user lookup);
//   - client_portal requires Bearer + exact clientAccessId + status not
//     revoked + caller currently holds client_portal.manage;
//   - failure paths preserve a bounded provider code in audit metadata but
//     never persist or log a raw provider message;
//   - exact-context concurrent clicks collapse into one atomic reservation,
//     one generated token, and one sent email;
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
    lookupExistingAuthUser: vi.fn(async () => ({
      id: "existing-user-1",
      emailConfirmed: true,
    })),
    reserveSend: vi.fn(async ({ messageId }) => ({
      reserved: true,
      messageId,
    })),
    generateMagicLink: vi.fn(async () => ({
      hashedToken: "hash",
      userId: "user-1",
      error: null,
    })),
    updateEmailSendLogStatus: vi.fn(async () => {}),
    updateEmailSendLogFailed: vi.fn(async () => {}),
    sendEmail: vi.fn(async () => {}),
    ...overrides,
  };
}

function expectNoSideEffects(deps: MagicLinkDeps) {
  expect(deps.reserveSend).not.toHaveBeenCalled();
  expect(deps.generateMagicLink).not.toHaveBeenCalled();
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
    client_user_id: null,
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
      reserveSend: vi.fn(async ({ messageId }) => {
        calls.push("reserveSend");
        return { reserved: true, messageId };
      }),
      lookupExistingAuthUser: vi.fn(async () => {
        calls.push("lookupExistingAuthUser");
        return null;
      }),
      generateMagicLink: vi.fn(async () => {
        calls.push("generateMagicLink");
        return { hashedToken: "hash", userId: "auth-user-1", error: null };
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
      "lookupExistingAuthUser",
      "reserveSend",
      "generateMagicLink",
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
    expect(deps.reserveSend).toHaveBeenCalledTimes(1);
    expect(deps.sendEmail).toHaveBeenCalledTimes(1);
    expect(deps.updateEmailSendLogStatus).toHaveBeenCalledWith(
      expect.any(String),
      "sent",
      expect.any(Object),
    );
    const sentPayload = (deps.sendEmail as unknown as { mock: { calls: unknown[][] } }).mock
      .calls[0][0] as { html: string };
    expect(sentPayload.html).toContain("type=invite");

    // Audit metadata on the atomically reserved email_send_log row; bearer
    // never appears.
    const logCall = (deps.reserveSend as unknown as { mock: { calls: unknown[][] } }).mock
      .calls[0][0] as { metadata?: Record<string, unknown> };
    expect(logCall.metadata).toMatchObject({
      invite_id: INVITE_ID,
      organization_id: ORG_ID,
      inviter_id: "user-1",
    });
    expect(JSON.stringify(logCall)).not.toContain("good");
  });

  it("H2. existing confirmed invitee uses magiclink directly (never invite)", async () => {
    const deps = buildDeps({
      fetchInviteById: vi.fn(async () => goodInvite()),
      lookupExistingAuthUser: vi.fn(async () => ({
        id: "existing-user-1",
        emailConfirmed: true,
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
    expect(deps.generateMagicLink).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "magiclink" }),
    );
    expect(deps.sendEmail).toHaveBeenCalledTimes(1);
    const sentPayload = (deps.sendEmail as unknown as { mock: { calls: unknown[][] } }).mock
      .calls[0][0] as { html: string };
    expect(sentPayload.html).toContain("type=magiclink");
  });

  it("H2a. existing unconfirmed invitee still uses magiclink and is never recreated", async () => {
    const deps = buildDeps({
      fetchInviteById: vi.fn(async () => goodInvite()),
      lookupExistingAuthUser: vi.fn(async () => ({
        id: "unconfirmed-existing-user",
        emailConfirmed: false,
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
    expect(deps.generateMagicLink).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "magiclink" }),
    );
    expect(deps.sendEmail).toHaveBeenCalledTimes(1);
  });

  it("H2b. portfolio invite carries its exact invite id and keeps a distinct dedupe context", async () => {
    const seenDedupeKeys: string[] = [];
    const deps = buildDeps({
      fetchInviteById: vi.fn(async () => goodInvite()),
      lookupExistingAuthUser: vi.fn(async () => null),
      reserveSend: vi.fn(async ({ dedupeKey, messageId }) => {
        seenDedupeKeys.push(dedupeKey);
        return { reserved: true, messageId };
      }),
    });

    const result = await handleMagicLinkRequest({
      requestUrl: REQ_URL,
      body: {
        email: "invitee@example.com",
        context: "portfolio_invite",
        inviteId: INVITE_ID,
      },
      authorizationHeader: "Bearer good",
      deps,
    });

    expect(result.ok).toBe(true);
    expect(seenDedupeKeys).toEqual([`portfolio_invite:${INVITE_ID}:invitee@example.com`]);
    const linkArgs = (deps.generateMagicLink as unknown as { mock: { calls: unknown[][] } }).mock
      .calls[0][0] as { redirectTo: string; kind: string };
    expect(linkArgs.kind).toBe("invite");
    expect(linkArgs.redirectTo).toContain(`invite_id=${INVITE_ID}`);
  });

  it("H3. duplicate-user race retries exactly once as magiclink and sends only the retry token", async () => {
    const generatedKinds: string[] = [];
    const deps = buildDeps({
      fetchInviteById: vi.fn(async () => goodInvite()),
      lookupExistingAuthUser: vi.fn(async () => null),
      generateMagicLink: vi.fn(async ({ kind }) => {
        generatedKinds.push(kind);
        return kind === "invite"
          ? {
              hashedToken: null,
              userId: null,
              error: { message: "duplicate", code: "user_already_exists" },
            }
          : {
              hashedToken: "magiclink-hash",
              userId: "racing-existing-user",
              error: null,
            };
      }),
    });
    const result = await handleMagicLinkRequest({
      requestUrl: REQ_URL,
      body: inviteBody,
      authorizationHeader: "Bearer good",
      deps,
    });
    expect(result.ok).toBe(true);
    expect(generatedKinds).toEqual(["invite", "magiclink"]);
    expect(deps.generateMagicLink).toHaveBeenCalledTimes(2);
    expect(deps.sendEmail).toHaveBeenCalledTimes(1);
    const payload = (deps.sendEmail as unknown as { mock: { calls: unknown[][] } }).mock
      .calls[0][0] as { html: string };
    expect(payload.html).toContain("magiclink-hash");
    expect(payload.html).toContain("type=magiclink");
  });

  it("H4. email_exists race also retries as magiclink", async () => {
    const deps = buildDeps({
      fetchInviteById: vi.fn(async () => goodInvite()),
      lookupExistingAuthUser: vi.fn(async () => null),
      generateMagicLink: vi
        .fn()
        .mockResolvedValueOnce({
          hashedToken: null,
          userId: null,
          error: { message: "already exists", code: "email_exists" },
        })
        .mockResolvedValueOnce({
          hashedToken: "retry-hash",
          userId: "existing-user-1",
          error: null,
        }),
    });

    const result = await handleMagicLinkRequest({
      requestUrl: REQ_URL,
      body: inviteBody,
      authorizationHeader: "Bearer good",
      deps,
    });

    expect(result.ok).toBe(true);
    expect(deps.generateMagicLink).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ kind: "invite" }),
    );
    expect(deps.generateMagicLink).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ kind: "magiclink" }),
    );
  });

  it("H5. non-duplicate generateLink error aborts, records failure, and does NOT leak provider code to the client", async () => {
    // Prior implementation matched /already|registered|exist/i and would
    // swallow this. Code-based allowlist must NOT — and the client
    // response must NOT expose the internal provider code either.
    const deps = buildDeps({
      fetchInviteById: vi.fn(async () => goodInvite()),
      lookupExistingAuthUser: vi.fn(async () => null),
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
    // The atomically reserved row is marked failed and carries only the
    // bounded provider code + invite audit, never the raw message.
    expect(deps.updateEmailSendLogFailed).toHaveBeenCalledTimes(1);
    const failureCall = (
      deps.updateEmailSendLogFailed as unknown as { mock: { calls: unknown[][] } }
    ).mock.calls[0] as [string, string, Record<string, unknown>];
    expect(failureCall[1]).toBe("Magic link generation failed.");
    expect(failureCall[2]).toMatchObject({
      error_code: "internal_server_error",
      invite_id: INVITE_ID,
      organization_id: ORG_ID,
    });
    expect(JSON.stringify(failureCall)).not.toContain("database instance does not exist");
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
    expect(deps.reserveSend).not.toHaveBeenCalled();
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

  it("I3. Auth lookup failure fails closed without exposing its diagnostic", async () => {
    const deps = buildDeps({
      fetchInviteById: vi.fn(async () => goodInvite()),
      lookupExistingAuthUser: vi.fn(async () => {
        throw new Error("service-role-token=must-not-leak");
      }),
    });

    const result = await handleMagicLinkRequest({
      requestUrl: REQ_URL,
      body: inviteBody,
      authorizationHeader: "Bearer good",
      deps,
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(503);
    expect(JSON.stringify(result.body)).not.toContain("service-role-token");
    expect(deps.generateMagicLink).not.toHaveBeenCalled();
    expect(deps.reserveSend).not.toHaveBeenCalled();
    expect(deps.sendEmail).not.toHaveBeenCalled();
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

  it("J4. genuinely new client proceeds with kind:'invite' and carries the exact client_access_id", async () => {
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
    expect(result.ok).toBe(true);
    expect(deps.generateMagicLink).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "invite" }),
    );
    const linkArgs = (deps.generateMagicLink as unknown as { mock: { calls: unknown[][] } }).mock
      .calls[0][0] as { redirectTo: string };
    expect(linkArgs.redirectTo).toContain(`client_access_id=${CLIENT_ACCESS_ID}`);
    expect(deps.sendEmail).toHaveBeenCalledTimes(1);
    const sentPayload = (deps.sendEmail as unknown as { mock: { calls: unknown[][] } }).mock
      .calls[0][0] as { html: string };
    expect(sentPayload.html).toContain("type=invite");
  });

  it("J5. existing client uses magiclink and still carries the exact client_access_id", async () => {
    const deps = buildDeps({
      fetchClientAccessById: vi.fn(async () => goodClientAccess()),
      lookupExistingAuthUser: vi.fn(async () => ({
        id: "existing-client",
        emailConfirmed: true,
      })),
    });

    const result = await handleMagicLinkRequest({
      requestUrl: REQ_URL,
      body: clientPortalBody,
      authorizationHeader: "Bearer good",
      deps,
    });

    expect(result.ok).toBe(true);
    expect(deps.generateMagicLink).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "magiclink" }),
    );
    const linkArgs = (deps.generateMagicLink as unknown as { mock: { calls: unknown[][] } }).mock
      .calls[0][0] as { redirectTo: string };
    expect(linkArgs.redirectTo).toContain(`client_access_id=${CLIENT_ACCESS_ID}`);
  });

  it("J5b. an active client row may send only to its exact bound Auth identity", async () => {
    const deps = buildDeps({
      fetchClientAccessById: vi.fn(async () =>
        goodClientAccess({
          status: "active",
          client_user_id: "bound-client",
        }),
      ),
      lookupExistingAuthUser: vi.fn(async () => ({
        id: "bound-client",
        emailConfirmed: true,
      })),
    });

    const result = await handleMagicLinkRequest({
      requestUrl: REQ_URL,
      body: clientPortalBody,
      authorizationHeader: "Bearer good",
      deps,
    });

    expect(result.ok).toBe(true);
    expect(deps.generateMagicLink).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "magiclink" }),
    );
    expect(deps.sendEmail).toHaveBeenCalledTimes(1);
  });

  it("J5c. a pre-bound client row cannot send to a different Auth identity", async () => {
    const deps = buildDeps({
      fetchClientAccessById: vi.fn(async () =>
        goodClientAccess({
          status: "active",
          client_user_id: "bound-client",
        }),
      ),
      lookupExistingAuthUser: vi.fn(async () => ({
        id: "different-client",
        emailConfirmed: true,
      })),
    });

    const result = await handleMagicLinkRequest({
      requestUrl: REQ_URL,
      body: clientPortalBody,
      authorizationHeader: "Bearer good",
      deps,
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(409);
    expect(deps.reserveSend).not.toHaveBeenCalled();
    expect(deps.generateMagicLink).not.toHaveBeenCalled();
    expect(deps.sendEmail).not.toHaveBeenCalled();
  });

  it("J6. client duplicate-user race retries as magiclink", async () => {
    const deps = buildDeps({
      fetchClientAccessById: vi.fn(async () => goodClientAccess()),
      lookupExistingAuthUser: vi.fn(async () => null),
      generateMagicLink: vi
        .fn()
        .mockResolvedValueOnce({
          hashedToken: null,
          userId: null,
          error: { message: "duplicate", code: "user_already_exists" },
        })
        .mockResolvedValueOnce({
          hashedToken: "retry-hash",
          userId: "existing-client",
          error: null,
        }),
    });

    const result = await handleMagicLinkRequest({
      requestUrl: REQ_URL,
      body: clientPortalBody,
      authorizationHeader: "Bearer good",
      deps,
    });

    expect(result.ok).toBe(true);
    expect(deps.generateMagicLink).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ kind: "invite" }),
    );
    expect(deps.generateMagicLink).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ kind: "magiclink" }),
    );
  });

  it("K. atomic reservation only runs AFTER the invite gate passes", async () => {
    const deps = buildDeps({
      fetchInviteById: vi.fn(async () => null),
    });
    const result = await handleMagicLinkRequest({
      requestUrl: REQ_URL,
      body: inviteBody,
      authorizationHeader: "Bearer good",
      deps,
    });
    expect(result.status).toBe(409);
    expect(deps.reserveSend).not.toHaveBeenCalled();
  });

  it("K2. reservation key discriminates on the exact invite id", async () => {
    const seen: string[] = [];
    const deps = buildDeps({
      fetchInviteById: vi.fn(async () => goodInvite()),
      reserveSend: vi.fn(async ({ dedupeKey, messageId }) => {
        seen.push(dedupeKey);
        return { reserved: true, messageId };
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

  it("K3. two concurrent exact-context clicks generate and send only one token", async () => {
    let reservationClaimed = false;
    let id = 0;
    const deps = buildDeps({
      randomUUID: () => `00000000-0000-0000-0000-${String(++id).padStart(12, "0")}`,
      fetchInviteById: vi.fn(async () => goodInvite()),
      lookupExistingAuthUser: vi.fn(async () => null),
      reserveSend: vi.fn(async ({ messageId }) => {
        // Yield inside the shared reservation adapter so both handlers reach
        // the contention point. This models the DB advisory-lock contract.
        await Promise.resolve();
        if (reservationClaimed) {
          return { reserved: false, messageId: "already-reserved" };
        }
        reservationClaimed = true;
        return { reserved: true, messageId };
      }),
    });

    const [first, second] = await Promise.all([
      handleMagicLinkRequest({
        requestUrl: REQ_URL,
        body: inviteBody,
        authorizationHeader: "Bearer good",
        deps,
      }),
      handleMagicLinkRequest({
        requestUrl: REQ_URL,
        body: inviteBody,
        authorizationHeader: "Bearer good",
        deps,
      }),
    ]);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect([first, second].filter((result) => result.ok && result.body.recentlySent)).toHaveLength(
      1,
    );
    expect(deps.reserveSend).toHaveBeenCalledTimes(2);
    expect(deps.generateMagicLink).toHaveBeenCalledTimes(1);
    expect(deps.sendEmail).toHaveBeenCalledTimes(1);
  });

  it("L. send failure marks the atomically reserved original row failed with no raw diagnostic", async () => {
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
    expect(deps.reserveSend).toHaveBeenCalledTimes(1);
    expect(deps.updateEmailSendLogFailed).toHaveBeenCalledTimes(1);
    const failureCall = (
      deps.updateEmailSendLogFailed as unknown as { mock: { calls: unknown[][] } }
    ).mock.calls[0] as [string, string, Record<string, unknown>];
    expect(failureCall[1]).toBe("Email delivery failed.");
    // Provider message must not leak to the client body, logs, or audit row.
    expect(JSON.stringify(result.body)).not.toContain("smtp exploded");
    expect(JSON.stringify(failureCall)).not.toContain("smtp exploded");
  });

  it("L2. a sent-status audit failure cannot trigger a competing second token", async () => {
    const logs: string[] = [];
    const deps = buildDeps({
      fetchInviteById: vi.fn(async () => goodInvite()),
      updateEmailSendLogStatus: vi.fn(async () => {
        throw new Error("persistence detail must not leak");
      }),
      logError: (message, metadata) => logs.push(`${message} ${JSON.stringify(metadata ?? {})}`),
    });

    const result = await handleMagicLinkRequest({
      requestUrl: REQ_URL,
      body: inviteBody,
      authorizationHeader: "Bearer good",
      deps,
    });

    expect(result).toEqual({
      ok: true,
      status: 200,
      body: { success: true },
    });
    expect(deps.generateMagicLink).toHaveBeenCalledTimes(1);
    expect(deps.sendEmail).toHaveBeenCalledTimes(1);
    expect(deps.updateEmailSendLogFailed).not.toHaveBeenCalled();
    expect(logs.join("\n")).toContain("magic-link sent-status update failed");
    expect(logs.join("\n")).not.toContain("persistence detail");
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
