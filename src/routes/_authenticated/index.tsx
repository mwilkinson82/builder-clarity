import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { createProject, listProjects, seedDemoIfEmpty } from "@/lib/projects.functions";
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
  LogOut,
  Plus,
} from "lucide-react";
import { fmtUSD, fmtPct } from "@/lib/format";

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

function PortfolioPage() {
  const list = useServerFn(listProjects);
  const seed = useServerFn(seedDemoIfEmpty);
  const qc = useQueryClient();
  const { data: projects = [], isLoading } = useQuery({
    queryKey: ["projects"],
    queryFn: () => list(),
  });
  const portfolioTotals = useMemo(() => buildPortfolioTotals(projects), [projects]);

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
            <div className="overflow-hidden rounded-lg border border-hairline bg-card shadow-card">
              <Table>
                <TableHeader>
                  <TableRow className="bg-surface">
                    <TableHead>Project</TableHead>
                    <TableHead>Job #</TableHead>
                    <TableHead className="text-right">Original Contract</TableHead>
                    <TableHead className="text-right">Plan GP %</TableHead>
                    <TableHead className="text-right">Indicated GP %</TableHead>
                    <TableHead className="text-right">GP At Risk</TableHead>
                    <TableHead className="text-right">Risk Allocated</TableHead>
                    <TableHead>Schedule</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {projects.map((p) => {
                    const s = statusFor(p.original_gp_pct, p.indicated_gp_pct);
                    const schedule = scheduleFor(p.schedule_variance_weeks, p.schedule_risk_count);
                    const jobNumber = p.job_number || `ID ${p.id.slice(0, 8).toUpperCase()}`;
                    return (
                      <TableRow key={p.id} className="cursor-pointer">
                        <TableCell>
                          <Link
                            to="/projects/$projectId"
                            params={{ projectId: p.id }}
                            className="block"
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
                          </Link>
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-sm tabular text-foreground">
                          {jobNumber}
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

type PortfolioTotals = {
  projectCount: number;
  originalContract: number;
  forecastedFinalContract: number;
  forecastedFinalCost: number;
  forecastedGPBeforeHolds: number;
  indicatedGP: number;
  indicatedPct: number;
  gpAtRisk: number;
  riskAllocated: number;
  slippedProjects: number;
  atRiskProjects: number;
  warningCount: number;
  topRiskProject: PortfolioProject | null;
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

  return {
    projectCount: projects.length,
    originalContract: sum((p) => p.original_contract),
    forecastedFinalContract,
    forecastedFinalCost: sum((p) => p.forecasted_final_cost),
    forecastedGPBeforeHolds: sum((p) => p.forecasted_gp_before_holds),
    indicatedGP: sum((p) => p.indicated_gp),
    indicatedPct: forecastedFinalContract
      ? (sum((p) => p.indicated_gp) / forecastedFinalContract) * 100
      : 0,
    gpAtRisk: sum((p) => p.gp_at_risk),
    riskAllocated: sum((p) => p.risk_allocated),
    slippedProjects: projects.filter(
      (p) => p.schedule_variance_weeks > 0 || p.schedule_risk_count > 0,
    ).length,
    atRiskProjects: projects.filter(
      (p) => statusFor(p.original_gp_pct, p.indicated_gp_pct).label === "At Risk",
    ).length,
    warningCount: sum((p) => p.warning_count),
    topRiskProject,
  };
}

function PortfolioDashboard({ totals }: { totals: PortfolioTotals }) {
  const topRisk = totals.topRiskProject;
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
        <div className="grid min-w-[320px] grid-cols-3 gap-2">
          <PortfolioSignal
            icon={<Activity className="h-3.5 w-3.5" />}
            label="Open projects"
            value={String(totals.projectCount)}
          />
          <PortfolioSignal
            icon={<CalendarClock className="h-3.5 w-3.5" />}
            label="Slipped"
            value={String(totals.slippedProjects)}
            tone={totals.slippedProjects > 0 ? "warning" : "success"}
          />
          <PortfolioSignal
            icon={<AlertTriangle className="h-3.5 w-3.5" />}
            label="At risk"
            value={String(totals.atRiskProjects)}
            tone={totals.atRiskProjects > 0 ? "danger" : "success"}
          />
        </div>
      </div>

      <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-6">
        <PortfolioMetric label="Original contract" value={fmtUSD(totals.originalContract)} />
        <PortfolioMetric
          label="Forecasted final contract"
          value={fmtUSD(totals.forecastedFinalContract)}
        />
        <PortfolioMetric label="Forecasted final cost" value={fmtUSD(totals.forecastedFinalCost)} />
        <PortfolioMetric label="GP before holds" value={fmtUSD(totals.forecastedGPBeforeHolds)} />
        <PortfolioMetric label="GP at risk" value={fmtUSD(totals.gpAtRisk)} tone="danger" />
        <PortfolioMetric
          label="Indicated GP"
          value={fmtUSD(totals.indicatedGP)}
          sub={fmtPct(totals.indicatedPct)}
          tone="accent"
        />
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-md border border-danger/20 bg-danger/5 p-4">
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-danger">
            Largest GP at risk
          </div>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="font-serif text-2xl text-foreground">
                {topRisk ? topRisk.name : "No project risk"}
              </div>
              {topRisk && (
                <div className="mt-1 text-xs text-muted-foreground">
                  {topRisk.job_number || `ID ${topRisk.id.slice(0, 8).toUpperCase()}`} ·{" "}
                  {topRisk.top_category
                    ? topRisk.top_category.replace(/_/g, " ")
                    : "No top category"}
                </div>
              )}
            </div>
            <div className="text-2xl font-medium tabular text-danger">
              {topRisk ? fmtUSD(topRisk.gp_at_risk) : fmtUSD(0)}
            </div>
          </div>
        </div>
        <div className="rounded-md border border-hairline bg-surface p-4">
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Risk allocated
          </div>
          <div className="mt-2 flex items-end justify-between gap-4">
            <div className="text-sm text-muted-foreground">
              Live E-holds and C-holds currently subtracting from project outcomes.
            </div>
            <div className="whitespace-nowrap text-2xl font-medium tabular text-warning">
              {fmtUSD(totals.riskAllocated)}
            </div>
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
  tone?: "danger" | "accent";
}) {
  const toneClass =
    tone === "danger" ? "text-danger" : tone === "accent" ? "text-accent" : "text-foreground";
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

function NewProjectButton() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [jobNumber, setJobNumber] = useState("");
  const [client, setClient] = useState("");
  const [contract, setContract] = useState("");
  const [costBudget, setCostBudget] = useState("");
  const navigate = useNavigate();
  const qc = useQueryClient();
  const create = useServerFn(createProject);

  const mutation = useMutation({
    mutationFn: () =>
      create({
        data: {
          name,
          job_number: jobNumber,
          client,
          original_contract: Number(contract) || 0,
          original_cost_budget: Number(costBudget) || 0,
        },
      }),
    onSuccess: ({ id }) => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      setOpen(false);
      setName("");
      setJobNumber("");
      setClient("");
      setContract("");
      setCostBudget("");
      navigate({ to: "/projects/$projectId", params: { projectId: id } });
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
