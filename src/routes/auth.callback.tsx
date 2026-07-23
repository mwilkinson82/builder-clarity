import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { sendTransactionalEmail } from "@/lib/email/send";
import {
  emailOtpTypeFromUrl,
  requiresExplicitMagicLinkConfirmation,
  safeAuthNext,
  scrubbedCallbackUrl,
} from "@/lib/auth/magic-link-url";

async function notifyLogin(session: { user: { id: string; email?: string | null } }) {
  try {
    await sendTransactionalEmail({
      templateName: "login-notification",
      recipientEmail: "wilkinson.marshall@gmail.com",
      idempotencyKey: `login-${session.user.id}-${Math.floor(Date.now() / 60000)}`,
      templateData: {
        userEmail: session.user.email ?? "unknown",
        loginAt: new Date().toISOString(),
        method: "magic link",
        userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
      },
    });
  } catch (err) {
    console.warn("Login notification failed", err);
  }
}

export const Route = createFileRoute("/auth/callback")({
  head: () => ({
    meta: [
      { title: "Signing in — Overwatch" },
      { name: "description", content: "Completing your Overwatch sign-in." },
    ],
  }),
  component: AuthCallbackPage,
});

function authHref(next: string) {
  return `/auth?next=${encodeURIComponent(next)}`;
}

function callbackFailureMessage(err: unknown) {
  const message = err instanceof Error ? err.message : "Could not complete sign-in.";
  if (/already|expired|invalid|jwt|refresh|token|link/i.test(message)) {
    return "This sign-in link was already used or expired. Request a fresh magic link and open it once.";
  }
  return message;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readInviteId(url: URL): string | null {
  const raw = url.searchParams.get("invite_id");
  if (!raw) return null;
  return UUID_RE.test(raw) ? raw : null;
}

function readClientAccessId(url: URL): string | null {
  const raw = url.searchParams.get("client_access_id");
  if (!raw) return null;
  return UUID_RE.test(raw) ? raw : null;
}

async function establishSessionFromUrl(url: URL) {
  const code = url.searchParams.get("code");
  if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) throw error;
    return data.session ?? null;
  }

  const tokenHash = url.searchParams.get("token_hash");
  if (tokenHash) {
    const { data, error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: emailOtpTypeFromUrl(url.searchParams.get("type")),
    });
    if (error) throw error;
    return data.session ?? null;
  }

  const hashParams = new URLSearchParams(url.hash.replace(/^#/, ""));
  const authError = hashParams.get("error_description") ?? hashParams.get("error");
  if (authError) throw new Error(authError);

  const accessToken = hashParams.get("access_token");
  const refreshToken = hashParams.get("refresh_token");
  if (!accessToken || !refreshToken) return null;

  const { data, error } = await supabase.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  });
  if (error) throw error;
  return data.session ?? null;
}

/**
 * After verifyOtp succeeds, finalize the EXACT invite the user
 * clicked. Fail closed to recovery if the RPC rejects — do not
 * navigate into internal chrome with a stale default.
 */
async function finalizeExactInvite(inviteId: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  // Cast: finalize_invite_acceptance is created by
  // supabase/migrations/20260724000000_account_provisioning_history_containment.sql
  // which is intentionally UNAPPLIED until the maintenance window,
  // so the generated types file does not yet know the RPC.
  const rpc = supabase.rpc as unknown as (
    fn: "finalize_invite_acceptance",
    params: { p_invite_id: string },
  ) => Promise<{ data: string | null; error: { message: string } | null }>;
  const { data, error } = await rpc("finalize_invite_acceptance", {
    p_invite_id: inviteId,
  });
  if (error) return { ok: false, reason: error.message };
  if (!data) return { ok: false, reason: "This invitation is no longer valid for your account." };
  return { ok: true };
}

/**
 * Exact client-access finalizer. Binds one exact pending/active
 * unexpired non-revoked project_client_access row to auth.uid() +
 * caller email. Rejects every other status so revocation/expiry
 * fails closed.
 */
async function finalizeExactClientAccess(
  accessId: string,
): Promise<
  | { ok: true; projectId: string }
  | { ok: false; reason: string }
> {
  const rpc = supabase.rpc as unknown as (
    fn: "finalize_client_access",
    params: { p_access_id: string },
  ) => Promise<{ data: string | null; error: { message: string } | null }>;
  const { data, error } = await rpc("finalize_client_access", {
    p_access_id: accessId,
  });
  if (error) return { ok: false, reason: error.message };
  if (!data) return { ok: false, reason: "This client-portal link is no longer valid for your account." };
  return { ok: true, projectId: data };
}

function AuthCallbackPage() {
  const navigate = useNavigate();
  const [message, setMessage] = useState("Completing sign-in...");
  const [nextPath, setNextPath] = useState("/");
  const [showRecovery, setShowRecovery] = useState(false);
  const [confirmationRequired, setConfirmationRequired] = useState(false);
  const [exchangeInFlight, setExchangeInFlight] = useState(false);

  const originalUrlRef = useRef<URL | null>(null);
  const inviteIdRef = useRef<string | null>(null);
  const clientAccessIdRef = useRef<string | null>(null);
  const consumptionInFlightRef = useRef(false);
  const consumedRef = useRef(false);
  const mountedRef = useRef(false);

  const clearCaptured = useCallback(() => {
    originalUrlRef.current = null;
    inviteIdRef.current = null;
    clientAccessIdRef.current = null;
  }, []);

  const failToRecovery = useCallback(async (reason: string) => {
    // Any failure past this point MUST NOT leave a stale prior session
    // masquerading as success. Sign out locally first, then show the
    // stable recovery UI. If sign-out itself throws we still surface
    // recovery — we never fall through to internal chrome.
    try {
      await supabase.auth.signOut();
    } catch {
      /* recovery is authoritative */
    }
    if (!mountedRef.current) return;
    consumedRef.current = true;
    clearCaptured();
    setConfirmationRequired(false);
    setShowRecovery(true);
    setMessage(reason);
  }, [clearCaptured]);

  const finishSignIn = useCallback(
    async (allowTokenConsumption: boolean) => {
      const url = originalUrlRef.current;
      if (!url) {
        if (mountedRef.current) {
          setShowRecovery(true);
          setMessage("No active session was found. Request a fresh magic link and open it once.");
        }
        return;
      }

      const next = safeAuthNext(url);
      setNextPath(next);

      if (requiresExplicitMagicLinkConfirmation(url) && !allowTokenConsumption) {
        setConfirmationRequired(true);
        setMessage("Your secure link is ready. Continue to finish signing in.");
        return;
      }

      if (consumedRef.current || consumptionInFlightRef.current) return;
      consumptionInFlightRef.current = true;
      setExchangeInFlight(true);

      try {
        // establishSessionFromUrl throws on any exchange/verify
        // failure. We MUST NOT catch that and fall back to a prior
        // session — the user clicked a bad/used link and any old
        // session cached in localStorage is unrelated. A rescue would
        // silently authorize the wrong identity.
        const sessionFromUrl = await establishSessionFromUrl(url);
        if (!sessionFromUrl) {
          await failToRecovery(
            "No active session was found. Request a fresh magic link and open it once.",
          );
          return;
        }

        // Exact-invite finalization is atomic with sign-in: if the
        // invite RPC rejects (revoked / expired / different email /
        // mismatched caller) we sign out and fail closed to recovery.
        if (inviteIdRef.current) {
          const res = await finalizeExactInvite(inviteIdRef.current);
          if (!res.ok) {
            await failToRecovery(res.reason);
            return;
          }
        }

        // Exact client-access finalization: identical guarantees for
        // /client/projects/:projectId path. On success, route to the
        // exact project.
        let clientTarget: string | null = null;
        if (clientAccessIdRef.current) {
          const res = await finalizeExactClientAccess(clientAccessIdRef.current);
          if (!res.ok) {
            await failToRecovery(res.reason);
            return;
          }
          clientTarget = `/client/projects/${res.projectId}`;
        }

        consumedRef.current = true;
        clearCaptured();
        void notifyLogin(sessionFromUrl);
        navigate({ to: (clientTarget ?? next) as never, replace: true });
      } catch (err) {
        // Do not log raw errors (may include tokens / provider text).
        // Fail closed. No getSession() rescue: a stale prior session
        // must NEVER convert a bad/used link into a successful sign-in.
        await failToRecovery(callbackFailureMessage(err));
      } finally {
        consumptionInFlightRef.current = false;
        if (mountedRef.current) setExchangeInFlight(false);
      }
    },
    [navigate, failToRecovery, clearCaptured],
  );

  useEffect(() => {
    mountedRef.current = true;
    if (!originalUrlRef.current && !consumedRef.current) {
      const captured = new URL(window.location.href);
      originalUrlRef.current = captured;
      // Capture exact invite id AND client-access id BEFORE scrub so
      // callback finalization can run against the exact resource the
      // user clicked.
      inviteIdRef.current = readInviteId(captured);
      clientAccessIdRef.current = readClientAccessId(captured);
      setNextPath(safeAuthNext(captured));
      try {
        const scrubbed = scrubbedCallbackUrl(window.location.href);
        window.history.replaceState(null, "", scrubbed);
      } catch {
        /* replaceState best-effort */
      }
    }

    void finishSignIn(false);

    return () => {
      mountedRef.current = false;
    };
  }, [finishSignIn]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6 text-foreground">
      <div className="max-w-sm text-center">
        <div className="mx-auto h-2 w-12 rounded-full bg-primary/70" />
        <h1 className="mt-6 font-serif text-3xl">Opening OverWatch</h1>
        <p className="mt-2 text-sm text-muted-foreground" role="status" aria-live="polite">
          {message}
        </p>
        {confirmationRequired && (
          <button
            type="button"
            disabled={exchangeInFlight}
            aria-busy={exchangeInFlight}
            onClick={() => {
              if (consumedRef.current || consumptionInFlightRef.current) return;
              setMessage("Completing sign-in...");
              void finishSignIn(true);
            }}
            className="mt-6 inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {exchangeInFlight ? "Signing in…" : "Continue to Overwatch"}
          </button>
        )}
        {showRecovery && !confirmationRequired && (
          <div className="mt-6 flex flex-col gap-3">
            <a
              href={authHref(nextPath)}
              className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
            >
              Request fresh magic link
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
