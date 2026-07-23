import {
  createFileRoute,
  Outlet,
  redirect,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { recordUserActivity } from "@/lib/team.functions";
import {
  clientProjectIdFromPath,
  clientPortalPathForProject,
  isClientPortalPath,
  resolveAccessMode,
  type AccessMode,
} from "@/lib/auth/access-mode";

const ACTIVITY_SESSION_STORAGE_KEY = "overwatch_activity_session_id";
const ACTIVITY_HEARTBEAT_MS = 45_000;
const ACCESS_RECHECK_MS = 60_000;
const HEARTBEAT_FAILURE_RECHECK_COOLDOWN_MS = 10_000;

function createActivitySessionId() {
  const randomId =
    typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : "";
  return randomId || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function getActivitySessionId() {
  try {
    const existing = window.sessionStorage.getItem(ACTIVITY_SESSION_STORAGE_KEY);
    if (existing) return existing;
    const next = createActivitySessionId();
    window.sessionStorage.setItem(ACTIVITY_SESSION_STORAGE_KEY, next);
    return next;
  } catch {
    return createActivitySessionId();
  }
}

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();

    if (sessionError || !sessionData.session) {
      throw redirect({
        to: "/auth",
        search: { next: location.href },
        replace: true,
      });
    }

    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
      throw redirect({
        to: "/auth",
        search: { next: location.href },
        replace: true,
      });
    }

    return { user: data.user };
  },
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const routeHref = useRouterState({ select: (state) => state.location.href });
  const routePathname = useRouterState({ select: (state) => state.location.pathname });
  const navigate = useNavigate();
  const recordActivity = useServerFn(recordUserActivity);
  const resolveMode = useServerFn(resolveAccessMode);

  const [mode, setMode] = useState<AccessMode | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const lastHeartbeatFailureRecheckRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const resolveVerifiedMode = async () => {
      const { data, error } = await supabase.auth.getUser();
      if (error || !data.user) {
        await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
        if (!cancelled) window.location.replace("/auth");
        return;
      }

      try {
        const next = await resolveMode({ data: undefined });
        if (!cancelled) setMode(next);
      } catch {
        if (!cancelled) {
          setMode({
            kind: "lookup_error",
            message: "We couldn't verify your access.",
          });
        }
      }
    };

    void resolveVerifiedMode();
    return () => {
      cancelled = true;
    };
  }, [resolveMode, reloadKey]);

  useEffect(() => {
    const refreshAccess = () => setReloadKey((key) => key + 1);
    const handleFocus = () => refreshAccess();
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") refreshAccess();
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        window.location.replace("/auth");
        return;
      }
      refreshAccess();
    });

    return () => {
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      subscription.unsubscribe();
    };
  }, []);

  // A disabled company seat or revoked client-project grant must leave the
  // protected screen even when the browser remains focused and Supabase emits
  // no auth event. Re-check active access in the background; keep the current
  // screen mounted until the answer arrives so the interval does not create a
  // once-per-minute loading flash.
  useEffect(() => {
    if (mode?.kind !== "internal_active" && mode?.kind !== "client_only") return;
    const interval = window.setInterval(() => setReloadKey((key) => key + 1), ACCESS_RECHECK_MS);
    return () => window.clearInterval(interval);
  }, [mode?.kind]);

  const clientPortalProjectId = useMemo(
    () => clientProjectIdFromPath(routePathname),
    [routePathname],
  );
  const onClientPortalRoute = useMemo(() => isClientPortalPath(routePathname), [routePathname]);
  const onAuthorizedClientPortalRoute =
    mode?.kind === "client_only" &&
    onClientPortalRoute &&
    clientPortalProjectId !== null &&
    mode.clientProjectIds.includes(clientPortalProjectId);

  // Redirect client-only identity from root/internal chrome to their
  // first exact authorized client-portal project once; never loop.
  useEffect(() => {
    if (!mode || mode.kind !== "client_only") return;
    if (onAuthorizedClientPortalRoute) return;
    const first = mode.clientProjectIds[0];
    if (!first) return;
    navigate({ to: clientPortalPathForProject(first), replace: true });
  }, [mode, onAuthorizedClientPortalRoute, navigate]);

  // Heartbeat runs only for internal_active — never for client_only,
  // no_active_company, or lookup_error, since it calls
  // ensureCurrentOrganization and would otherwise spam every 45s.
  const heartbeatEnabled = mode?.kind === "internal_active";

  useEffect(() => {
    if (!heartbeatEnabled) return;
    const clientSessionId = getActivitySessionId();
    let cancelled = false;

    const sendHeartbeat = () => {
      if (cancelled || document.visibilityState === "hidden") return;
      const routePath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      void recordActivity({
        data: {
          clientSessionId,
          routePath,
          pageTitle: document.title,
          userAgent: navigator.userAgent,
        },
      }).catch(() => {
        console.warn("Overwatch activity heartbeat failed");
        const now = Date.now();
        if (now - lastHeartbeatFailureRecheckRef.current >= HEARTBEAT_FAILURE_RECHECK_COOLDOWN_MS) {
          lastHeartbeatFailureRecheckRef.current = now;
          setReloadKey((key) => key + 1);
        }
      });
    };

    sendHeartbeat();
    const interval = window.setInterval(sendHeartbeat, ACTIVITY_HEARTBEAT_MS);
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") sendHeartbeat();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [recordActivity, routeHref, heartbeatEnabled]);

  const handleSignOut = useCallback(async () => {
    try {
      await supabase.auth.signOut({ scope: "local" });
    } finally {
      window.location.replace("/auth");
    }
  }, []);

  // Loading — first-paint before mode resolves. Keep it minimal; no
  // internal chrome renders yet.
  if (!mode) {
    return (
      <div
        data-testid="access-mode-loading"
        className="flex min-h-screen items-center justify-center bg-background p-8 text-sm text-muted-foreground"
      >
        Checking your access…
      </div>
    );
  }

  // Internal user OR client-only user visiting a valid client-portal
  // route: render children.
  if (mode.kind === "internal_active") {
    return <Outlet />;
  }

  if (mode.kind === "client_only" && onAuthorizedClientPortalRoute) {
    return <Outlet />;
  }

  if (mode.kind === "client_only") {
    // Redirect effect above will fire; render a small stable placeholder
    // meanwhile — never internal chrome.
    return (
      <div
        data-testid="access-mode-client-redirecting"
        className="flex min-h-screen items-center justify-center bg-background p-8 text-sm text-muted-foreground"
      >
        Opening your project…
      </div>
    );
  }

  if (mode.kind === "lookup_error") {
    return (
      <AccessMessage
        testId="access-mode-lookup-error"
        title="We couldn't verify your access"
        body="This is usually a transient issue. Try again in a moment."
        detail={mode.message}
        primary={{ label: "Retry", onClick: () => setReloadKey((k) => k + 1) }}
        onSignOut={handleSignOut}
        support
      />
    );
  }

  // no_active_company
  return (
    <AccessMessage
      testId="access-mode-no-active-company"
      title="No active company access"
      body="Your Overwatch account isn't attached to an active company right now. Contact your company owner to restore access, or reach out to Overwatch support."
      primary={{ label: "Check access again", onClick: () => setReloadKey((k) => k + 1) }}
      onSignOut={handleSignOut}
      support
    />
  );
}

type AccessMessageProps = {
  testId: string;
  title: string;
  body: string;
  detail?: string;
  primary?: { label: string; onClick: () => void };
  onSignOut: () => void;
  support?: boolean;
};

function AccessMessage({
  testId,
  title,
  body,
  detail,
  primary,
  onSignOut,
  support,
}: AccessMessageProps) {
  return (
    <main
      data-testid={testId}
      className="flex min-h-screen w-full min-w-0 items-center justify-center overflow-x-hidden bg-background p-4 text-foreground sm:p-6"
    >
      <section className="hairline w-full min-w-0 max-w-lg rounded-xl border bg-surface p-6 shadow-sm sm:p-8">
        <p className="eyebrow">Overwatch</p>
        <h1 className="mb-3 mt-2 break-words font-serif text-3xl font-normal">{title}</h1>
        <p className="mb-5 break-words text-sm leading-relaxed text-muted-foreground">{body}</p>
        {detail ? <p className="mb-5 break-words text-xs text-muted-foreground">{detail}</p> : null}
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          {primary ? (
            <Button type="button" onClick={primary.onClick}>
              {primary.label}
            </Button>
          ) : null}
          <Button type="button" variant="outline" onClick={onSignOut}>
            Sign out
          </Button>
          {support ? (
            <a
              href="mailto:support@alpcontractorcircle.com"
              className="min-w-0 break-all text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              support@alpcontractorcircle.com
            </a>
          ) : null}
        </div>
      </section>
    </main>
  );
}
