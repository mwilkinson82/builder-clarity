// Small presentational atoms shared by the project route and the billing
// workspace: the section header, the SOV/billing metric tile, the SOV import
// history card, and its mini ledger stat. Extracted verbatim from the project
// route during the PROJECTDECOMP1 split.
import { fmtUSD, formatShortDateTime } from "@/lib/format";
import type { SovImportRow } from "@/lib/projects.functions";

export function WorkspaceHeader({
  title,
  subtitle,
  compact,
}: {
  title: string;
  subtitle: string;
  compact?: boolean;
}) {
  return (
    <div className={compact ? "" : "mb-5"}>
      <h2 className={`font-serif text-foreground ${compact ? "text-3xl" : "text-4xl"}`}>{title}</h2>
      <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{subtitle}</p>
    </div>
  );
}

export function SovMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-h-[72px] flex-col justify-between rounded-md border border-hairline bg-surface px-3 py-2">
      <div className="text-[10px] font-semibold uppercase leading-snug tracking-[0.14em] text-muted-foreground">
        {label}
      </div>
      <div className="pt-2 text-lg font-medium tabular leading-none text-foreground">{value}</div>
    </div>
  );
}

export function SovImportHistory({ imports }: { imports: SovImportRow[] }) {
  const latest = imports[0];
  if (!latest) {
    return (
      <div className="mt-5 rounded-md border border-dashed border-hairline bg-background/60 px-3 py-3 text-sm text-muted-foreground">
        No budget import history yet. After the next import, Overwatch will show the source file,
        mapping confidence, selected budget basis, and warnings here.
      </div>
    );
  }

  const warnings = Array.isArray(latest.warnings)
    ? latest.warnings.filter((warning): warning is string => typeof warning === "string")
    : [];
  const confidenceTone =
    latest.confidence === "high"
      ? "text-success"
      : latest.confidence === "medium"
        ? "text-warning"
        : "text-danger";
  const source = [
    latest.source_name || latest.source_type || "Imported budget",
    latest.source_sheet,
  ]
    .filter(Boolean)
    .join(" / ");

  return (
    <div className="mt-5 rounded-md border border-hairline bg-background">
      <div className="flex flex-col gap-3 border-b border-hairline px-3 py-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Latest budget import
          </div>
          <div className="mt-1 font-medium text-foreground">{source}</div>
          <div className="mt-1 text-xs text-muted-foreground">
            {latest.profile || "Generic spreadsheet"} ·{" "}
            <span className={`font-semibold uppercase ${confidenceTone}`}>{latest.confidence}</span>{" "}
            confidence · {formatShortDateTime(latest.created_at)}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
          <MiniLedgerStat label="Rows" value={String(latest.raw_rows)} />
          <MiniLedgerStat label="Staged" value={String(latest.staged_rows)} />
          <MiniLedgerStat label="Created" value={String(latest.inserted_count)} />
          <MiniLedgerStat label="Updated" value={String(latest.updated_count)} />
        </div>
      </div>
      <div className="grid gap-3 px-3 py-3 md:grid-cols-3">
        <div className="rounded-md border border-hairline bg-surface px-3 py-2">
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Imported budget
          </div>
          <div className="mt-1 text-lg font-medium tabular">{fmtUSD(latest.total_budget)}</div>
        </div>
        <div className="rounded-md border border-hairline bg-surface px-3 py-2">
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Budget basis
          </div>
          <div className="mt-1 text-sm font-medium">
            {latest.selected_budget_label ||
              (latest.selected_budget_column == null
                ? "Not recorded"
                : `Column ${latest.selected_budget_column + 1}`)}
          </div>
        </div>
        <div className="rounded-md border border-hairline bg-surface px-3 py-2">
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Mode
          </div>
          <div className="mt-1 text-sm font-medium capitalize">
            {latest.mode === "append" ? "Merge/update existing" : "Replace all buckets"}
          </div>
        </div>
      </div>
      {warnings.length > 0 && (
        <div className="border-t border-hairline px-3 py-3">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Review flags
          </div>
          <div className="grid gap-2 lg:grid-cols-2">
            {warnings.slice(0, 4).map((warning, index) => (
              <div
                key={`${warning}-${index}`}
                className="rounded-md border border-warning/30 bg-warning/10 px-2.5 py-2 text-xs text-warning"
              >
                {warning}
              </div>
            ))}
          </div>
        </div>
      )}
      {imports.length > 1 && (
        <div className="border-t border-hairline px-3 py-2 text-xs text-muted-foreground">
          {imports.length - 1} previous import{imports.length === 2 ? "" : "s"} retained for audit.
        </div>
      )}
    </div>
  );
}

export function MiniLedgerStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-hairline bg-surface px-2.5 py-2">
      <div className="text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 font-medium tabular text-foreground">{value}</div>
    </div>
  );
}
