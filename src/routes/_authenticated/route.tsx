import {
  createFileRoute,
  Link,
  Outlet,
  redirect,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { recordUserActivity } from "@/lib/team.functions";
import {
  clientPortalPathForProject,
  isClientPortalPath,
  resolveAccessMode,
  type AccessMode,
} from "@/lib/auth/access-mode";

const ACTIVITY_SESSION_STORAGE_KEY = "overwatch_activity_session_id";
const ACTIVITY_HEARTBEAT_MS = 45_000;

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
    // Fail-closed: getUser() is authoritative. It re-validates the
    // access token against Supabase Auth, so a stale localStorage
    // session cannot mask a revoked/disabled user. If it fails for
    // ANY reason, sign out locally and redirect to /auth. We must
    // NOT render Outlet from a "restored session" fallback — that
    // is exactly how a disabled seat kept seeing internal chrome.
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      try {
        await supabase.auth.signOut();
      } catch {
        /* redirect is authoritative */
      }
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

  useEffect(() => {
    let cancelled = false;
    setMode(null);
    resolveMode({ data: undefined })
      .then((next: AccessMode) => {
        if (!cancelled) setMode(next);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setMode({
          kind: "lookup_error",
          message: error instanceof Error ? error.message : "Access lookup failed.",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [resolveMode, reloadKey]);

  // Re-resolve access on visibility return AND on auth-state changes.
  // A seat disabled mid-session (owner revoked, membership deactivated,
  // capability removed) must lose access without a hard refresh. This
  // also covers the case where the same tab was left open across a
  // sign-out from another tab.
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState !== "visible") return;
      setReloadKey((k) => k + 1);
    };
    const handleFocus = () => setReloadKey((k) => k + 1);
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("focus", handleFocus);
    const { data: authSub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        window.location.replace("/auth");
        return;
      }
      if (event === "SIGNED_IN" || event === "USER_UPDATED" || event === "TOKEN_REFRESHED") {
        setReloadKey((k) => k + 1);
      }
    });
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("focus", handleFocus);
      authSub.subscription.unsubscribe();
    };
  }, []);

  const onClientPortalRoute = useMemo(() => isClientPortalPath(routePathname), [routePathname]);

  // Redirect client-only identity from root/internal chrome to their
  // client-portal project once; never loop.
  useEffect(() => {
    if (!mode || mode.kind !== "client_only") return;
    if (onClientPortalRoute) return;
    const first = mode.clientProjectIds[0];
    if (!first) return;
    navigate({ to: clientPortalPathForProject(first), replace: true });
  }, [mode, onClientPortalRoute, navigate]);

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
      }).catch((error) => {
        console.warn("Overwatch activity heartbeat failed", error);
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
      await supabase.auth.signOut();
    } finally {
      window.location.replace("/auth");
    }
  }, []);

  // Loading — first-paint before mode resolves. Keep it minimal; no
  // internal chrome renders yet.
  if (!mode) {
    return (
      <div data-testid="access-mode-loading" style={{ padding: 32, fontFamily: "sans-serif" }}>
        Checking your access…
      </div>
    );
  }

  // Internal user OR client-only user visiting a valid client-portal
  // route: render children.
  if (mode.kind === "internal_active") {
    return <Outlet />;
  }

  if (mode.kind === "client_only" && onClientPortalRoute) {
    return <Outlet />;
  }

  if (mode.kind === "client_only") {
    // Redirect effect above will fire; render a small stable placeholder
    // meanwhile — never internal chrome.
    return (
      <div data-testid="access-mode-client-redirecting" style={{ padding: 32 }}>
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
      />
    );
  }

  // no_active_company
  return (
    <AccessMessage
      testId="access-mode-no-active-company"
      title="No active company access"
      body="Your Overwatch account isn't attached to an active company right now. Contact your company owner to restore access, or reach out to Overwatch support."
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
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        background: "#f7f4ee",
        fontFamily: "Inter, system-ui, sans-serif",
        color: "#211a16",
      }}
    >
      <div
        style={{
          maxWidth: 480,
          background: "#fff",
          border: "1px solid #e7e0d5",
          borderRadius: 12,
          padding: 32,
        }}
      >
        <p
          style={{
            margin: 0,
            textTransform: "uppercase",
            letterSpacing: "0.16em",
            fontSize: 11,
            color: "#776e66",
          }}
        >
          Overwatch
        </p>
        <h1
          style={{
            margin: "8px 0 12px",
            fontFamily: "Georgia, serif",
            fontWeight: 400,
            fontSize: 26,
          }}
        >
          {title}
        </h1>
        <p style={{ margin: "0 0 20px", color: "#5f5750", lineHeight: 1.55 }}>{body}</p>
        {detail ? (
          <p style={{ margin: "0 0 20px", fontSize: 12, color: "#8a7f74" }}>{detail}</p>
        ) : null}
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {primary ? (
            <button
              type="button"
              onClick={primary.onClick}
              style={{
                background: "#211a16",
                color: "#fff",
                border: 0,
                borderRadius: 6,
                padding: "10px 18px",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {primary.label}
            </button>
          ) : null}
          <button
            type="button"
            onClick={onSignOut}
            style={{
              background: "#fff",
              color: "#211a16",
              border: "1px solid #211a16",
              borderRadius: 6,
              padding: "10px 18px",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Sign out
          </button>
          {support ? (
            <Link to="/support" style={{ alignSelf: "center", color: "#5f5750", fontSize: 14 }}>
              Support
            </Link>
          ) : null}
          {support ? (
            <a
              href="mailto:support@alpcontractorcircle.com"
              style={{ alignSelf: "center", color: "#5f5750", fontSize: 14 }}
            >
              support@alpcontractorcircle.com
            </a>
          ) : null}
        </div>
      </div>
    </main>
  );
}
