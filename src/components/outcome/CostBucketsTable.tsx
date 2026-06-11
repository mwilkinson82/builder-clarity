import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MoneyInput } from "@/components/ui/money-input";
import { fmtUSD } from "@/lib/format";
import type { BucketRow } from "@/lib/projects.functions";

export function CostBucketsTable({
  buckets,
  onUpdate,
}: {
  buckets: BucketRow[];
  onUpdate: (id: string, patch: Partial<Pick<BucketRow, "actual_to_date" | "ftc" | "original_budget">>) => void;
}) {
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
          </TableRow>
        </TableHeader>
        <TableBody>
          {buckets.map((b) => {
            const fac = b.actual_to_date + b.ftc;
            const variance = b.original_budget - fac;
            const neg = variance < 0;
            return (
              <TableRow key={b.id}>
                <TableCell className="font-medium">{b.bucket}</TableCell>
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
              </TableRow>
            );
          })}
          {buckets.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                No cost buckets yet. Use “Import SOV” to bring in your existing schedule of values from Excel or QuickBooks.
              </TableCell>
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
