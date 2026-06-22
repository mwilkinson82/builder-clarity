import { useState } from "react";
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
import { Textarea } from "@/components/ui/textarea";
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
import { ListChecks, Plus, Pencil, Trash2 } from "lucide-react";
import { MoneyInput } from "@/components/ui/money-input";
import { fmtUSD } from "@/lib/format";
import type { ExposureCategory, ExposureStatus, HoldClass, ResponsePath } from "@/lib/ior";
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
  onCreate,
  onUpdate,
  onDelete,
  onCreateTodo,
}: {
  exposures: ExposureRow[];
  onCreate: (d: ExposureDraft) => void;
  onUpdate: (id: string, patch: Partial<ExposureDraft>) => void;
  onDelete: (id: string) => void;
  onCreateTodo?: (exposure: ExposureRow) => void;
}) {
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ExposureDraft>(empty);
  const [errors, setErrors] = useState<{ dollar?: string; response?: string; title?: string }>({});

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
    const payload = {
      ...draft,
      released_amount: Math.min(draft.released_amount, likely),
      release_updated_at: draft.released_amount > 0 ? new Date().toISOString() : null,
    };
    if (editingId) onUpdate(editingId, payload);
    else onCreate(payload);
    setOpen(false);
  };

  const live = exposures
    .filter((e) => e.status === "active" || e.status === "escalated")
    .sort((a, b) => remainingValue(b) - remainingValue(a));
  const eHolds = live.filter((e) => e.hold_class === "E-Hold" || e.hold_class === "Both");
  const cHolds = live.filter((e) => e.hold_class === "C-Hold");
  const unclassifiedLive = live.filter((e) => e.hold_class === "None");
  const topEHoldId = eHolds[0]?.id ?? null;
  const topCHoldId = cHolds[0]?.id ?? null;
  const topUnclassifiedId = unclassifiedLive[0]?.id ?? null;
  const closed = exposures
    .filter((e) => e.status !== "active" && e.status !== "escalated")
    .sort((a, b) => likelyValue(b) - likelyValue(a));

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={openNew} size="sm" className="gap-1.5">
          <Plus className="h-3.5 w-3.5" /> Add risk
        </Button>
      </div>

      <div className="overflow-hidden rounded-lg border border-hairline bg-card">
        <Table className="min-w-[1120px]">
          <TableHeader>
            <TableRow className="bg-surface">
              <TableHead className="min-w-[290px]">Risk / exposure</TableHead>
              <TableHead>Category</TableHead>
              <TableHead className="text-right">Dollar</TableHead>
              <TableHead className="text-right">Prob.</TableHead>
              <TableHead className="text-right">Likely $</TableHead>
              <TableHead className="text-right">Released</TableHead>
              <TableHead className="text-right">Remaining</TableHead>
              <TableHead>Hold</TableHead>
              <TableHead>Owner</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Treatment</TableHead>
              <TableHead className="w-[80px] text-right" />
            </TableRow>
          </TableHeader>
          <TableBody>
            <RiskGroupRow label="E-Holds" detail="Known exposure now" count={eHolds.length} />
            {eHolds.map((e) => (
              <RiskRow
                key={e.id}
                exposure={e}
                highlightLabel={e.id === topEHoldId ? "Top E-Hold" : undefined}
                onEdit={openEdit}
                onDelete={onDelete}
                onCreateTodo={onCreateTodo}
              />
            ))}
            <RiskGroupRow
              label="C-Holds"
              detail="Contingency still being gardened"
              count={cHolds.length}
            />
            {cHolds.map((e) => (
              <RiskRow
                key={e.id}
                exposure={e}
                highlightLabel={e.id === topCHoldId ? "Top C-Hold" : undefined}
                onEdit={openEdit}
                onDelete={onDelete}
                onCreateTodo={onCreateTodo}
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
                onEdit={openEdit}
                onDelete={onDelete}
                onCreateTodo={onCreateTodo}
              />
            ))}
            {closed.length > 0 && (
              <RiskGroupRow
                label="Closed / released"
                detail="Status has removed this from active holds"
                count={closed.length}
              />
            )}
            {closed.map((e) => (
              <RiskRow
                key={e.id}
                exposure={e}
                onEdit={openEdit}
                onDelete={onDelete}
                onCreateTodo={onCreateTodo}
              />
            ))}
            {exposures.length === 0 && (
              <TableRow>
                <TableCell colSpan={12} className="py-10 text-center text-sm text-muted-foreground">
                  No risk allocations yet. Every emerging problem has a dollar consequence - add the
                  first one to begin protecting margin.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <span />
        </DialogTrigger>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="font-serif text-2xl">
              {editingId ? "Edit risk allocation" : "Add risk allocation"}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="space-y-1.5">
              <Label>Title</Label>
              <Input
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              />
              {errors.title && <p className="text-xs text-danger">{errors.title}</p>}
            </div>
            <div className="space-y-1.5">
              <Label>What changed?</Label>
              <Textarea
                rows={2}
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Category</Label>
                <Select
                  value={draft.category}
                  onValueChange={(v) => setDraft({ ...draft, category: v as ExposureCategory })}
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
            <div className="grid grid-cols-3 gap-3">
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
                  onChange={(e) => setDraft({ ...draft, probability: Number(e.target.value) })}
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
                      schedule_impact_weeks: e.target.value === "" ? null : Number(e.target.value),
                    })
                  }
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label className="text-danger">Treatment path *</Label>
                <Select
                  value={draft.response_path}
                  onValueChange={(v) => setDraft({ ...draft, response_path: v as ResponsePath })}
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
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label>Recovered / offset so far</Label>
                <MoneyInput
                  value={draft.released_amount}
                  onValueChange={(v) => setDraft({ ...draft, released_amount: v })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Remaining likely hold</Label>
                <div className="flex h-10 items-center rounded-md border border-hairline bg-surface px-3 text-sm font-medium tabular text-foreground">
                  {fmtUSD(
                    Math.max(
                      0,
                      draft.dollar_exposure * (draft.probability / 100) - draft.released_amount,
                    ),
                  )}
                </div>
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
            <div className="space-y-1.5">
              <Label>Action plan / course of action</Label>
              <Textarea
                rows={3}
                value={draft.notes}
                placeholder="How will this be recovered, offset, eliminated, or accepted? Who must do what next?"
                onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Release condition</Label>
              <Input
                value={draft.release_condition}
                onChange={(e) => setDraft({ ...draft, release_condition: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Next review date</Label>
              <Input
                type="date"
                value={draft.next_review_at ?? ""}
                onChange={(e) => setDraft({ ...draft, next_review_at: e.target.value || null })}
              />
            </div>
          </div>
          <DialogFooter>
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
  return e.dollar_exposure * (e.probability / 100);
}

function releasedValue(e: ExposureRow) {
  return Math.min(likelyValue(e), e.released_amount ?? 0);
}

function remainingValue(e: ExposureRow) {
  return Math.max(0, likelyValue(e) - releasedValue(e));
}

function RiskGroupRow({ label, detail, count }: { label: string; detail: string; count: number }) {
  return (
    <TableRow className="bg-surface/80 hover:bg-surface/80">
      <TableCell colSpan={12} className="py-2">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-baseline gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-foreground">
              {label}
            </span>
            <span className="text-xs text-muted-foreground">{detail}</span>
          </div>
          <span className="rounded-full border border-hairline bg-card px-2 py-0.5 text-[10px] text-muted-foreground">
            {count}
          </span>
        </div>
      </TableCell>
    </TableRow>
  );
}

function RiskRow({
  exposure,
  highlightLabel,
  onEdit,
  onDelete,
  onCreateTodo,
}: {
  exposure: ExposureRow;
  highlightLabel?: string;
  onEdit: (exposure: ExposureRow) => void;
  onDelete: (id: string) => void;
  onCreateTodo?: (exposure: ExposureRow) => void;
}) {
  const closed = exposure.status !== "active" && exposure.status !== "escalated";
  const highlighted = Boolean(highlightLabel);
  return (
    <TableRow
      onDoubleClick={() => onEdit(exposure)}
      className={[
        closed ? "opacity-65" : "",
        highlighted ? "border-l-4 border-l-danger bg-danger/8 hover:bg-danger/10" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <TableCell className="min-w-[290px]">
        <div className="flex items-center gap-2">
          <div className="font-medium text-foreground">{exposure.title}</div>
          {highlightLabel && (
            <span className="rounded-full border border-danger/30 bg-danger/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-danger">
              {highlightLabel}
            </span>
          )}
        </div>
        {exposure.description && (
          <div className="mt-0.5 max-w-md text-xs text-muted-foreground">
            {exposure.description}
          </div>
        )}
        {exposure.notes && (
          <div className="mt-2 rounded-md border border-hairline bg-surface px-2 py-1.5 text-xs text-foreground">
            <span className="font-medium">Plan: </span>
            {exposure.notes}
          </div>
        )}
        {exposure.release_note && (
          <div className="mt-2 rounded-md border border-success/25 bg-success/10 px-2 py-1.5 text-xs text-foreground">
            <span className="font-medium text-success">Released: </span>
            {exposure.release_note}
          </div>
        )}
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">
        {CATEGORY_LABELS[exposure.category]}
      </TableCell>
      <TableCell className="text-right tabular">{fmtUSD(exposure.dollar_exposure)}</TableCell>
      <TableCell className="text-right tabular text-muted-foreground">
        {exposure.probability}%
      </TableCell>
      <TableCell className="text-right tabular font-medium">
        {fmtUSD(likelyValue(exposure))}
      </TableCell>
      <TableCell className="text-right tabular text-success">
        {releasedValue(exposure) > 0 ? fmtUSD(releasedValue(exposure)) : "$0"}
      </TableCell>
      <TableCell className="text-right tabular font-semibold text-foreground">
        {fmtUSD(remainingValue(exposure))}
      </TableCell>
      <TableCell>
        <span className="inline-flex items-center rounded-md border border-hairline px-1.5 py-0.5 font-mono text-[10px]">
          {exposure.hold_class}
        </span>
      </TableCell>
      <TableCell className="text-sm">{exposure.owner}</TableCell>
      <TableCell>
        <StatusBadge status={exposure.status} />
      </TableCell>
      <TableCell>
        <TreatmentBadge path={exposure.response_path} />
      </TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end gap-1">
          {onCreateTodo && (
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              title="Create linked to-do"
              aria-label={`Create linked to-do for ${exposure.title}`}
              onClick={(event) => {
                event.stopPropagation();
                onCreateTodo(exposure);
              }}
            >
              <ListChecks className="h-3.5 w-3.5" />
            </Button>
          )}
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => onEdit(exposure)}>
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            aria-label={`Delete risk ${exposure.title}`}
            title="Delete risk"
            onClick={(event) => {
              event.stopPropagation();
              onDelete(exposure.id);
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}
