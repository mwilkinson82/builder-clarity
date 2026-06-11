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
import { Plus, Pencil, Trash2 } from "lucide-react";
import { fmtUSD } from "@/lib/format";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Info } from "lucide-react";
import type { HoldRow, HoldStatus, HoldType } from "@/lib/projects.functions";

function StatusBadge({ status }: { status: HoldStatus }) {
  const map: Record<HoldStatus, string> = {
    Active: "bg-warning/15 text-warning border-warning/30",
    Released: "bg-success/15 text-success border-success/30",
    Escalated: "bg-danger/15 text-danger border-danger/30",
  };
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${map[status]}`}>
      {status}
    </span>
  );
}

function TypePill({ type }: { type: HoldType }) {
  const isE = type === "E-Hold";
  return (
    <span
      className={`inline-flex items-center rounded-md border px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-tight ${
        isE ? "border-accent/40 bg-accent/10 text-accent" : "border-foreground/20 bg-secondary text-foreground"
      }`}
    >
      {type}
    </span>
  );
}

type Draft = {
  type: HoldType;
  description: string;
  amount: number;
  reason: string;
  owner: string;
  release_condition: string;
  status: HoldStatus;
};

const empty: Draft = {
  type: "E-Hold",
  description: "",
  amount: 0,
  reason: "",
  owner: "",
  release_condition: "",
  status: "Active",
};

export function HoldsPanel({
  holds,
  onCreate,
  onUpdate,
  onDelete,
  pending,
}: {
  holds: HoldRow[];
  onCreate: (draft: Draft) => void;
  onUpdate: (id: string, patch: Partial<Draft>) => void;
  onDelete: (id: string) => void;
  pending?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(empty);

  const openNew = () => { setEditingId(null); setDraft(empty); setOpen(true); };
  const openEdit = (h: HoldRow) => {
    setEditingId(h.id);
    setDraft({
      type: h.type, description: h.description, amount: h.amount, reason: h.reason,
      owner: h.owner, release_condition: h.release_condition, status: h.status,
    });
    setOpen(true);
  };
  const save = () => {
    if (!draft.description.trim()) return;
    if (editingId) onUpdate(editingId, draft);
    else onCreate(draft);
    setOpen(false);
  };

  const eHolds = holds.filter((h) => h.type === "E-Hold");
  const cHolds = holds.filter((h) => h.type === "C-Hold");
  const eTotal = eHolds.filter((h) => h.status !== "Released").reduce((s, h) => s + h.amount, 0);
  const cTotal = cHolds.filter((h) => h.status !== "Released").reduce((s, h) => s + h.amount, 0);

  return (
    <TooltipProvider delayDuration={150}>
      <div className="space-y-6">
        <div className="grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-hairline bg-hairline md:grid-cols-3">
          <div className="bg-card px-5 py-4">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              E-Hold Reserve
              <Tooltip>
                <TooltipTrigger asChild>
                  <button className="text-muted-foreground/70 hover:text-foreground"><Info className="h-3 w-3" /></button>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  Exposure Holds reserve margin against specific, named risks.
                </TooltipContent>
              </Tooltip>
            </div>
            <div className="mt-1 font-serif text-2xl tabular">{fmtUSD(eTotal)}</div>
            <div className="text-xs text-muted-foreground">{eHolds.length} items</div>
          </div>
          <div className="bg-card px-5 py-4">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              C-Hold Reserve
              <Tooltip>
                <TooltipTrigger asChild>
                  <button className="text-muted-foreground/70 hover:text-foreground"><Info className="h-3 w-3" /></button>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  Contingency Hold reserves general remaining uncertainty across unbought or unfinished scope.
                </TooltipContent>
              </Tooltip>
            </div>
            <div className="mt-1 font-serif text-2xl tabular">{fmtUSD(cTotal)}</div>
            <div className="text-xs text-muted-foreground">{cHolds.length} items</div>
          </div>
          <div className="bg-card px-5 py-4 flex items-center justify-between">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Total Held</div>
              <div className="mt-1 font-serif text-2xl tabular text-accent">{fmtUSD(eTotal + cTotal)}</div>
            </div>
            <Button onClick={openNew} size="sm" className="gap-1.5" disabled={pending}>
              <Plus className="h-3.5 w-3.5" /> Add hold
            </Button>
          </div>
        </div>

        <div className="overflow-hidden rounded-lg border border-hairline bg-card">
          <Table>
            <TableHeader>
              <TableRow className="bg-surface">
                <TableHead className="w-[80px]">Type</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="hidden lg:table-cell">Reason</TableHead>
                <TableHead className="hidden md:table-cell">Owner</TableHead>
                <TableHead className="hidden xl:table-cell">Release Condition</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-[200px] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {holds.map((h) => (
                <TableRow key={h.id} className={h.status === "Released" ? "opacity-60" : ""}>
                  <TableCell><TypePill type={h.type} /></TableCell>
                  <TableCell className="font-medium">{h.description}</TableCell>
                  <TableCell className="text-right tabular">{fmtUSD(h.amount)}</TableCell>
                  <TableCell className="hidden lg:table-cell text-sm text-muted-foreground max-w-xs">{h.reason}</TableCell>
                  <TableCell className="hidden md:table-cell text-sm">{h.owner}</TableCell>
                  <TableCell className="hidden xl:table-cell text-sm text-muted-foreground max-w-xs">{h.release_condition}</TableCell>
                  <TableCell><StatusBadge status={h.status} /></TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Select value={h.status} onValueChange={(v) => onUpdate(h.id, { status: v as HoldStatus })}>
                        <SelectTrigger className="h-7 w-[110px] text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Active">Active</SelectItem>
                          <SelectItem value="Released">Released</SelectItem>
                          <SelectItem value="Escalated">Escalated</SelectItem>
                        </SelectContent>
                      </Select>
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(h)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => onDelete(h.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {holds.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
                    No holds yet. Add an exposure or contingency hold to begin reserving margin.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><span /></DialogTrigger>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle className="font-serif text-2xl">
                {editingId ? "Edit hold" : "Add hold"}
              </DialogTitle>
            </DialogHeader>
            <div className="grid gap-4 py-2">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Type</Label>
                  <Select value={draft.type} onValueChange={(v) => setDraft({ ...draft, type: v as HoldType })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="E-Hold">E-Hold (Exposure)</SelectItem>
                      <SelectItem value="C-Hold">C-Hold (Contingency)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Amount (USD)</Label>
                  <Input
                    type="number"
                    value={draft.amount}
                    onChange={(e) => setDraft({ ...draft, amount: Number(e.target.value) })}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Description</Label>
                <Input value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Reason</Label>
                <Textarea rows={2} value={draft.reason} onChange={(e) => setDraft({ ...draft, reason: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Owner</Label>
                  <Input value={draft.owner} onChange={(e) => setDraft({ ...draft, owner: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Status</Label>
                  <Select value={draft.status} onValueChange={(v) => setDraft({ ...draft, status: v as HoldStatus })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Active">Active</SelectItem>
                      <SelectItem value="Released">Released</SelectItem>
                      <SelectItem value="Escalated">Escalated</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Release condition</Label>
                <Input value={draft.release_condition} onChange={(e) => setDraft({ ...draft, release_condition: e.target.value })} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={save}>{editingId ? "Save changes" : "Add hold"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
}
