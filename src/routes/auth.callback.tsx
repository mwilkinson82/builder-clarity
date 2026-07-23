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
  } catch {
    console.warn("Login notification failed");
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

const INVALID_LINK_MESSAGE =
  "This sign-in link was already used or expired. Request a fresh magic link and open it once.";
const INVALID_INVITE_MESSAGE =
  "This invitation is no longer available. Ask your company administrator for a fresh invitation.";
const INVALID_CLIENT_ACCESS_MESSAGE =
  "This client access link is no longer available. Ask the project team for a fresh link.";

async function clearLocalAuthSession() {
  try {
    await supabase.auth.signOut({ scope: "local" });
  } catch {
    // Recovery must remain stable even if local storage is unavailable.
    console.warn("Could not clear local authentication state");
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readScopedId(url: URL, param: "invite_id" | "client_access_id"): string | null {
  const raw = url.searchParams.get(param);
  if (!raw) return null;
  return UUID_RE.test(raw) ? raw : null;
}

function hasInvalidProvisioningContext(url: URL): boolean {
  const rawInviteId = url.searchParams.get("invite_id");
  const rawClientAccessId = url.searchParams.get("client_access_id");
  if (rawInviteId && !UUID_RE.test(rawInviteId)) return true;
  if (rawClientAccessId && !UUID_RE.test(rawClientAccessId)) return true;
  return Boolean(rawInviteId && rawClientAccessId);
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
async function finalizeExactInvite(inviteId: string): Promise<boolean> {
  // Cast: finalize_invite_acceptance is created by
  // supabase/migrations/20260724000000_account_provisioning_history_containment.sql
  // which is intentionally UNAPPLIED until the maintenance window,
  // so the generated types file does not yet know the RPC.
  const rpc = supabase.rpc as unknown as (
    fn: "finalize_invite_acceptance",
    params: { p_invite_id: string },
  ) => Promise<{ data: string | null; error: unknown | null }>;
  try {
    const { data, error } = await rpc("finalize_invite_acceptance", {
      p_invite_id: inviteId,
    });
    return !error && Boolean(data);
  } catch {
    return false;
  }
}

async function finalizeExactClientAccess(clientAccessId: string): Promise<string | null> {
  // Cast until the maintenance-window migration that creates this
  // auth.uid/email-bound RPC has been applied and generated types refresh.
  const rpc = supabase.rpc as unknown as (
    fn: "finalize_client_access_acceptance",
    params: { p_client_access_id: string },
  ) => Promise<{ data: string | null; error: unknown | null }>;
  try {
    const { data, error } = await rpc("finalize_client_access_acceptance", {
      p_client_access_id: clientAccessId,
    });
    return !error && data && UUID_RE.test(data) ? data : null;
  } catch {
    return null;
  }
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
  const invalidProvisioningContextRef = useRef(false);
  const consumptionInFlightRef = useRef(false);
  const consumedRef = useRef(false);
  const mountedRef = useRef(false);

  const failClosed = useCallback(async (recoveryMessage: string) => {
    consumedRef.current = true;
    originalUrlRef.current = null;
    inviteIdRef.current = null;
    clientAccessIdRef.current = null;
    invalidProvisioningContextRef.current = false;
    await clearLocalAuthSession();
    if (!mountedRef.current) return;
    setConfirmationRequired(false);
    setShowRecovery(true);
    setMessage(recoveryMessage);
  }, []);

  const finishSignIn = useCallback(
    async (allowTokenConsumption: boolean) => {
      if (consumedRef.current) return;

      const url = originalUrlRef.current;
      if (!url) {
        await failClosed(INVALID_LINK_MESSAGE);
        return;
      }

      const next = safeAuthNext(url);
      setNextPath(next);

      if (invalidProvisioningContextRef.current) {
        await failClosed(INVALID_LINK_MESSAGE);
        return;
      }

      if (requiresExplicitMagicLinkConfirmation(url) && !allowTokenConsumption) {
        setConfirmationRequired(true);
        setMessage("Your secure link is ready. Continue to finish signing in.");
        return;
      }

      if (consumptionInFlightRef.current) return;
      consumptionInFlightRef.current = true;
      setExchangeInFlight(true);

      try {
        const sessionFromUrl = await establishSessionFromUrl(url);
        const finalize = async (session: { user: { id: string; email?: string | null } }) => {
          let destination = next;

          // Exact-invite finalization is atomic with sign-in: if the
          // invite RPC rejects (revoked / expired / different email /
          // mismatched caller) we must NOT navigate into internal
          // chrome. Fail closed to the recovery UI.
          if (inviteIdRef.current) {
            const finalized = await finalizeExactInvite(inviteIdRef.current);
            if (!finalized) {
              await failClosed(INVALID_INVITE_MESSAGE);
              return;
            }
          }

          // A client link is not access by itself. Bind and activate only
          // the exact client_access_id after Auth succeeds. The RPC returns
          // that row's project id; ignore the caller-provided next path and
          // land only on the exact canonical client project route.
          if (clientAccessIdRef.current) {
            const projectId = await finalizeExactClientAccess(clientAccessIdRef.current);
            if (!projectId) {
              await failClosed(INVALID_CLIENT_ACCESS_MESSAGE);
              return;
            }
            destination = `/client/projects/${projectId}`;
          }

          // Router navigation is part of successful completion. Await it
          // before discarding the captured context; a rejected navigation
          // falls into failClosed below instead of stranding the callback in
          // a consumed, non-recoverable state.
          await navigate({ to: destination as never, replace: true });
          consumedRef.current = true;
          originalUrlRef.current = null;
          inviteIdRef.current = null;
          clientAccessIdRef.current = null;
          invalidProvisioningContextRef.current = false;
          void notifyLogin(session);
        };

        if (sessionFromUrl) {
          await finalize(sessionFromUrl);
          return;
        }

        await failClosed(INVALID_LINK_MESSAGE);
      } catch {
        await failClosed(INVALID_LINK_MESSAGE);
      } finally {
        consumptionInFlightRef.current = false;
        if (mountedRef.current) setExchangeInFlight(false);
      }
    },
    [failClosed, navigate],
  );

  useEffect(() => {
    mountedRef.current = true;
    if (!originalUrlRef.current && !consumedRef.current) {
      const captured = new URL(window.location.href);
      originalUrlRef.current = captured;
      // Capture exact provisioning ids BEFORE scrub so callback
      // finalization runs against the row the user actually clicked.
      // Malformed or ambiguous contexts fail closed before token use.
      inviteIdRef.current = readScopedId(captured, "invite_id");
      clientAccessIdRef.current = readScopedId(captured, "client_access_id");
      invalidProvisioningContextRef.current = hasInvalidProvisioningContext(captured);
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
