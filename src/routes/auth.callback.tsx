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

function AuthCallbackPage() {
  const navigate = useNavigate();
  const [message, setMessage] = useState("Completing sign-in...");
  const [nextPath, setNextPath] = useState("/");
  const [showRecovery, setShowRecovery] = useState(false);
  const [confirmationRequired, setConfirmationRequired] = useState(false);
  const [exchangeInFlight, setExchangeInFlight] = useState(false);

  const originalUrlRef = useRef<URL | null>(null);
  const inviteIdRef = useRef<string | null>(null);
  const consumptionInFlightRef = useRef(false);
  const consumedRef = useRef(false);
  const mountedRef = useRef(false);

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
        const sessionFromUrl = await establishSessionFromUrl(url);
        const finalize = async (
          session: { user: { id: string; email?: string | null } },
        ) => {
          // Exact-invite finalization is atomic with sign-in: if the
          // invite RPC rejects (revoked / expired / different email /
          // mismatched caller) we must NOT navigate into internal
          // chrome. Fail closed to the recovery UI.
          if (inviteIdRef.current) {
            const res = await finalizeExactInvite(inviteIdRef.current);
            if (!res.ok) {
              consumedRef.current = true;
              originalUrlRef.current = null;
              inviteIdRef.current = null;
              setConfirmationRequired(false);
              setShowRecovery(true);
              setMessage(res.reason);
              return;
            }
          }
          consumedRef.current = true;
          originalUrlRef.current = null;
          inviteIdRef.current = null;
          void notifyLogin(session);
          navigate({ to: next as never, replace: true });
        };

        if (sessionFromUrl) {
          await finalize(sessionFromUrl);
          return;
        }

        const started = Date.now();
        while (mountedRef.current && Date.now() - started < 3000) {
          const { data, error } = await supabase.auth.getSession();
          if (error) throw error;
          if (data.session) {
            await finalize(data.session);
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, 250));
        }

        if (mountedRef.current) {
          consumedRef.current = true;
          originalUrlRef.current = null;
          inviteIdRef.current = null;
          setConfirmationRequired(false);
          setShowRecovery(true);
          setMessage("No active session was found. Request a fresh magic link and open it once.");
        }
      } catch (err) {
        console.error(err);
        const { data } = await supabase.auth
          .getSession()
          .catch(() => ({ data: { session: null } }));
        if (data.session && mountedRef.current) {
          // Even on establish-failure, if a session exists we still
          // must finalize the exact invite before navigating.
          if (inviteIdRef.current) {
            const res = await finalizeExactInvite(inviteIdRef.current);
            if (!res.ok) {
              consumedRef.current = true;
              originalUrlRef.current = null;
              inviteIdRef.current = null;
              setConfirmationRequired(false);
              setShowRecovery(true);
              setMessage(res.reason);
              return;
            }
          }
          consumedRef.current = true;
          originalUrlRef.current = null;
          inviteIdRef.current = null;
          void notifyLogin(data.session);
          navigate({ to: next as never, replace: true });
          return;
        }
        if (mountedRef.current) {
          consumedRef.current = true;
          originalUrlRef.current = null;
          inviteIdRef.current = null;
          setConfirmationRequired(false);
          setShowRecovery(true);
          setMessage(callbackFailureMessage(err));
        }
      } finally {
        consumptionInFlightRef.current = false;
        if (mountedRef.current) setExchangeInFlight(false);
      }
    },
    [navigate],
  );

  useEffect(() => {
    mountedRef.current = true;
    if (!originalUrlRef.current && !consumedRef.current) {
      const captured = new URL(window.location.href);
      originalUrlRef.current = captured;
      // Capture exact invite id BEFORE scrub so callback finalization
      // can run against the invite the user actually clicked.
      inviteIdRef.current = readInviteId(captured);
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
