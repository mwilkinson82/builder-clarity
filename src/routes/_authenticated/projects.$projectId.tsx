import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { KpiStrip } from "@/components/outcome/KpiStrip";
import { OutcomeWaterfall } from "@/components/outcome/OutcomeWaterfall";
import { HoldsPanel } from "@/components/outcome/HoldsPanel";
import { CostBucketsTable } from "@/components/outcome/CostBucketsTable";
import { ChangeOrdersTable } from "@/components/outcome/ChangeOrdersTable";
import { ScheduleRisk } from "@/components/outcome/ScheduleRisk";
import { DecisionsTable } from "@/components/outcome/DecisionsTable";
import { RiskWarnings } from "@/components/outcome/RiskWarnings";
import {
  createHold, deleteHold, getProject, listProjects, updateHold,
  updateProjectFinancials, createChangeOrder, updateChangeOrder,
  deleteChangeOrder, updateBucket,
  type ProjectRow,
} from "@/lib/projects.functions";
import { fmtUSD, fmtPct } from "@/lib/format";
import type { Phase } from "@/lib/ior";
import { LogOut, Pencil } from "lucide-react";

export const Route = createFileRoute("/_authenticated/projects/$projectId")({
  head: () => ({ meta: [{ title: "Project Outcome Review" }] }),
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
  const createCoFn = useServerFn(createChangeOrder);
  const updateCoFn = useServerFn(updateChangeOrder);
  const deleteCoFn = useServerFn(deleteChangeOrder);
  const updateBucketFn = useServerFn(updateBucket);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["project", projectId] });
    qc.invalidateQueries({ queryKey: ["projects"] });
  };
  const mk = <I,>(fn: (i: { data: I }) => Promise<unknown>) =>
    useMutation({ mutationFn: (input: I) => fn({ data: input }), onSuccess: invalidate });

  const holdCreate = mk<Record<string, unknown>>(createHoldFn as never);
  const holdUpdate = mk<Record<string, unknown>>(updateHoldFn as never);
  const holdDelete = mk<{ id: string }>(deleteHoldFn);
  const finUpdate = mk<Record<string, unknown>>(updateFinFn as never);
  const coCreate = mk<Record<string, unknown>>(createCoFn as never);
  const coUpdate = mk<Record<string, unknown>>(updateCoFn as never);
  const coDelete = mk<{ id: string }>(deleteCoFn);
  const bucketUpdate = mk<Record<string, unknown>>(updateBucketFn as never);

  const navigate = useNavigate();
  const router = useRouter();
  const signOut = async () => {
    await supabase.auth.signOut();
    router.invalidate();
    navigate({ to: "/auth" });
  };

  if (isLoading) return <div className="p-10 text-muted-foreground">Loading…</div>;
  if (error || !data) {
    return (
      <div className="p-10">
        <p className="text-sm text-danger">Could not load project.</p>
        <Link to="/" className="mt-4 inline-block text-sm underline">← Back to portfolio</Link>
      </div>
    );
  }

  const { project, holds, changeOrders, buckets, rollup, guidance, warnings } = data;

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
                Project Outcome Review · {project.phase} Phase · {project.percent_complete}% complete
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
                  <dd className="mt-0.5 tabular text-foreground">{fmtUSD(rollup.forecastedFinalContract)}</dd>
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
          originalGP={rollup.originalGP}
          originalGPpct={rollup.originalGPpct}
          forecastedGP={rollup.forecastedGPBeforeHolds}
          indicatedGP={rollup.indicatedGP}
          indicatedGPpct={rollup.indicatedGPpct}
          gpAtRisk={rollup.gpAtRisk}
          exposureHolds={rollup.exposureHolds}
          contingencyHold={rollup.contingencyHold}
          pendingCOs={rollup.pendingCOContract}
          scheduleWeeks={project.schedule_variance_weeks}
        />

        <RiskWarnings warnings={warnings} />

        <div className="flex items-start gap-3 rounded-lg border border-hairline bg-surface px-5 py-4">
          <span className="mt-1.5 inline-block h-px w-6 shrink-0 bg-accent" />
          <p className="text-sm text-foreground/85">
            <span className="font-semibold text-foreground">How this rolls up:</span>{" "}
            Forecasted Final Contract = Original + Approved COs + (Pending COs × probability).
            Forecasted Final Cost = Actual-to-Date + FTC across buckets + cost-side CO impacts.
            Holds sit below the line and reduce Indicated GP — they do not inflate cost.
          </p>
        </div>

        <Tabs defaultValue="outcome" className="space-y-6">
          <TabsList className="h-auto w-full justify-start gap-1 rounded-lg border border-hairline bg-card p-1">
            {[
              ["outcome", "Outcome"],
              ["buckets", "Cost Buckets"],
              ["change-orders", "Change Orders"],
              ["holds", "Holds"],
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
                    From original contract through indicated gross profit — all figures derived from change orders, cost buckets, and holds.
                  </p>
                </div>
                <OutcomeWaterfall
                  originalContract={project.original_contract}
                  approvedCOs={rollup.approvedCOContract}
                  pendingCOs={rollup.weightedPendingCOContract}
                  forecastedFinalContract={rollup.forecastedFinalContract}
                  originalCostBudget={project.original_cost_budget}
                  forecastedFinalCost={rollup.forecastedFinalCost}
                  forecastedGPBeforeHolds={rollup.forecastedGPBeforeHolds}
                  exposureHolds={rollup.exposureHolds}
                  contingencyHold={rollup.contingencyHold}
                  indicatedGP={rollup.indicatedGP}
                  indicatedGPpct={rollup.indicatedGPpct}
                />
                <div className="mt-8 rounded-lg border border-hairline bg-surface p-6">
                  <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                    <span className="inline-block h-px w-6 bg-foreground/50" />
                    Management Interpretation
                  </div>
                  <p className="mt-3 font-serif text-xl leading-snug text-foreground">
                    This project began as a{" "}
                    <span className="tabular">{fmtPct(rollup.originalGPpct)}</span> GP job.
                    Based on current holds and forecasted final cost, it is now indicating{" "}
                    <span className="tabular text-accent">{fmtPct(rollup.indicatedGPpct)}</span>.
                    The company has{" "}
                    <span className="tabular text-danger">{fmtUSD(rollup.gpAtRisk)}</span>{" "}
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

          <TabsContent value="buckets">
            <SectionHeader title="Cost Buckets" subtitle="Actual-to-date plus forecast-to-complete per bucket. These roll up into Forecasted Final Cost." />
            <CostBucketsTable
              buckets={buckets}
              onUpdate={(id, patch) => bucketUpdate.mutate({ id, patch })}
            />
          </TabsContent>

          <TabsContent value="change-orders">
            <SectionHeader title="Change Orders" subtitle="Approved COs add to both sides. Pending COs are probability-weighted into the rollup." />
            <ChangeOrdersTable
              changeOrders={changeOrders}
              onCreate={(d) => coCreate.mutate({ projectId, ...d })}
              onUpdate={(id, patch) => coUpdate.mutate({ id, ...patch })}
              onDelete={(id) => coDelete.mutate({ id })}
            />
          </TabsContent>

          <TabsContent value="holds">
            <SectionHeader title="Holds" subtitle="Reserved margin against specific exposures (E-Holds) and general remaining uncertainty (C-Hold)." />
            <HoldsPanel
              holds={holds}
              guidance={guidance}
              phase={project.phase}
              onCreate={(d) => holdCreate.mutate({ projectId, ...d })}
              onUpdate={(id, patch) => holdUpdate.mutate({ id, ...patch })}
              onDelete={(id) => holdDelete.mutate({ id })}
              pending={holdCreate.isPending || holdUpdate.isPending || holdDelete.isPending}
            />
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
            Indicated GP recalculates as buckets, COs, and holds change.
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

type EditableProject = Pick<
  ProjectRow,
  "name" | "client" | "original_contract" | "original_cost_budget" |
  "schedule_variance_weeks" | "phase" | "percent_complete" | "hold_variance_note"
>;

function EditFinancialsDialog({
  project,
  onSave,
  pending,
}: {
  project: ProjectRow;
  onSave: (patch: Partial<EditableProject>) => void;
  pending: boolean;
}) {
  const [open, setOpen] = useState(false);
  const init = (): EditableProject => ({
    name: project.name,
    client: project.client,
    original_contract: project.original_contract,
    original_cost_budget: project.original_cost_budget,
    schedule_variance_weeks: project.schedule_variance_weeks,
    phase: project.phase,
    percent_complete: project.percent_complete,
    hold_variance_note: project.hold_variance_note,
  });
  const [form, setForm] = useState<EditableProject>(init);

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) setForm(init()); }}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" className="gap-1.5">
          <Pencil className="h-3.5 w-3.5" /> Edit
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-serif text-2xl">Edit project</DialogTitle>
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
            <div className="space-y-1.5">
              <Label>Original contract</Label>
              <Input type="number" value={form.original_contract} onChange={(e) => setForm({ ...form, original_contract: Number(e.target.value) })} />
            </div>
            <div className="space-y-1.5">
              <Label>Original cost budget</Label>
              <Input type="number" value={form.original_cost_budget} onChange={(e) => setForm({ ...form, original_cost_budget: Number(e.target.value) })} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label>Phase</Label>
              <Select value={form.phase} onValueChange={(v) => setForm({ ...form, phase: v as Phase })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Early">Early</SelectItem>
                  <SelectItem value="Middle">Middle</SelectItem>
                  <SelectItem value="Late">Late</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>% complete</Label>
              <Input type="number" min={0} max={100} value={form.percent_complete} onChange={(e) => setForm({ ...form, percent_complete: Number(e.target.value) })} />
            </div>
            <div className="space-y-1.5">
              <Label>Schedule variance (wk)</Label>
              <Input type="number" value={form.schedule_variance_weeks} onChange={(e) => setForm({ ...form, schedule_variance_weeks: Number(e.target.value) })} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Hold variance note <span className="text-muted-foreground">(required if holds are below guidance)</span></Label>
            <Textarea rows={2} value={form.hold_variance_note} onChange={(e) => setForm({ ...form, hold_variance_note: e.target.value })} />
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
