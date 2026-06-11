import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
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
import { MoneyInput } from "@/components/ui/money-input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { KpiStrip } from "@/components/outcome/KpiStrip";
import { OutcomeWaterfall } from "@/components/outcome/OutcomeWaterfall";
import { ExposuresTable } from "@/components/outcome/ExposuresTable";
import { CostBucketsTable } from "@/components/outcome/CostBucketsTable";
import { ChangeOrdersTable } from "@/components/outcome/ChangeOrdersTable";
import { ScheduleRisk } from "@/components/outcome/ScheduleRisk";
import { DecisionsTable } from "@/components/outcome/DecisionsTable";
import { RiskWarnings } from "@/components/outcome/RiskWarnings";
import { ProjectTruthReview } from "@/components/outcome/ProjectTruthReview";
import { ImportSOVSheet } from "@/components/outcome/ImportSOVSheet";
import { ReviewsTab } from "@/components/outcome/ReviewsTab";
import {
  createExposure, updateExposure, deleteExposure,
  createDecision, updateDecision, deleteDecision,
  getProject, listProjects,
  updateProjectFinancials, createChangeOrder, updateChangeOrder,
  deleteChangeOrder, updateBucket, submitReview, updateReview,
  importCostBuckets,
  type ProjectRow, type ReviewRow,
} from "@/lib/projects.functions";
import { fmtUSD, fmtPct } from "@/lib/format";
import type { Phase, ExposureCategory } from "@/lib/ior";
import { generateIorPdf, downloadPdfBytes, type IorPdfStyle } from "@/lib/ior-pdf";
import { LogOut, Pencil, Download } from "lucide-react";

export const Route = createFileRoute("/_authenticated/projects/$projectId")({
  head: () => ({ meta: [{ title: "Project Outcome Review" }] }),
  component: ProjectPage,
});

const CATEGORY_LABELS: Record<ExposureCategory, string> = {
  owner_decision: "Owner decision",
  design_drift: "Design drift",
  trade_performance: "Trade performance",
  procurement: "Procurement",
  schedule_compression: "Schedule compression",
  allowance_overrun: "Allowance overrun",
  field_change: "Field change",
  closeout_punch: "Closeout / punch",
  other: "Other",
};

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

  const createExposureFn = useServerFn(createExposure);
  const updateExposureFn = useServerFn(updateExposure);
  const deleteExposureFn = useServerFn(deleteExposure);
  const createDecisionFn = useServerFn(createDecision);
  const updateDecisionFn = useServerFn(updateDecision);
  const deleteDecisionFn = useServerFn(deleteDecision);
  const updateFinFn = useServerFn(updateProjectFinancials);
  const createCoFn = useServerFn(createChangeOrder);
  const updateCoFn = useServerFn(updateChangeOrder);
  const deleteCoFn = useServerFn(deleteChangeOrder);
  const updateBucketFn = useServerFn(updateBucket);
  const submitReviewFn = useServerFn(submitReview);
  const updateReviewFn = useServerFn(updateReview);
  const importBucketsFn = useServerFn(importCostBuckets);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["project", projectId] });
    qc.invalidateQueries({ queryKey: ["projects"] });
  };
  const mk = <I,>(fn: (i: { data: I }) => Promise<unknown>) =>
    useMutation({ mutationFn: (input: I) => fn({ data: input }), onSuccess: invalidate });

  const expCreate = mk<Record<string, unknown>>(createExposureFn as never);
  const expUpdate = mk<Record<string, unknown>>(updateExposureFn as never);
  const expDelete = mk<{ id: string }>(deleteExposureFn);
  const decCreate = mk<Record<string, unknown>>(createDecisionFn as never);
  const decUpdate = mk<Record<string, unknown>>(updateDecisionFn as never);
  const decDelete = mk<{ id: string }>(deleteDecisionFn);
  const finUpdate = mk<Record<string, unknown>>(updateFinFn as never);
  const coCreate = mk<Record<string, unknown>>(createCoFn as never);
  const coUpdate = mk<Record<string, unknown>>(updateCoFn as never);
  const coDelete = mk<{ id: string }>(deleteCoFn);
  const bucketUpdate = mk<Record<string, unknown>>(updateBucketFn as never);
  const reviewSubmit = mk<Record<string, unknown>>(submitReviewFn as never);
  const reviewUpdate = mk<Record<string, unknown>>(updateReviewFn as never);
  const bucketImport = mk<Record<string, unknown>>(importBucketsFn as never);

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

  const {
    project, exposures, changeOrders, buckets, decisions, reviews,
    rollup, guidance, warnings, byCategory, aging,
  } = data;

  // Last-reviewed chip is gated by hydration to avoid SSR/CSR text mismatch
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => { setHydrated(true); }, []);
  const lastReviewDays = hydrated && project.last_reviewed_at
    ? Math.floor((Date.now() - new Date(project.last_reviewed_at).getTime()) / 86400000)
    : null;

  const handleSubmitReview = async (input: {
    reviewer: string;
    forecast_completion_date_before: string | null;
    forecast_completion_date_after: string | null;
    summary_notes: string;
    body_markdown: string;
    pdf_style: IorPdfStyle;
    kpi_snapshot: Record<string, number | string>;
    newExposures: Array<{
      title: string; description: string; category: ExposureCategory;
      dollar_exposure: number; probability: number; owner: string;
      response_path: import("@/lib/ior").ResponsePath | null;
      hold_class: import("@/lib/ior").HoldClass;
    }>;
    resolutionUpdates: Array<{ id: string; status: import("@/lib/ior").ExposureStatus; note: string }>;
    pdfBytes: Uint8Array;
  }) => {
    // Create new exposures
    for (const e of input.newExposures) {
      if (!e.response_path) continue;
      expCreate.mutate({
        projectId,
        title: e.title,
        description: e.description,
        category: e.category,
        dollar_exposure: e.dollar_exposure,
        probability: e.probability,
        owner: e.owner,
        response_path: e.response_path,
        hold_class: e.hold_class,
        status: "active",
        release_condition: "",
      });
    }
    // Apply resolutions
    for (const r of input.resolutionUpdates) {
      const patch: Record<string, unknown> = { status: r.status };
      if (r.note) patch.notes = r.note;
      if (r.status === "recovered" || r.status === "eliminated" || r.status === "released") {
        patch.resolved_at = new Date().toISOString();
      }
      expUpdate.mutate({ id: r.id, ...patch });
    }
    // Submit the review row
    reviewSubmit.mutate({
      projectId,
      reviewer: input.reviewer,
      forecast_completion_date_before: input.forecast_completion_date_before,
      forecast_completion_date_after: input.forecast_completion_date_after,
      summary_notes: input.summary_notes,
      body_markdown: input.body_markdown,
      pdf_style: input.pdf_style,
      kpi_snapshot: input.kpi_snapshot,
      email_recipients: [],
    });
    // PDF was already downloaded by the wizard itself.
  };

  const downloadCurrentReport = async (style: IorPdfStyle) => {
    const bytes = await generateIorPdf({
      project, rollup, exposures, changeOrders, buckets, decisions, reviews,
      narrative: project.last_review_summary,
      generatedAt: new Date(),
    }, style);
    downloadPdfBytes(bytes, `IOR_${project.name.replace(/\s+/g, "_")}_${new Date().toISOString().slice(0,10)}.pdf`);
  };

  const buildPdfInputForReview = (r: ReviewRow | null) => ({
    project, rollup, exposures, changeOrders, buckets, decisions, reviews,
    narrative: r?.body_markdown || r?.summary_notes,
    generatedAt: r ? new Date(r.reviewed_at) : new Date(),
  });

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
                Project Truth · {project.phase} Phase · {project.percent_complete}% complete
                {lastReviewDays !== null && (
                  <span className={lastReviewDays > 30 ? "text-danger" : ""}>
                    · Last reviewed {lastReviewDays}d ago
                  </span>
                )}
              </div>
              <h1 className="mt-3 font-serif text-5xl leading-[1.05] text-foreground lg:text-6xl">
                {project.name}
              </h1>
              <p className="mt-3 max-w-2xl text-base text-muted-foreground">
                A project truth system, not a budget report. Start from the SOV, capture exposure, convert it to managed decisions.
              </p>
            </div>
            <div className="flex flex-col items-end gap-3">
              <div className="flex flex-wrap items-center justify-end gap-2">
                <ProjectTruthReview
                  project={project}
                  exposures={exposures}
                  changeOrders={changeOrders}
                  buckets={buckets}
                  decisions={decisions}
                  rollup={rollup}
                  onSubmit={handleSubmitReview}
                  pending={reviewSubmit.isPending}
                />
                <DownloadReportMenu onDownload={downloadCurrentReport} />
                <EditFinancialsDialog
                  project={project}
                  onSave={(patch) => finUpdate.mutate({ projectId, patch })}
                  pending={finUpdate.isPending}
                />
              </div>
              <dl className="grid grid-cols-3 gap-x-8 gap-y-1 text-sm">
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

        <Tabs defaultValue="outcome" className="space-y-6">
          <TabsList className="h-auto w-full justify-start gap-1 rounded-lg border border-hairline bg-card p-1">
            {[
              ["outcome", "Outcome"],
              ["exposures", `Exposures (${exposures.filter(e => e.status === "active" || e.status === "escalated").length})`],
              ["decisions", `Decisions (${decisions.filter(d => d.status !== "resolved").length})`],
              ["buckets", "Cost Buckets"],
              ["change-orders", "Change Orders"],
              ["schedule", "Schedule"],
              ["reviews", `Reviews (${reviews.length})`],
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
                    Computed from change orders, cost buckets, and the exposure register.
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
                    Based on current exposures and forecasted final cost, it is now indicating{" "}
                    <span className="tabular text-accent">{fmtPct(rollup.indicatedGPpct)}</span>.
                    The company has{" "}
                    <span className="tabular text-danger">{fmtUSD(rollup.gpAtRisk)}</span>{" "}
                    of original expected profit at risk.
                  </p>
                </div>
              </div>

              <aside className="space-y-6">
                <div className="rounded-lg border border-hairline bg-card p-6 shadow-card">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                    Margin at risk by category
                  </div>
                  <div className="mt-4 space-y-3">
                    {byCategory.length === 0 && (
                      <p className="text-sm text-muted-foreground">No active exposures.</p>
                    )}
                    {byCategory.map((c) => {
                      const max = byCategory[0].total || 1;
                      const pct = (c.total / max) * 100;
                      return (
                        <div key={c.category}>
                          <div className="flex items-baseline justify-between text-xs">
                            <span className="text-foreground">{CATEGORY_LABELS[c.category]}</span>
                            <span className="tabular text-muted-foreground">{fmtUSD(c.total)}</span>
                          </div>
                          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-secondary">
                            <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="rounded-lg border border-hairline bg-card p-6 shadow-card">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                    Exposure aging (active)
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-3">
                    <AgingCell label="< 7 days" value={aging.fresh} />
                    <AgingCell label="7–30 days" value={aging.recent} />
                    <AgingCell label="> 30 days" value={aging.stale} danger />
                  </div>
                </div>

                <div className="rounded-lg border border-hairline bg-card p-6 shadow-card">
                  <div className="flex items-baseline justify-between">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                      Hold guidance · {project.phase}
                    </div>
                  </div>
                  <div className="mt-3 space-y-3">
                    <GuidanceRow label="E-Hold" actual={rollup.exposureHolds} target={guidance.eTarget} pct={guidance.ePct} />
                    <GuidanceRow label="C-Hold" actual={rollup.contingencyHold} target={guidance.cTarget} pct={guidance.cPct} />
                  </div>
                  <p className="mt-3 text-xs text-muted-foreground">
                    Targets are % of remaining cost. If actual is below target, capture a written justification.
                  </p>
                </div>
              </aside>
            </div>
          </TabsContent>

          <TabsContent value="exposures">
            <SectionHeader
              title="Exposure Register"
              subtitle="Every emerging problem becomes a dollarized exposure with an owner and a treatment path. This is the heart of the system."
            />
            <ExposuresTable
              exposures={exposures}
              onCreate={(d) => expCreate.mutate({ projectId, ...d })}
              onUpdate={(id, patch) => expUpdate.mutate({ id, ...patch })}
              onDelete={(id) => expDelete.mutate({ id })}
            />
          </TabsContent>

          <TabsContent value="decisions">
            <SectionHeader title="Required Decisions" subtitle="Convert exposures and pending COs into owned actions with due dates." />
            <DecisionsTable
              decisions={decisions}
              onCreate={(d) => decCreate.mutate({ projectId, ...d })}
              onUpdate={(id, patch) => decUpdate.mutate({ id, ...patch })}
              onDelete={(id) => decDelete.mutate({ id })}
            />
          </TabsContent>

          <TabsContent value="buckets">
            <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="font-serif text-3xl text-foreground">Cost Buckets</h2>
                <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
                  Actual-to-date plus forecast-to-complete per bucket. Import your existing schedule of values from QuickBooks or Excel — we'll map the columns for you.
                </p>
              </div>
              <ImportSOVSheet
                onImport={(rows, mode) => bucketImport.mutate({ projectId, rows, mode })}
                pending={bucketImport.isPending}
              />
            </div>
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

          <TabsContent value="schedule">
            <SectionHeader title="Schedule Risk" subtitle="Completion forecast, decision bottlenecks, procurement and trade performance risks." />
            <ScheduleRisk />
          </TabsContent>

          <TabsContent value="reviews">
            <SectionHeader title="Project Truth Reviews" subtitle="Each review is an editable, downloadable, emailable IOR Report — ready for the next L10 or project meeting." />
            <ReviewsTab
              reviews={reviews}
              project={project}
              buildPdfInput={buildPdfInputForReview}
              onUpdate={(id, patch) => reviewUpdate.mutate({ id, patch })}
              pending={reviewUpdate.isPending}
            />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}



function DownloadReportMenu({ onDownload }: { onDownload: (style: IorPdfStyle) => void | Promise<void> }) {
  return (
    <div className="flex items-center gap-1 rounded-md border border-hairline bg-card p-0.5">
      <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => onDownload("executive")}>
        <Download className="h-3.5 w-3.5" /> One-pager PDF
      </Button>
      <span className="text-hairline">·</span>
      <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => onDownload("structured")}>
        Multi-page PDF
      </Button>
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

function AgingCell({ label, value, danger }: { label: string; value: number; danger?: boolean }) {
  return (
    <div className="rounded-md border border-hairline bg-surface px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
      <div className={`mt-0.5 font-serif text-2xl tabular ${danger && value > 0 ? "text-danger" : "text-foreground"}`}>
        {value}
      </div>
    </div>
  );
}

function GuidanceRow({ label, actual, target, pct }: { label: string; actual: number; target: number; pct: number }) {
  const below = actual < target;
  const ratio = target > 0 ? Math.min(100, (actual / target) * 100) : 100;
  return (
    <div>
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-foreground">{label} <span className="text-muted-foreground">· {pct}%</span></span>
        <span className={`tabular ${below ? "text-danger" : "text-success"}`}>
          {fmtUSD(actual)} <span className="text-muted-foreground">/ {fmtUSD(target)}</span>
        </span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-secondary">
        <div className={`h-full rounded-full ${below ? "bg-danger" : "bg-success"}`} style={{ width: `${ratio}%` }} />
      </div>
    </div>
  );
}

type EditableProject = {
  name: string;
  client: string;
  original_contract: number;
  original_cost_budget: number;
  schedule_variance_weeks: number;
  phase: Phase;
  percent_complete: number;
  hold_variance_note: string;
  forecast_completion_date: string | null;
  baseline_completion_date: string | null;
};

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
    forecast_completion_date: project.forecast_completion_date,
    baseline_completion_date: project.baseline_completion_date,
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
              <MoneyInput value={form.original_contract} onValueChange={(v) => setForm({ ...form, original_contract: v })} />
            </div>
            <div className="space-y-1.5">
              <Label>Original cost budget</Label>
              <MoneyInput value={form.original_cost_budget} onValueChange={(v) => setForm({ ...form, original_cost_budget: v })} />
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
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Baseline completion</Label>
              <Input type="date" value={form.baseline_completion_date ?? ""} onChange={(e) => setForm({ ...form, baseline_completion_date: e.target.value || null })} />
            </div>
            <div className="space-y-1.5">
              <Label>Forecast completion</Label>
              <Input type="date" value={form.forecast_completion_date ?? ""} onChange={(e) => setForm({ ...form, forecast_completion_date: e.target.value || null })} />
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
