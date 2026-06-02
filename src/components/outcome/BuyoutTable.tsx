import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtUSD } from "@/lib/format";
import { buyouts } from "./data";

const statusStyles: Record<string, string> = {
  Bought: "bg-success/15 text-success border-success/30",
  "In Negotiation": "bg-warning/15 text-warning border-warning/30",
  Open: "bg-secondary text-muted-foreground border-hairline",
  "At Risk": "bg-danger/15 text-danger border-danger/30",
};

export function BuyoutTable() {
  return (
    <div className="overflow-hidden rounded-lg border border-hairline bg-card">
      <Table>
        <TableHeader>
          <TableRow className="bg-surface">
            <TableHead>Scope</TableHead>
            <TableHead className="text-right">Budget</TableHead>
            <TableHead className="text-right">Committed</TableHead>
            <TableHead className="text-right">Forecast Remaining</TableHead>
            <TableHead className="text-right">Variance</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="hidden lg:table-cell">Notes</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {buyouts.map((b) => {
            const projected = b.committed + b.forecastRemaining;
            const variance = b.budget - projected;
            const neg = variance < 0;
            return (
              <TableRow key={b.scope}>
                <TableCell className="font-medium">{b.scope}</TableCell>
                <TableCell className="text-right tabular text-foreground/80">{fmtUSD(b.budget)}</TableCell>
                <TableCell className="text-right tabular">{fmtUSD(b.committed)}</TableCell>
                <TableCell className="text-right tabular text-foreground/80">{fmtUSD(b.forecastRemaining)}</TableCell>
                <TableCell className={`text-right tabular ${neg ? "text-danger font-medium" : "text-success"}`}>
                  {neg ? `−${fmtUSD(Math.abs(variance)).replace("−", "")}` : fmtUSD(variance)}
                </TableCell>
                <TableCell>
                  <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${statusStyles[b.status]}`}>
                    {b.status}
                  </span>
                </TableCell>
                <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">{b.notes}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
