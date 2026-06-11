import { useState } from "react";
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
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { fmtUSD } from "@/lib/format";
import type {
  ExposureCategory, ExposureStatus, HoldClass, ResponsePath,
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
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${map[status]}`}>
      {status}
    </span>
  );
}

export function ExposuresTable({
  exposures,
  onCreate,
  onUpdate,
  onDelete,
}: {
  exposures: ExposureRow[];
  onCreate: (d: ExposureDraft) => void;
  onUpdate: (id: string, patch: Partial<ExposureDraft>) => void;
  onDelete: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ExposureDraft>(empty);
  const [errors, setErrors] = useState<{ dollar?: string; response?: string; title?: string }>({});

  const openNew = () => { setEditingId(null); setDraft(empty); setErrors({}); setOpen(true); };
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
    if (!(draft.dollar_exposure > 0)) errs.dollar = "Dollar exposure is required — what is the probable dollar consequence if nothing changes?";
    if (!draft.response_path) errs.response = "Choose a treatment path";
    if (Object.keys(errs).length) { setErrors(errs); return; }
    if (editingId) onUpdate(editingId, draft);
    else onCreate(draft);
    setOpen(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={openNew} size="sm" className="gap-1.5">
          <Plus className="h-3.5 w-3.5" /> Log exposure
        </Button>
      </div>

      <div className="overflow-hidden rounded-lg border border-hairline bg-card">
        <Table>
          <TableHeader>
            <TableRow className="bg-surface">
              <TableHead>Exposure</TableHead>
              <TableHead>Category</TableHead>
              <TableHead className="text-right">Dollar</TableHead>
              <TableHead className="text-right">Prob.</TableHead>
              <TableHead className="text-right">Weighted</TableHead>
              <TableHead>Treatment</TableHead>
              <TableHead>Hold</TableHead>
              <TableHead>Owner</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-[80px] text-right" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {exposures.map((e) => (
              <TableRow key={e.id} className={e.status === "released" ? "opacity-60" : ""}>
                <TableCell>
                  <div className="font-medium text-foreground">{e.title}</div>
                  {e.description && <div className="mt-0.5 text-xs text-muted-foreground max-w-md">{e.description}</div>}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">{CATEGORY_LABELS[e.category]}</TableCell>
                <TableCell className="text-right tabular">{fmtUSD(e.dollar_exposure)}</TableCell>
                <TableCell className="text-right tabular text-muted-foreground">{e.probability}%</TableCell>
                <TableCell className="text-right tabular">{fmtUSD(e.dollar_exposure * (e.probability / 100))}</TableCell>
                <TableCell className="text-xs">{RESPONSE_LABELS[e.response_path]}</TableCell>
                <TableCell>
                  <span className="inline-flex items-center rounded-md border border-hairline px-1.5 py-0.5 font-mono text-[10px]">
                    {e.hold_class}
                  </span>
                </TableCell>
                <TableCell className="text-sm">{e.owner}</TableCell>
                <TableCell><StatusBadge status={e.status} /></TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(e)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => onDelete(e.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {exposures.length === 0 && (
              <TableRow>
                <TableCell colSpan={10} className="py-10 text-center text-sm text-muted-foreground">
                  No exposures yet. Every emerging problem has a dollar consequence — log the first one to begin protecting margin.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild><span /></DialogTrigger>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="font-serif text-2xl">
              {editingId ? "Edit exposure" : "Log exposure"}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="space-y-1.5">
              <Label>Title</Label>
              <Input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
              {errors.title && <p className="text-xs text-danger">{errors.title}</p>}
            </div>
            <div className="space-y-1.5">
              <Label>What changed?</Label>
              <Textarea rows={2} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Category</Label>
                <Select value={draft.category} onValueChange={(v) => setDraft({ ...draft, category: v as ExposureCategory })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(CATEGORY_LABELS) as ExposureCategory[]).map((k) => (
                      <SelectItem key={k} value={k}>{CATEGORY_LABELS[k]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Owner</Label>
                <Input value={draft.owner} onChange={(e) => setDraft({ ...draft, owner: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label className="text-danger">Dollar exposure *</Label>
                <Input type="number" value={draft.dollar_exposure} onChange={(e) => setDraft({ ...draft, dollar_exposure: Number(e.target.value) })} />
                {errors.dollar && <p className="text-xs text-danger">{errors.dollar}</p>}
              </div>
              <div className="space-y-1.5">
                <Label>Probability %</Label>
                <Input type="number" min={0} max={100} value={draft.probability} onChange={(e) => setDraft({ ...draft, probability: Number(e.target.value) })} />
              </div>
              <div className="space-y-1.5">
                <Label>Schedule impact (wk)</Label>
                <Input type="number" value={draft.schedule_impact_weeks ?? ""} onChange={(e) => setDraft({ ...draft, schedule_impact_weeks: e.target.value === "" ? null : Number(e.target.value) })} />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label className="text-danger">Treatment path *</Label>
                <Select value={draft.response_path} onValueChange={(v) => setDraft({ ...draft, response_path: v as ResponsePath })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(RESPONSE_LABELS) as ResponsePath[]).map((k) => (
                      <SelectItem key={k} value={k}>{RESPONSE_LABELS[k]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Hold class</Label>
                <Select value={draft.hold_class} onValueChange={(v) => setDraft({ ...draft, hold_class: v as HoldClass })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
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
                <Select value={draft.status} onValueChange={(v) => setDraft({ ...draft, status: v as ExposureStatus })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(["active","escalated","recovered","eliminated","accepted","released"] as ExposureStatus[]).map((k) => (
                      <SelectItem key={k} value={k}>{k}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Release condition</Label>
              <Input value={draft.release_condition} onChange={(e) => setDraft({ ...draft, release_condition: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Next review date</Label>
              <Input type="date" value={draft.next_review_at ?? ""} onChange={(e) => setDraft({ ...draft, next_review_at: e.target.value || null })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save}>{editingId ? "Save changes" : "Log exposure"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
