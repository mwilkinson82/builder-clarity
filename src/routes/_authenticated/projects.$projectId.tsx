import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { KpiStrip } from "@/components/outcome/KpiStrip";
import { OutcomeWaterfall } from "@/components/outcome/OutcomeWaterfall";
import { HoldsPanel } from "@/components/outcome/HoldsPanel";
import { BuyoutTable } from "@/components/outcome/BuyoutTable";
import { ChangeOrdersTable } from "@/components/outcome/ChangeOrdersTable";
import { ScheduleRisk } from "@/components/outcome/ScheduleRisk";
import { DecisionsTable } from "@/components/outcome/DecisionsTable";
import {
  createHold,
  deleteHold,
  getProject,
  listProjects,
  updateHold,
  updateProjectFinancials,
} from "@/lib/projects.functions";
import { fmtUSD, fmtPct } from "@/lib/format";
import { LogOut, Pencil } from "lucide-react";

export const Route = createFileRoute("/_authenticated/projects/$projectId")({
  head: () => ({
    meta: [{ title: "Project Outcome Review" }],
  }),
  component: ProjectPage,
});

function ProjectPage() {
  const { projectId } = Route.useParams();
  const get = useServerFn(getProject);
  const list = useServerFn(listProjects);
  const qc = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => get({ data: { projectId } }),
  });
  const { data: portfolio = [] } = useQuery({
    queryKey: ["projects"],
    queryFn: () => list(),
  });

  const createHoldFn = useServerFn(createHold);
  const updateHoldFn = useServerFn(updateHold);
  const deleteHoldFn = useServerFn(deleteHold);
  const updateFinFn = useServerFn(updateProjectFinancials);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["project", projectId] });
    qc.invalidateQueries({ queryKey: ["projects"] });
  };

  const holdCreate = useMutation({
    mutationFn: (input: Parameters<typeof createHoldFn>[0]["data"]) =>
      createHoldFn({ data: input }),
    onSuccess: invalidate,
  });
  const holdUpdate = useMutation({
    mutationFn: (input: Parameters<typeof updateHoldFn>[0]["data"]) =>
      updateHoldFn({ data: input }),
    onSuccess: invalidate,
  });
  const holdDelete = useMutation({
    mutationFn: (id: string) => deleteHoldFn({ data: { id } }),
    onSuccess: invalidate,
  });
  const finUpdate = useMutation({
    mutationFn: (input: Parameters<typeof updateFinFn>[0]["data"]) =>
      updateFinFn({ data: input }),
    onSuccess: invalidate,
  });

  const navigate = useNavigate();
  const router = useRouter();
  const signOut = async () => {
    await supabase.auth.signOut();
    router.invalidate();
    navigate({ to: "/auth" });
  };

  const figures = useMemo(() => {
    if (!data) return null;
    const { project, holds } = data;
    const active = holds.filter((h) => h.status !== "Released");
    const exposureHolds = active.filter((h) => h.type === "E-Hold").reduce((s, h) => s + h.amount, 0);
    const contingencyHold = active.filter((h) => h.type === "C-Hold").reduce((s, h) => s + h.amount, 0);
    const forecastedGPBeforeHolds = project.forecasted_final_contract - project.forecasted_final_cost;
    const indicatedGP = forecastedGPBeforeHolds - exposureHolds - contingencyHold;
    const originalGP = project.original_contract - project.original_cost_budget;
    const indicatedGPpct = project.forecasted_final_contract > 0
      ? (indicatedGP / project.forecasted_final_contract) * 100 : 0;
    const originalGPpct = project.original_contract > 0
      ? (originalGP / project.original_contract) * 100 : 0;
    const gpAtRisk = originalGP - indicatedGP;
    return { exposureHolds, contingencyHold, forecastedGPBeforeHolds, indicatedGP, originalGP, indicatedGPpct, originalGPpct, gpAtRisk };
  }, [data]);

  if (isLoading) return <div className="p-10 text-muted-foreground">Loading…</div>;
  if (error || !data || !figures) {
    return (
      <div className="p-10">
        <p className="text-sm text-danger">Could not load project.</p>
        <Link to="/" className="mt-4 inline-block text-sm underline">← Back to portfolio</Link>
      </div>
    );
  }

  const { project, holds } = data;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="relative border-b border-hairline bg-surface-elevated">
        <div className="absolute inset-0 grid-bg opacity-40" />
        <div className="relative mx-auto max-w-[1400px] px-6 py-8 lg:px-10 lg:py-10">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <Link to="/" className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground hover:text-foreground">
                ← Portfolio
              </Link>
              <Select value={projectId} onValueChange={(v) => navigate({ to: "/projects/$projectId", params: { projectId: v } })}>
                <SelectTrigger className="h-8 w-[260px] text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {portfolio.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button variant="ghost" size="sm" onClick={signOut} className="gap-1.5">
              <LogOut className="h-3.5 w-3.5" /> Sign out
            </Button>
          </div>

          <div className="mt-6 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="flex items-center gap-3 text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                <span className="inline-block h-px w-8 bg-accent" />
                Project Outcome Review
              </div>
              <h1 className="mt-3 font-serif text-5xl leading-[1.05] text-foreground lg:text-6xl">
                {project.name}
              </h1>
              <p className="mt-3 max-w-2xl text-base text-muted-foreground">
                Forecast-to-finish control for margin, risk, schedule, and owner decisions.
              </p>
            </div>
            <div className="flex items-start gap-6">
              <dl className="grid grid-cols-2 gap-x-10 gap-y-3 text-sm sm:grid-cols-3">
                <div>
                  <dt className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Client</dt>
                  <dd className="mt-0.5 text-foreground">{project.client || "—"}</dd>
                </div>
                <div>
                  <dt className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Original Contract</dt>
                  <dd className="mt-0.5 tabular text-foreground">{fmtUSD(project.original_contract)}</dd>
                </div>
                <div>
                  <dt className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Forecasted Final</dt>
                  <dd className="mt-0.5 tabular text-foreground">{fmtUSD(project.forecasted_final_contract)}</dd>
                </div>
              </dl>
              <EditFinancialsDialog
                project={project}
                onSave={(patch) => finUpdate.mutate({ projectId, patch })}
                pending={finUpdate.isPending}
              />
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1400px] space-y-8 px-6 py-10 lg:px-10">
        <KpiStrip
          originalGP={figures.originalGP}
          originalGPpct={figures.originalGPpct}
          forecastedGP={figures.forecastedGPBeforeHolds}
          indicatedGP={figures.indicatedGP}
          indicatedGPpct={figures.indicatedGPpct}
          gpAtRisk={figures.gpAtRisk}
          exposureHolds={figures.exposureHolds}
          contingencyHold={figures.contingencyHold}
          pendingCOs={project.pending_cos}
          scheduleWeeks={project.schedule_variance_weeks}
        />

        <div className="flex items-start gap-3 rounded-lg border border-hairline bg-surface px-5 py-4">
          <span className="mt-1.5 inline-block h-px w-6 shrink-0 bg-accent" />
          <p className="text-sm text-foreground/85">
            <span className="font-semibold text-foreground">How to read this:</span>{" "}
            <span className="font-serif italic">Indicated GP</span> = Forecasted GP Before Holds
            <span className="text-muted-foreground"> − </span>Exposure Holds
            <span className="text-muted-foreground"> − </span>Contingency Hold.
          </p>
        </div>

        <Tabs defaultValue="outcome" className="space-y-6">
          <TabsList className="h-auto w-full justify-start gap-1 rounded-lg border border-hairline bg-card p-1">
            {[
              ["outcome", "Outcome"],
              ["buyout", "Buyout"],
              ["holds", "Holds"],
              ["change-orders", "Change Orders"],
              ["schedule", "Schedule Risk"],
              ["decisions", "Required Decisions"],
            ].map(([v, label]) => (
              <TabsTrigger
                key={v}
                value={v}
                className="rounded-md px-4 py-2 text-sm data-[state=active]:bg-foreground data-[state=active]:text-background"
              >
                {label}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="outcome" className="space-y-6">
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
              <div className="rounded-lg border border-hairline bg-card p-6 lg:col-span-2 lg:p-10 shadow-card">
                <div className="mb-6">
                  <h2 className="font-serif text-3xl text-foreground">Financial Outcome</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    From original contract through indicated gross profit.
                  </p>
                </div>
                <OutcomeWaterfall
                  originalContract={project.original_contract}
                  approvedCOs={project.approved_cos}
                  pendingCOs={project.pending_cos}
                  forecastedFinalContract={project.forecasted_final_contract}
                  originalCostBudget={project.original_cost_budget}
                  forecastedFinalCost={project.forecasted_final_cost}
                  forecastedGPBeforeHolds={figures.forecastedGPBeforeHolds}
                  exposureHolds={figures.exposureHolds}
                  contingencyHold={figures.contingencyHold}
                  indicatedGP={figures.indicatedGP}
                  indicatedGPpct={figures.indicatedGPpct}
                />
                <div className="mt-8 rounded-lg border border-hairline bg-surface p-6">
                  <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                    <span className="inline-block h-px w-6 bg-foreground/50" />
                    Management Interpretation
                  </div>
                  <p className="mt-3 font-serif text-xl leading-snug text-foreground">
                    This project began as a{" "}
                    <span className="tabular">{fmtPct(figures.originalGPpct)}</span> GP job.
                    Based on current holds and forecasted final cost, it is now indicating{" "}
                    <span className="tabular text-accent">{fmtPct(figures.indicatedGPpct)}</span>.
                    The company has{" "}
                    <span className="tabular text-danger">{fmtUSD(figures.gpAtRisk)}</span>{" "}
                    of original expected profit at risk.
                  </p>
                </div>
              </div>

              <aside className="rounded-lg border border-hairline bg-card p-6 shadow-card lg:p-7">
                <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                  <span className="inline-block h-px w-6 bg-accent" />
                  Next Required Decisions
                </div>
                <h3 className="mt-3 font-serif text-2xl text-foreground">
                  Three moves that protect margin
                </h3>
                <ol className="mt-5 space-y-4">
                  {[
                    { n: "01", t: "Submit electrical change order package", s: "Releases the E-Hold against unapproved field changes.", owner: "J. Patel" },
                    { n: "02", t: "Escalate appliance selection deadline to owner", s: "Unblocks MEP rough-in and protects two weeks of schedule.", owner: "K. Alvarez" },
                    { n: "03", t: "Hold contingency until millwork buyout is complete", s: "Preserves the C-Hold through finish-phase variability.", owner: "Executive" },
                  ].map((d) => (
                    <li key={d.n} className="border-t border-hairline pt-4 first:border-t-0 first:pt-0">
                      <div className="flex items-baseline gap-3">
                        <span className="font-mono text-[10px] tracking-widest text-accent">{d.n}</span>
                        <div className="flex-1">
                          <div className="text-sm font-medium text-foreground">{d.t}</div>
                          <div className="mt-1 text-xs text-muted-foreground">{d.s}</div>
                          <div className="mt-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/80">
                            Owner · {d.owner}
                          </div>
                        </div>
                      </div>
                    </li>
                  ))}
                </ol>
              </aside>
            </div>
          </TabsContent>

          <TabsContent value="buyout">
            <SectionHeader title="Buyout Status" subtitle="Scope-by-scope view of budget, commitments, and projected remaining cost." />
            <BuyoutTable />
          </TabsContent>

          <TabsContent value="holds">
            <SectionHeader title="Holds" subtitle="Reserved margin against specific exposures (E-Holds) and general remaining uncertainty (C-Hold)." />
            <HoldsPanel
              holds={holds}
              onCreate={(d) => holdCreate.mutate({ projectId, ...d })}
              onUpdate={(id, patch) => holdUpdate.mutate({ id, ...patch })}
              onDelete={(id) => holdDelete.mutate(id)}
              pending={holdCreate.isPending || holdUpdate.isPending || holdDelete.isPending}
            />
          </TabsContent>

          <TabsContent value="change-orders">
            <SectionHeader title="Change Orders" subtitle="Approved, pending, unpriced, submitted, and disputed changes affecting contract value." />
            <ChangeOrdersTable />
          </TabsContent>

          <TabsContent value="schedule">
            <SectionHeader title="Schedule Risk" subtitle="Completion forecast, decision bottlenecks, procurement and trade performance risks." />
            <ScheduleRisk />
          </TabsContent>

          <TabsContent value="decisions">
            <SectionHeader title="Required Decisions" subtitle="The owner-level moves that will protect — or erode — indicated gross profit." />
            <DecisionsTable />
          </TabsContent>
        </Tabs>

        <footer className="grid gap-4 border-t border-hairline pt-6 text-xs text-muted-foreground sm:grid-cols-3">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em]">Last reviewed</div>
            <div className="mt-1 text-foreground tabular">
              {new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })} · Project Executive
            </div>
          </div>
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em]">Next review date</div>
            <div className="mt-1 text-foreground tabular">
              {new Date(Date.now() + 14 * 86400000).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })} · Bi-weekly cadence
            </div>
          </div>
          <div className="sm:text-right">
            Indicated GP recalculates as holds are added, released, or escalated.
          </div>
        </footer>
      </main>
    </div>
  );
}

function SectionHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="mb-5">
      <h2 className="font-serif text-3xl text-foreground">{title}</h2>
      <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{subtitle}</p>
    </div>
  );
}

type Project = {
  name: string;
  client: string;
  original_contract: number;
  original_cost_budget: number;
  forecasted_final_contract: number;
  forecasted_final_cost: number;
  approved_cos: number;
  pending_cos: number;
  schedule_variance_weeks: number;
};

function EditFinancialsDialog({
  project,
  onSave,
  pending,
}: {
  project: Project;
  onSave: (patch: Partial<Project>) => void;
  pending: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(project);

  const numField = (key: keyof Project, label: string) => (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Input
        type="number"
        value={form[key] as number}
        onChange={(e) => setForm({ ...form, [key]: Number(e.target.value) })}
      />
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) setForm(project); }}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" className="gap-1.5">
          <Pencil className="h-3.5 w-3.5" /> Edit
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-serif text-2xl">Edit project financials</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Project name</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Client</Label>
              <Input value={form.client} onChange={(e) => setForm({ ...form, client: e.target.value })} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {numField("original_contract", "Original contract")}
            {numField("original_cost_budget", "Original cost budget")}
            {numField("forecasted_final_contract", "Forecasted final contract")}
            {numField("forecasted_final_cost", "Forecasted final cost")}
            {numField("approved_cos", "Approved COs")}
            {numField("pending_cos", "Pending COs")}
            {numField("schedule_variance_weeks", "Schedule variance (weeks)")}
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            disabled={pending}
            onClick={() => { onSave(form); setOpen(false); }}
          >
            {pending ? "Saving…" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
