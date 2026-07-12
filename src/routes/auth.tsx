import { createFileRoute, useNavigate, Link, Outlet, useLocation } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
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
        content: "Sign in to Overwatch, the IOR project management command center for contractors.",
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

const MONO_LABEL =
  "font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground";

function AuthForm() {
  const navigate = useNavigate();
  const next = safeNextFromLocation();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [magicLoading, setMagicLoading] = useState(false);

  const isSignup = mode === "signup";

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

  const toggleMode = () => {
    setMode(isSignup ? "signin" : "signup");
    setError(null);
    setNotice(null);
  };

  const sendMagicLink = async () => {
    setError(null);
    setNotice(null);
    if (!email) {
      setError("Enter your work email above, then request a magic link.");
      return;
    }
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
    <div className="flex min-h-screen items-center justify-center bg-background p-4 text-foreground sm:p-6">
      <div className="flex w-full max-w-[880px] flex-col overflow-hidden rounded-xl border hairline bg-surface shadow-sm md:min-h-[560px] md:flex-row">
        {/* Left — dark brand panel (hidden on mobile; a compact wordmark shows above the form instead) */}
        <div className="hidden flex-col bg-dark-panel p-11 text-dark-panel-foreground md:flex md:w-[46%]">
          <Link to="/" aria-label="Overwatch home" className="flex w-fit items-baseline gap-2">
            <span className="text-[30px] font-extrabold leading-none tracking-[-0.03em] text-dark-panel-foreground">
              OverWatch
            </span>
            <span className="mb-[3px] inline-block h-2 w-2 bg-signal" aria-hidden />
          </Link>
          <div className="my-auto">
            <div className="eyebrow">Enterprise construction OS</div>
            <h1 className="mt-4 max-w-[16ch] font-serif text-[40px] font-normal leading-[1.12] text-dark-panel-foreground">
              Every dollar, from first call to cash in the bank.
            </h1>
            <p className="mt-5 max-w-[44ch] text-sm leading-relaxed text-dark-panel-foreground/70">
              Pipeline, estimating, delivery, schedule and billing — one operating record for the
              whole company.
            </p>
          </div>
          <div className={`${MONO_LABEL} text-dark-panel-foreground/60`}>
            Trusted by builders on $7.4M+ of active work
          </div>
        </div>

        {/* Right — sign-in form */}
        <div className="flex flex-1 flex-col bg-surface p-8 sm:p-10 md:p-11">
          <div className="flex items-center">
            <Link
              to="/"
              aria-label="Overwatch home"
              className="flex w-fit items-baseline gap-2 md:hidden"
            >
              <span className="text-xl font-extrabold leading-none tracking-[-0.03em] text-foreground">
                OverWatch
              </span>
              <span className="mb-[2px] inline-block h-1.5 w-1.5 bg-signal" aria-hidden />
            </Link>
            <div className={`ml-auto ${MONO_LABEL}`}>
              {isSignup ? "Have an account? " : "New here? "}
              <button
                type="button"
                onClick={toggleMode}
                className="font-bold text-clay hover:underline"
              >
                {isSignup ? "Sign in" : "Request access"}
              </button>
            </div>
          </div>

          <div className="mx-auto my-auto w-full max-w-[380px] py-8">
            <div className="eyebrow">{isSignup ? "Get started" : "Welcome back"}</div>
            <h2 className="mb-6 mt-2.5 font-serif text-3xl font-normal text-foreground">
              {isSignup ? "Create your account" : "Sign in to OverWatch"}
            </h2>

            <form onSubmit={onPasswordSubmit} className="space-y-3.5">
              <div className="space-y-1.5">
                <Label htmlFor="email" className={MONO_LABEL}>
                  Work email
                </Label>
                <Input
                  id="email"
                  type="email"
                  required
                  autoComplete="email"
                  placeholder="you@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="password" className={MONO_LABEL}>
                  Password
                </Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    required
                    minLength={6}
                    autoComplete={isSignup ? "new-password" : "current-password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    title={showPassword ? "Hide password" : "Show password"}
                    className="absolute inset-y-0 right-0 flex items-center pr-3 text-muted-foreground hover:text-foreground"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between pt-0.5">
                <label
                  className="flex items-center gap-2 text-xs text-muted-foreground"
                  title="You stay signed in on this device — Overwatch keeps your session automatically."
                >
                  <input
                    type="checkbox"
                    defaultChecked
                    disabled
                    className="h-4 w-4 rounded border-input accent-clay"
                  />
                  Keep me signed in
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setNotice(
                      'No password? Use "Email me a magic link" below — it signs you in without one.',
                    );
                  }}
                  className="text-xs font-semibold text-clay hover:underline"
                >
                  Forgot password?
                </button>
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

              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Working…" : isSignup ? "Create account →" : "Sign in →"}
              </Button>
            </form>

            <div className="my-4 flex items-center gap-3">
              <span className="h-px flex-1 bg-border" />
              <span className={MONO_LABEL}>or</span>
              <span className="h-px flex-1 bg-border" />
            </div>

            <Button
              type="button"
              variant="outline"
              onClick={() => void sendMagicLink()}
              disabled={magicLoading}
              className="w-full"
            >
              {magicLoading ? "Sending…" : "Email me a magic link instead"}
            </Button>

            <Button
              type="button"
              variant="outline"
              disabled
              title="Google sign-in is coming soon"
              className="mt-3 w-full gap-2"
            >
              <span className="h-4 w-4 rounded-full bg-muted" aria-hidden />
              Continue with Google
            </Button>

            <div className={`mt-8 flex justify-center gap-4 ${MONO_LABEL}`}>
              <span>© 2026 ALP</span>
              <span aria-hidden>·</span>
              <span>an ALP product</span>
              <span aria-hidden>·</span>
              <span>Support</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
