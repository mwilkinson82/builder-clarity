import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import type { ReactNode } from "react";
import {
  Activity,
  ArrowLeft,
  Building2,
  Clock3,
  LayoutDashboard,
  MonitorSmartphone,
  ShieldCheck,
  Users,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { getOverwatchAdminWorkspace, type AdminActivitySession } from "@/lib/admin.functions";
import { isOverwatchAdminEmail } from "@/lib/admin-access";

export const Route = createFileRoute("/_authenticated/admin")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !isOverwatchAdminEmail(data.user?.email)) {
      throw redirect({ to: "/" });
    }
  },
  head: () => ({
    meta: [
      { title: "Admin — Overwatch" },
      {
        name: "description",
        content: "Marshall-only Overwatch administration workspace.",
      },
    ],
  }),
  component: AdminPage,
});

const numberFormatter = new Intl.NumberFormat("en-US");
const dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

function formatNumber(value: number) {
  return numberFormatter.format(Math.max(0, Math.round(value)));
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return "Unknown";
  return dateTimeFormatter.format(date);
}

function relativeActivityTime(value: string) {
  const seenAt = new Date(value).getTime();
  if (!value || Number.isNaN(seenAt)) return "unknown";
  const seconds = Math.max(0, Math.round((Date.now() - seenAt) / 1000));
  if (seconds < 45) return "now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return `${hours}h ago`;
}

function compactRoutePath(routePath: string) {
  const clean = routePath.split("?")[0] || "/";
  if (clean === "/") return "Portfolio";
  if (clean === "/team") return "Company";
  return (
    clean
      .split("/")
      .filter(Boolean)
      .slice(0, 4)
      .map((part) => (part.length > 22 ? `${part.slice(0, 19)}...` : part))
      .join(" / ") || "Overwatch"
  );
}

function initials(value: string) {
  return (
    value
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "OW"
  );
}

function AdminPage() {
  const loadWorkspace = useServerFn(getOverwatchAdminWorkspace);
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["overwatch-admin-workspace"],
    queryFn: () => loadWorkspace(),
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });

  const activeUsers = data?.activeSessions.length ?? 0;
  const activeWindowLabel = data ? `${Math.round(data.activeWindowSeconds / 60)} min` : "2 min";

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-hairline bg-surface-elevated">
        <div className="mx-auto flex max-w-[1600px] flex-col gap-4 px-6 py-5 lg:flex-row lg:items-center lg:justify-between lg:px-10">
          <div>
            <Button asChild variant="ghost" size="sm" className="-ml-3 mb-2 gap-1.5">
              <Link to="/">
                <ArrowLeft className="h-3.5 w-3.5" />
                Portfolio
              </Link>
            </Button>
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
              <ShieldCheck className="h-3.5 w-3.5 text-accent" />
              Marshall-only admin
            </div>
            <h1 className="mt-1 font-serif text-3xl text-foreground">Overwatch Admin</h1>
          </div>
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link to="/">
                <LayoutDashboard className="h-3.5 w-3.5" />
                Portfolio
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link to="/team">
                <Building2 className="h-3.5 w-3.5" />
                Company
              </Link>
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1600px] px-6 py-7 lg:px-10">
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <AdminMetric
            icon={<Users className="h-4 w-4" />}
            label="Active now"
            value={formatNumber(activeUsers)}
            detail={`Seen inside ${activeWindowLabel}`}
          />
          <AdminMetric
            icon={<Activity className="h-4 w-4" />}
            label="Open sessions"
            value={formatNumber(data?.rawSessionCount ?? 0)}
            detail="Browser tabs reporting"
          />
          <AdminMetric
            icon={<Building2 className="h-4 w-4" />}
            label="Companies"
            value={formatNumber(data?.organizationCount ?? 0)}
            detail="Represented online"
          />
          <AdminMetric
            icon={<Clock3 className="h-4 w-4" />}
            label="Last refresh"
            value={data ? formatDateTime(data.generatedAt) : "Loading"}
            detail="Auto-refreshes every 30s"
          />
        </section>

        <section
          data-testid="overwatch-admin-live-activity"
          className="mt-6 rounded-lg border border-hairline bg-card p-5 shadow-card"
        >
          <div className="flex flex-col gap-3 border-b border-hairline pb-4 md:flex-row md:items-start md:justify-between">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                Site presence
              </div>
              <h2 className="mt-1 font-serif text-2xl text-foreground">Active users</h2>
            </div>
            <div className="inline-flex w-fit items-center gap-2 rounded-full border border-success/25 bg-success/10 px-3 py-1.5 text-sm font-medium text-success">
              <Activity className="h-3.5 w-3.5" />
              {formatNumber(activeUsers)} active
            </div>
          </div>

          {isLoading ? (
            <div className="mt-5 rounded-md border border-hairline bg-surface px-4 py-8 text-center text-sm text-muted-foreground">
              Loading live activity...
            </div>
          ) : isError ? (
            <div className="mt-5 rounded-md border border-danger/30 bg-danger/10 px-4 py-5 text-sm text-danger">
              {error instanceof Error ? error.message : "Admin activity did not load."}
            </div>
          ) : !data?.schemaReady ? (
            <div className="mt-5 rounded-md border border-warning/30 bg-warning/10 px-4 py-5 text-sm text-warning">
              Activity table is waiting for the database migration. Heartbeats will appear here
              after Lovable applies the schema.
            </div>
          ) : data.activeSessions.length === 0 ? (
            <div className="mt-5 rounded-md border border-hairline bg-surface px-4 py-8 text-center text-sm text-muted-foreground">
              No users are active in the current two-minute window.
            </div>
          ) : (
            <div className="mt-5 grid gap-2">
              {data.activeSessions.map((session) => (
                <ActivityRow key={session.id} session={session} />
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

function AdminMetric({
  icon,
  label,
  value,
  detail,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-lg border border-hairline bg-card p-4 shadow-card">
      <div className="flex items-center justify-between gap-3">
        <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          {label}
        </div>
        <div className="flex h-8 w-8 items-center justify-center rounded-md border border-accent/20 bg-accent/10 text-accent">
          {icon}
        </div>
      </div>
      <div className="mt-4 font-serif text-3xl leading-none text-foreground">{value}</div>
      <div className="mt-1 text-sm text-muted-foreground">{detail}</div>
    </div>
  );
}

function ActivityRow({ session }: { session: AdminActivitySession }) {
  const displayName = session.full_name || session.email || "Signed-in user";
  const routeLabel = compactRoutePath(session.route_path);

  return (
    <div className="grid gap-3 rounded-md border border-hairline bg-surface px-3 py-3 lg:grid-cols-[minmax(220px,1fr)_minmax(180px,0.65fr)_minmax(240px,1fr)_minmax(180px,0.7fr)] lg:items-center">
      <div className="flex min-w-0 items-center gap-3">
        <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-success/30 bg-success/10 text-xs font-semibold text-success">
          {initials(displayName)}
          <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border border-card bg-success" />
        </div>
        <div className="min-w-0">
          <div className="truncate font-medium text-foreground">{displayName}</div>
          <div className="truncate text-xs text-muted-foreground">
            {session.email || "No email on profile"}
          </div>
        </div>
      </div>

      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-foreground">
          {session.organization_name}
        </div>
        <div className="truncate text-xs text-muted-foreground">{session.organization_id}</div>
      </div>

      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-foreground">{routeLabel}</div>
        <div className="truncate text-xs text-muted-foreground">
          {session.page_title || session.route_path || "Overwatch"}
        </div>
      </div>

      <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-muted-foreground lg:justify-end">
        <span className="inline-flex items-center gap-1.5 rounded-md border border-hairline bg-card px-2.5 py-1.5 font-medium">
          <Clock3 className="h-3.5 w-3.5" />
          {relativeActivityTime(session.last_seen_at)}
        </span>
        <span
          className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-hairline bg-card px-2.5 py-1.5"
          title={session.user_agent || "Unknown device"}
        >
          <MonitorSmartphone className="h-3.5 w-3.5" />
          <span className="max-w-[220px] truncate">{session.user_agent || "Unknown device"}</span>
        </span>
      </div>
    </div>
  );
}
