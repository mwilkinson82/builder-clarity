import { CheckCircle2, Clock3, Contact, Landmark, PhoneCall, UserRound } from "lucide-react";
import type { ReactNode } from "react";
import type {
  PipelineCrmSnapshot,
  PipelineNextActionRow,
  PipelineOpportunityRow,
} from "@/lib/pipeline.functions";
import { fmtUSD } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { shortDate } from "./pipeline-ui";

type PipelineCrmOverviewProps = {
  snapshot: PipelineCrmSnapshot | null;
  opportunities: PipelineOpportunityRow[];
  isLoading: boolean;
  completingActionId: string | null;
  onCompleteAction: (id: string) => void;
};

export function PipelineCrmOverview({
  snapshot,
  opportunities,
  isLoading,
  completingActionId,
  onCompleteAction,
}: PipelineCrmOverviewProps) {
  const accounts = snapshot?.accounts ?? [];
  const contacts = snapshot?.contacts ?? [];
  const openActions = snapshot?.openActions ?? [];
  const activeRelationshipCount = accounts.filter((account) => !account.archived).length;
  const activeContactCount = contacts.filter((contact) => !contact.archived).length;
  const activeValue = accounts.reduce((total, account) => total + account.active_pipeline_value, 0);
  const nextAction = openActions[0] ?? null;

  return (
    <section className="rounded-lg border border-hairline bg-card p-4 shadow-card md:p-5">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0 xl:max-w-[360px]">
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            <Contact className="h-3.5 w-3.5" />
            CRM command center
          </div>
          <h2 className="mt-2 font-serif text-3xl leading-none text-foreground">
            Relationships, pursuits, and follow-up.
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Accounts and contacts now sit beside the bid board so the next move is visible before
            work becomes an Overwatch project.
          </p>
          <div className="mt-4 grid grid-cols-3 gap-2">
            <MiniStat label="Accounts" value={String(activeRelationshipCount)} />
            <MiniStat label="Contacts" value={String(activeContactCount)} />
            <MiniStat
              label="Open bids"
              value={String(opportunities.filter((o) => !o.archived).length)}
            />
          </div>
        </div>

        <div className="grid flex-1 gap-3 xl:grid-cols-[minmax(220px,0.95fr)_minmax(240px,1.05fr)_minmax(280px,1.2fr)]">
          <Panel
            icon={<Landmark className="h-3.5 w-3.5" />}
            label="Top accounts"
            meta={activeValue > 0 ? `${fmtUSD(activeValue)} weighted` : "Relationship ledger"}
          >
            {isLoading ? (
              <LoadingLine />
            ) : accounts.length === 0 ? (
              <EmptyLine text="CRM sample data will appear here." />
            ) : (
              accounts.slice(0, 4).map((account) => (
                <div key={account.id} className="border-b border-hairline py-2 last:border-0">
                  <div className="flex items-center justify-between gap-3">
                    <div className="truncate text-sm font-semibold text-foreground">
                      {account.name}
                    </div>
                    <HealthPill health={account.relationship_health} />
                  </div>
                  <div className="mt-0.5 flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
                    <span className="truncate">
                      {account.market_sector || account.relationship_stage}
                    </span>
                    <span className="shrink-0 tabular-nums">
                      {fmtUSD(account.active_pipeline_value)}
                    </span>
                  </div>
                </div>
              ))
            )}
          </Panel>

          <Panel
            icon={<UserRound className="h-3.5 w-3.5" />}
            label="Key contacts"
            meta="People map"
          >
            {isLoading ? (
              <LoadingLine />
            ) : contacts.length === 0 ? (
              <EmptyLine text="Contacts will populate from opportunities." />
            ) : (
              contacts.slice(0, 4).map((contact) => (
                <div key={contact.id} className="border-b border-hairline py-2 last:border-0">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-foreground">
                        {contact.name}
                      </div>
                      <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                        {contact.title || contact.role || "Contact"} ·{" "}
                        {contact.account_name || "No account"}
                      </div>
                    </div>
                    <span className="shrink-0 rounded-full border border-hairline bg-surface px-2 py-0.5 text-[10px] font-semibold capitalize text-muted-foreground">
                      {contact.influence_level.replace(/_/g, " ")}
                    </span>
                  </div>
                </div>
              ))
            )}
          </Panel>

          <Panel
            icon={<Clock3 className="h-3.5 w-3.5" />}
            label="Next actions"
            meta={nextAction ? `Next: ${shortDate(nextAction.due_date)}` : "Daily follow-up"}
          >
            {isLoading ? (
              <LoadingLine />
            ) : openActions.length === 0 ? (
              <EmptyLine text="No open CRM actions." />
            ) : (
              openActions
                .slice(0, 4)
                .map((action) => (
                  <ActionRow
                    key={action.id}
                    action={action}
                    isCompleting={completingActionId === action.id}
                    onCompleteAction={onCompleteAction}
                  />
                ))
            )}
          </Panel>
        </div>
      </div>
    </section>
  );
}

function Panel({
  icon,
  label,
  meta,
  children,
}: {
  icon: ReactNode;
  label: string;
  meta: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-md border border-hairline bg-background px-3 py-3">
      <div className="flex items-center justify-between gap-3 border-b border-hairline pb-2">
        <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {icon}
          {label}
        </div>
        <div className="truncate text-[10px] font-medium text-muted-foreground">{meta}</div>
      </div>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-hairline bg-background px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-xl font-semibold tabular-nums text-foreground">{value}</div>
    </div>
  );
}

function HealthPill({ health }: { health: string }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold capitalize",
        health === "strong" && "border-success/40 bg-success/10 text-success",
        health === "steady" && "border-secondary/40 bg-secondary/15 text-secondary-foreground",
        health === "watch" && "border-warning/40 bg-warning/10 text-warning",
        health === "unknown" && "border-hairline bg-surface text-muted-foreground",
      )}
    >
      {health}
    </span>
  );
}

function ActionRow({
  action,
  isCompleting,
  onCompleteAction,
}: {
  action: PipelineNextActionRow;
  isCompleting: boolean;
  onCompleteAction: (id: string) => void;
}) {
  return (
    <div className="flex items-start gap-2 border-b border-hairline py-2 last:border-0">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="mt-0.5 h-7 w-7 shrink-0"
        disabled={isCompleting}
        onClick={() => onCompleteAction(action.id)}
        title="Complete action"
      >
        <CheckCircle2 className="h-4 w-4" />
      </Button>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 text-sm font-semibold text-foreground">{action.title}</div>
          <span
            className={cn(
              "shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold capitalize",
              action.priority === "high"
                ? "border-danger/40 bg-danger/10 text-danger"
                : action.priority === "normal"
                  ? "border-warning/40 bg-warning/10 text-warning"
                  : "border-hairline bg-surface text-muted-foreground",
            )}
          >
            {action.priority}
          </span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
          <span>{shortDate(action.due_date)}</span>
          {action.contact_name && (
            <>
              <span>·</span>
              <span className="inline-flex items-center gap-1">
                <PhoneCall className="h-3 w-3" />
                {action.contact_name}
              </span>
            </>
          )}
          {(action.opportunity_name || action.account_name) && (
            <>
              <span>·</span>
              <span className="truncate">{action.opportunity_name || action.account_name}</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function LoadingLine() {
  return <div className="py-3 text-sm text-muted-foreground">Loading CRM records…</div>;
}

function EmptyLine({ text }: { text: string }) {
  return <div className="py-3 text-sm text-muted-foreground">{text}</div>;
}
