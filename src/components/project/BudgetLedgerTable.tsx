// Budget-vs-cost ledger (BUDGETENGINE Phase 2) — the per-cost-code accounting
// view: Budget → Actuals → Open → At Risk → Contingency → EAC → (Over)/Under.
// At Risk (E-Holds) and Contingency (C-Holds) come from the live exposure
// allocations, so this reads the IOR risk register — not a typed number.
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fmtUSD } from "@/lib/format";
import { computeBudgetLedger } from "@/lib/budget-ledger";
import type { BucketRow, ExposureRow } from "@/lib/projects.functions";
import type { ExposureAllocationRow } from "@/lib/projects.functions";

function OverUnder({ value }: { value: number }) {
  if (value === 0) return <span className="tabular text-muted-foreground">$0</span>;
  // Positive = under budget (good), negative = over budget (bad, shown in parens).
  const under = value > 0;
  return (
    <span className={`tabular font-medium ${under ? "text-success" : "text-danger"}`}>
      {under ? fmtUSD(value) : `(${fmtUSD(Math.abs(value))})`}
    </span>
  );
}

export function BudgetLedgerTable({
  buckets,
  exposures,
  allocations,
}: {
  buckets: BucketRow[];
  exposures: ExposureRow[];
  allocations: ExposureAllocationRow[];
}) {
  const ledger = computeBudgetLedger(buckets, exposures, allocations);

  if (ledger.rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No budget lines yet. Import or add cost codes to your budget, then allocate risk to see the
        At Risk column go live.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div>
        <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Budget vs cost by code
        </div>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          EAC is Actuals + Open (paid + committed). At Risk (E-Holds) and Contingency (C-Holds) come
          straight from the IOR risk register. (Over)/Under is Budget − EAC — positive is under
          budget.
        </p>
      </div>
      <div className="overflow-x-auto rounded-lg border border-hairline bg-card">
        <Table>
          <TableHeader>
            <TableRow className="bg-surface text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              <TableHead className="w-[90px]">Cost code</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className="text-right">Budget</TableHead>
              <TableHead className="text-right">Actuals</TableHead>
              <TableHead className="text-right">Open</TableHead>
              <TableHead className="text-right">At Risk</TableHead>
              <TableHead className="text-right">Contingency</TableHead>
              <TableHead className="text-right">EAC</TableHead>
              <TableHead className="text-right">(Over)/Under</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ledger.rows.map((row) => (
              <TableRow key={row.costBucketId ?? `general-${row.costCode}`}>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {row.costCode || "—"}
                </TableCell>
                <TableCell className="font-medium">{row.description}</TableCell>
                <TableCell className="text-right tabular">{fmtUSD(row.budget)}</TableCell>
                <TableCell className="text-right tabular">{fmtUSD(row.actuals)}</TableCell>
                <TableCell className="text-right tabular text-muted-foreground">
                  {fmtUSD(row.open)}
                </TableCell>
                <TableCell className="text-right tabular text-warning">
                  {row.atRisk > 0 ? fmtUSD(row.atRisk) : "—"}
                </TableCell>
                <TableCell className="text-right tabular text-accent">
                  {row.contingency > 0 ? fmtUSD(row.contingency) : "—"}
                </TableCell>
                <TableCell className="text-right tabular font-medium">{fmtUSD(row.eac)}</TableCell>
                <TableCell className="text-right">
                  <OverUnder value={row.overUnder} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow className="bg-surface font-semibold">
              <TableCell />
              <TableCell>{ledger.totals.description}</TableCell>
              <TableCell className="text-right tabular">{fmtUSD(ledger.totals.budget)}</TableCell>
              <TableCell className="text-right tabular">{fmtUSD(ledger.totals.actuals)}</TableCell>
              <TableCell className="text-right tabular">{fmtUSD(ledger.totals.open)}</TableCell>
              <TableCell className="text-right tabular text-warning">
                {fmtUSD(ledger.totals.atRisk)}
              </TableCell>
              <TableCell className="text-right tabular text-accent">
                {fmtUSD(ledger.totals.contingency)}
              </TableCell>
              <TableCell className="text-right tabular">{fmtUSD(ledger.totals.eac)}</TableCell>
              <TableCell className="text-right">
                <OverUnder value={ledger.totals.overUnder} />
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </div>
    </div>
  );
}
