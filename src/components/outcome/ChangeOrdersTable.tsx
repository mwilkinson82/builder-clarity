import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtUSD } from "@/lib/format";
import { changeOrders } from "./data";

const statusStyles: Record<string, string> = {
  Approved: "bg-success/15 text-success border-success/30",
  Pending: "bg-warning/15 text-warning border-warning/30",
  Unpriced: "bg-secondary text-foreground border-hairline",
  Disputed: "bg-danger/15 text-danger border-danger/30",
  Submitted: "bg-accent/15 text-accent border-accent/30",
};

export function ChangeOrdersTable() {
  return (
    <div className="overflow-hidden rounded-lg border border-hairline bg-card">
      <Table>
        <TableHeader>
          <TableRow className="bg-surface">
            <TableHead className="w-[90px]">CO #</TableHead>
            <TableHead>Description</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Age</TableHead>
            <TableHead className="hidden md:table-cell">Owner</TableHead>
            <TableHead className="hidden lg:table-cell">Next Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {changeOrders.map((co) => (
            <TableRow key={co.id}>
              <TableCell className="font-mono text-xs text-muted-foreground">{co.id}</TableCell>
              <TableCell className="font-medium">{co.description}</TableCell>
              <TableCell className="text-right tabular">{fmtUSD(co.amount)}</TableCell>
              <TableCell>
                <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${statusStyles[co.status]}`}>
                  {co.status}
                </span>
              </TableCell>
              <TableCell className={`text-right tabular text-sm ${co.ageDays > 30 ? "text-danger" : "text-muted-foreground"}`}>
                {co.ageDays}d
              </TableCell>
              <TableCell className="hidden md:table-cell text-sm">{co.owner}</TableCell>
              <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">{co.nextAction}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
