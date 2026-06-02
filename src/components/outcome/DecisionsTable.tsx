import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { decisions } from "./data";

const statusStyles: Record<string, string> = {
  Open: "bg-secondary text-foreground border-hairline",
  "In Progress": "bg-accent/15 text-accent border-accent/30",
  Resolved: "bg-success/15 text-success border-success/30",
  Overdue: "bg-danger/15 text-danger border-danger/30",
};

export function DecisionsTable() {
  return (
    <div className="overflow-hidden rounded-lg border border-hairline bg-card">
      <Table>
        <TableHeader>
          <TableRow className="bg-surface">
            <TableHead>Decision Needed</TableHead>
            <TableHead className="hidden md:table-cell">Impact</TableHead>
            <TableHead>Owner</TableHead>
            <TableHead>Due</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {decisions.map((d) => (
            <TableRow key={d.id}>
              <TableCell className="font-medium">{d.decision}</TableCell>
              <TableCell className="hidden md:table-cell text-sm text-muted-foreground">{d.impact}</TableCell>
              <TableCell className="text-sm">{d.owner}</TableCell>
              <TableCell className="text-sm tabular">{d.dueDate}</TableCell>
              <TableCell>
                <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${statusStyles[d.status]}`}>
                  {d.status}
                </span>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
