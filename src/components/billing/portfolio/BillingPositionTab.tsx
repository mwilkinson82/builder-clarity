// Billing position tab — unbilled revenue and over/under-billing by project,
// with the "Cut pay app" entry point into each project's billing workspace.
import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { fmtUSDCents as fmtUSD } from "@/lib/billing-format";
import { daysUntilDue } from "@/lib/receivables";
import type { PortfolioBillingProject } from "@/lib/billing.functions";
import {
  MONO_LABEL,
  projectUnbilled,
  shortDate,
  type PortfolioBillingTotals,
} from "./portfolio-billing-shared";
import { MoneyCell, StatTile } from "./PortfolioStatTiles";

// An overbilled job reads crit once the overbilling passes 5% of earned
// revenue (judgment call — the mock colors a ~7.7% overbill crit and a ~2.1%
// overbill warn); any overbilling with zero earned is crit outright.
const OVERBILLED_CRIT_SHARE = 0.05;

export function BillingPositionTab({
  totals,
  projects,
  today,
}: {
  totals: PortfolioBillingTotals;
  projects: PortfolioBillingProject[];
  today: string;
}) {
  const totalUnbilled = projects.reduce((sum, project) => sum + projectUnbilled(project), 0);
  const dueSoon = useMemo(
    () =>
      projects.filter((project) => {
        const remaining = daysUntilDue(project.next_billing_date, today);
        return remaining !== null && remaining <= 7;
      }),
    [projects, today],
  );
  const dueSoonUnbilled = dueSoon.reduce((sum, project) => sum + projectUnbilled(project), 0);
  const sortedProjects = useMemo(
    () =>
      [...projects].sort(
        (a, b) =>
          Math.abs(b.total_over_under) - Math.abs(a.total_over_under) ||
          b.open_receivable - a.open_receivable ||
          a.project_name.localeCompare(b.project_name),
      ),
    [projects],
  );

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5">
        <StatTile
          label="Unbilled / earned"
          value={fmtUSD(totalUnbilled)}
          sub="ready to invoice"
          tone="warn"
        />
        <StatTile
          label="Net over/under"
          value={fmtUSD(totals.total_over_under, { sign: true })}
          sub={`${fmtUSD(totals.total_earned)} earned`}
          tone="warn"
        />
        <StatTile label="Billed to date" value={fmtUSD(totals.total_billed)} />
        <StatTile
          label="Due to bill · 7d"
          value={`${dueSoon.length} job${dueSoon.length === 1 ? "" : "s"}`}
          sub={`${fmtUSD(dueSoonUnbilled)} est.`}
          tone="warn"
        />
        <StatTile label="Open A/R" value={fmtUSD(totals.open_receivable)} />
      </div>

      <section className="overflow-hidden rounded-xl border border-hairline bg-card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline bg-secondary px-4 py-3.5">
          <div className={`${MONO_LABEL} text-muted-foreground`}>Billing position by project</div>
          <div className="text-[11px] tabular text-muted-foreground">
            {totals.project_count} project{totals.project_count === 1 ? "" : "s"} ·{" "}
            {fmtUSD(totals.total_contract)} under contract
          </div>
        </div>
        {sortedProjects.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            No active projects are available for billing yet.
          </div>
        ) : (
          sortedProjects.map((project) => (
            <PositionRow key={project.project_id} project={project} />
          ))
        )}
      </section>
    </div>
  );
}

function overUnderChip(project: PortfolioBillingProject) {
  const overUnder = project.total_over_under;
  if (overUnder > 0) {
    const share = project.total_earned > 0 ? overUnder / project.total_earned : Infinity;
    return {
      label: `Overbilled ${fmtUSD(overUnder, { sign: true })}`,
      className: share > OVERBILLED_CRIT_SHARE ? "text-danger" : "text-warning",
    };
  }
  if (overUnder < 0) {
    return { label: `Underbilled ${fmtUSD(overUnder)}`, className: "text-success" };
  }
  return { label: "On track", className: "text-muted-foreground" };
}

function PositionRow({ project }: { project: PortfolioBillingProject }) {
  const chip = overUnderChip(project);
  const unbilled = projectUnbilled(project);
  return (
    <div className="grid items-center gap-x-3.5 gap-y-2 border-t border-hairline px-4 py-3.5 first:border-t-0 md:grid-cols-[1.4fr_0.9fr_0.9fr_1.3fr_0.9fr_0.8fr_auto]">
      <div className="min-w-0">
        <div className="truncate text-[13.5px] font-semibold text-foreground">
          {project.project_name}
        </div>
        <div className="truncate text-[11px] text-muted-foreground">
          {[project.job_number ? `Job ${project.job_number}` : "", project.client]
            .filter(Boolean)
            .join(" · ") || "No client set"}
        </div>
      </div>
      <MoneyCell label="Billed" value={fmtUSD(project.total_billed)} />
      <MoneyCell label="Earned" value={fmtUSD(project.total_earned)} />
      <div>
        <span
          className={`inline-block rounded-md border border-current px-2 py-1 font-mono text-[9px] font-bold uppercase tabular ${chip.className}`}
        >
          {chip.label}
        </span>
      </div>
      <MoneyCell
        label="Unbilled"
        value={fmtUSD(unbilled)}
        valueClassName={unbilled > 0 ? "text-warning" : "text-muted-foreground"}
      />
      <div>
        <div className={`${MONO_LABEL} text-muted-foreground`}>Next</div>
        <div className="mt-0.5 text-[12.5px] font-semibold">
          {shortDate(project.next_billing_date)}
        </div>
      </div>
      <Button
        asChild
        size="sm"
        className="justify-self-start whitespace-nowrap md:justify-self-end"
      >
        <Link
          to="/projects/$projectId"
          params={{ projectId: project.project_id }}
          search={{ tab: "billing" }}
        >
          Cut pay app →
        </Link>
      </Button>
    </div>
  );
}
