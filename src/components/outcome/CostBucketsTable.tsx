import { useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { MoneyInput } from "@/components/ui/money-input";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2 } from "lucide-react";
import { fmtUSD } from "@/lib/format";
import type { BucketRow } from "@/lib/projects.functions";

type BucketSource = BucketRow["source_type"];
type BucketPatch = Partial<
  Pick<
    BucketRow,
    | "actual_to_date"
    | "ftc"
    | "original_budget"
    | "bucket"
    | "source_type"
    | "source_date"
    | "source_note"
  >
>;
type NewBucketInput = {
  bucket: string;
  source_type: BucketSource;
  source_date: string;
  source_note: string;
};

const SOURCE_LABEL: Record<BucketSource, string> = {
  original_sov: "Original SOV",
  change_order: "Change Order",
  added_cost: "Added Cost",
};

export function CostBucketsTable({
  buckets,
  onUpdate,
  onCreate,
  onDelete,
}: {
  buckets: BucketRow[];
  onUpdate: (id: string, patch: BucketPatch) => void;
  onCreate?: (input: NewBucketInput) => void;
  onDelete?: (id: string) => void;
}) {
  const [newName, setNewName] = useState("");
  const [newSource, setNewSource] = useState<BucketSource>("added_cost");
  const today = new Date().toISOString().slice(0, 10);

  const submitNew = () => {
    const n = newName.trim();
    if (!n || !onCreate) return;
    onCreate({
      bucket: n,
      source_type: newSource,
      source_date: today,
      source_note: SOURCE_LABEL[newSource],
    });
    setNewName("");
    setNewSource("added_cost");
  };

  return (
    <div className="overflow-hidden rounded-lg border border-hairline bg-card">
      <Table>
        <TableHeader>
          <TableRow className="bg-surface">
            <TableHead>Bucket</TableHead>
            <TableHead>Source</TableHead>
            <TableHead className="text-right">Original Budget</TableHead>
            <TableHead className="text-right">Actual to Date</TableHead>
            <TableHead className="text-right">Forecast to Complete</TableHead>
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
                <TableCell className="min-w-[150px]">
                  <SourceCell
                    value={b.source_type}
                    date={b.source_date}
                    onChange={(source_type) => onUpdate(b.id, { source_type })}
                  />
                </TableCell>
                <TableCell className="text-right tabular text-foreground/80">
                  <NumCell
                    value={b.original_budget}
                    onCommit={(v) => onUpdate(b.id, { original_budget: v })}
                  />
                </TableCell>
                <TableCell className="text-right tabular">
                  <NumCell
                    value={b.actual_to_date}
                    onCommit={(v) => onUpdate(b.id, { actual_to_date: v })}
                  />
                </TableCell>
                <TableCell className="text-right tabular">
                  <NumCell value={b.ftc} onCommit={(v) => onUpdate(b.id, { ftc: v })} />
                </TableCell>
                <TableCell className="text-right tabular font-medium">{fmtUSD(fac)}</TableCell>
                <TableCell
                  className={`text-right tabular ${neg ? "text-danger font-medium" : "text-success"}`}
                >
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
              <TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
                No cost buckets yet. Use "Import SOV" to bring in your existing schedule of values
                from Excel or QuickBooks, or add the first line below.
              </TableCell>
            </TableRow>
          )}
          {onCreate && (
            <TableRow className="bg-surface/40">
              <TableCell colSpan={7}>
                <div className="flex flex-col gap-2 md:flex-row md:items-center">
                  <Input
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") submitNew();
                    }}
                    placeholder="Add a cost line (e.g. Owner-direct allowance, CO-cost holdback, Permits)"
                    className="h-8 md:max-w-md"
                  />
                  <Select value={newSource} onValueChange={(v) => setNewSource(v as BucketSource)}>
                    <SelectTrigger className="h-8 md:w-[170px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="original_sov">Original SOV</SelectItem>
                      <SelectItem value="change_order">Change Order</SelectItem>
                      <SelectItem value="added_cost">Added Cost</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={submitNew}
                    disabled={!newName.trim()}
                    className="gap-1.5"
                  >
                    <Plus className="h-3.5 w-3.5" /> Add line
                  </Button>
                </div>
              </TableCell>
              <TableCell />
            </TableRow>
          )}
        </TableBody>
        {buckets.length > 0 &&
          (() => {
            const tBudget = buckets.reduce((s, b) => s + b.original_budget, 0);
            const tActual = buckets.reduce((s, b) => s + b.actual_to_date, 0);
            const tFtc = buckets.reduce((s, b) => s + b.ftc, 0);
            const tFac = tActual + tFtc;
            const tVar = tBudget - tFac;
            const neg = tVar < 0;
            return (
              <TableFooter>
                <TableRow className="bg-surface font-semibold">
                  <TableCell>Total</TableCell>
                  <TableCell />
                  <TableCell className="text-right tabular">{fmtUSD(tBudget)}</TableCell>
                  <TableCell className="text-right tabular">{fmtUSD(tActual)}</TableCell>
                  <TableCell className="text-right tabular">{fmtUSD(tFtc)}</TableCell>
                  <TableCell className="text-right tabular">{fmtUSD(tFac)}</TableCell>
                  <TableCell
                    className={`text-right tabular ${neg ? "text-danger" : "text-success"}`}
                  >
                    {neg ? `−${fmtUSD(Math.abs(tVar)).replace("−", "")}` : fmtUSD(tVar)}
                  </TableCell>
                  <TableCell />
                </TableRow>
              </TableFooter>
            );
          })()}
      </Table>
    </div>
  );
}

function NumCell({ value, onCommit }: { value: number; onCommit: (v: number) => void }) {
  return (
    <MoneyInput
      value={value}
      onValueChange={(v) => {
        if (v !== value) onCommit(v);
      }}
      align="right"
      className="ml-auto h-8 w-32"
    />
  );
}

function NameCell({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [v, setV] = useState(value);
  return (
    <Textarea
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => {
        const t = v.trim();
        if (t && t !== value) onCommit(t);
        else setV(value);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      rows={2}
      className="min-h-[44px] w-full min-w-[220px] resize-y border-transparent bg-transparent px-1.5 py-1.5 leading-snug focus-visible:border-input focus-visible:bg-background"
    />
  );
}

function SourceCell({
  value,
  date,
  onChange,
}: {
  value: BucketSource;
  date: string | null;
  onChange: (v: BucketSource) => void;
}) {
  return (
    <div className="space-y-1">
      <Select value={value} onValueChange={(v) => onChange(v as BucketSource)}>
        <SelectTrigger className="h-8">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="original_sov">Original SOV</SelectItem>
          <SelectItem value="change_order">Change Order</SelectItem>
          <SelectItem value="added_cost">Added Cost</SelectItem>
        </SelectContent>
      </Select>
      {date && <div className="text-[10px] tabular text-muted-foreground">Added {date}</div>}
    </div>
  );
}
