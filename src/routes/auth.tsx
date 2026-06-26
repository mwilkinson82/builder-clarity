import { createFileRoute, useNavigate, Link, Outlet, useLocation } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { sendOverwatchMagicLink } from "@/lib/auth/magic-link";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — Overwatch" },
      {
        name: "description",
        content:
          "Sign in to Overwatch, the IOR project management command center for contractors.",
      },
    ],
  }),
  component: AuthPage,
});

function safeNextFromLocation() {
  if (typeof window === "undefined") return "/";
  const next = new URLSearchParams(window.location.search).get("next") ?? "/";
  if (!next.startsWith("/") || next.startsWith("//")) return "/";
  return next;
}

const LIVE_AUTH_ORIGIN = "https://overwatch.alpcontractorcircle.com";

function authRedirectTo(next: string) {
  if (typeof window === "undefined")
    return `${LIVE_AUTH_ORIGIN}/auth/callback?next=${encodeURIComponent(next)}`;
  const isLocal = ["localhost", "127.0.0.1"].includes(window.location.hostname);
  const origin = isLocal ? window.location.origin : LIVE_AUTH_ORIGIN;
  return `${origin}/auth/callback?next=${encodeURIComponent(next)}`;
}

function goAfterAuth(next: string, navigate: ReturnType<typeof useNavigate>) {
  if (next === "/") {
    navigate({ to: "/", replace: true });
  } else {
    window.location.replace(next);
  }
}

function AuthPage() {
  const location = useLocation();
  const isCallbackRoute = location.pathname.startsWith("/auth/callback");

  if (isCallbackRoute) return <Outlet />;

  return <AuthForm />;
}

function AuthForm() {
  const navigate = useNavigate();
  const next = safeNextFromLocation();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [magicLoading, setMagicLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function checkExistingSession() {
      try {
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;
        if (!cancelled && data.session) goAfterAuth(next, navigate);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not check current session.");
        }
      }
    }

    void checkExistingSession();

    return () => {
      cancelled = true;
    };
  }, [navigate, next]);

  const sendMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setMagicLoading(true);
    try {
      await sendOverwatchMagicLink({ email, next, context: "login" });
      setNotice("Check your email. Your secure sign-in link is on the way.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send magic link");
    } finally {
      setMagicLoading(false);
    }
  };

  const onPasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setLoading(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: authRedirectTo(next),
          },
        });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
      goAfterAuth(next, navigate);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-12">
        <Link
          to="/"
          className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground"
        >
          ← Overwatch
        </Link>
        <h1 className="mt-6 font-serif text-4xl text-foreground">Sign in by magic link</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Enter your email and we will send a secure link. New users can use the same link to grab a
          seat and start creating projects.
        </p>

        <form onSubmit={sendMagicLink} className="mt-8 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          {error && (
            <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
              {error}
            </div>
          )}
          {notice && (
            <div className="rounded-md border border-success/40 bg-success/10 px-3 py-2 text-sm text-success">
              {notice}
            </div>
          )}
          <Button type="submit" className="w-full" disabled={magicLoading}>
            {magicLoading ? "Sending…" : "Send magic link"}
          </Button>
        </form>

        <div className="mt-8 border-t border-hairline pt-6">
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Password fallback
          </div>
          <form onSubmit={onPasswordSubmit} className="mt-4 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                required
                minLength={6}
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <Button type="submit" variant="outline" className="w-full" disabled={loading}>
              {loading
                ? "Working…"
                : mode === "signin"
                  ? "Sign in with password"
                  : "Create password account"}
            </Button>
          </form>

          <button
            type="button"
            onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
            className="mt-4 text-sm text-muted-foreground hover:text-foreground"
          >
            {mode === "signin"
              ? "Need a password account? Create one →"
              : "Already have a password? Sign in →"}
          </button>
        </div>
      </div>
    </div>
  );
}
