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
import { Plus, Pencil, Trash2 } from "lucide-react";
import type { DecisionRow, DecisionStatus, ExposureRow } from "@/lib/projects.functions";

const statusStyles: Record<DecisionStatus, string> = {
  open: "bg-secondary text-foreground border-hairline",
  in_progress: "bg-accent/15 text-accent border-accent/30",
  resolved: "bg-success/15 text-success border-success/30",
  overdue: "bg-danger/15 text-danger border-danger/30",
};

const statusLabels: Record<DecisionStatus, string> = {
  open: "Open",
  in_progress: "In Progress",
  resolved: "Resolved",
  overdue: "Overdue",
};

export type DecisionDraft = {
  decision: string;
  impact: string;
  owner: string;
  due_date: string | null;
  status: DecisionStatus;
  linked_exposure_id: string | null;
  linked_co_id: string | null;
  notes: string;
};

const empty: DecisionDraft = {
  decision: "",
  impact: "",
  owner: "",
  due_date: null,
  status: "open",
  linked_exposure_id: null,
  linked_co_id: null,
  notes: "",
};

function fmtDate(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function DecisionsTable({
  decisions,
  exposures = [],
  onCreate,
  onUpdate,
  onDelete,
}: {
  decisions: DecisionRow[];
  exposures?: ExposureRow[];
  onCreate: (d: DecisionDraft) => void;
  onUpdate: (id: string, patch: Partial<DecisionDraft>) => void;
  onDelete: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DecisionDraft>(empty);

  const openNew = () => {
    setEditingId(null);
    setDraft(empty);
    setOpen(true);
  };
  const openEdit = (d: DecisionRow) => {
    setEditingId(d.id);
    setDraft({
      decision: d.decision,
      impact: d.impact,
      owner: d.owner,
      due_date: d.due_date,
      status: d.status,
      linked_exposure_id: d.linked_exposure_id,
      linked_co_id: d.linked_co_id,
      notes: d.notes,
    });
    setOpen(true);
  };
  const save = () => {
    if (!draft.decision.trim()) return;
    if (editingId) onUpdate(editingId, draft);
    else onCreate(draft);
    setOpen(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={openNew} size="sm" className="gap-1.5">
          <Plus className="h-3.5 w-3.5" /> Add decision
        </Button>
      </div>
      <div className="overflow-hidden rounded-lg border border-hairline bg-card">
        <Table>
          <TableHeader>
            <TableRow className="bg-surface">
              <TableHead>Decision Needed</TableHead>
              <TableHead className="hidden lg:table-cell">Linked Risk</TableHead>
              <TableHead className="hidden md:table-cell">Impact</TableHead>
              <TableHead>Owner</TableHead>
              <TableHead>Due</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-[80px] text-right" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {decisions.map((d) => (
              <TableRow key={d.id}>
                <TableCell className="font-medium">{d.decision}</TableCell>
                <TableCell className="hidden lg:table-cell text-xs text-muted-foreground">
                  {riskTitle(exposures, d.linked_exposure_id)}
                </TableCell>
                <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                  {d.impact}
                </TableCell>
                <TableCell className="text-sm">{d.owner}</TableCell>
                <TableCell className="text-sm tabular">{fmtDate(d.due_date)}</TableCell>
                <TableCell>
                  <Select
                    value={d.status}
                    onValueChange={(v) => onUpdate(d.id, { status: v as DecisionStatus })}
                  >
                    <SelectTrigger className={`h-7 w-[130px] text-xs ${statusStyles[d.status]}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(statusLabels) as DecisionStatus[]).map((k) => (
                        <SelectItem key={k} value={k}>
                          {statusLabels[k]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      onClick={() => openEdit(d)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      onClick={() => onDelete(d.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {decisions.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">
                  No to-dos yet. Create one from a risk row or add the next action here.
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
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-serif text-2xl">
              {editingId ? "Edit decision" : "Add decision"}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="space-y-1.5">
              <Label>To-do</Label>
              <Input
                value={draft.decision}
                onChange={(e) => setDraft({ ...draft, decision: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Action detail / impact</Label>
              <Textarea
                rows={2}
                value={draft.impact}
                onChange={(e) => setDraft({ ...draft, impact: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Linked risk</Label>
              <Select
                value={draft.linked_exposure_id ?? "none"}
                onValueChange={(v) =>
                  setDraft({ ...draft, linked_exposure_id: v === "none" ? null : v })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No linked risk</SelectItem>
                  {exposures.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Owner</Label>
                <Input
                  value={draft.owner}
                  onChange={(e) => setDraft({ ...draft, owner: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Due date</Label>
                <Input
                  type="date"
                  value={draft.due_date ?? ""}
                  onChange={(e) => setDraft({ ...draft, due_date: e.target.value || null })}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select
                value={draft.status}
                onValueChange={(v) => setDraft({ ...draft, status: v as DecisionStatus })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(statusLabels) as DecisionStatus[]).map((k) => (
                    <SelectItem key={k} value={k}>
                      {statusLabels[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={save}>{editingId ? "Save" : "Add to-do"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function riskTitle(exposures: ExposureRow[], id: string | null) {
  if (!id) return "—";
  return exposures.find((e) => e.id === id)?.title ?? "Linked risk";
}
