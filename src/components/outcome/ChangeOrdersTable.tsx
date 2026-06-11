import { useState } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { MoneyInput } from "@/components/ui/money-input";
import { fmtUSD } from "@/lib/format";
import type { ChangeOrderRow, COStatus, COType } from "@/lib/projects.functions";

const statusStyles: Record<COStatus, string> = {
  Approved: "bg-success/15 text-success border-success/30",
  Pending: "bg-warning/15 text-warning border-warning/30",
  Denied: "bg-danger/15 text-danger border-danger/30",
};

const CO_TYPE_LABELS: Record<COType, string> = {
  owner_change: "Owner change",
  design_error: "Design error",
  design_omission: "Design omission",
  unforeseen_condition: "Unforeseen field condition",
  missed_scope: "Missed scope (our side)",
  sub_issued: "Issued to sub",
  other: "Other",
};

type Draft = {
  number: string;
  description: string;
  contract_amount: number;
  cost_amount: number;
  status: COStatus;
  probability: number;
  owner: string;
  notes: string;
  co_type: COType;
};

const empty: Draft = {
  number: "",
  description: "",
  contract_amount: 0,
  cost_amount: 0,
  status: "Pending",
  probability: 100,
  owner: "",
  notes: "",
  co_type: "owner_change",
};


export function ChangeOrdersTable({
  changeOrders,
  onCreate,
  onUpdate,
  onDelete,
}: {
  changeOrders: ChangeOrderRow[];
  onCreate: (d: Draft) => void;
  onUpdate: (id: string, p: Partial<Draft>) => void;
  onDelete: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(empty);

  const openNew = () => { setEditingId(null); setDraft(empty); setOpen(true); };
  const openEdit = (c: ChangeOrderRow) => {
    setEditingId(c.id);
    setDraft({
      number: c.number, description: c.description,
      contract_amount: c.contract_amount, cost_amount: c.cost_amount,
      status: c.status, probability: c.probability,
      owner: c.owner, notes: c.notes, co_type: c.co_type,
    });

    setOpen(true);
  };
  const save = () => {
    if (!draft.description.trim()) return;
    if (editingId) onUpdate(editingId, draft);
    else onCreate(draft);
    setOpen(false);
  };

  const totals = changeOrders.reduce(
    (acc, c) => {
      if (c.status === "Approved") {
        acc.approvedContract += c.contract_amount;
        acc.approvedCost += c.cost_amount;
      } else if (c.status === "Pending") {
        acc.pendingContract += c.contract_amount;
        acc.weightedContract += c.contract_amount * (c.probability / 100);
        acc.weightedCost += c.cost_amount * (c.probability / 100);
      }
      return acc;
    },
    { approvedContract: 0, approvedCost: 0, pendingContract: 0, weightedContract: 0, weightedCost: 0 },
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-hairline bg-hairline md:grid-cols-4">
        <Stat label="Approved (contract)" value={fmtUSD(totals.approvedContract)} />
        <Stat label="Approved (cost)" value={fmtUSD(totals.approvedCost)} />
        <Stat label="Pending (raw)" value={fmtUSD(totals.pendingContract)} />
        <Stat label="Pending (probability-weighted)" value={fmtUSD(totals.weightedContract)} accent />
      </div>

      <div className="flex justify-end">
        <Button size="sm" className="gap-1.5" onClick={openNew}>
          <Plus className="h-3.5 w-3.5" /> Add change order
        </Button>
      </div>

      <div className="overflow-hidden rounded-lg border border-hairline bg-card">
        <Table>
          <TableHeader>
            <TableRow className="bg-surface">
              <TableHead className="w-[90px]">CO #</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className="hidden lg:table-cell">Type</TableHead>
              <TableHead className="text-right">Contract</TableHead>
              <TableHead className="text-right">Cost</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Prob.</TableHead>
              <TableHead className="hidden md:table-cell">Owner</TableHead>
              <TableHead className="w-[120px] text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {changeOrders.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="font-mono text-xs text-muted-foreground">{c.number}</TableCell>
                <TableCell className="font-medium">{c.description}</TableCell>
                <TableCell className="hidden lg:table-cell text-xs text-muted-foreground">{CO_TYPE_LABELS[c.co_type] ?? "—"}</TableCell>
                <TableCell className="text-right tabular">{fmtUSD(c.contract_amount)}</TableCell>
                <TableCell className="text-right tabular text-foreground/80">{fmtUSD(c.cost_amount)}</TableCell>
                <TableCell>
                  <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${statusStyles[c.status]}`}>
                    {c.status}
                  </span>
                </TableCell>
                <TableCell className="text-right tabular text-sm">
                  {c.status === "Pending" ? `${c.probability}%` : "—"}
                </TableCell>
                <TableCell className="hidden md:table-cell text-sm">{c.owner}</TableCell>

                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(c)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => onDelete(c.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {changeOrders.length === 0 && (
              <TableRow>
                <TableCell colSpan={9} className="py-8 text-center text-sm text-muted-foreground">
                  No change orders yet. Add approved and pending COs to roll into the forecasted final contract.
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
              {editingId ? "Edit change order" : "Add change order"}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label>CO number</Label>
                <Input value={draft.number} onChange={(e) => setDraft({ ...draft, number: e.target.value })} placeholder="CO-005" />
              </div>
              <div className="space-y-1.5">
                <Label>Status</Label>
                <Select value={draft.status} onValueChange={(v) => setDraft({ ...draft, status: v as COStatus })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Approved">Approved</SelectItem>
                    <SelectItem value="Pending">Pending</SelectItem>
                    <SelectItem value="Denied">Denied</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Probability %</Label>
                <Input
                  type="number"
                  disabled={draft.status !== "Pending"}
                  value={draft.probability}
                  onChange={(e) => setDraft({ ...draft, probability: Number(e.target.value) })}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Input value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Contract amount (USD)</Label>
                <MoneyInput value={draft.contract_amount} onValueChange={(v) => setDraft({ ...draft, contract_amount: v })} />
              </div>
              <div className="space-y-1.5">
                <Label>Cost amount (USD)</Label>
                <MoneyInput value={draft.cost_amount} onValueChange={(v) => setDraft({ ...draft, cost_amount: v })} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Owner</Label>
              <Input value={draft.owner} onChange={(e) => setDraft({ ...draft, owner: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Textarea rows={2} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save}>{editingId ? "Save changes" : "Add change order"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="bg-card px-5 py-4">
      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
      <div className={`mt-1 font-serif text-2xl tabular ${accent ? "text-accent" : ""}`}>{value}</div>
    </div>
  );
}
