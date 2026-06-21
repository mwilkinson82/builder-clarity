import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
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
import { Plus, LogOut } from "lucide-react";
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
          <div className="overflow-hidden rounded-lg border border-hairline bg-card shadow-card">
            <Table>
              <TableHeader>
                <TableRow className="bg-surface">
                  <TableHead>Project</TableHead>
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
        )}
      </main>
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
