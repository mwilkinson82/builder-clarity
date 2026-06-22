import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { createProject, listProjects, seedDemoIfEmpty } from "@/lib/projects.functions";
import {
  assignProjectMember,
  createTeamInvite,
  getTeamWorkspace,
  removeProjectMember,
  revokeTeamInvite,
  updateProjectMember,
  updateTeamMember,
  type AccountRole,
  type MemberStatus,
  type ProjectMemberRole,
} from "@/lib/team.functions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Activity,
  AlertTriangle,
  BriefcaseBusiness,
  CalendarClock,
  ClipboardList,
  LogOut,
  MailPlus,
  Plus,
  Search,
  Trash2,
  Users,
} from "lucide-react";
import { fmtUSD, fmtPct } from "@/lib/format";
import { computeScheduleVarianceWeeks } from "@/lib/ior";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/")({
  head: () => ({
    meta: [
      { title: "Portfolio — Project Outcome Review" },
      { name: "description", content: "All active outcome reviews across your portfolio." },
    ],
  }),
  component: PortfolioPage,
});

function statusFor(originalPct: number, indicatedPct: number) {
  const erosion = originalPct - indicatedPct;
  if (erosion >= 5)
    return { label: "At Risk", className: "border-danger/40 bg-danger/10 text-danger" };
  if (erosion >= 2)
    return { label: "Watch", className: "border-warning/40 bg-warning/10 text-warning" };
  return { label: "Healthy", className: "border-success/40 bg-success/10 text-success" };
}

function scheduleFor(weeks: number, scheduleRiskCount: number) {
  const slip = Math.max(0, weeks);
  const score = Math.max(0, Math.min(100, 100 - slip * 8 - scheduleRiskCount * 6));
  if (slip >= 4 || score < 65) {
    return { label: "Slipped", score, className: "border-danger/40 bg-danger/10 text-danger" };
  }
  if (slip > 0 || scheduleRiskCount > 0) {
    return { label: "Watch", score, className: "border-warning/40 bg-warning/10 text-warning" };
  }
  return { label: "On plan", score, className: "border-success/40 bg-success/10 text-success" };
}

type PortfolioSortMode = "manager" | "profitability" | "gp-risk" | "schedule" | "overdue" | "name";

function PortfolioPage() {
  const list = useServerFn(listProjects);
  const seed = useServerFn(seedDemoIfEmpty);
  const qc = useQueryClient();
  const { data: projects = [], isLoading } = useQuery({
    queryKey: ["projects"],
    queryFn: () => list(),
  });
  const [search, setSearch] = useState("");
  const [managerFilter, setManagerFilter] = useState("all");
  const [sortMode, setSortMode] = useState<PortfolioSortMode>("manager");
  const managerNames = useMemo(
    () =>
      Array.from(new Set(projects.map((p) => p.project_manager.trim()).filter(Boolean))).sort(
        (a, b) => a.localeCompare(b),
      ),
    [projects],
  );
  const visibleProjects = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = projects.filter((p) => {
      const manager = p.project_manager.trim();
      const matchesManager = managerFilter === "all" || manager === managerFilter;
      const haystack = [p.name, p.job_number, p.client, p.project_manager].join(" ").toLowerCase();
      return matchesManager && (!q || haystack.includes(q));
    });
    const sorted = [...filtered];
    sorted.sort((a, b) => {
      if (sortMode === "profitability") return a.indicated_gp_pct - b.indicated_gp_pct;
      if (sortMode === "gp-risk") return b.gp_at_risk - a.gp_at_risk;
      if (sortMode === "overdue") {
        return (
          b.overdue_decision_count - a.overdue_decision_count ||
          b.active_decision_count - a.active_decision_count ||
          a.name.localeCompare(b.name)
        );
      }
      if (sortMode === "schedule") {
        const aScore = a.schedule_variance_weeks * 10 + a.schedule_risk_count;
        const bScore = b.schedule_variance_weeks * 10 + b.schedule_risk_count;
        return bScore - aScore;
      }
      if (sortMode === "name") return a.name.localeCompare(b.name);
      return (
        (a.project_manager || "Unassigned").localeCompare(b.project_manager || "Unassigned") ||
        a.name.localeCompare(b.name)
      );
    });
    return sorted;
  }, [managerFilter, projects, search, sortMode]);
  const portfolioTotals = useMemo(() => buildPortfolioTotals(visibleProjects), [visibleProjects]);

  const seededRef = useRef(false);
  useEffect(() => {
    if (isLoading || seededRef.current || projects.length > 0) return;
    seededRef.current = true;
    seed()
      .then((r) => {
        if (r.seeded) qc.invalidateQueries({ queryKey: ["projects"] });
      })
      .catch(() => {
        seededRef.current = false;
      });
  }, [isLoading, projects.length, seed, qc]);

  const navigate = useNavigate();
  const router = useRouter();
  const openProject = (projectId: string) => {
    window.location.assign(`/projects/${projectId}`);
  };
  const signOut = async () => {
    await supabase.auth.signOut();
    router.invalidate();
    navigate({ to: "/auth" });
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-hairline bg-surface-elevated">
        <div className="mx-auto flex max-w-[1400px] items-center justify-between px-6 py-6 lg:px-10">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
              Project Outcome Review
            </div>
            <h1 className="mt-1 font-serif text-3xl text-foreground">Portfolio</h1>
          </div>
          <div className="flex items-center gap-2">
            <InviteByMagicLinkButton />
            <NewProjectButton />
            <Button variant="ghost" size="sm" onClick={signOut} className="gap-1.5">
              <LogOut className="h-3.5 w-3.5" /> Sign out
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1400px] px-6 py-10 lg:px-10">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : projects.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="space-y-6">
            <PortfolioDashboard totals={portfolioTotals} />
            <div className="flex flex-col gap-3 rounded-lg border border-hairline bg-card p-4 shadow-card lg:flex-row lg:items-center">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search project, job number, client, or PM"
                  className="pl-9"
                />
              </div>
              <Select value={managerFilter} onValueChange={setManagerFilter}>
                <SelectTrigger className="w-full lg:w-[220px]">
                  <SelectValue placeholder="Project manager" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All project managers</SelectItem>
                  {managerNames.map((manager) => (
                    <SelectItem key={manager} value={manager}>
                      {manager}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={sortMode} onValueChange={(v) => setSortMode(v as PortfolioSortMode)}>
                <SelectTrigger className="w-full lg:w-[220px]">
                  <SelectValue placeholder="Sort" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="manager">PM A-Z</SelectItem>
                  <SelectItem value="profitability">Profitability low to high</SelectItem>
                  <SelectItem value="gp-risk">GP at risk high to low</SelectItem>
                  <SelectItem value="schedule">Schedule risk high to low</SelectItem>
                  <SelectItem value="overdue">Overdue to-dos high to low</SelectItem>
                  <SelectItem value="name">Project A-Z</SelectItem>
                </SelectContent>
              </Select>
              <div className="whitespace-nowrap text-xs text-muted-foreground">
                Showing {visibleProjects.length} of {projects.length}
              </div>
            </div>
            <div className="overflow-hidden rounded-lg border border-hairline bg-card shadow-card">
              <Table>
                <TableHeader>
                  <TableRow className="bg-surface">
                    <TableHead>Project</TableHead>
                    <TableHead>Job #</TableHead>
                    <TableHead>Project Manager</TableHead>
                    <TableHead className="text-right">Original Contract</TableHead>
                    <TableHead className="text-right">Plan GP %</TableHead>
                    <TableHead className="text-right">Indicated GP %</TableHead>
                    <TableHead className="text-right">GP At Risk</TableHead>
                    <TableHead className="text-right">Risk Allocated</TableHead>
                    <TableHead>Top Exposure</TableHead>
                    <TableHead>To-Dos</TableHead>
                    <TableHead>Schedule</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleProjects.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={12}
                        className="py-10 text-center text-sm text-muted-foreground"
                      >
                        No projects match the current portfolio filters.
                      </TableCell>
                    </TableRow>
                  )}
                  {visibleProjects.map((p) => {
                    const s = statusFor(p.original_gp_pct, p.indicated_gp_pct);
                    const schedule = scheduleFor(p.schedule_variance_weeks, p.schedule_risk_count);
                    const jobNumber = p.job_number || `ID ${p.id.slice(0, 8).toUpperCase()}`;
                    const projectHref = `/projects/${p.id}`;
                    const highlightRisk = s.label === "At Risk" || p.gp_at_risk > 0;
                    return (
                      <TableRow
                        key={p.id}
                        role="link"
                        tabIndex={0}
                        title={`Open ${p.name}`}
                        className={`cursor-pointer hover:bg-surface/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                          highlightRisk ? "border-l-2 border-l-danger/60 bg-danger/5" : ""
                        }`}
                        onClick={() => openProject(p.id)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            openProject(p.id);
                          }
                        }}
                      >
                        <TableCell>
                          <a
                            href={projectHref}
                            className="block"
                            onClick={(event) => event.stopPropagation()}
                          >
                            <div className="flex items-center gap-2">
                              <div className="font-serif text-lg text-foreground">{p.name}</div>
                              {p.warning_count > 0 && (
                                <span
                                  title={`${p.warning_count} system risk${p.warning_count === 1 ? "" : "s"} detected`}
                                  className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-danger/15 px-1.5 text-[10px] font-semibold text-danger"
                                >
                                  {p.warning_count}
                                </span>
                              )}
                              {p.days_since_review !== null && p.days_since_review > 30 && (
                                <span
                                  title="Project has not been reviewed in over 30 days"
                                  className="rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-semibold text-warning"
                                >
                                  Review {p.days_since_review}d
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {p.client} · {p.phase} · {p.percent_complete}% complete
                              {p.top_category && (
                                <> · Top risk: {p.top_category.replace(/_/g, " ")}</>
                              )}
                            </div>
                          </a>
                        </TableCell>

                        <TableCell className="whitespace-nowrap text-sm tabular text-foreground">
                          {jobNumber}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-sm text-foreground">
                          {p.project_manager || "Unassigned"}
                        </TableCell>
                        <TableCell className="text-right tabular">
                          {fmtUSD(p.original_contract)}
                        </TableCell>
                        <TableCell className="text-right tabular">
                          {fmtPct(p.original_gp_pct)}
                        </TableCell>
                        <TableCell className="text-right tabular">
                          {fmtPct(p.indicated_gp_pct)}
                        </TableCell>
                        <TableCell
                          className={`text-right tabular ${p.gp_at_risk > 0 ? "text-danger" : ""}`}
                        >
                          {fmtUSD(p.gp_at_risk)}
                        </TableCell>
                        <TableCell className="text-right tabular">
                          {fmtUSD(p.risk_allocated)}
                        </TableCell>
                        <TableCell className="max-w-[220px]">
                          {p.top_exposure_title ? (
                            <div>
                              <div className="truncate text-sm font-medium text-foreground">
                                {p.top_exposure_title}
                              </div>
                              <div className="mt-1 text-[11px] text-muted-foreground">
                                {fmtUSD(p.top_exposure_value)}{" "}
                                {p.top_exposure_hold_class ? `· ${p.top_exposure_hold_class}` : ""}
                              </div>
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">No live exposure</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <div
                            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${
                              p.overdue_decision_count > 0
                                ? "border-danger/40 bg-danger/10 text-danger"
                                : p.active_decision_count > 0
                                  ? "border-warning/40 bg-warning/10 text-warning"
                                  : "border-success/40 bg-success/10 text-success"
                            }`}
                          >
                            {p.overdue_decision_count > 0
                              ? `${p.overdue_decision_count} overdue`
                              : `${p.active_decision_count} open`}
                          </div>
                          {p.next_decision_due && (
                            <div className="mt-1 text-[11px] text-muted-foreground">
                              next due {p.next_decision_due}
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          <div
                            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${schedule.className}`}
                          >
                            {schedule.label} · {Math.round(schedule.score)}%
                          </div>
                          <div className="mt-1 text-[11px] text-muted-foreground">
                            {p.schedule_variance_weeks > 0
                              ? `+${p.schedule_variance_weeks} wk`
                              : "No slip"}{" "}
                            · {p.schedule_risk_count} risks
                          </div>
                        </TableCell>
                        <TableCell>
                          <span
                            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${s.className}`}
                          >
                            {s.label}
                          </span>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

type PortfolioProject = Awaited<ReturnType<typeof listProjects>>[number];

type PortfolioTopExposure = {
  projectId: string;
  projectName: string;
  jobNumber: string;
  title: string;
  owner: string;
  holdClass: string | null;
  value: number;
};

type PortfolioTotals = {
  projectCount: number;
  forecastedFinalContract: number;
  forecastedFinalCost: number;
  forecastedGPBeforeHolds: number;
  originalGP: number;
  indicatedGP: number;
  indicatedPct: number;
  gpAtRisk: number;
  riskAllocated: number;
  exposureHolds: number;
  contingencyHold: number;
  activeDecisionCount: number;
  overdueDecisionCount: number;
  slippedProjects: number;
  atRiskProjects: number;
  warningCount: number;
  topRiskProject: PortfolioProject | null;
  topExposures: PortfolioTopExposure[];
  overdueProjects: PortfolioProject[];
};

function buildPortfolioTotals(projects: PortfolioProject[]): PortfolioTotals {
  const sum = (fn: (p: PortfolioProject) => number) =>
    projects.reduce((total, p) => total + fn(p), 0);
  const forecastedFinalContract = sum((p) => p.forecasted_final_contract);
  const topRiskProject =
    projects.reduce<PortfolioProject | null>(
      (current, p) => (!current || p.gp_at_risk > current.gp_at_risk ? p : current),
      null,
    ) ?? null;
  const topExposures = projects
    .filter((p) => p.top_exposure_value > 0)
    .map((p) => ({
      projectId: p.id,
      projectName: p.name,
      jobNumber: p.job_number || `ID ${p.id.slice(0, 8).toUpperCase()}`,
      title: p.top_exposure_title,
      owner: p.top_exposure_owner,
      holdClass: p.top_exposure_hold_class,
      value: p.top_exposure_value,
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 5);
  const overdueProjects = projects
    .filter((p) => p.overdue_decision_count > 0)
    .sort(
      (a, b) => b.overdue_decision_count - a.overdue_decision_count || b.gp_at_risk - a.gp_at_risk,
    )
    .slice(0, 5);

  return {
    projectCount: projects.length,
    forecastedFinalContract,
    forecastedFinalCost: sum((p) => p.forecasted_final_cost),
    forecastedGPBeforeHolds: sum((p) => p.forecasted_gp_before_holds),
    originalGP: sum((p) => p.original_gp),
    indicatedGP: sum((p) => p.indicated_gp),
    indicatedPct: forecastedFinalContract
      ? (sum((p) => p.indicated_gp) / forecastedFinalContract) * 100
      : 0,
    gpAtRisk: sum((p) => p.gp_at_risk),
    riskAllocated: sum((p) => p.risk_allocated),
    exposureHolds: sum((p) => p.exposure_holds),
    contingencyHold: sum((p) => p.contingency_hold),
    activeDecisionCount: sum((p) => p.active_decision_count),
    overdueDecisionCount: sum((p) => p.overdue_decision_count),
    slippedProjects: projects.filter(
      (p) => p.schedule_variance_weeks > 0 || p.schedule_risk_count > 0,
    ).length,
    atRiskProjects: projects.filter(
      (p) => statusFor(p.original_gp_pct, p.indicated_gp_pct).label === "At Risk",
    ).length,
    warningCount: sum((p) => p.warning_count),
    topRiskProject,
    topExposures,
    overdueProjects,
  };
}

function PortfolioDashboard({ totals }: { totals: PortfolioTotals }) {
  return (
    <section className="rounded-lg border border-hairline bg-card p-6 shadow-card">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            <BriefcaseBusiness className="h-3.5 w-3.5" />
            Portfolio Dashboard
          </div>
          <h2 className="mt-2 font-serif text-4xl text-foreground">Company-wide IOR posture.</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Rollup of active jobs, margin at risk, current indicated profit, and schedule pressure.
          </p>
        </div>
        <div className="grid min-w-[420px] grid-cols-4 gap-2">
          <PortfolioSignal
            icon={<Activity className="h-3.5 w-3.5" />}
            label="Open projects"
            value={String(totals.projectCount)}
          />
          <PortfolioSignal
            icon={<CalendarClock className="h-3.5 w-3.5" />}
            label="Delayed"
            value={String(totals.slippedProjects)}
            tone={totals.slippedProjects > 0 ? "warning" : "success"}
          />
          <PortfolioSignal
            icon={<AlertTriangle className="h-3.5 w-3.5" />}
            label="At risk"
            value={String(totals.atRiskProjects)}
            tone={totals.atRiskProjects > 0 ? "danger" : "success"}
          />
          <PortfolioSignal
            icon={<ClipboardList className="h-3.5 w-3.5" />}
            label="Overdue"
            value={String(totals.overdueDecisionCount)}
            tone={totals.overdueDecisionCount > 0 ? "danger" : "success"}
          />
        </div>
      </div>

      <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-7">
        <PortfolioMetric label="Original GP" value={fmtUSD(totals.originalGP)} />
        <PortfolioMetric label="GP at risk" value={fmtUSD(totals.gpAtRisk)} tone="danger" />
        <PortfolioMetric
          label="Indicated GP"
          value={fmtUSD(totals.indicatedGP)}
          sub={fmtPct(totals.indicatedPct)}
          tone="accent"
        />
        <PortfolioMetric label="E-Holds" value={fmtUSD(totals.exposureHolds)} tone="danger" />
        <PortfolioMetric label="C-Holds" value={fmtUSD(totals.contingencyHold)} tone="warning" />
        <PortfolioMetric label="Active projects" value={String(totals.projectCount)} />
        <PortfolioMetric
          label="Delayed jobs"
          value={String(totals.slippedProjects)}
          tone={totals.slippedProjects > 0 ? "warning" : undefined}
        />
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-md border border-danger/20 bg-danger/5 p-4">
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-danger">
            Top portfolio exposures
          </div>
          <div className="mt-3 divide-y divide-danger/15">
            {totals.topExposures.length === 0 ? (
              <div className="py-3 text-sm text-muted-foreground">
                No live exposure is currently pulling down gross profit.
              </div>
            ) : (
              totals.topExposures.map((exposure, index) => (
                <a
                  key={`${exposure.projectId}-${exposure.title}`}
                  href={`/projects/${exposure.projectId}`}
                  className="grid gap-2 py-3 hover:text-danger sm:grid-cols-[28px_1fr_auto]"
                >
                  <div className="text-xs font-semibold tabular text-danger">
                    {String(index + 1).padStart(2, "0")}
                  </div>
                  <div>
                    <div className="font-medium text-foreground">{exposure.title}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {exposure.projectName} · {exposure.jobNumber}
                      {exposure.owner ? ` · ${exposure.owner}` : ""}
                      {exposure.holdClass ? ` · ${exposure.holdClass}` : ""}
                    </div>
                  </div>
                  <div className="text-right font-medium tabular text-danger">
                    {fmtUSD(exposure.value)}
                  </div>
                </a>
              ))
            )}
          </div>
        </div>
        <div className="rounded-md border border-hairline bg-surface p-4">
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            PM accountability
          </div>
          <div className="mt-2 flex items-end justify-between gap-4">
            <div className="text-sm text-muted-foreground">
              {totals.activeDecisionCount} open to-dos across the filtered portfolio.
            </div>
            <div
              className={`whitespace-nowrap text-2xl font-medium tabular ${
                totals.overdueDecisionCount > 0 ? "text-danger" : "text-success"
              }`}
            >
              {totals.overdueDecisionCount} overdue
            </div>
          </div>
          <div className="mt-3 divide-y divide-hairline">
            {totals.overdueProjects.length === 0 ? (
              <div className="py-3 text-sm text-muted-foreground">
                No overdue project to-dos in the current view.
              </div>
            ) : (
              totals.overdueProjects.map((project) => (
                <a
                  key={project.id}
                  href={`/projects/${project.id}`}
                  className="grid gap-2 py-3 hover:text-danger sm:grid-cols-[1fr_auto]"
                >
                  <div>
                    <div className="font-medium text-foreground">{project.name}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {project.project_manager || "Unassigned"} ·{" "}
                      {project.job_number || `ID ${project.id.slice(0, 8).toUpperCase()}`}
                    </div>
                  </div>
                  <div className="text-right text-sm font-medium tabular text-danger">
                    {project.overdue_decision_count} overdue
                  </div>
                </a>
              ))
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function PortfolioMetric({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "danger" | "accent" | "warning";
}) {
  const toneClass =
    tone === "danger"
      ? "text-danger"
      : tone === "accent"
        ? "text-accent"
        : tone === "warning"
          ? "text-warning"
          : "text-foreground";
  return (
    <div className="flex min-h-[92px] flex-col justify-between rounded-md border border-hairline bg-surface p-3">
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </div>
      <div>
        <div className={`text-lg font-medium tabular ${toneClass}`}>{value}</div>
        {sub && <div className="mt-1 text-xs tabular text-muted-foreground">{sub}</div>}
      </div>
    </div>
  );
}

function PortfolioSignal({
  icon,
  label,
  value,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  tone?: "success" | "warning" | "danger";
}) {
  const toneClass =
    tone === "danger"
      ? "border-danger/30 bg-danger/10 text-danger"
      : tone === "warning"
        ? "border-warning/30 bg-warning/10 text-warning"
        : tone === "success"
          ? "border-success/30 bg-success/10 text-success"
          : "border-hairline bg-surface text-foreground";
  return (
    <div className={`rounded-md border p-3 ${toneClass}`}>
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em]">
        {icon}
        {label}
      </div>
      <div className="mt-2 text-2xl font-medium tabular">{value}</div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-lg border border-hairline bg-card p-16 text-center">
      <h2 className="font-serif text-2xl text-foreground">No projects yet</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
        Create your first outcome review to begin tracking margin, holds, and required decisions.
      </p>
      <div className="mt-6 flex justify-center">
        <NewProjectButton />
      </div>
    </div>
  );
}

const roleOptions: { value: AccountRole; label: string }[] = [
  { value: "owner", label: "Owner" },
  { value: "admin", label: "Admin" },
  { value: "executive", label: "Executive" },
  { value: "project_manager", label: "Project manager" },
  { value: "member", label: "Team member" },
  { value: "viewer", label: "Viewer" },
];

const memberStatusOptions: { value: MemberStatus; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "disabled", label: "Disabled" },
];

const projectRoleOptions: { value: ProjectMemberRole; label: string }[] = [
  { value: "owner", label: "Project owner" },
  { value: "manager", label: "Manager" },
  { value: "editor", label: "Editor" },
  { value: "viewer", label: "Viewer" },
];

function roleLabel(role: string) {
  return roleOptions.find((option) => option.value === role)?.label ?? role;
}

function projectRoleLabel(role: string) {
  return projectRoleOptions.find((option) => option.value === role)?.label ?? role;
}

function InviteByMagicLinkButton() {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<AccountRole>("project_manager");
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [selectedUserId, setSelectedUserId] = useState("");
  const [projectRole, setProjectRole] = useState<ProjectMemberRole>("viewer");
  const qc = useQueryClient();
  const loadTeam = useServerFn(getTeamWorkspace);
  const createInvite = useServerFn(createTeamInvite);
  const updateMember = useServerFn(updateTeamMember);
  const revokeInvite = useServerFn(revokeTeamInvite);
  const assignMember = useServerFn(assignProjectMember);
  const updateProjectAccess = useServerFn(updateProjectMember);
  const removeProjectAccess = useServerFn(removeProjectMember);
  const { data: team, isLoading } = useQuery({
    queryKey: ["team-workspace"],
    queryFn: () => loadTeam(),
    enabled: open,
  });

  useEffect(() => {
    if (!team) return;
    setSelectedProjectId((current) => current || team.projects[0]?.id || "");
    setSelectedUserId(
      (current) => current || team.members.find((m) => m.status === "active")?.user_id || "",
    );
  }, [team]);

  const refreshTeam = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["team-workspace"] }),
      qc.invalidateQueries({ queryKey: ["projects"] }),
    ]);
  };

  const inviteMutation = useMutation({
    mutationFn: async () => {
      const inviteEmail = email.trim().toLowerCase();
      if (!inviteEmail) throw new Error("Enter an email address.");

      await createInvite({ data: { email: inviteEmail, role } });

      const { error } = await supabase.auth.signInWithOtp({
        email: inviteEmail,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`,
          shouldCreateUser: true,
        },
      });
      if (error) throw error;

      return inviteEmail;
    },
    onSuccess: async (inviteEmail) => {
      await qc.invalidateQueries({ queryKey: ["team-workspace"] });
      toast.success("Team invite sent", {
        description: `${inviteEmail} can sign in and join this Overwatch team.`,
      });
      setEmail("");
      setRole("project_manager");
    },
    onError: (err) => {
      toast.error("Team invite did not send", {
        description: err instanceof Error ? err.message : "Try again.",
      });
    },
  });

  const memberMutation = useMutation({
    mutationFn: (payload: { membershipId: string; role?: AccountRole; status?: Exclude<MemberStatus, "pending"> }) =>
      updateMember({ data: payload }),
    onSuccess: async () => {
      await refreshTeam();
      toast.success("Team member updated");
    },
    onError: (err) => {
      toast.error("Team member did not update", {
        description: err instanceof Error ? err.message : "Try again.",
      });
    },
  });

  const revokeMutation = useMutation({
    mutationFn: (inviteId: string) => revokeInvite({ data: { inviteId } }),
    onSuccess: async () => {
      await refreshTeam();
      toast.success("Invite revoked");
    },
    onError: (err) => {
      toast.error("Invite did not revoke", {
        description: err instanceof Error ? err.message : "Try again.",
      });
    },
  });

  const assignMutation = useMutation({
    mutationFn: () => {
      if (!selectedProjectId) throw new Error("Choose a project.");
      if (!selectedUserId) throw new Error("Choose a team member.");
      return assignMember({
        data: { projectId: selectedProjectId, userId: selectedUserId, role: projectRole },
      });
    },
    onSuccess: async () => {
      await refreshTeam();
      toast.success("Project access updated");
    },
    onError: (err) => {
      toast.error("Project access did not update", {
        description: err instanceof Error ? err.message : "Try again.",
      });
    },
  });

  const projectAccessMutation = useMutation({
    mutationFn: (payload: {
      membershipId: string;
      role?: ProjectMemberRole;
      status?: Exclude<MemberStatus, "pending">;
    }) => updateProjectAccess({ data: payload }),
    onSuccess: async () => {
      await refreshTeam();
      toast.success("Project member updated");
    },
    onError: (err) => {
      toast.error("Project member did not update", {
        description: err instanceof Error ? err.message : "Try again.",
      });
    },
  });

  const removeProjectAccessMutation = useMutation({
    mutationFn: (membershipId: string) => removeProjectAccess({ data: { membershipId } }),
    onSuccess: async () => {
      await refreshTeam();
      toast.success("Project access removed");
    },
    onError: (err) => {
      toast.error("Project access did not remove", {
        description: err instanceof Error ? err.message : "Try again.",
      });
    },
  });

  const sendInvite = async () => {
    inviteMutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1.5">
          <Users className="h-3.5 w-3.5" /> Team
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle className="font-serif text-2xl">Team access</DialogTitle>
        </DialogHeader>
        <div className="grid max-h-[76vh] gap-5 overflow-y-auto py-2 pr-1">
          <div className="grid gap-3 rounded-md border border-hairline bg-surface p-3 md:grid-cols-4">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Plan
              </div>
              <div className="mt-1 font-medium">
                {team?.organization.contractor_circle_grant
                  ? "Circle grant"
                  : team?.organization.plan_code}
              </div>
            </div>
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Projects
              </div>
              <div className="mt-1 font-medium">
                {team ? `${team.usage.projects}/${team.organization.project_limit}` : "-"}
              </div>
            </div>
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Seats
              </div>
              <div className="mt-1 font-medium">
                {team
                  ? `${team.usage.activeSeats + team.usage.pendingInvites}/${team.organization.seat_limit}`
                  : "-"}
              </div>
            </div>
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Daily logs
              </div>
              <div className="mt-1 font-medium">{team ? team.usage.dailyReports : "-"}</div>
            </div>
          </div>

          {team && !team.canManageTeam && (
            <div className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
              You can see this workspace, but only owners, admins, and executives can invite seats
              or change company roles.
            </div>
          )}

          {(!team || team.canManageTeam) && (
            <div className="grid gap-3 rounded-md border border-hairline p-3 md:grid-cols-[1fr_190px_auto] md:items-end">
              <div className="space-y-1.5">
                <Label>Email</Label>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="pm@company.com"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Company role</Label>
                <Select value={role} onValueChange={(v) => setRole(v as AccountRole)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {roleOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                disabled={!email.trim() || inviteMutation.isPending}
                onClick={sendInvite}
                className="gap-1.5"
              >
                <MailPlus className="h-3.5 w-3.5" />
                {inviteMutation.isPending ? "Sending..." : "Send invite"}
              </Button>
            </div>
          )}

          <div className="rounded-md border border-hairline">
            <div className="border-b border-hairline bg-surface px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Members
            </div>
            <div className="divide-y divide-hairline">
              {isLoading ? (
                <div className="px-3 py-4 text-sm text-muted-foreground">Loading team...</div>
              ) : !team || team.members.length === 0 ? (
                <div className="px-3 py-4 text-sm text-muted-foreground">No team members yet.</div>
              ) : (
                team.members.map((member) => (
                  <div
                    key={member.id}
                    className="grid gap-2 px-3 py-3 md:grid-cols-[1fr_190px_150px] md:items-center"
                  >
                    <div>
                      <div className="font-medium">{member.full_name || member.email}</div>
                      <div className="text-xs text-muted-foreground">{member.email}</div>
                    </div>
                    {team.canManageTeam ? (
                      <>
                        <Select
                          value={member.role}
                          onValueChange={(v) =>
                            memberMutation.mutate({
                              membershipId: member.id,
                              role: v as AccountRole,
                            })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {roleOptions.map((option) => (
                              <SelectItem key={option.value} value={option.value}>
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Select
                          value={member.status === "pending" ? "active" : member.status}
                          onValueChange={(v) =>
                            memberMutation.mutate({
                              membershipId: member.id,
                              status: v as Exclude<MemberStatus, "pending">,
                            })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {memberStatusOptions.map((option) => (
                              <SelectItem key={option.value} value={option.value}>
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </>
                    ) : (
                      <>
                        <div className="text-sm text-muted-foreground">
                          {roleLabel(member.role)}
                        </div>
                        <div className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                          {member.status}
                        </div>
                      </>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          {team && team.invites.length > 0 && (
            <div className="rounded-md border border-hairline">
              <div className="border-b border-hairline bg-surface px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Pending invites
              </div>
              <div className="divide-y divide-hairline">
                {team.invites.map((invite) => (
                  <div
                    key={invite.id}
                    className="grid gap-2 px-3 py-3 md:grid-cols-[1fr_150px_auto] md:items-center"
                  >
                    <div>
                      <div className="font-medium">{invite.email}</div>
                      <div className="text-xs text-muted-foreground">Magic link invite pending</div>
                    </div>
                    <div className="text-sm text-muted-foreground">{roleLabel(invite.role)}</div>
                    {team.canManageTeam && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={revokeMutation.isPending}
                        onClick={() => revokeMutation.mutate(invite.id)}
                      >
                        Revoke
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="rounded-md border border-hairline">
            <div className="border-b border-hairline bg-surface px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Project access
            </div>
            <div className="grid gap-4 p-3">
              <div className="grid gap-3 md:grid-cols-[1fr_1fr_180px_auto] md:items-end">
                <div className="space-y-1.5">
                  <Label>Project</Label>
                  <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Choose project" />
                    </SelectTrigger>
                    <SelectContent>
                      {team?.projects.map((project) => (
                        <SelectItem key={project.id} value={project.id}>
                          {project.job_number
                            ? `${project.job_number} - ${project.name}`
                            : project.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Team member</Label>
                  <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Choose person" />
                    </SelectTrigger>
                    <SelectContent>
                      {team?.members
                        .filter((member) => member.status === "active")
                        .map((member) => (
                          <SelectItem key={member.user_id} value={member.user_id}>
                            {member.full_name || member.email}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Project role</Label>
                  <Select
                    value={projectRole}
                    onValueChange={(v) => setProjectRole(v as ProjectMemberRole)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {projectRoleOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  disabled={!selectedProjectId || !selectedUserId || assignMutation.isPending}
                  onClick={() => assignMutation.mutate()}
                >
                  {assignMutation.isPending ? "Saving..." : "Assign"}
                </Button>
              </div>

              {isLoading ? (
                <div className="text-sm text-muted-foreground">Loading project access...</div>
              ) : !team || team.projects.length === 0 ? (
                <div className="text-sm text-muted-foreground">
                  Create a project before assigning project access.
                </div>
              ) : team.projectMembers.length === 0 ? (
                <div className="text-sm text-muted-foreground">
                  No project-level access has been assigned yet.
                </div>
              ) : (
                <div className="divide-y divide-hairline rounded-md border border-hairline">
                  {team.projectMembers.map((member) => {
                    const project = team.projects.find((p) => p.id === member.project_id);
                    return (
                      <div
                        key={member.id}
                        className="grid gap-2 px-3 py-3 lg:grid-cols-[1.2fr_1fr_170px_140px_auto] lg:items-center"
                      >
                        <div>
                          <div className="font-medium">{project?.name || "Project"}</div>
                          <div className="text-xs text-muted-foreground">
                            {project?.job_number || "No job number"}
                          </div>
                        </div>
                        <div>
                          <div className="font-medium">{member.full_name || member.email}</div>
                          <div className="text-xs text-muted-foreground">{member.email}</div>
                        </div>
                        <Select
                          value={member.role}
                          onValueChange={(v) =>
                            projectAccessMutation.mutate({
                              membershipId: member.id,
                              role: v as ProjectMemberRole,
                            })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {projectRoleOptions.map((option) => (
                              <SelectItem key={option.value} value={option.value}>
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Select
                          value={member.status === "pending" ? "active" : member.status}
                          onValueChange={(v) =>
                            projectAccessMutation.mutate({
                              membershipId: member.id,
                              status: v as Exclude<MemberStatus, "pending">,
                            })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {memberStatusOptions.map((option) => (
                              <SelectItem key={option.value} value={option.value}>
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button
                          variant="ghost"
                          size="icon"
                          disabled={removeProjectAccessMutation.isPending}
                          onClick={() => removeProjectAccessMutation.mutate(member.id)}
                          aria-label="Remove project access"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NewProjectButton() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [jobNumber, setJobNumber] = useState("");
  const [client, setClient] = useState("");
  const [projectManager, setProjectManager] = useState("");
  const [phase, setPhase] = useState<"Early" | "Middle" | "Late">("Early");
  const [contract, setContract] = useState("");
  const [costBudget, setCostBudget] = useState("");
  const [baselineCompletion, setBaselineCompletion] = useState("");
  const [forecastCompletion, setForecastCompletion] = useState("");
  const navigate = useNavigate();
  const qc = useQueryClient();
  const create = useServerFn(createProject);
  const scheduleVariance = computeScheduleVarianceWeeks(
    baselineCompletion || null,
    forecastCompletion || null,
  );

  const mutation = useMutation({
    mutationFn: () =>
      create({
        data: {
          name,
          job_number: jobNumber,
          client,
          project_manager: projectManager,
          phase,
          original_contract: Number(contract) || 0,
          original_cost_budget: Number(costBudget) || 0,
          baseline_completion_date: baselineCompletion || null,
          forecast_completion_date: forecastCompletion || null,
        },
      }),
    onSuccess: ({ id }) => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      setOpen(false);
      setName("");
      setJobNumber("");
      setClient("");
      setProjectManager("");
      setPhase("Early");
      setContract("");
      setCostBudget("");
      setBaselineCompletion("");
      setForecastCompletion("");
      navigate({ to: "/projects/$projectId", params: { projectId: id } });
    },
    onError: (err) => {
      toast.error("Project did not save", {
        description: err instanceof Error ? err.message : "Try again.",
      });
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5">
          <Plus className="h-3.5 w-3.5" /> New project
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-serif text-2xl">New project</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Project name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Job number</Label>
              <Input value={jobNumber} onChange={(e) => setJobNumber(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Client</Label>
            <Input value={client} onChange={(e) => setClient(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Project manager</Label>
              <Input
                value={projectManager}
                onChange={(e) => setProjectManager(e.target.value)}
                placeholder="e.g. Marshall Wilkinson"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Phase</Label>
              <Select
                value={phase}
                onValueChange={(v) => setPhase(v as "Early" | "Middle" | "Late")}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Early">Early</SelectItem>
                  <SelectItem value="Middle">Middle</SelectItem>
                  <SelectItem value="Late">Late</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Original contract (USD)</Label>
              <Input type="number" value={contract} onChange={(e) => setContract(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Original cost budget (USD)</Label>
              <Input
                type="number"
                value={costBudget}
                onChange={(e) => setCostBudget(e.target.value)}
              />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label>Baseline completion</Label>
              <Input
                type="date"
                value={baselineCompletion}
                onChange={(e) => setBaselineCompletion(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Forecast completion</Label>
              <Input
                type="date"
                value={forecastCompletion}
                onChange={(e) => setForecastCompletion(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Calculated variance</Label>
              <div
                className={`flex h-10 items-center rounded-md border border-input bg-surface px-3 text-sm tabular ${
                  (scheduleVariance ?? 0) > 0
                    ? "text-danger"
                    : (scheduleVariance ?? 0) < 0
                      ? "text-success"
                      : "text-foreground"
                }`}
              >
                {scheduleVariance == null
                  ? "0 wk"
                  : scheduleVariance > 0
                    ? `+${scheduleVariance} wk`
                    : scheduleVariance < 0
                      ? `${scheduleVariance} wk`
                      : "0 wk"}
              </div>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button disabled={!name.trim() || mutation.isPending} onClick={() => mutation.mutate()}>
            {mutation.isPending ? "Creating…" : "Create project"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
