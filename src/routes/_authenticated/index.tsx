import { createFileRoute, Link, useLocation, useNavigate, useRouter } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { sendOverwatchMagicLink } from "@/lib/auth/magic-link";
import {
  listCrmSnapshot,
  listOpportunities,
  type PipelineCrmSnapshot,
  type PipelineOpportunityRow,
  type PipelineStage,
} from "@/lib/pipeline.functions";
import { createProject, listProjects, seedDemoIfEmpty } from "@/lib/projects.functions";
import { getOnboardingStatus } from "@/lib/onboarding.functions";
import { FirstRunChecklist, type ChecklistStep } from "@/components/onboarding/FirstRunChecklist";
import { PortfolioHome } from "@/components/home/PortfolioHome";
import { BillingFeedBadge } from "@/components/billing/BillingFeedBadge";
import { PipelineWorkspace } from "@/components/pipeline/PipelineWorkspace";
import {
  pruneRemovedDemoCrm,
  readDemoOpportunityRemovals,
} from "@/components/pipeline/pipeline-ui";
import {
  assignProjectMember,
  createTeamInvite,
  getTeamWorkspace,
  getCompanyWorkspaceContext,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  BriefcaseBusiness,
  CalendarClock,
  ClipboardList,
  FileText,
  Info,
  KanbanSquare,
  LogOut,
  MailPlus,
  Plus,
  ReceiptText,
  RotateCcw,
  Search,
  Trash2,
  Users,
} from "lucide-react";
import { fmtUSD, fmtPct } from "@/lib/format";
import { computeScheduleVarianceWeeks } from "@/lib/ior";
import { toast } from "sonner";

const numberFormatter = new Intl.NumberFormat("en-US");

function formatNumber(value: number) {
  return numberFormatter.format(Math.max(0, Math.round(value)));
}

function formatUsageValue(used: number, limit: number) {
  return `${formatNumber(used)} / ${limit > 0 ? formatNumber(limit) : "No cap"}`;
}

const ONBOARDING_DISMISSED_KEY = "overwatch:onboarding-dismissed:v1";

function companyInitials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "OW"
  );
}

export const Route = createFileRoute("/_authenticated/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Portfolio — Overwatch" },
      {
        name: "description",
        content: "Company-wide IOR posture across active Overwatch projects.",
      },
    ],
  }),
  component: PortfolioIndex,
});

// Cutover: the redesigned home (6a) IS the portfolio landing. The classic tabbed
// views — the full projects table (?tab=projects) and CRM (?tab=crm / ?tab=pipeline)
// — stay reachable on this same route, so every existing /?tab=… deep link (incl.
// the CRM &opportunity= links) keeps resolving here unchanged. Bare / renders 6a.
function PortfolioIndex() {
  const tab = useLocation({ select: (l) => (l.search as { tab?: unknown }).tab });
  const hasTab = typeof tab === "string" && tab.length > 0;
  return hasTab ? <PortfolioPage /> : <PortfolioHome />;
}

function statusFor(originalPct: number, indicatedPct: number) {
  const erosion = originalPct - indicatedPct;
  if (erosion >= 5)
    return { label: "At Risk", className: "border-danger/40 bg-danger/10 text-danger" };
  if (erosion >= 2)
    return { label: "Watch", className: "border-warning/40 bg-warning/10 text-warning" };
  // "Aligned" matches the IOR header's posture vocabulary.
  return { label: "Aligned", className: "border-success/40 bg-success/10 text-success" };
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
type PortfolioRiskFilter = "all" | "at-risk" | "watch" | "aligned";
type PortfolioScheduleFilter = "all" | "slipped" | "watch" | "on-plan";
type PortfolioReviewFilter = "all" | "stale" | "current" | "never";
type PortfolioDailyFilter = "all" | "current" | "stale" | "none" | "client-visible";

function dailyReportFor(reportCount: number, daysSince: number | null) {
  if (reportCount === 0 || daysSince === null) {
    return { label: "None", className: "border-warning/40 bg-warning/10 text-warning" };
  }
  if (daysSince > 7) {
    return { label: "Stale", className: "border-danger/40 bg-danger/10 text-danger" };
  }
  return { label: "Current", className: "border-success/40 bg-success/10 text-success" };
}

function shortDate(value: string | null) {
  if (!value) return "";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error";
}

function PortfolioPage() {
  const list = useServerFn(listProjects);
  const seed = useServerFn(seedDemoIfEmpty);
  const listCrm = useServerFn(listOpportunities);
  const loadCrmSnapshot = useServerFn(listCrmSnapshot);
  const loadCompanyContext = useServerFn(getCompanyWorkspaceContext);
  const qc = useQueryClient();
  const {
    data: projects = [],
    error: projectsError,
    isError: projectsDidError,
    isLoading,
    refetch: refetchProjects,
  } = useQuery({
    queryKey: ["projects"],
    queryFn: () => list(),
  });
  const { data: crmOpportunities = [], isLoading: crmOpportunitiesLoading } = useQuery({
    queryKey: ["pipeline-opportunities", false],
    queryFn: () => listCrm({ data: { includeArchived: false } }),
  });
  const { data: crmSnapshot = null, isLoading: crmSnapshotLoading } = useQuery({
    queryKey: ["pipeline-crm-snapshot"],
    queryFn: () => loadCrmSnapshot(),
  });
  const { data: companyContext } = useQuery({
    queryKey: ["company-workspace-context"],
    queryFn: () => loadCompanyContext(),
  });
  const loadOnboardingStatus = useServerFn(getOnboardingStatus);
  const { data: onboardingStatus } = useQuery({
    queryKey: ["onboarding-status"],
    queryFn: () => loadOnboardingStatus(),
  });
  const [onboardingDismissed, setOnboardingDismissed] = useState(false);
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  useEffect(() => {
    // Client-only: read the persisted dismissal after mount to avoid an SSR mismatch.
    if (typeof window !== "undefined") {
      setOnboardingDismissed(window.localStorage.getItem(ONBOARDING_DISMISSED_KEY) === "1");
    }
  }, []);
  const dismissOnboarding = () => {
    setOnboardingDismissed(true);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(ONBOARDING_DISMISSED_KEY, "1");
    }
  };
  const [search, setSearch] = useState("");
  const [seedError, setSeedError] = useState<string | null>(null);
  const [companyFilter, setCompanyFilter] = useState("all");
  const [managerFilter, setManagerFilter] = useState("all");
  const [riskFilter, setRiskFilter] = useState<PortfolioRiskFilter>("all");
  const [scheduleFilter, setScheduleFilter] = useState<PortfolioScheduleFilter>("all");
  const [reviewFilter, setReviewFilter] = useState<PortfolioReviewFilter>("all");
  const [dailyFilter, setDailyFilter] = useState<PortfolioDailyFilter>("all");
  const [sortMode, setSortMode] = useState<PortfolioSortMode>("manager");
  const [failedOrganizationLogos, setFailedOrganizationLogos] = useState<Set<string>>(
    () => new Set(),
  );
  const [failedCompanyLogoUrl, setFailedCompanyLogoUrl] = useState<string | null>(null);
  const [portfolioTab, setPortfolioTab] = useState<"projects" | "pipeline">(() => {
    if (typeof window === "undefined") return "projects";
    const tab = new URLSearchParams(window.location.search).get("tab");
    return tab === "pipeline" || tab === "crm" ? "pipeline" : "projects";
  });
  const [initialPipelineOpportunityId] = useState(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("opportunity");
  });
  const companyNames = useMemo(
    () =>
      Array.from(new Set(projects.map((p) => p.organization_name.trim()).filter(Boolean))).sort(
        (a, b) => a.localeCompare(b),
      ),
    [projects],
  );
  const headerCompanyName =
    companyFilter !== "all" ? companyFilter : companyContext?.name || companyNames[0] || "Company";
  const headerTitle = portfolioTab === "pipeline" ? "CRM" : "Portfolio";
  const headerLogoUrl =
    companyContext?.logo_url &&
    failedCompanyLogoUrl !== companyContext.logo_url &&
    companyFilter === "all"
      ? companyContext.logo_url
      : "";
  const currentViewLabel =
    portfolioTab === "projects"
      ? "Live project IOR control"
      : "Sales CRM, relationships, and bid pursuits";
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
      const company = p.organization_name.trim();
      const status = statusFor(p.original_gp_pct, p.indicated_gp_pct).label;
      const schedule = scheduleFor(p.schedule_variance_weeks, p.schedule_risk_count).label;
      const daily = dailyReportFor(p.daily_report_count, p.days_since_daily_report).label;
      const reviewState =
        p.days_since_review === null ? "never" : p.days_since_review > 30 ? "stale" : "current";
      const matchesCompany = companyFilter === "all" || company === companyFilter;
      const matchesManager = managerFilter === "all" || manager === managerFilter;
      const matchesRisk =
        riskFilter === "all" || status.toLowerCase().replace(" ", "-") === riskFilter;
      const matchesSchedule =
        scheduleFilter === "all" || schedule.toLowerCase().replace(" ", "-") === scheduleFilter;
      const matchesReview = reviewFilter === "all" || reviewState === reviewFilter;
      const matchesDaily =
        dailyFilter === "all" ||
        (dailyFilter === "client-visible" && p.client_visible_daily_report_count > 0) ||
        daily.toLowerCase() === dailyFilter;
      const haystack = [p.name, p.job_number, p.client, p.project_manager, p.organization_name]
        .join(" ")
        .toLowerCase();
      return (
        matchesCompany &&
        matchesManager &&
        matchesRisk &&
        matchesSchedule &&
        matchesReview &&
        matchesDaily &&
        (!q || haystack.includes(q))
      );
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
  }, [
    companyFilter,
    dailyFilter,
    managerFilter,
    projects,
    reviewFilter,
    riskFilter,
    scheduleFilter,
    search,
    sortMode,
  ]);
  const portfolioTotals = useMemo(() => buildPortfolioTotals(visibleProjects), [visibleProjects]);
  const activeFilterCount = [
    search.trim(),
    companyFilter !== "all",
    managerFilter !== "all",
    riskFilter !== "all",
    scheduleFilter !== "all",
    reviewFilter !== "all",
    dailyFilter !== "all",
  ].filter(Boolean).length;
  const resetFilters = () => {
    setSearch("");
    setCompanyFilter("all");
    setManagerFilter("all");
    setRiskFilter("all");
    setScheduleFilter("all");
    setReviewFilter("all");
    setDailyFilter("all");
  };
  const setPortfolioTabWithUrl = (value: string) => {
    const nextTab = value === "pipeline" ? "pipeline" : "projects";
    setPortfolioTab(nextTab);
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (nextTab === "pipeline") {
      url.searchParams.set("tab", "crm");
    } else {
      // Keep an explicit ?tab=projects — bare / now renders the 6a home, so the
      // classic table needs a param to stay put across refresh/deep-link.
      url.searchParams.set("tab", "projects");
      url.searchParams.delete("opportunity");
    }
    window.history.replaceState({}, "", url.toString());
  };

  const seededRef = useRef(false);
  useEffect(() => {
    if (isLoading || seededRef.current) return;
    seededRef.current = true;
    seed()
      .then((r) => {
        setSeedError(null);
        if (r.seeded) qc.invalidateQueries({ queryKey: ["projects"] });
      })
      .catch((error) => {
        const message = errorMessage(error);
        setSeedError(message);
        toast.error("Harbor Residence demo did not load", {
          description: message,
        });
        seededRef.current = false;
      });
  }, [isLoading, seed, qc]);

  const navigate = useNavigate();
  const router = useRouter();
  const signOut = async () => {
    await supabase.auth.signOut();
    router.invalidate();
    navigate({ to: "/auth" });
  };

  // First-run checklist (ONBOARDING1). Each step self-checks from live data; the billing
  // steps stay disabled until their prerequisite lands, and deep-link straight to Billing.
  const onboardingFirstProjectId = onboardingStatus?.firstProjectId ?? null;
  const onboardingHasCompany = Boolean(companyContext?.name) && companyContext?.name !== "Company";
  const onboardingHasProject = Boolean(onboardingStatus?.hasProject);
  const onboardingHasSov = Boolean(onboardingStatus?.hasScheduleOfValues);
  const onboardingHasPayApp = Boolean(onboardingStatus?.hasPayApplication);
  const onboardingAllDone =
    onboardingHasCompany && onboardingHasProject && onboardingHasSov && onboardingHasPayApp;
  const billingDeepLink = (label: string, enabled: boolean) =>
    enabled && onboardingFirstProjectId ? (
      <Button asChild size="sm" variant="outline">
        <Link
          to="/projects/$projectId"
          params={{ projectId: onboardingFirstProjectId }}
          search={{ tab: "billing" }}
        >
          {label}
        </Link>
      </Button>
    ) : (
      <Button size="sm" variant="outline" disabled>
        {label}
      </Button>
    );
  const onboardingSteps: ChecklistStep[] = [
    {
      key: "company",
      title: "Set up your company",
      description: "Add your company name and logo so pay apps and portals are branded.",
      done: onboardingHasCompany,
      action: (
        <Button asChild size="sm" variant="outline">
          <Link to="/team">Open company</Link>
        </Button>
      ),
    },
    {
      key: "project",
      title: "Create your first project",
      description: "Start a real job alongside the Harbor Residence demo.",
      done: onboardingHasProject,
      action: (
        <Button size="sm" variant="outline" onClick={() => setCreateProjectOpen(true)}>
          New project
        </Button>
      ),
    },
    {
      key: "sov",
      title: "Import a schedule of values",
      description: "Open Billing, then Costs, and bring in your SOV cost codes.",
      done: onboardingHasSov,
      blocked: !onboardingHasProject,
      blockedReason: "Create your first project first — the schedule of values lives on a project.",
      action: billingDeepLink("Open billing", onboardingHasProject),
    },
    {
      key: "payapp",
      title: "Generate your first pay application",
      description: "In Billing, then Pay Applications, bill your SOV progress.",
      done: onboardingHasPayApp,
      blocked: !onboardingHasSov,
      blockedReason: "Import a schedule of values first — pay apps are built from it.",
      action: billingDeepLink("Open billing", onboardingHasSov),
    },
  ];
  const showOnboarding =
    onboardingStatus !== undefined && !onboardingDismissed && !onboardingAllDone;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="relative border-b border-hairline bg-surface-elevated/95 shadow-[0_10px_30px_rgb(31_28_23_/_0.05)]">
        <div className="absolute inset-0 grid-bg opacity-25" />
        <div className="relative mx-auto flex max-w-[1760px] flex-col gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              {headerLogoUrl ? (
                <img
                  src={headerLogoUrl}
                  alt={`${headerCompanyName} logo`}
                  className="h-9 w-9 shrink-0 rounded-sm border border-hairline bg-card object-contain p-1"
                  onError={() => setFailedCompanyLogoUrl(headerLogoUrl)}
                />
              ) : (
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-sm border border-hairline bg-card text-xs font-semibold text-muted-foreground">
                  {companyInitials(headerCompanyName)}
                </div>
              )}
              <div className="min-w-0">
                <div className="truncate text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  {headerCompanyName}
                </div>
                <h1 className="truncate font-serif text-3xl leading-none text-foreground">
                  {headerTitle}
                </h1>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button asChild size="sm" variant="outline" className="gap-1.5 bg-card/70">
                <a href="/?tab=crm">
                  <BriefcaseBusiness className="h-3.5 w-3.5" /> CRM
                </a>
              </Button>
              <Button asChild size="sm" variant="outline" className="gap-1.5 bg-card/70">
                <Link to="/estimates">
                  <ClipboardList className="h-3.5 w-3.5" /> Estimates
                </Link>
              </Button>
              <Button asChild size="sm" variant="outline" className="gap-1.5 bg-card/70">
                <Link to="/billing">
                  <ReceiptText className="h-3.5 w-3.5" /> Billing
                  <BillingFeedBadge />
                </Link>
              </Button>
              <Button asChild size="sm" variant="outline" className="gap-1.5 bg-card/70">
                <Link to="/reports">
                  <BarChart3 className="h-3.5 w-3.5" /> Reports
                </Link>
              </Button>
              <Button asChild size="sm" variant="outline" className="gap-1.5 bg-card/70">
                <Link to="/cost-library">
                  <FileText className="h-3.5 w-3.5" /> Cost Library
                </Link>
              </Button>
              <Button asChild size="sm" variant="outline" className="gap-1.5 bg-card/70">
                <Link to="/team">
                  <Users className="h-3.5 w-3.5" /> Company
                </Link>
              </Button>
              <NewProjectButton open={createProjectOpen} onOpenChange={setCreateProjectOpen} />
              <Button variant="ghost" size="sm" onClick={signOut} className="gap-1.5">
                <LogOut className="h-3.5 w-3.5" /> Sign out
              </Button>
            </div>
          </div>
        </div>
      </header>

      <main
        className={`mx-auto px-4 py-6 sm:px-6 lg:px-8 ${
          portfolioTab === "pipeline" ? "max-w-[1900px]" : "max-w-[1760px]"
        }`}
      >
        {seedError && (
          <PortfolioLoadError
            title="Harbor Residence demo did not load"
            description="The demo project is supposed to be prepared automatically for each workspace. This error is visible now so we can fix the underlying database rule instead of quietly showing an empty portfolio."
            detail={seedError}
            onRetry={() => {
              setSeedError(null);
              seededRef.current = false;
              qc.invalidateQueries({ queryKey: ["projects"] });
            }}
          />
        )}
        <Tabs value={portfolioTab} onValueChange={setPortfolioTabWithUrl} className="space-y-5">
          <div className="flex flex-col gap-3 rounded-lg border border-hairline bg-card/80 p-3 shadow-card sm:flex-row sm:items-center sm:justify-between">
            <TabsList className="h-auto w-full justify-start rounded-md border border-accent/20 bg-accent/5 p-1 sm:w-auto">
              <TabsTrigger value="projects">Projects</TabsTrigger>
              <TabsTrigger value="pipeline">CRM</TabsTrigger>
            </TabsList>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>{currentViewLabel}</span>
              {portfolioTab === "projects" && projects.length > 0 && (
                <span className="rounded-sm border border-hairline bg-surface px-2 py-1 font-medium tabular text-foreground">
                  {visibleProjects.length} of {projects.length} projects
                </span>
              )}
            </div>
          </div>
          <TabsContent value="projects" className="mt-0">
            {showOnboarding ? (
              <div className="mb-4">
                <FirstRunChecklist steps={onboardingSteps} onDismiss={dismissOnboarding} />
              </div>
            ) : null}
            {isLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : projectsDidError ? (
              <PortfolioLoadError
                title="Portfolio did not load"
                description="Your projects were not deleted. The app could not read the portfolio from the database with the current access context."
                detail={errorMessage(projectsError)}
                onRetry={() => refetchProjects()}
              />
            ) : projects.length === 0 ? (
              <EmptyState />
            ) : (
              <div className="space-y-6">
                <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(400px,0.65fr)]">
                  <PortfolioDashboard totals={portfolioTotals} />
                  <PortfolioCrmDashboard
                    opportunities={crmOpportunities}
                    snapshot={crmSnapshot}
                    isLoading={crmOpportunitiesLoading || crmSnapshotLoading}
                    onOpenCrm={() => setPortfolioTabWithUrl("pipeline")}
                  />
                </div>
                <div className="space-y-3 rounded-lg border border-hairline bg-surface-elevated/80 p-3 shadow-card">
                  <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
                    <div className="min-w-0 xl:w-[260px]">
                      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                        Project worklist
                      </div>
                      <div className="mt-1 text-sm text-muted-foreground">
                        Search, sort, and open the next job that needs attention.
                      </div>
                    </div>
                    <div className="relative flex-1">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search project, job number, client, PM, or company"
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
                    <Select
                      value={sortMode}
                      onValueChange={(v) => setSortMode(v as PortfolioSortMode)}
                    >
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
                  </div>
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[1.1fr_repeat(4,minmax(0,1fr))_auto]">
                    <Select value={companyFilter} onValueChange={setCompanyFilter}>
                      <SelectTrigger>
                        <SelectValue placeholder="Company" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All companies</SelectItem>
                        {companyNames.map((company) => (
                          <SelectItem key={company} value={company}>
                            {company}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select
                      value={riskFilter}
                      onValueChange={(v) => setRiskFilter(v as PortfolioRiskFilter)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Risk status" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All risk</SelectItem>
                        <SelectItem value="at-risk">At risk</SelectItem>
                        <SelectItem value="watch">Watch</SelectItem>
                        <SelectItem value="aligned">Aligned</SelectItem>
                      </SelectContent>
                    </Select>
                    <Select
                      value={scheduleFilter}
                      onValueChange={(v) => setScheduleFilter(v as PortfolioScheduleFilter)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Schedule" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All schedules</SelectItem>
                        <SelectItem value="slipped">Slipped</SelectItem>
                        <SelectItem value="watch">Watch</SelectItem>
                        <SelectItem value="on-plan">On plan</SelectItem>
                      </SelectContent>
                    </Select>
                    <Select
                      value={reviewFilter}
                      onValueChange={(v) => setReviewFilter(v as PortfolioReviewFilter)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="IOR review" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All IOR reviews</SelectItem>
                        <SelectItem value="stale">Stale 30+ days</SelectItem>
                        <SelectItem value="current">Current</SelectItem>
                        <SelectItem value="never">Never reviewed</SelectItem>
                      </SelectContent>
                    </Select>
                    <Select
                      value={dailyFilter}
                      onValueChange={(v) => setDailyFilter(v as PortfolioDailyFilter)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Daily reports" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All daily reports</SelectItem>
                        <SelectItem value="current">Current 7 days</SelectItem>
                        <SelectItem value="stale">Stale 8+ days</SelectItem>
                        <SelectItem value="none">No reports</SelectItem>
                        <SelectItem value="client-visible">Client-visible</SelectItem>
                      </SelectContent>
                    </Select>
                    <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground xl:justify-end">
                      <span className="whitespace-nowrap">
                        Showing {visibleProjects.length} of {projects.length}
                        {activeFilterCount > 0 ? ` · ${activeFilterCount} filters` : ""}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={resetFilters}
                        disabled={activeFilterCount === 0}
                        className="gap-1.5"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        Reset
                      </Button>
                    </div>
                  </div>
                </div>
                <PortfolioProjectLedger
                  projects={visibleProjects}
                  failedOrganizationLogos={failedOrganizationLogos}
                  onOrganizationLogoError={(logoUrl) =>
                    setFailedOrganizationLogos((current) => new Set(current).add(logoUrl))
                  }
                />
              </div>
            )}
          </TabsContent>
          <TabsContent value="pipeline" className="mt-0">
            <PipelineWorkspace initialOpportunityId={initialPipelineOpportunityId} />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

function PortfolioPill({ children, className }: { children: ReactNode; className: string }) {
  return (
    <span
      className={`inline-flex h-6 min-w-[78px] items-center justify-center whitespace-nowrap rounded-full border px-2.5 text-center text-[10px] font-semibold uppercase leading-none tracking-[0.08em] ${className}`}
    >
      {children}
    </span>
  );
}

const PROJECT_LEDGER_GRID_CLASS =
  "xl:grid-cols-[minmax(260px,1.35fr)_minmax(210px,0.95fr)_minmax(205px,0.9fr)_minmax(230px,1fr)_minmax(120px,0.55fr)]";

function PortfolioProjectLedger({
  projects,
  failedOrganizationLogos,
  onOrganizationLogoError,
}: {
  projects: PortfolioProject[];
  failedOrganizationLogos: Set<string>;
  onOrganizationLogoError: (logoUrl: string) => void;
}) {
  return (
    <section
      data-testid="portfolio-project-ledger"
      className="overflow-hidden rounded-lg border border-hairline bg-card shadow-card"
    >
      <div className="flex flex-col gap-3 border-b border-hairline bg-surface/80 px-4 py-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Project ledger
          </div>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Active jobs grouped by project identity, financial posture, risk, and field controls.
          </p>
        </div>
        <div className="inline-flex w-fit items-center justify-center rounded-md border border-hairline bg-card px-3 py-2 text-center">
          <div>
            <div className="text-xl font-medium leading-none tabular text-foreground">
              {projects.length}
            </div>
            <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              showing
            </div>
          </div>
        </div>
      </div>

      <div
        className={`hidden gap-4 border-b border-hairline px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground xl:grid ${PROJECT_LEDGER_GRID_CLASS}`}
      >
        <div>Project</div>
        <div className="text-center">Financials</div>
        <div>Risk exposure</div>
        <div>IOR controls</div>
        <div className="text-right">Posture</div>
      </div>

      {projects.length === 0 ? (
        <div className="px-4 py-12 text-center text-sm text-muted-foreground">
          No projects match the current portfolio filters.
        </div>
      ) : (
        <div className="divide-y divide-hairline">
          {projects.map((project) => {
            const status = statusFor(project.original_gp_pct, project.indicated_gp_pct);
            const schedule = scheduleFor(
              project.schedule_variance_weeks,
              project.schedule_risk_count,
            );
            const daily = dailyReportFor(
              project.daily_report_count,
              project.days_since_daily_report,
            );
            const jobNumber = project.job_number || `ID ${project.id.slice(0, 8).toUpperCase()}`;
            const projectHref = `/projects/${project.id}`;
            const highlightRisk = status.label === "At Risk" || project.gp_at_risk > 0;
            const isDemo = project.job_number === "DEMO-HARBOR";
            const organizationLogoUrl =
              project.organization_logo_url &&
              !failedOrganizationLogos.has(project.organization_logo_url)
                ? project.organization_logo_url
                : "";
            const fallbackInitial = (
              project.organization_name ||
              project.client ||
              project.name ||
              "O"
            )
              .trim()
              .slice(0, 1)
              .toUpperCase();
            return (
              <a
                key={project.id}
                href={projectHref}
                className={`group grid gap-4 px-4 py-4 text-foreground transition hover:bg-surface/70 active:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring md:grid-cols-2 ${PROJECT_LEDGER_GRID_CLASS} ${
                  highlightRisk ? "border-l-2 border-l-danger/60 bg-danger/5" : ""
                }`}
              >
                <div className="flex min-w-0 gap-3">
                  {organizationLogoUrl ? (
                    <img
                      src={organizationLogoUrl}
                      alt={`${project.organization_name} logo`}
                      className="mt-0.5 h-10 w-10 shrink-0 rounded-sm border border-hairline bg-card object-contain p-1"
                      onError={() => onOrganizationLogoError(organizationLogoUrl)}
                    />
                  ) : (
                    <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-sm border border-hairline bg-card text-sm font-semibold uppercase text-muted-foreground">
                      {fallbackInitial}
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <div className="truncate font-serif text-xl leading-tight text-foreground group-hover:underline">
                        {project.name}
                      </div>
                      {isDemo && (
                        <span
                          title="Seeded Overwatch teaching project"
                          className="rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-accent"
                        >
                          Demo IOR
                        </span>
                      )}
                      {project.warning_count > 0 && (
                        <span
                          title={`${project.warning_count} system risk${
                            project.warning_count === 1 ? "" : "s"
                          } detected`}
                          className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-danger/15 px-1.5 text-[10px] font-semibold text-danger"
                        >
                          {project.warning_count}
                        </span>
                      )}
                      {project.days_since_review !== null && project.days_since_review > 30 && (
                        <span
                          title="Project has not been reviewed in over 30 days"
                          className="rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-semibold text-warning"
                        >
                          Review {project.days_since_review}d
                        </span>
                      )}
                    </div>
                    <div className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      <span className="font-medium text-foreground">{jobNumber}</span>
                      {" · "}
                      {project.project_manager || "Unassigned"}
                      {" · "}
                      {project.organization_name}
                    </div>
                    <div className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                      {project.client} · {project.phase} · {project.percent_complete}% complete
                      {project.top_category && (
                        <> · Top risk: {project.top_category.replace(/_/g, " ")}</>
                      )}
                    </div>
                  </div>
                </div>

                <div className="grid min-w-0 grid-cols-2 gap-2">
                  <PortfolioLedgerStat
                    label="Contract"
                    value={fmtUSD(project.original_contract)}
                    sub={`Plan ${fmtPct(project.original_gp_pct)}`}
                  />
                  <PortfolioLedgerStat
                    label="Indicated"
                    value={fmtUSD(project.indicated_gp)}
                    sub={fmtPct(project.indicated_gp_pct)}
                    tone={project.indicated_gp_pct < project.original_gp_pct ? "warning" : "accent"}
                  />
                  <PortfolioLedgerStat
                    label={project.gp_at_risk > 0 ? "GP risk" : "GP upside"}
                    value={fmtUSD(Math.abs(project.gp_at_risk))}
                    sub={project.gp_at_risk > 0 ? "Margin erosion" : "Above signed"}
                    tone={project.gp_at_risk > 0 ? "danger" : "accent"}
                  />
                  <PortfolioLedgerStat
                    label="Allocated"
                    value={fmtUSD(project.risk_allocated)}
                    sub="Current holds"
                  />
                </div>

                <div className="min-w-0 rounded-md border border-hairline bg-surface/70 p-3">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    Top exposure
                  </div>
                  {project.top_exposure_title ? (
                    <div className="mt-2">
                      <div className="line-clamp-2 text-sm font-medium leading-snug text-foreground">
                        {project.top_exposure_title}
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                        <span className="font-medium tabular text-danger">
                          {fmtUSD(project.top_exposure_value)}
                        </span>
                        {project.top_exposure_hold_class && (
                          <span>{project.top_exposure_hold_class}</span>
                        )}
                        {project.top_exposure_owner && <span>{project.top_exposure_owner}</span>}
                      </div>
                    </div>
                  ) : (
                    <div className="mt-2 text-sm text-muted-foreground">No live exposure</div>
                  )}
                </div>

                <div className="grid min-w-0 gap-2">
                  <PortfolioLedgerState
                    label="To-dos"
                    detail={
                      project.next_decision_due
                        ? `Due ${shortDate(project.next_decision_due)}`
                        : "No dated action"
                    }
                  >
                    <PortfolioPill
                      className={
                        project.overdue_decision_count > 0
                          ? "border-danger/40 bg-danger/10 text-danger"
                          : project.active_decision_count > 0
                            ? "border-warning/40 bg-warning/10 text-warning"
                            : "border-success/40 bg-success/10 text-success"
                      }
                    >
                      {project.overdue_decision_count > 0
                        ? `${project.overdue_decision_count} overdue`
                        : `${project.active_decision_count} open`}
                    </PortfolioPill>
                  </PortfolioLedgerState>
                  <PortfolioLedgerState
                    label="Schedule"
                    detail={`${
                      project.schedule_variance_weeks > 0
                        ? `+${project.schedule_variance_weeks} wk`
                        : "No slip"
                    } · ${project.schedule_risk_count} risks`}
                  >
                    <PortfolioPill className={schedule.className}>
                      {schedule.label} · {Math.round(schedule.score)}%
                    </PortfolioPill>
                  </PortfolioLedgerState>
                  <PortfolioLedgerState
                    label="Daily reports"
                    detail={
                      project.daily_report_count === 0
                        ? "No job logs"
                        : `${project.daily_report_count} logs · last ${shortDate(
                            project.last_daily_report_date,
                          )}${
                            project.client_visible_daily_report_count > 0
                              ? ` · ${project.client_visible_daily_report_count} client-visible`
                              : ""
                          }`
                    }
                  >
                    <PortfolioPill className={daily.className}>{daily.label}</PortfolioPill>
                  </PortfolioLedgerState>
                </div>

                <div className="flex min-w-0 flex-col items-start gap-2 md:items-end md:text-right">
                  <PortfolioPill className={status.className}>{status.label}</PortfolioPill>
                  <span className="text-xs font-medium text-muted-foreground transition group-hover:text-accent">
                    Open project
                  </span>
                </div>
              </a>
            );
          })}
        </div>
      )}
    </section>
  );
}

function PortfolioLedgerStat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
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
    <div className="min-w-0 rounded-md border border-hairline bg-card/80 px-2.5 py-2 text-center">
      <div className="min-h-[22px] text-center text-[9px] font-semibold uppercase leading-[1.15] tracking-[0.08em] text-muted-foreground">
        {label}
      </div>
      <div className={`mt-1 truncate text-sm font-semibold leading-tight tabular ${toneClass}`}>
        {value}
      </div>
      <div className="mt-1 truncate text-[11px] leading-tight tabular text-muted-foreground">
        {sub}
      </div>
    </div>
  );
}

function PortfolioLedgerState({
  label,
  detail,
  children,
}: {
  label: string;
  detail: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3 rounded-md border border-hairline bg-surface/70 px-3 py-2">
      <div className="min-w-0">
        <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          {label}
        </div>
        <div className="mt-1 line-clamp-2 text-[11px] leading-tight text-muted-foreground">
          {detail}
        </div>
      </div>
      <div className="shrink-0">{children}</div>
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
  staleReviewProjects: number;
  neverReviewedProjects: number;
  dailyReportCount: number;
  projectsWithoutDailyReports: number;
  staleDailyReportProjects: number;
  clientVisibleDailyReportCount: number;
  dailyReportAttachmentCount: number;
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
    staleReviewProjects: projects.filter(
      (p) => p.days_since_review !== null && p.days_since_review > 30,
    ).length,
    neverReviewedProjects: projects.filter((p) => p.days_since_review === null).length,
    dailyReportCount: sum((p) => p.daily_report_count),
    projectsWithoutDailyReports: projects.filter((p) => p.daily_report_count === 0).length,
    staleDailyReportProjects: projects.filter(
      (p) => p.daily_report_count > 0 && (p.days_since_daily_report ?? 0) > 7,
    ).length,
    clientVisibleDailyReportCount: sum((p) => p.client_visible_daily_report_count),
    dailyReportAttachmentCount: sum((p) => p.daily_report_attachment_count),
    warningCount: sum((p) => p.warning_count),
    topRiskProject,
    topExposures,
    overdueProjects,
  };
}

const CRM_ACTIVE_STAGES = new Set<PipelineStage>([
  "lead",
  "qualifying",
  "estimating",
  "bid_submitted",
  "negotiating",
]);

function buildPortfolioCrmTotals(
  opportunities: PipelineOpportunityRow[],
  snapshot: PipelineCrmSnapshot | null,
) {
  const activeOpportunities = opportunities.filter(
    (opportunity) => !opportunity.archived && CRM_ACTIVE_STAGES.has(opportunity.stage),
  );
  const wonOpportunities = opportunities.filter((opportunity) => opportunity.stage === "won");
  const topOpportunities = [...activeOpportunities]
    .sort(
      (a, b) =>
        b.estimated_contract * (b.probability / 100) -
          a.estimated_contract * (a.probability / 100) ||
        b.estimated_contract - a.estimated_contract,
    )
    .slice(0, 4);
  const openActions = snapshot?.openActions ?? [];
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const oneWeek = now.getTime() + 7 * 86400000;
  const overdueActions = openActions.filter((action) => {
    if (!action.due_date) return false;
    return new Date(`${action.due_date}T00:00:00`).getTime() < now.getTime();
  });
  const dueThisWeek = openActions.filter((action) => {
    if (!action.due_date) return false;
    const due = new Date(`${action.due_date}T00:00:00`).getTime();
    return due <= oneWeek;
  });

  return {
    accountCount: snapshot?.accounts.length ?? 0,
    contactCount: snapshot?.contacts.length ?? 0,
    activeOpportunityCount: activeOpportunities.length,
    activePipelineValue: activeOpportunities.reduce(
      (total, opportunity) => total + opportunity.estimated_contract,
      0,
    ),
    weightedPipelineValue: activeOpportunities.reduce(
      (total, opportunity) =>
        total + opportunity.estimated_contract * (opportunity.probability / 100),
      0,
    ),
    wonValue: wonOpportunities.reduce(
      (total, opportunity) => total + opportunity.estimated_contract,
      0,
    ),
    openActionCount: openActions.length,
    overdueActionCount: overdueActions.length,
    dueThisWeekCount: dueThisWeek.length,
    topOpportunities,
    nextActions: openActions.slice(0, 4),
  };
}

function PortfolioDashboard({ totals }: { totals: PortfolioTotals }) {
  const reviewDebt = totals.staleReviewProjects + totals.neverReviewedProjects;
  return (
    <TooltipProvider delayDuration={150}>
      <section className="rounded-lg border border-hairline bg-card p-4 shadow-card md:p-5">
        <div className="grid gap-4 2xl:grid-cols-[minmax(260px,0.78fr)_minmax(520px,1.22fr)] 2xl:items-start">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              <BriefcaseBusiness className="h-3.5 w-3.5" />
              Portfolio Control Room
            </div>
            <h2 className="mt-2 font-serif text-3xl leading-none text-foreground lg:text-4xl">
              Company-wide IOR posture
            </h2>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">
              The operating truth across active jobs: margin, holds, schedule pressure, and field
              follow-through in one view.
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <PortfolioMetric
              label="Indicated GP"
              value={fmtUSD(totals.indicatedGP)}
              sub={fmtPct(totals.indicatedPct)}
              tone="accent"
              help="The gross profit you're currently on track to make across all jobs — your original expected profit, less what's now held back for risk."
            />
            <PortfolioMetric
              label={totals.gpAtRisk > 0 ? "GP at risk" : "GP upside"}
              // gpAtRisk = original GP − indicated GP. Positive = erosion (risk);
              // negative = indicating ABOVE signed (upside) — show that as upside,
              // never as a red negative "at risk", matching the project dashboard.
              value={fmtUSD(Math.abs(totals.gpAtRisk))}
              tone={totals.gpAtRisk > 0 ? "danger" : "accent"}
              help={
                totals.gpAtRisk > 0
                  ? "How much your originally expected profit has eroded — original expected GP minus what you're now indicating. It's the profit in question you're managing back, not a booked loss, so it can be larger than indicated GP."
                  : "How much you're indicating ABOVE the gross profit you originally signed — upside on the book across your jobs, not risk."
              }
            />
            <PortfolioMetric
              label="E-Holds"
              value={fmtUSD(totals.exposureHolds)}
              tone="danger"
              help="Exposure holds — dollars set aside for specific, identified risks on your jobs (from the IOR risk register)."
            />
            <PortfolioMetric
              label="C-Holds"
              value={fmtUSD(totals.contingencyHold)}
              tone="warning"
              help="Contingency holds — a general set-aside for the unknowns, not tied to any one specific risk."
            />
          </div>
        </div>

        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
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
            help="Jobs tracking behind their baseline finish date."
          />
          <PortfolioSignal
            icon={<AlertTriangle className="h-3.5 w-3.5" />}
            label="At risk"
            value={String(totals.atRiskProjects)}
            tone={totals.atRiskProjects > 0 ? "danger" : "success"}
            help="Jobs whose IOR reading flags margin or schedule that needs attention."
          />
          <PortfolioSignal
            icon={<AlertTriangle className="h-3.5 w-3.5" />}
            label="IOR debt"
            value={String(reviewDebt)}
            tone={reviewDebt > 0 ? "warning" : "success"}
            help="Jobs whose IOR reading is stale or never run — the numbers need a fresh review before you can trust them."
          />
          <PortfolioSignal
            icon={<FileText className="h-3.5 w-3.5" />}
            label="No daily"
            value={String(totals.projectsWithoutDailyReports)}
            tone={totals.projectsWithoutDailyReports > 0 ? "warning" : "success"}
            help="Jobs with no recent daily log — field activity isn't being captured."
          />
          <PortfolioSignal
            icon={<ClipboardList className="h-3.5 w-3.5" />}
            label="Overdue"
            value={String(totals.overdueDecisionCount)}
            tone={totals.overdueDecisionCount > 0 ? "danger" : "success"}
            help="Open action items past their due date across all jobs."
          />
        </div>

        <div className="mt-3 grid gap-3 lg:grid-cols-[1.12fr_0.88fr]">
          <div className="rounded-md border border-danger/20 bg-danger/5 p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-danger">
                Largest exposure pressure
              </div>
              {/* The live risk holds pulling on GP (E + C holds) — this box is
                  about exposures, so show their total, not gpAtRisk (which can be
                  negative when the book is running to upside). */}
              <div className="text-sm font-medium tabular text-danger">
                {fmtUSD(totals.exposureHolds + totals.contingencyHold)}
              </div>
            </div>
            <div className="mt-2 divide-y divide-danger/15">
              {totals.topExposures.length === 0 ? (
                <div className="py-2 text-sm text-muted-foreground">
                  No live exposure is currently pulling down gross profit.
                </div>
              ) : (
                totals.topExposures.slice(0, 3).map((exposure, index) => (
                  <a
                    key={`${exposure.projectId}-${exposure.title}`}
                    href={`/projects/${exposure.projectId}`}
                    className="grid gap-2 py-2.5 transition hover:text-danger sm:grid-cols-[28px_1fr_auto]"
                  >
                    <div className="text-xs font-semibold tabular text-danger">
                      {String(index + 1).padStart(2, "0")}
                    </div>
                    <div className="min-w-0">
                      <div className="truncate font-medium text-foreground">{exposure.title}</div>
                      <div className="mt-0.5 truncate text-xs text-muted-foreground">
                        {exposure.projectName} · {exposure.jobNumber}
                        {exposure.owner ? ` · ${exposure.owner}` : ""}
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
          <div className="rounded-md border border-hairline bg-surface p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Action debt
              </div>
              <div
                className={`text-sm font-medium tabular ${
                  totals.overdueDecisionCount > 0 ? "text-danger" : "text-success"
                }`}
              >
                {totals.overdueDecisionCount} overdue
              </div>
            </div>
            <div className="mt-2 divide-y divide-hairline">
              {totals.overdueProjects.length === 0 ? (
                <div className="py-2 text-sm text-muted-foreground">
                  No overdue project to-dos in the current view.
                </div>
              ) : (
                totals.overdueProjects.slice(0, 3).map((project) => (
                  <a
                    key={project.id}
                    href={`/projects/${project.id}`}
                    className="grid gap-2 py-2.5 transition hover:text-danger sm:grid-cols-[1fr_auto]"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-medium text-foreground">{project.name}</div>
                      <div className="mt-0.5 truncate text-xs text-muted-foreground">
                        {project.project_manager || "Unassigned"} ·{" "}
                        {project.job_number || `ID ${project.id.slice(0, 8).toUpperCase()}`}
                      </div>
                    </div>
                    <div className="text-right text-sm font-medium tabular text-danger">
                      {project.overdue_decision_count}
                    </div>
                  </a>
                ))
              )}
            </div>
          </div>
        </div>
      </section>
    </TooltipProvider>
  );
}

function PortfolioCrmDashboard({
  opportunities,
  snapshot,
  isLoading,
  onOpenCrm,
}: {
  opportunities: PipelineOpportunityRow[];
  snapshot: PipelineCrmSnapshot | null;
  isLoading: boolean;
  onOpenCrm: () => void;
}) {
  // Sample CRM data is client-side, so deleting a sample opportunity in the CRM
  // tab only records a local removal. Read those removals (fresh each time this
  // tab is shown) and prune both feeds so Pipeline intake stops counting the
  // deleted sample's opportunity, weighted value, and open actions. Real CRM
  // rows are untouched, so this is a no-op once a company has its own data.
  const [removedDemoIds] = useState(readDemoOpportunityRemovals);
  const removedDemoIdSet = useMemo(() => new Set(removedDemoIds), [removedDemoIds]);
  const visibleOpportunities = useMemo(
    () => opportunities.filter((opportunity) => !removedDemoIdSet.has(opportunity.id)),
    [opportunities, removedDemoIdSet],
  );
  const prunedSnapshot = useMemo(
    () => (snapshot ? pruneRemovedDemoCrm(snapshot, removedDemoIds) : null),
    [snapshot, removedDemoIds],
  );
  const totals = buildPortfolioCrmTotals(visibleOpportunities, prunedSnapshot);
  return (
    <section className="rounded-lg border border-hairline bg-card p-4 shadow-card md:p-5">
      <div className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              <KanbanSquare className="h-3.5 w-3.5" />
              Pipeline intake
            </div>
            <h2 className="mt-2 font-serif text-2xl leading-tight text-foreground">
              CRM before project control
            </h2>
          </div>
          <Button type="button" size="sm" onClick={onOpenCrm} className="shrink-0 gap-1.5">
            <KanbanSquare className="h-3.5 w-3.5" />
            Open CRM
          </Button>
        </div>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Pursuits, relationships, and follow-ups that become estimates, then managed IOR projects.
        </p>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-3 xl:grid-cols-1 2xl:grid-cols-3">
        <PortfolioSignal
          icon={<BriefcaseBusiness className="h-3.5 w-3.5" />}
          label="Open opps"
          value={isLoading ? "..." : String(totals.activeOpportunityCount)}
          compact
        />
        <PortfolioSignal
          icon={<Activity className="h-3.5 w-3.5" />}
          label="Weighted"
          value={isLoading ? "..." : fmtUSD(totals.weightedPipelineValue)}
          tone={totals.weightedPipelineValue > 0 ? "success" : undefined}
          compact
        />
        <PortfolioSignal
          icon={<ClipboardList className="h-3.5 w-3.5" />}
          label="Open actions"
          value={isLoading ? "..." : String(totals.openActionCount)}
          tone={totals.overdueActionCount > 0 ? "danger" : "success"}
          compact
        />
      </div>

      <div className="mt-3 grid gap-3 2xl:grid-cols-1">
        <div className="rounded-md border border-hairline bg-surface p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Top opportunities
            </div>
            <div className="text-sm font-medium tabular text-foreground">
              {fmtUSD(totals.activePipelineValue)}
            </div>
          </div>
          <div className="mt-2 divide-y divide-hairline">
            {totals.topOpportunities.length === 0 ? (
              <div className="py-2 text-sm text-muted-foreground">
                No open CRM opportunities in the current company workspace.
              </div>
            ) : (
              totals.topOpportunities.slice(0, 3).map((opportunity) => (
                <button
                  type="button"
                  key={opportunity.id}
                  onClick={onOpenCrm}
                  className="grid w-full gap-2 py-2.5 text-left transition hover:text-accent sm:grid-cols-[1fr_auto]"
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium text-foreground">{opportunity.name}</div>
                    <div className="mt-0.5 truncate text-xs text-muted-foreground">
                      {opportunity.account_name || opportunity.client || "No account"} ·{" "}
                      {crmStageLabel(opportunity.stage)} · {opportunity.probability}%
                    </div>
                  </div>
                  <div className="text-right font-medium tabular text-foreground">
                    {fmtUSD(opportunity.estimated_contract)}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        <div className="rounded-md border border-hairline bg-surface p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Next CRM actions
            </div>
            <div
              className={`text-sm font-medium tabular ${
                totals.overdueActionCount > 0 ? "text-danger" : "text-foreground"
              }`}
            >
              {totals.overdueActionCount} overdue
            </div>
          </div>
          <div className="mt-2 divide-y divide-hairline">
            {totals.nextActions.length === 0 ? (
              <div className="py-2 text-sm text-muted-foreground">No open CRM actions.</div>
            ) : (
              totals.nextActions.slice(0, 3).map((action) => (
                <button
                  type="button"
                  key={action.id}
                  onClick={onOpenCrm}
                  className="grid w-full gap-2 py-2.5 text-left transition hover:text-accent sm:grid-cols-[1fr_auto]"
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium text-foreground">{action.title}</div>
                    <div className="mt-0.5 truncate text-xs text-muted-foreground">
                      {action.opportunity_name || action.account_name || action.contact_name}
                    </div>
                  </div>
                  <div className="text-right text-xs font-medium tabular text-muted-foreground">
                    {shortDate(action.due_date)}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function crmStageLabel(stage: PipelineStage) {
  return stage
    .split("_")
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

// A stat label that explains itself on hover. The portfolio front door is full
// of shorthand (GP at risk, E/C-Holds, IOR debt) a first-time contractor won't
// know — one hover says what each means in plain English.
function StatLabel({ label, help }: { label: string; help?: string }) {
  if (!help) return <>{label}</>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex cursor-help items-center gap-1">
          {label}
          <Info className="h-3 w-3 opacity-60" />
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-[250px] text-xs font-normal normal-case leading-snug tracking-normal">
        {help}
      </TooltipContent>
    </Tooltip>
  );
}

function PortfolioMetric({
  label,
  value,
  sub,
  tone,
  help,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "danger" | "accent" | "warning";
  help?: string;
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
    <div className="flex min-h-[78px] min-w-0 flex-col justify-between rounded-md border border-hairline bg-surface px-3 py-2.5">
      <div className="text-[10px] font-semibold uppercase leading-[1.2] tracking-[0.12em] text-muted-foreground">
        <StatLabel label={label} help={help} />
      </div>
      <div className="mt-2 min-w-0">
        {/* Never clip a headline figure: show the whole number, wrap only if it
            genuinely can't fit rather than ending in "…". */}
        <div
          className={`text-lg font-semibold leading-tight tabular [overflow-wrap:break-word] ${toneClass}`}
        >
          {value}
        </div>
        <div className="mt-1 min-h-4 text-xs leading-4 tabular text-muted-foreground">
          {sub || "\u00a0"}
        </div>
      </div>
    </div>
  );
}

function PortfolioSignal({
  icon,
  label,
  value,
  tone,
  compact,
  help,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  tone?: "success" | "warning" | "danger";
  // Narrow tiles (e.g. the pipeline-intake column) hold currency that would
  // overflow at the big size — step the value down a notch so it stays whole.
  compact?: boolean;
  help?: string;
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
    <div
      className={`flex min-h-[70px] min-w-0 flex-col justify-between rounded-md border px-3 py-2.5 ${toneClass}`}
    >
      <div className="flex items-start gap-1.5 text-[10px] font-semibold uppercase leading-[1.2] tracking-[0.12em]">
        <span className="mt-0.5 shrink-0">{icon}</span>
        <span>
          <StatLabel label={label} help={help} />
        </span>
      </div>
      <div
        className={`mt-2 max-w-full font-semibold leading-tight tabular [overflow-wrap:break-word] ${
          compact ? "text-xl" : "text-2xl"
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function PortfolioLoadError({
  title,
  description,
  detail,
  onRetry,
}: {
  title: string;
  description: string;
  detail: string;
  onRetry: () => void;
}) {
  return (
    <div className="mb-6 rounded-lg border border-danger/30 bg-danger/10 p-5 text-danger">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="flex gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <h2 className="font-serif text-2xl text-danger">{title}</h2>
            <p className="mt-1 max-w-2xl text-sm text-danger/80">{description}</p>
            <pre className="mt-3 max-w-3xl overflow-auto rounded-md border border-danger/20 bg-background/70 p-3 text-left text-xs text-foreground">
              {detail}
            </pre>
          </div>
        </div>
        <Button type="button" variant="outline" onClick={onRetry} className="shrink-0 gap-1.5">
          <RotateCcw className="h-3.5 w-3.5" />
          Retry
        </Button>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-lg border border-hairline bg-card p-10 shadow-card sm:p-16">
      <div className="mx-auto max-w-xl text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-accent/20 bg-accent/10 text-accent">
          <BriefcaseBusiness className="h-5 w-5" />
        </div>
        <h2 className="mt-4 font-serif text-3xl text-foreground">No projects yet</h2>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
          This page becomes your control room: margin, schedule pressure, and field follow-through
          for every active job, in one view. It starts with your first project.
        </p>
        <div className="mx-auto mt-6 grid max-w-lg gap-2 text-left sm:grid-cols-3">
          <div className="rounded-md border border-hairline bg-surface px-3 py-2.5">
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Step 1
            </div>
            <div className="mt-1 text-xs leading-relaxed text-foreground">
              Create the project — a name is enough to start.
            </div>
          </div>
          <div className="rounded-md border border-hairline bg-surface px-3 py-2.5">
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Step 2
            </div>
            <div className="mt-1 text-xs leading-relaxed text-foreground">
              Add the contract value and completion dates when you have them.
            </div>
          </div>
          <div className="rounded-md border border-hairline bg-surface px-3 py-2.5">
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Step 3
            </div>
            <div className="mt-1 text-xs leading-relaxed text-foreground">
              Work the job from its IOR page — schedule, risks, and billing.
            </div>
          </div>
        </div>
        <div className="mt-6 flex justify-center">
          <NewProjectButton />
        </div>
      </div>
    </div>
  );
}

const roleOptions: { value: AccountRole; label: string }[] = [
  { value: "owner", label: "Owner" },
  { value: "admin", label: "Admin" },
  { value: "executive", label: "Executive" },
  { value: "project_manager", label: "Project manager" },
  { value: "member", label: "Company member" },
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
      await sendOverwatchMagicLink({ email: inviteEmail, next: "/", context: "portfolio_invite" });

      return inviteEmail;
    },
    onSuccess: async (inviteEmail) => {
      await qc.invalidateQueries({ queryKey: ["team-workspace"] });
      toast.success("Company invite sent", {
        description: `${inviteEmail} can sign in and join this Overwatch company.`,
      });
      setEmail("");
      setRole("project_manager");
    },
    onError: (err) => {
      toast.error("Company invite did not send", {
        description: err instanceof Error ? err.message : "Try again.",
      });
    },
  });

  const memberMutation = useMutation({
    mutationFn: (payload: { membershipId: string; role?: AccountRole; status?: MemberStatus }) =>
      updateMember({
        data: payload as {
          membershipId: string;
          role?: AccountRole;
          status?: "active" | "disabled";
        },
      }),
    onSuccess: async () => {
      await refreshTeam();
      toast.success("Company member updated");
    },
    onError: (err) => {
      toast.error("Company member did not update", {
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
      if (!selectedUserId) throw new Error("Choose a company member.");
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
      status?: MemberStatus;
    }) =>
      updateProjectAccess({
        data: payload as {
          membershipId: string;
          role?: ProjectMemberRole;
          status?: "active" | "disabled";
        },
      }),
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
          <Users className="h-3.5 w-3.5" /> Company
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle className="font-serif text-2xl">Company access</DialogTitle>
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
                {team
                  ? formatUsageValue(team.usage.projects, team.organization.project_limit)
                  : "-"}
              </div>
            </div>
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Seats
              </div>
              <div className="mt-1 font-medium">
                {team
                  ? formatUsageValue(
                      team.usage.activeSeats + team.usage.pendingInvites,
                      team.organization.seat_limit,
                    )
                  : "-"}
              </div>
            </div>
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Daily logs this month
              </div>
              <div className="mt-1 font-medium">
                {team
                  ? formatUsageValue(
                      team.usage.dailyReportsThisMonth,
                      team.organization.daily_report_limit_per_month,
                    )
                  : "-"}
              </div>
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
                <div className="px-3 py-4 text-sm text-muted-foreground">Loading company...</div>
              ) : !team || team.members.length === 0 ? (
                <div className="px-3 py-4 text-sm text-muted-foreground">
                  No company members yet.
                </div>
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
                              status: v as MemberStatus,
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
                  <Label>Company member</Label>
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
                              status: v as MemberStatus,
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

function NewProjectButton({
  open: openProp,
  onOpenChange,
}: {
  open?: boolean;
  onOpenChange?: (value: boolean) => void;
} = {}) {
  const [openState, setOpenState] = useState(false);
  // Controllable so the first-run checklist (ONBOARDING1) can open this dialog; falls back
  // to self-managed state when rendered standalone.
  const open = openProp ?? openState;
  const setOpen = onOpenChange ?? setOpenState;
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
      toast.success("Project created", {
        id: "create-project",
        description: "Opening the new project now.",
      });
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
        id: "create-project",
        description: err instanceof Error ? err.message : "Try again.",
      });
    },
  });

  const handleCreateProject = (event?: React.FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    if (!name.trim()) {
      toast.error("Project name is required", {
        description: "Add a project name before creating the job.",
      });
      return;
    }
    if (mutation.isPending) return;
    toast.loading("Creating project...", { id: "create-project" });
    mutation.mutate();
  };

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
        <form className="grid gap-4 py-2" onSubmit={handleCreateProject}>
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
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || mutation.isPending}>
              {mutation.isPending ? "Creating..." : "Create project"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
