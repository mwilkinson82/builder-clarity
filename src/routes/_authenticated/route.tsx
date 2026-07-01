import { createFileRoute, Outlet, redirect, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { recordUserActivity } from "@/lib/team.functions";

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
      console.warn("Supabase user verification failed; continuing with restored session", error);
      return { user: sessionData.session.user };
    }

    return { user: data.user };
  },
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const routeHref = useRouterState({ select: (state) => state.location.href });
  const recordActivity = useServerFn(recordUserActivity);

  useEffect(() => {
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
  }, [recordActivity, routeHref]);

  return <Outlet />;
}
