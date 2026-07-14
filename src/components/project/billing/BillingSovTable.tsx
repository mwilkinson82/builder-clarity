import { useMemo } from "react";

import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ChangeOrderAllocationRow } from "@/lib/billing.functions";
import { computeBudgetLedger } from "@/lib/budget-ledger";
import { fmtUSD } from "@/lib/format";
import type { BucketRow, ChangeOrderRow } from "@/lib/projects.functions";

function SovFigure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="font-mono text-[9.5px] font-bold uppercase tracking-[0.14em] text-dark-panel-foreground/60">
        {label}
      </div>
      <div className="mt-1.5 whitespace-nowrap font-serif text-[22px] leading-none tabular">
        {value}
      </div>
    </div>
  );
}

export function BillingSovTable({
  buckets,
  changeOrders,
  changeOrderAllocations,
}: {
  buckets: BucketRow[];
  changeOrders: ChangeOrderRow[];
  changeOrderAllocations: ChangeOrderAllocationRow[];
}) {
  const ledger = useMemo(
    () => computeBudgetLedger(buckets, [], [], changeOrders, changeOrderAllocations),
    [buckets, changeOrders, changeOrderAllocations],
  );
  const originalSov = ledger.totals.contractValue - ledger.totals.changeOrderContract;
  const revisedSov = ledger.totals.contractValue;

  if (buckets.length === 0) {
    return (
      <div className="rounded-lg border border-hairline bg-card p-6 text-sm text-muted-foreground shadow-card">
        No SOV lines yet. Add contract values to the project cost codes before building the first
        pay application.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-x-10 gap-y-4 rounded-xl bg-dark-panel px-5 py-4 text-dark-panel-foreground">
        <SovFigure label="Original SOV" value={fmtUSD(originalSov)} />
        <SovFigure label="Approved COs" value={fmtUSD(ledger.totals.changeOrderContract)} />
        <SovFigure label="Revised contract" value={fmtUSD(revisedSov)} />
        <p className="ml-auto max-w-sm text-right text-xs leading-relaxed text-dark-panel-foreground/60">
          Owner-facing contract value. The internal build budget remains in the project Budget
          workspace.
        </p>
      </div>

      <div>
        <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Schedule of values by cost code
        </div>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          These are the contract amounts billed to the owner. Approved change orders increase or
          decrease the applicable SOV line; internal cost and margin are intentionally excluded.
        </p>
      </div>

      <div className="overflow-x-auto rounded-lg border border-hairline bg-card">
        <Table>
          <TableHeader>
            <TableRow className="bg-surface font-mono text-[9.5px] uppercase tracking-[0.1em] text-muted-foreground [&_th]:font-bold">
              <TableHead className="w-[100px]">Code</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className="text-right">Original SOV</TableHead>
              <TableHead className="text-right">Approved COs</TableHead>
              <TableHead className="text-right">Revised SOV</TableHead>
              <TableHead className="text-right">% of contract</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ledger.rows.map((row) => {
              const baseContract = row.contractValue - row.changeOrderContract;
              const contractShare = revisedSov > 0 ? (row.contractValue / revisedSov) * 100 : 0;
              return (
                <TableRow key={row.costBucketId ?? "unallocated-change-orders"}>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {row.costCode || "—"}
                  </TableCell>
                  <TableCell className="font-medium">{row.description}</TableCell>
                  <TableCell className="text-right tabular">
                    {row.costBucketId !== null && !row.priced ? (
                      <span className="text-xs font-medium text-warning">Needs contract value</span>
                    ) : (
                      fmtUSD(baseContract)
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular">
                    {row.changeOrderContract === 0 ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      fmtUSD(row.changeOrderContract)
                    )}
                  </TableCell>
                  <TableCell className="text-right font-medium tabular">
                    {row.costBucketId !== null && !row.priced && row.changeOrderContract === 0 ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      fmtUSD(row.contractValue)
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular text-muted-foreground">
                    {contractShare.toFixed(1)}%
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
          <TableFooter>
            <TableRow className="bg-surface font-semibold">
              <TableCell />
              <TableCell>Total SOV</TableCell>
              <TableCell className="text-right font-serif text-[15px] tabular">
                {fmtUSD(originalSov)}
              </TableCell>
              <TableCell className="text-right font-serif text-[15px] tabular">
                {fmtUSD(ledger.totals.changeOrderContract)}
              </TableCell>
              <TableCell className="text-right font-serif text-[15px] tabular">
                {fmtUSD(revisedSov)}
              </TableCell>
              <TableCell className="text-right tabular">
                {revisedSov > 0 ? "100.0%" : "—"}
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </div>

      {ledger.unpricedCount > 0 ? (
        <p className="text-xs text-warning">
          {ledger.unpricedCount} SOV {ledger.unpricedCount === 1 ? "line needs" : "lines need"} a
          contract value before the schedule is ready to bill.
        </p>
      ) : null}
    </div>
  );
}
