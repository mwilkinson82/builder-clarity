import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { sendTransactionalEmail } from "@/lib/email/send";

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
  ssr: false,
  head: () => ({
    meta: [
      { title: "Signing in — Project Outcome Review" },
      { name: "description", content: "Completing your Project Outcome Review sign-in." },
    ],
  }),
  component: AuthCallbackPage,
});

function safeNextFromUrl(url: URL) {
  const next = url.searchParams.get("next") ?? "/";
  if (!next.startsWith("/") || next.startsWith("//")) return "/";
  return next;
}

function callbackHref(next: string) {
  return `/auth/callback?next=${encodeURIComponent(next)}`;
}

function authHref(next: string) {
  return `/auth?next=${encodeURIComponent(next)}`;
}

function cleanCallbackUrl(url: URL) {
  if (url.hash) window.history.replaceState(null, "", `${url.pathname}${url.search}`);
}

function goAfterSignIn(next: string) {
  window.location.replace(next);
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

  const hashParams = new URLSearchParams(url.hash.replace(/^#/, ""));
  const authError = hashParams.get("error_description") ?? hashParams.get("error");
  if (authError) {
    cleanCallbackUrl(url);
    throw new Error(authError);
  }

  const accessToken = hashParams.get("access_token");
  const refreshToken = hashParams.get("refresh_token");
  if (!accessToken || !refreshToken) return null;

  try {
    const { data, error } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
    if (error) throw error;
    return data.session ?? null;
  } finally {
    cleanCallbackUrl(url);
  }
}

function AuthCallbackPage() {
  const [message, setMessage] = useState("Completing sign-in...");
  const [nextPath, setNextPath] = useState("/");
  const [showRecovery, setShowRecovery] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function finishSignIn() {
      try {
        const url = new URL(window.location.href);
        const next = safeNextFromUrl(url);
        setNextPath(next);
        const sessionFromUrl = await establishSessionFromUrl(url);
        if (sessionFromUrl) {
          void notifyLogin(sessionFromUrl);
          goAfterSignIn(next);
          return;
        }

        const started = Date.now();
        while (!cancelled && Date.now() - started < 3000) {
          const { data, error } = await supabase.auth.getSession();
          if (error) throw error;
          if (data.session) {
            void notifyLogin(data.session);
            goAfterSignIn(next);
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, 250));
        }

        if (!cancelled) {
          setShowRecovery(true);
          setMessage("No active session was found. Request a fresh magic link and open it once.");
        }
      } catch (err) {
        console.error(err);
        if (!cancelled) {
          setShowRecovery(true);
          setMessage(callbackFailureMessage(err));
        }
      }
    }

    void finishSignIn();

    let subscription: { unsubscribe: () => void } | undefined;
    try {
      const { data } = supabase.auth.onAuthStateChange((_event, session) => {
        if (session && !cancelled) {
          goAfterSignIn(safeNextFromUrl(new URL(window.location.href)));
        }
      });
      subscription = data.subscription;
    } catch (err) {
      console.error(err);
      setMessage(err instanceof Error ? err.message : "Could not start sign-in listener.");
    }

    return () => {
      cancelled = true;
      subscription?.unsubscribe();
    };
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6 text-foreground">
      <div className="max-w-sm text-center">
        <div className="mx-auto h-2 w-12 rounded-full bg-primary/70" />
        <h1 className="mt-6 font-serif text-3xl">Opening IOR</h1>
        <p className="mt-2 text-sm text-muted-foreground">{message}</p>
        {showRecovery && (
          <div className="mt-6 flex flex-col gap-3">
            <a
              href={authHref(nextPath)}
              className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
            >
              Request fresh magic link
            </a>
            <a
              href={callbackHref(nextPath)}
              className="text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              Retry callback
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
