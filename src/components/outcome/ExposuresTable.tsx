import { type ReactNode, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  FileCheck,
  FileText,
  Gavel,
  ListChecks,
  Plus,
  Pencil,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { MoneyInput } from "@/components/ui/money-input";
import { fmtUSD } from "@/lib/format";
import {
  releasedExposureValue,
  remainingExposureValue,
  weightedExposureValue,
  type ExposureCategory,
  type ExposureStatus,
  type HoldClass,
  type ResponsePath,
} from "@/lib/ior";
import type { ExposureRow } from "@/lib/projects.functions";

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

const RESPONSE_LABELS: Record<ResponsePath, string> = {
  eliminate: "Eliminate",
  recover: "Recover",
  offset: "Offset",
  accept: "Accept",
};

export type ExposureDraft = {
  title: string;
  description: string;
  category: ExposureCategory;
  dollar_exposure: number;
  probability: number;
  schedule_impact_weeks: number | null;
  owner: string;
  response_path: ResponsePath;
  release_condition: string;
  released_amount: number;
  release_note: string;
  release_updated_at: string | null;
  hold_class: HoldClass;
  status: ExposureStatus;
  next_review_at: string | null;
  notes: string;
};

const empty: ExposureDraft = {
  title: "",
  description: "",
  category: "other",
  dollar_exposure: 0,
  probability: 100,
  schedule_impact_weeks: null,
  owner: "",
  response_path: "recover",
  release_condition: "",
  released_amount: 0,
  release_note: "",
  release_updated_at: null,
  hold_class: "E-Hold",
  status: "active",
  next_review_at: null,
  notes: "",
};

function StatusBadge({ status }: { status: ExposureStatus }) {
  const map: Record<ExposureStatus, string> = {
    active: "bg-warning/15 text-warning border-warning/30",
    escalated: "bg-danger/15 text-danger border-danger/30",
    recovered: "bg-success/15 text-success border-success/30",
    eliminated: "bg-success/15 text-success border-success/30",
    accepted: "bg-secondary text-foreground border-hairline",
    released: "bg-secondary text-muted-foreground border-hairline",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${map[status]}`}
    >
      {status}
    </span>
  );
}

function TreatmentBadge({ path }: { path: ResponsePath }) {
  const map: Record<ResponsePath, string> = {
    eliminate: "border-success/30 bg-success/10 text-success",
    recover: "border-primary/30 bg-primary/10 text-primary",
    offset: "border-warning/40 bg-warning/10 text-warning",
    accept: "border-danger/35 bg-danger/10 text-danger",
  };
  return (
    <span
      className={`inline-flex min-w-[84px] justify-center rounded-md border px-2 py-1 text-xs font-semibold ${map[path]}`}
    >
      {RESPONSE_LABELS[path]}
    </span>
  );
}

export function ExposuresTable({
  exposures,
  focusedExposureId,
  onFocusExposureHandled,
  openCreateSignal,
  onCreate,
  onUpdate,
  onDelete,
  onCreateTodo,
  onCreateChangeOrder,
  onCreateClaim,
}: {
  exposures: ExposureRow[];
  focusedExposureId?: string | null;
  onFocusExposureHandled?: () => void;
  /** Increment to open the create-risk dialog from outside (workbench header "+ Log risk"). */
  openCreateSignal?: number;
  onCreate: (d: ExposureDraft) => void;
  onUpdate: (id: string, patch: Partial<ExposureDraft>) => void;
  onDelete: (id: string) => void;
  onCreateTodo?: (exposure: ExposureRow) => void;
  onCreateChangeOrder?: (exposure: ExposureRow) => void;
  onCreateClaim?: (exposure: ExposureRow) => void;
}) {
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ExposureDraft>(empty);
  const [errors, setErrors] = useState<{ dollar?: string; response?: string; title?: string }>({});
  const [spotlightExposureId, setSpotlightExposureId] = useState<string | null>(null);

  const openNew = () => {
    setEditingId(null);
    setDraft(empty);
    setErrors({});
    setOpen(true);
  };
  const openEdit = (e: ExposureRow) => {
    setEditingId(e.id);
    setDraft({
      title: e.title,
      description: e.description,
      category: e.category,
      dollar_exposure: e.dollar_exposure,
      probability: e.probability,
      schedule_impact_weeks: e.schedule_impact_weeks,
      owner: e.owner,
      response_path: e.response_path,
      release_condition: e.release_condition,
      released_amount: e.released_amount,
      release_note: e.release_note,
      release_updated_at: e.release_updated_at,
      hold_class: e.hold_class,
      status: e.status,
      next_review_at: e.next_review_at,
      notes: e.notes,
    });
    setErrors({});
    setOpen(true);
  };

  // Header "+ Log risk" lives in the workbench; a bumped counter opens the same
  // create flow the empty-state Add-risk uses (state stays internal to this file).
  useEffect(() => {
    if (!openCreateSignal) return;
    setEditingId(null);
    setDraft(empty);
    setErrors({});
    setOpen(true);
  }, [openCreateSignal]);

  useEffect(() => {
    if (!focusedExposureId) return;
    const focused = exposures.find((item) => item.id === focusedExposureId);
    if (!focused) {
      onFocusExposureHandled?.();
      return;
    }

    setSpotlightExposureId(focused.id);

    window.requestAnimationFrame(() => {
      document
        .getElementById(`risk-exposure-${focused.id}`)
        ?.scrollIntoView({ block: "center", behavior: "smooth" });
    });

    const timeout = window.setTimeout(() => {
      setSpotlightExposureId(null);
      onFocusExposureHandled?.();
    }, 3500);
    return () => window.clearTimeout(timeout);
  }, [exposures, focusedExposureId, onFocusExposureHandled]);

  const save = () => {
    const errs: typeof errors = {};
    if (!draft.title.trim()) errs.title = "Title is required";
    if (!(draft.dollar_exposure > 0))
      errs.dollar =
        "Dollar exposure is required — what is the probable dollar consequence if nothing changes?";
    if (!draft.response_path) errs.response = "Choose a treatment path";
    if (Object.keys(errs).length) {
      setErrors(errs);
      return;
    }
    const likely = draft.dollar_exposure * (draft.probability / 100);
    const releasedAmount = Math.max(0, Math.min(draft.released_amount, likely));
    const payload = {
      ...draft,
      released_amount: releasedAmount,
      release_updated_at: releasedAmount > 0 ? new Date().toISOString() : null,
    };
    if (editingId) onUpdate(editingId, payload);
    else onCreate(payload);
    setOpen(false);
  };

  const openRisks = exposures
    .filter((e) => remainingValue(e) > 0)
    .sort((a, b) => remainingValue(b) - remainingValue(a));
  const eHolds = openRisks.filter((e) => e.hold_class === "E-Hold" || e.hold_class === "Both");
  const cHolds = openRisks.filter((e) => e.hold_class === "C-Hold");
  const unclassifiedLive = openRisks.filter((e) => e.hold_class === "None");
  const topEHoldId = eHolds[0]?.id ?? null;
  const topCHoldId = cHolds[0]?.id ?? null;
  const topUnclassifiedId = unclassifiedLive[0]?.id ?? null;
  const closed = exposures
    .filter((e) => remainingValue(e) === 0)
    .sort((a, b) => releasedValue(b) - releasedValue(a));
  const draftLikely = draft.dollar_exposure * (draft.probability / 100);
  const draftRemaining = Math.max(0, draftLikely - draft.released_amount);

  return (
    <div className="min-w-0 space-y-4">
      <div className="w-full min-w-0 max-w-full overflow-hidden rounded-lg border border-hairline bg-card">
        <div className="divide-y divide-hairline">
          <RiskGroupRow
            label="E-Holds"
            detail="Specific known exposure, priced now"
            count={eHolds.length}
          />
          {eHolds.map((e) => (
            <RiskRow
              key={e.id}
              exposure={e}
              highlightLabel={e.id === topEHoldId ? "Top E-Hold" : undefined}
              spotlighted={spotlightExposureId === e.id}
              onEdit={openEdit}
              onDelete={onDelete}
              onCreateTodo={onCreateTodo}
              onCreateChangeOrder={onCreateChangeOrder}
              onCreateClaim={onCreateClaim}
            />
          ))}
          <RiskGroupRow
            label="C-Holds"
            detail="Broader contingency still being carried"
            count={cHolds.length}
          />
          {cHolds.length === 0 && (
            <div className="flex items-center gap-3 px-4 py-5">
              <span className="h-2 w-2 shrink-0 rounded-full bg-success" aria-hidden />
              <span className="text-sm text-muted-foreground">
                No contingency hold currently carried — general uncertainty is{" "}
                <b className="font-semibold text-foreground">$0</b>. Add a C-Hold to reserve for
                unknowns not yet priced.
              </span>
            </div>
          )}
          {cHolds.map((e) => (
            <RiskRow
              key={e.id}
              exposure={e}
              highlightLabel={e.id === topCHoldId ? "Top C-Hold" : undefined}
              spotlighted={spotlightExposureId === e.id}
              onEdit={openEdit}
              onDelete={onDelete}
              onCreateTodo={onCreateTodo}
              onCreateChangeOrder={onCreateChangeOrder}
              onCreateClaim={onCreateClaim}
            />
          ))}
          {unclassifiedLive.length > 0 && (
            <RiskGroupRow
              label="Unclassified live risk"
              detail="Still active but not assigned to E-Hold or C-Hold"
              count={unclassifiedLive.length}
            />
          )}
          {unclassifiedLive.map((e) => (
            <RiskRow
              key={e.id}
              exposure={e}
              highlightLabel={e.id === topUnclassifiedId ? "Top risk" : undefined}
              spotlighted={spotlightExposureId === e.id}
              onEdit={openEdit}
              onDelete={onDelete}
              onCreateTodo={onCreateTodo}
              onCreateChangeOrder={onCreateChangeOrder}
              onCreateClaim={onCreateClaim}
            />
          ))}
          {closed.length > 0 && (
            <RiskGroupRow
              label="Closed / released"
              detail="No remaining hold against indicated GP"
              count={closed.length}
            />
          )}
          {closed.map((e) => (
            <RiskRow
              key={e.id}
              exposure={e}
              spotlighted={spotlightExposureId === e.id}
              onEdit={openEdit}
              onDelete={onDelete}
              onCreateTodo={onCreateTodo}
              onCreateChangeOrder={onCreateChangeOrder}
              onCreateClaim={onCreateClaim}
            />
          ))}
          {exposures.length === 0 && (
            <div className="px-4 py-10">
              <EmptyState
                icon={ShieldAlert}
                title="No risk allocations yet"
                description="Every emerging problem has a dollar consequence — add the first one to begin protecting margin."
                action={
                  <Button onClick={openNew} size="sm" className="gap-1.5">
                    <Plus className="h-3.5 w-3.5" /> Add risk
                  </Button>
                }
              />
            </div>
          )}
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[92vh] w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)] flex-col gap-0 overflow-hidden p-0 sm:w-[min(calc(100vw-2rem),76rem)] sm:max-w-[76rem]">
          <DialogHeader className="border-b border-hairline bg-surface px-5 py-5 pr-12 sm:px-6">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <p className="eyebrow">{editingId ? "Existing risk" : "New risk"}</p>
                <DialogTitle className="mt-1 font-serif text-3xl leading-tight">
                  {editingId ? "Edit risk allocation" : "Add risk allocation"}
                </DialogTitle>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 md:w-[360px]">
                <DraftMetric label="Likely exposure" value={fmtUSD(draftLikely)} />
                <DraftMetric label="Remaining hold" value={fmtUSD(draftRemaining)} tone="danger" />
              </div>
            </div>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
              <div className="min-w-0 space-y-4">
                <EditorSection title="Risk definition">
                  <div className="space-y-1.5">
                    <Label>Title</Label>
                    <Input
                      value={draft.title}
                      onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                    />
                    {errors.title && <p className="text-xs text-danger">{errors.title}</p>}
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label>Category</Label>
                      <Select
                        value={draft.category}
                        onValueChange={(v) =>
                          setDraft({ ...draft, category: v as ExposureCategory })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {(Object.keys(CATEGORY_LABELS) as ExposureCategory[]).map((k) => (
                            <SelectItem key={k} value={k}>
                              {CATEGORY_LABELS[k]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Owner</Label>
                      <Input
                        value={draft.owner}
                        onChange={(e) => setDraft({ ...draft, owner: e.target.value })}
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label>What changed?</Label>
                    <Textarea
                      rows={4}
                      value={draft.description}
                      onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                    />
                  </div>
                </EditorSection>

                <EditorSection title="Course of action">
                  <div className="space-y-1.5">
                    <Label>Action plan</Label>
                    <Textarea
                      rows={6}
                      value={draft.notes}
                      placeholder="Recovery, offset, elimination, or acceptance plan."
                      onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
                    />
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label>Release condition</Label>
                      <Input
                        value={draft.release_condition}
                        onChange={(e) => setDraft({ ...draft, release_condition: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Release note</Label>
                      <Input
                        value={draft.release_note}
                        placeholder="CO approved, buyout savings..."
                        onChange={(e) => setDraft({ ...draft, release_note: e.target.value })}
                      />
                    </div>
                  </div>
                </EditorSection>
              </div>

              <div className="min-w-0 space-y-4">
                <EditorSection title="Hold controls">
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
                    <div className="space-y-1.5">
                      <Label className="text-danger">Dollar risk *</Label>
                      <MoneyInput
                        value={draft.dollar_exposure}
                        onValueChange={(v) => setDraft({ ...draft, dollar_exposure: v })}
                      />
                      {errors.dollar && <p className="text-xs text-danger">{errors.dollar}</p>}
                    </div>
                    <div className="space-y-1.5">
                      <Label>Probability %</Label>
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        value={draft.probability}
                        onChange={(e) =>
                          setDraft({ ...draft, probability: Number(e.target.value) })
                        }
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Recovered / offset so far</Label>
                      <MoneyInput
                        value={draft.released_amount}
                        onValueChange={(v) => setDraft({ ...draft, released_amount: v })}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Schedule impact (wk)</Label>
                      <Input
                        type="number"
                        value={draft.schedule_impact_weeks ?? ""}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            schedule_impact_weeks:
                              e.target.value === "" ? null : Number(e.target.value),
                          })
                        }
                      />
                    </div>
                  </div>
                </EditorSection>

                <EditorSection title="Classification">
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
                    <div className="space-y-1.5">
                      <Label className="text-danger">Treatment path *</Label>
                      <Select
                        value={draft.response_path}
                        onValueChange={(v) =>
                          setDraft({ ...draft, response_path: v as ResponsePath })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {(Object.keys(RESPONSE_LABELS) as ResponsePath[]).map((k) => (
                            <SelectItem key={k} value={k}>
                              {RESPONSE_LABELS[k]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {errors.response && <p className="text-xs text-danger">{errors.response}</p>}
                    </div>
                    <div className="space-y-1.5">
                      <Label>Hold class</Label>
                      <Select
                        value={draft.hold_class}
                        onValueChange={(v) => setDraft({ ...draft, hold_class: v as HoldClass })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="E-Hold">E-Hold</SelectItem>
                          <SelectItem value="C-Hold">C-Hold</SelectItem>
                          <SelectItem value="Both">Both</SelectItem>
                          <SelectItem value="None">None</SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-[11px] leading-snug text-muted-foreground">
                        E-Hold = a specific priced risk. Switch to C-Hold for general contingency
                        not tied to one item.
                      </p>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Status</Label>
                      <Select
                        value={draft.status}
                        onValueChange={(v) => setDraft({ ...draft, status: v as ExposureStatus })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {(
                            [
                              "active",
                              "escalated",
                              "recovered",
                              "eliminated",
                              "accepted",
                              "released",
                            ] as ExposureStatus[]
                          ).map((k) => (
                            <SelectItem key={k} value={k}>
                              {k}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Next review date</Label>
                      <Input
                        type="date"
                        value={draft.next_review_at ?? ""}
                        onChange={(e) =>
                          setDraft({ ...draft, next_review_at: e.target.value || null })
                        }
                      />
                    </div>
                  </div>
                </EditorSection>
              </div>
            </div>
          </div>

          <DialogFooter className="gap-3 border-t border-hairline bg-surface/70 px-5 py-4 sm:items-center sm:px-6">
            <p className="text-xs text-muted-foreground sm:mr-auto">
              Likely exposure = dollar risk × probability. It flows to the hold class you pick
              above.
            </p>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={save}>{editingId ? "Save changes" : "Add risk"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function likelyValue(e: ExposureRow) {
  return weightedExposureValue(e);
}

function releasedValue(e: ExposureRow) {
  return releasedExposureValue(e);
}

function remainingValue(e: ExposureRow) {
  return remainingExposureValue(e);
}

function planText(value: string) {
  return value.trim().replace(/^plan:\s*/i, "");
}

function DraftMetric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "danger" | "success";
}) {
  const toneClass =
    tone === "danger" ? "text-danger" : tone === "success" ? "text-success" : "text-foreground";
  return (
    <div className="rounded-md border border-hairline bg-card px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </div>
      <div className={`mt-1 text-sm font-semibold tabular ${toneClass}`}>{value}</div>
    </div>
  );
}

function EditorSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="min-w-0 rounded-lg border border-hairline bg-card p-4">
      <div className="mb-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        {title}
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function RiskGroupRow({ label, detail, count }: { label: string; detail: string; count: number }) {
  return (
    <div className="bg-secondary px-4 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2.5 gap-y-1">
          <span className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-foreground">
            {label}
          </span>
          <span className="text-xs text-muted-foreground">{detail}</span>
        </div>
        <span className="shrink-0 rounded-full border border-hairline bg-surface px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
          {count}
        </span>
      </div>
    </div>
  );
}

function RiskRow({
  exposure,
  highlightLabel,
  spotlighted,
  onEdit,
  onDelete,
  onCreateTodo,
  onCreateChangeOrder,
  onCreateClaim,
}: {
  exposure: ExposureRow;
  highlightLabel?: string;
  spotlighted?: boolean;
  onEdit: (exposure: ExposureRow) => void;
  onDelete: (id: string) => void;
  onCreateTodo?: (exposure: ExposureRow) => void;
  onCreateChangeOrder?: (exposure: ExposureRow) => void;
  onCreateClaim?: (exposure: ExposureRow) => void;
}) {
  const closed = remainingValue(exposure) === 0;
  const highlighted = Boolean(highlightLabel);
  const nextReview = exposure.next_review_at || exposure.due_date || "Not scheduled";
  return (
    <div
      id={`risk-exposure-${exposure.id}`}
      role="button"
      tabIndex={0}
      onClick={() => onEdit(exposure)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onEdit(exposure);
        }
      }}
      className={[
        "grid cursor-pointer gap-4 px-4 py-4 transition-colors hover:bg-surface/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:grid-cols-[minmax(0,1fr)_200px_150px_175px] lg:gap-5",
        closed ? "opacity-65" : "",
        highlighted ? "border-l-4 border-l-danger bg-danger/10 hover:bg-danger/10" : "",
        spotlighted ? "ring-2 ring-accent ring-inset" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <div className="min-w-0 break-words text-base font-semibold leading-snug text-foreground">
            {exposure.title}
          </div>
          {highlightLabel && (
            <span className="shrink-0 rounded-full border border-danger/40 px-2 py-0.5 font-mono text-[8px] font-bold uppercase tracking-[0.06em] text-danger">
              {highlightLabel}
            </span>
          )}
        </div>
        <div className="mt-1.5 font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
          {CATEGORY_LABELS[exposure.category]}
        </div>
        {exposure.description && (
          <div className="mt-1.5 line-clamp-2 max-w-prose text-sm leading-snug text-muted-foreground">
            {exposure.description}
          </div>
        )}
        {exposure.notes && (
          <div className="mt-3 rounded-md border border-hairline bg-surface px-3 py-2 text-xs leading-relaxed text-foreground">
            <div className="mb-1 font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
              Plan
            </div>
            <div className="max-h-24 overflow-y-auto overscroll-contain pr-2">
              <p className="whitespace-pre-wrap">{planText(exposure.notes)}</p>
            </div>
          </div>
        )}
        {exposure.release_note && (
          <div className="mt-2 rounded-md border border-success/25 bg-success/10 px-2 py-1.5 text-xs text-foreground">
            <span className="font-medium text-success">Released: </span>
            {exposure.release_note}
          </div>
        )}
      </div>

      <div className="min-w-0">
        <div className="font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-muted-foreground lg:hidden">
          Treatment
        </div>
        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5 lg:mt-0">
          <TreatmentBadge path={exposure.response_path} />
          <span className="inline-flex items-center rounded-full border border-accent/40 bg-accent/5 px-2 py-0.5 font-mono text-[8px] font-bold uppercase tracking-[0.06em] text-clay">
            {exposure.hold_class}
          </span>
        </div>
        <div className="mt-2">
          <StatusBadge status={exposure.status} />
        </div>
        <div className="mt-2 text-xs leading-relaxed text-muted-foreground">
          {exposure.release_condition || "Release condition not set"}
        </div>
      </div>

      <div className="min-w-0 tabular lg:text-right">
        <div className="grid grid-cols-3 gap-2 lg:block">
          <div className="min-w-0 rounded-md border border-hairline bg-surface px-2 py-1.5 lg:border-0 lg:bg-transparent lg:px-0 lg:py-0">
            <div className="font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
              Likely
            </div>
            <div className="mt-0.5 font-serif text-lg leading-tight text-foreground">
              {fmtUSD(likelyValue(exposure))}
            </div>
            <div className="mt-0.5 text-[10px] text-muted-foreground">
              {fmtUSD(exposure.dollar_exposure)} at {exposure.probability}%
            </div>
          </div>
          <div className="min-w-0 rounded-md border border-hairline bg-surface px-2 py-1.5 lg:mt-2.5 lg:border-0 lg:bg-transparent lg:px-0 lg:py-0">
            <div className="font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
              Released
            </div>
            <div className="mt-0.5 font-serif text-[15px] leading-tight text-success">
              {releasedValue(exposure) > 0 ? fmtUSD(releasedValue(exposure)) : "$0"}
            </div>
          </div>
          <div className="min-w-0 rounded-md border border-hairline bg-surface px-2 py-1.5 lg:mt-2.5 lg:border-0 lg:bg-transparent lg:px-0 lg:py-0">
            <div className="font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
              Remaining
            </div>
            <div className="mt-0.5 font-serif text-base leading-tight text-danger">
              {fmtUSD(remainingValue(exposure))}
            </div>
          </div>
        </div>
        <div className="mt-3 text-xs">
          <div className="font-semibold text-foreground">{exposure.owner || "Unassigned"}</div>
          <div className="mt-0.5 text-muted-foreground">Next review: {nextReview}</div>
          {exposure.schedule_impact_weeks ? (
            <div className="mt-2 inline-flex rounded-md border border-warning/30 bg-warning/10 px-2 py-1 text-[11px] font-medium text-warning">
              {exposure.schedule_impact_weeks} wk schedule impact
            </div>
          ) : null}
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-clay">
          Send this risk to →
        </div>
        {exposure.linked_change_order_id ? (
          <Button
            size="sm"
            variant="outline"
            className="w-full justify-start gap-2 border-accent/45 bg-accent/5 text-clay"
            disabled
            title="Already in change orders"
            aria-label={`${exposure.title} is already in change orders`}
            onClick={(event) => event.stopPropagation()}
          >
            <FileCheck className="h-3.5 w-3.5" /> Change Order
          </Button>
        ) : onCreateChangeOrder ? (
          <Button
            size="sm"
            variant="outline"
            className="w-full justify-start gap-2 border-accent/45 bg-accent/5 text-clay hover:bg-accent/10 hover:text-clay"
            title="Tag as change order"
            aria-label={`Tag risk ${exposure.title} as a change order`}
            onClick={(event) => {
              event.stopPropagation();
              onCreateChangeOrder(exposure);
            }}
          >
            <FileText className="h-3.5 w-3.5" /> Change Order
          </Button>
        ) : null}
        {exposure.linked_claim_id ? (
          <Button
            size="sm"
            variant="outline"
            className="w-full justify-start gap-2 border-accent/45 bg-accent/5 text-clay"
            disabled
            title="Already tracked as a claim"
            aria-label={`${exposure.title} is already tracked as a claim`}
            onClick={(event) => event.stopPropagation()}
          >
            <Gavel className="h-3.5 w-3.5" /> Claim
          </Button>
        ) : onCreateClaim ? (
          <Button
            size="sm"
            variant="outline"
            className="w-full justify-start gap-2 border-accent/45 bg-accent/5 text-clay hover:bg-accent/10 hover:text-clay"
            title="Track as claim"
            aria-label={`Track risk ${exposure.title} as a claim`}
            onClick={(event) => {
              event.stopPropagation();
              onCreateClaim(exposure);
            }}
          >
            <Gavel className="h-3.5 w-3.5" /> Claim
          </Button>
        ) : null}
        {onCreateTodo && (
          <Button
            size="sm"
            variant="outline"
            className="w-full justify-start gap-2 border-accent/45 bg-accent/5 text-clay hover:bg-accent/10 hover:text-clay"
            title="Create linked to-do"
            aria-label={`Create linked to-do for ${exposure.title}`}
            onClick={(event) => {
              event.stopPropagation();
              onCreateTodo(exposure);
            }}
          >
            <ListChecks className="h-3.5 w-3.5" /> To-do
          </Button>
        )}
        <div className="mt-0.5 flex gap-1.5 border-t border-hairline pt-2">
          <Button
            size="sm"
            variant="outline"
            className="flex-1 gap-1.5"
            title="Edit risk"
            aria-label={`Edit risk ${exposure.title}`}
            onClick={(event) => {
              event.stopPropagation();
              onEdit(exposure);
            }}
          >
            <Pencil className="h-3.5 w-3.5" /> Edit
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="flex-1 gap-1.5 text-danger hover:bg-danger/10 hover:text-danger"
            aria-label={`Delete risk ${exposure.title}`}
            title="Delete risk"
            onClick={(event) => {
              event.stopPropagation();
              onDelete(exposure.id);
            }}
          >
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </Button>
        </div>
      </div>
    </div>
  );
}
