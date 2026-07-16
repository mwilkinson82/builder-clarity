import { ArrowUpRight } from "lucide-react";
import { fmtPct, fmtUSD } from "@/lib/format";
import type { PipelineOpportunityRow, PipelineStage } from "@/lib/pipeline.functions";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
  bidUrgencyClass,
  gpToneClass,
  opportunityPricingState,
  shortDate,
  STAGE_LABELS,
  STAGE_ORDER,
  STAGE_PILL_CLASS,
} from "./pipeline-ui";

type PipelineListProps = {
  opportunities: PipelineOpportunityRow[];
  onOpen: (id: string) => void;
  onStageChange: (id: string, stage: PipelineStage) => void;
};

export function PipelineList({ opportunities, onOpen, onStageChange }: PipelineListProps) {
  return (
    <div className="overflow-hidden rounded-lg border border-hairline bg-card shadow-card">
      <Table className="min-w-[1280px]">
        <TableHeader>
          <TableRow className="bg-surface [&>th]:whitespace-nowrap">
            <TableHead>Name</TableHead>
            <TableHead>Account / Contact</TableHead>
            <TableHead>Stage</TableHead>
            <TableHead className="text-right">Est. Contract</TableHead>
            <TableHead className="text-right">GP%</TableHead>
            <TableHead>Bid Due</TableHead>
            <TableHead>Next Action</TableHead>
            <TableHead className="text-right">Probability</TableHead>
            <TableHead>Assigned</TableHead>
            <TableHead>Last Activity</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {opportunities.length === 0 && (
            <TableRow>
              <TableCell colSpan={10} className="py-10 text-center text-sm text-muted-foreground">
                No opportunities match the current CRM filters.
              </TableCell>
            </TableRow>
          )}
          {opportunities.map((opportunity) => {
            const pricing = opportunityPricingState(opportunity);
            return (
              <TableRow
                key={opportunity.id}
                className="cursor-pointer hover:bg-surface/60 [&>td]:align-middle"
                onClick={() => onOpen(opportunity.id)}
              >
                <TableCell className="max-w-[240px]">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium text-foreground">{opportunity.name}</span>
                    {opportunity.converted_project_id && (
                      <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-success" />
                    )}
                  </div>
                </TableCell>
                <TableCell className="max-w-[200px] truncate text-muted-foreground">
                  <div className="truncate text-sm text-foreground">
                    {opportunity.account_name || opportunity.client || "No account"}
                  </div>
                  <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                    {opportunity.primary_contact_name || "No primary contact"}
                  </div>
                </TableCell>
                <TableCell onClick={(event) => event.stopPropagation()}>
                  <Select
                    value={opportunity.stage}
                    onValueChange={(stage) => onStageChange(opportunity.id, stage as PipelineStage)}
                  >
                    <SelectTrigger className="h-8 w-[150px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {STAGE_ORDER.map((stage) => (
                        <SelectItem key={stage} value={stage}>
                          {STAGE_LABELS[stage]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {pricing.priced ? fmtUSD(opportunity.estimated_contract) : "Unpriced"}
                </TableCell>
                <TableCell
                  className={cn(
                    "text-right font-medium tabular-nums",
                    pricing.marginReady
                      ? gpToneClass(opportunity.estimated_gp_pct)
                      : "text-muted-foreground",
                  )}
                >
                  {pricing.marginReady ? fmtPct(opportunity.estimated_gp_pct) : "Pending"}
                </TableCell>
                <TableCell className={cn("whitespace-nowrap", bidUrgencyClass(opportunity))}>
                  {shortDate(opportunity.bid_due_date)}
                </TableCell>
                <TableCell className="max-w-[220px]">
                  <div className="truncate text-sm text-foreground">
                    {opportunity.next_action_title || "No action"}
                  </div>
                  {opportunity.next_action_due_date && (
                    <div className="mt-0.5 text-[11px] text-muted-foreground">
                      Due {shortDate(opportunity.next_action_due_date)}
                    </div>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {opportunity.probability}%
                </TableCell>
                <TableCell className="max-w-[160px] truncate">
                  {opportunity.assigned_to || "Unassigned"}
                </TableCell>
                <TableCell>
                  <span
                    className={cn(
                      "inline-flex rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em]",
                      STAGE_PILL_CLASS[opportunity.stage],
                    )}
                  >
                    {new Date(opportunity.last_activity_at).toLocaleDateString()}
                  </span>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
