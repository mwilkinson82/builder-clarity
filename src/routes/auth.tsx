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
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
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

  const onMagicLinkSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await sendMagicLink();
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
              New here?{" "}
              <a
                href="mailto:support@alpcontractorcircle.com?subject=Request%20Overwatch%20access"
                className="font-bold text-clay hover:underline"
              >
                Request access
              </a>
            </div>
          </div>

          <div className="mx-auto my-auto w-full max-w-[380px] py-8">
            <div className="eyebrow">Welcome back</div>
            <h2 className="mb-6 mt-2.5 font-serif text-3xl font-normal text-foreground">
              Sign in to OverWatch
            </h2>
            <p className="mb-6 text-sm leading-relaxed text-muted-foreground">
              Enter your work email and we&apos;ll send you a secure, one-time sign-in link. No
              password needed.
            </p>

            <form onSubmit={onMagicLinkSubmit} className="space-y-3.5">
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

              {error && (
                <div
                  role="alert"
                  className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger"
                >
                  {error}
                </div>
              )}
              {notice && (
                <div
                  role="status"
                  aria-live="polite"
                  className="rounded-md border border-success/40 bg-success/10 px-3 py-2 text-sm text-success"
                >
                  {notice}
                </div>
              )}

              <Button type="submit" className="w-full" disabled={magicLoading}>
                {magicLoading ? "Sending…" : "Email me a sign-in link →"}
              </Button>
            </form>

            <p className="mt-4 text-center text-xs leading-relaxed text-muted-foreground">
              Each link works once. Overwatch keeps you signed in on this device after you open it.
            </p>

            <div className={`mt-8 flex justify-center gap-4 ${MONO_LABEL}`}>
              <span>© 2026 ALP</span>
              <span aria-hidden>·</span>
              <span>an ALP product</span>
              <span aria-hidden>·</span>
              <a href="mailto:support@alpcontractorcircle.com" className="hover:text-foreground">
                Support
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
