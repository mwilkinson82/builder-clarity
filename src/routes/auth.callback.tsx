import { createFileRoute, useNavigate } from "@tanstack/react-router";
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

function AuthCallbackPage() {
  const navigate = useNavigate();
  const [message, setMessage] = useState("Completing sign-in...");

  useEffect(() => {
    let cancelled = false;

    async function finishSignIn() {
      try {
        const url = new URL(window.location.href);
        const code = url.searchParams.get("code");
        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw error;
        }

        const started = Date.now();
        while (!cancelled && Date.now() - started < 8000) {
          const { data, error } = await supabase.auth.getSession();
          if (error) throw error;
          if (data.session) {
            void notifyLogin(data.session);
            navigate({ to: "/", replace: true });
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, 250));
        }

        if (!cancelled) {
          setMessage("Sign-in link opened. Taking you back to sign in...");
          navigate({ to: "/auth", replace: true });
        }
      } catch (err) {
        console.error(err);
        if (!cancelled) {
          setMessage(err instanceof Error ? err.message : "Could not complete sign-in.");
        }
      }
    }

    finishSignIn();

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session && !cancelled) navigate({ to: "/", replace: true });
    });

    return () => {
      cancelled = true;
      data.subscription.unsubscribe();
    };
  }, [navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6 text-foreground">
      <div className="max-w-sm text-center">
        <div className="mx-auto h-2 w-12 rounded-full bg-primary/70" />
        <h1 className="mt-6 font-serif text-3xl">Opening IOR</h1>
        <p className="mt-2 text-sm text-muted-foreground">{message}</p>
      </div>
    </div>
  );
}
