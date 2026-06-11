import { useState } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MoneyInput } from "@/components/ui/money-input";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Plus, Trash2 } from "lucide-react";
import { fmtUSD } from "@/lib/format";
import type { BucketRow } from "@/lib/projects.functions";

type BucketPatch = Partial<Pick<BucketRow, "actual_to_date" | "ftc" | "original_budget" | "bucket">>;

export function CostBucketsTable({
  buckets,
  onUpdate,
  onCreate,
  onDelete,
}: {
  buckets: BucketRow[];
  onUpdate: (id: string, patch: BucketPatch) => void;
  onCreate?: (name: string) => void;
  onDelete?: (id: string) => void;
}) {
  const [newName, setNewName] = useState("");

  const submitNew = () => {
    const n = newName.trim();
    if (!n || !onCreate) return;
    onCreate(n);
    setNewName("");
  };

  return (
    <div className="overflow-hidden rounded-lg border border-hairline bg-card">
      <Table>
        <TableHeader>
          <TableRow className="bg-surface">
            <TableHead>Bucket</TableHead>
            <TableHead className="text-right">Original Budget</TableHead>
            <TableHead className="text-right">Actual to Date</TableHead>
            <TableHead className="text-right">FTC</TableHead>
            <TableHead className="text-right">Forecast at Completion</TableHead>
            <TableHead className="text-right">Variance vs Budget</TableHead>
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {buckets.map((b) => {
            const fac = b.actual_to_date + b.ftc;
            const variance = b.original_budget - fac;
            const neg = variance < 0;
            return (
              <TableRow key={b.id}>
                <TableCell className="font-medium">
                  <NameCell value={b.bucket} onCommit={(v) => onUpdate(b.id, { bucket: v })} />
                </TableCell>
                <TableCell className="text-right tabular text-foreground/80">
                  <NumCell value={b.original_budget} onCommit={(v) => onUpdate(b.id, { original_budget: v })} />
                </TableCell>
                <TableCell className="text-right tabular">
                  <NumCell value={b.actual_to_date} onCommit={(v) => onUpdate(b.id, { actual_to_date: v })} />
                </TableCell>
                <TableCell className="text-right tabular">
                  <NumCell value={b.ftc} onCommit={(v) => onUpdate(b.id, { ftc: v })} />
                </TableCell>
                <TableCell className="text-right tabular font-medium">{fmtUSD(fac)}</TableCell>
                <TableCell className={`text-right tabular ${neg ? "text-danger font-medium" : "text-success"}`}>
                  {neg ? `−${fmtUSD(Math.abs(variance)).replace("−", "")}` : fmtUSD(variance)}
                </TableCell>
                <TableCell>
                  {onDelete && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-muted-foreground hover:text-danger"
                      onClick={() => {
                        if (confirm(`Delete cost bucket "${b.bucket}"?`)) onDelete(b.id);
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
          {buckets.length === 0 && (
            <TableRow>
              <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                No cost buckets yet. Use "Import SOV" to bring in your existing schedule of values from Excel or QuickBooks, or add the first line below.
              </TableCell>
            </TableRow>
          )}
          {onCreate && (
            <TableRow className="bg-surface/40">
              <TableCell colSpan={6}>
                <div className="flex items-center gap-2">
                  <Input
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") submitNew(); }}
                    placeholder="Add a cost line (e.g. Owner-direct allowance, CO-cost holdback, Permits)"
                    className="h-8 max-w-md"
                  />
                  <Button size="sm" variant="outline" onClick={submitNew} disabled={!newName.trim()} className="gap-1.5">
                    <Plus className="h-3.5 w-3.5" /> Add line
                  </Button>
                </div>
              </TableCell>
              <TableCell />
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}

function NumCell({ value, onCommit }: { value: number; onCommit: (v: number) => void }) {
  return (
    <MoneyInput
      value={value}
      onValueChange={(v) => { if (v !== value) onCommit(v); }}
      align="right"
      className="ml-auto h-8 w-32"
    />
  );
}

function NameCell({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [v, setV] = useState(value);
  return (
    <Input
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => { const t = v.trim(); if (t && t !== value) onCommit(t); else setV(value); }}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
      className="h-8 w-56 border-transparent bg-transparent px-1.5 focus-visible:border-input focus-visible:bg-background"
    />
  );
}
