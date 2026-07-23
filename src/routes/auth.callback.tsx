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

function AuthCallbackPage() {
  const navigate = useNavigate();
  const [message, setMessage] = useState("Completing sign-in...");
  const [nextPath, setNextPath] = useState("/");
  const [showRecovery, setShowRecovery] = useState(false);
  const [confirmationRequired, setConfirmationRequired] = useState(false);

  // Original callback URL (with token_hash / code / hash tokens) is captured
  // exactly once in memory and NEVER re-read from window.location, which is
  // scrubbed immediately below. Cleared after success or definitive failure.
  const originalUrlRef = useRef<URL | null>(null);

  const finishSignIn = useCallback(
    async (allowTokenConsumption: boolean, isCancelled: () => boolean) => {
      const url = originalUrlRef.current;
      if (!url) {
        if (!isCancelled()) {
          setShowRecovery(true);
          setMessage("No active session was found. Request a fresh magic link and open it once.");
        }
        return;
      }
      try {
        const next = safeAuthNext(url);
        setNextPath(next);

        if (requiresExplicitMagicLinkConfirmation(url) && !allowTokenConsumption) {
          setConfirmationRequired(true);
          setMessage("Your secure link is ready. Continue to finish signing in.");
          return;
        }

        setConfirmationRequired(false);
        const sessionFromUrl = await establishSessionFromUrl(url);
        if (sessionFromUrl) {
          originalUrlRef.current = null;
          void notifyLogin(sessionFromUrl);
          navigate({ to: next as never, replace: true });
          return;
        }

        const started = Date.now();
        while (!isCancelled() && Date.now() - started < 3000) {
          const { data, error } = await supabase.auth.getSession();
          if (error) throw error;
          if (data.session) {
            originalUrlRef.current = null;
            void notifyLogin(data.session);
            navigate({ to: next as never, replace: true });
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, 250));
        }

        if (!isCancelled()) {
          originalUrlRef.current = null;
          setShowRecovery(true);
          setMessage("No active session was found. Request a fresh magic link and open it once.");
        }
      } catch (err) {
        console.error(err);
        const { data } = await supabase.auth
          .getSession()
          .catch(() => ({ data: { session: null } }));
        if (data.session && !isCancelled()) {
          const next = safeAuthNext(url);
          originalUrlRef.current = null;
          void notifyLogin(data.session);
          navigate({ to: next as never, replace: true });
          return;
        }
        if (!isCancelled()) {
          originalUrlRef.current = null;
          setShowRecovery(true);
          setMessage(callbackFailureMessage(err));
        }
      }
    },
    [navigate],
  );

  useEffect(() => {
    // Capture the full original URL (credentials + hash) in a ref, then
    // immediately scrub the address bar / history so no secret is visible
    // during the human confirmation screen or the network exchange.
    if (!originalUrlRef.current) {
      const captured = new URL(window.location.href);
      originalUrlRef.current = captured;
      setNextPath(safeAuthNext(captured));
      try {
        const scrubbed = scrubbedCallbackUrl(window.location.href);
        window.history.replaceState(null, "", scrubbed);
      } catch {
        /* replaceState best-effort */
      }
    }

    let cancelled = false;
    void finishSignIn(false, () => cancelled);

    return () => {
      cancelled = true;
    };
  }, [finishSignIn]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6 text-foreground">
      <div className="max-w-sm text-center">
        <div className="mx-auto h-2 w-12 rounded-full bg-primary/70" />
        <h1 className="mt-6 font-serif text-3xl">Opening OverWatch</h1>
        <p className="mt-2 text-sm text-muted-foreground">{message}</p>
        {confirmationRequired && (
          <button
            type="button"
            onClick={() => {
              setMessage("Completing sign-in...");
              void finishSignIn(true, () => false);
            }}
            className="mt-6 inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
          >
            Continue to Overwatch
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
