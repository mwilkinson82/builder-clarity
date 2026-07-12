// "Where it's moving" — the budget bridge between the stat bar and the ledger
// (reskin B1, Budget.html mock). Two columns: the codes running over budget and
// the biggest cushions, each with a proportional bar so the eye ranks them
// without reading a single number. Values reuse the ledger rows' overUnder
// (budget − projected: POSITIVE = under budget, NEGATIVE = over) — never a
// re-derivation that could drift from the table below.
import { useState } from "react";

import { fmtUSD } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { BudgetLedgerRow } from "@/lib/budget-ledger";

const MAX_ROWS_PER_SIDE = 4;

// One mover line: name + code, a bar sized against the biggest mover shown
// (either side — the two columns share a scale so "over" and "under" bars are
// comparable), and the signed dollar amount.
function MoverRow({
  row,
  maxAbs,
  side,
}: {
  row: BudgetLedgerRow;
  maxAbs: number;
  side: "over" | "under";
}) {
  const magnitude = Math.abs(row.overUnder);
  // Floor tiny movers at 8% so they stay visible as a mark, not a sliver.
  const widthPct = Math.max(8, Math.min(100, Math.round((magnitude / maxAbs) * 100)));
  const over = side === "over";
  return (
    <div className="grid grid-cols-[150px_1fr_92px] items-center gap-3 py-1.5">
      <span className="truncate text-[12.5px] font-medium">
        {row.description}{" "}
        {row.costCode ? (
          <span className="font-mono text-[9.5px] text-muted-foreground">{row.costCode}</span>
        ) : null}
      </span>
      <span className="relative block h-1.5 overflow-hidden rounded-full bg-muted">
        <span
          className={cn(
            "absolute top-0 h-full rounded-full",
            // Over-budget bars grow from the left in red; cushions grow from the
            // right in green, so the two columns mirror toward each other.
            over ? "left-0 bg-danger/70" : "right-0 bg-success/70",
          )}
          style={{ width: `${widthPct}%` }}
        />
      </span>
      <span
        className={cn(
          "whitespace-nowrap text-right font-serif text-sm tabular",
          over ? "text-danger" : "text-success",
        )}
      >
        {over ? "+" : "−"}
        {fmtUSD(magnitude)}
      </span>
    </div>
  );
}

export function BudgetMovers({ rows }: { rows: readonly BudgetLedgerRow[] }) {
  // <details> is browser-toggled; mirror its state so React re-renders never
  // snap it back open.
  const [open, setOpen] = useState(true);

  // Real cost-code lines only — the ledger's synthetic rollups (unallocated
  // COs / general job risk) aren't "codes" and would read as fake cushions.
  const codes = rows.filter((row) => row.costBucketId !== null);
  const overCount = codes.filter((row) => row.overUnder < 0).length;
  const underOrOnCount = codes.length - overCount;

  // overUnder = budget − projected: negative means the code is running OVER.
  const over = codes
    .filter((row) => row.overUnder < 0)
    .sort((a, b) => a.overUnder - b.overUnder)
    .slice(0, MAX_ROWS_PER_SIDE);
  const under = codes
    .filter((row) => row.overUnder > 0)
    .sort((a, b) => b.overUnder - a.overUnder)
    .slice(0, MAX_ROWS_PER_SIDE);

  // Every code is dead on budget → nothing is moving; say nothing at all.
  if (over.length === 0 && under.length === 0) return null;

  // Both columns share one scale: the largest mover shown on either side.
  const maxAbs = Math.max(
    ...over.map((row) => Math.abs(row.overUnder)),
    ...under.map((row) => Math.abs(row.overUnder)),
  );

  return (
    <details
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      className="rounded-xl border border-hairline bg-card px-5 pb-1.5"
    >
      <summary className="flex cursor-pointer list-none items-center gap-2.5 py-3 [&::-webkit-details-marker]:hidden">
        <span className="eyebrow">Where it's moving</span>
        <span className="text-xs text-muted-foreground">
          {overCount} code{overCount === 1 ? "" : "s"} over · {underOrOnCount} under or on
        </span>
        <span className="ml-auto text-[11px] text-muted-foreground">collapse / expand ▾</span>
      </summary>
      <div className="grid gap-6 pb-2.5 pt-1 md:grid-cols-2">
        <div>
          <div className="pb-1 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-danger">
            Running over
          </div>
          {over.length > 0 ? (
            over.map((row) => (
              <MoverRow
                key={row.costBucketId ?? row.costCode}
                row={row}
                maxAbs={maxAbs}
                side="over"
              />
            ))
          ) : (
            <p className="py-1.5 text-xs text-muted-foreground">None — every code is holding.</p>
          )}
        </div>
        <div>
          <div className="pb-1 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-success">
            Biggest cushions
          </div>
          {under.length > 0 ? (
            under.map((row) => (
              <MoverRow
                key={row.costBucketId ?? row.costCode}
                row={row}
                maxAbs={maxAbs}
                side="under"
              />
            ))
          ) : (
            <p className="py-1.5 text-xs text-muted-foreground">None — every code is holding.</p>
          )}
        </div>
      </div>
    </details>
  );
}
