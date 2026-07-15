import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  ClipboardCheck,
  FileSearch,
  ScanText,
  ShieldCheck,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getPlanScopeCoverage } from "@/lib/plan-room-measurement-assistant.functions";
import type { MeasurementScopeQueueItem } from "@/lib/plan-room-measurement-scope";
import {
  measurementScopeStatusLabel,
  measurementSuggestionKey,
} from "@/lib/plan-room-measurement-scope";
import type { PlanSetRow, PlanSheetRow } from "@/lib/plan-room.functions";
import {
  planScopeCoverageDiscipline,
  type PlanScopeCoverageRecord,
} from "@/lib/plan-scope-coverage";

type CoverageFilter = "all" | "unreviewed" | "cited" | "decided";

const reviewedDate = (value: string) => {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Review recorded";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
};

export function PlanScopeCoverageMatrix({
  estimateId,
  planSet,
  sheets,
  queueItems,
  reviewingSheetId,
  onReviewSheet,
  onOpenRecord,
}: {
  estimateId: string;
  planSet: PlanSetRow | null;
  sheets: PlanSheetRow[];
  queueItems: MeasurementScopeQueueItem[];
  reviewingSheetId: string;
  onReviewSheet: (sheetId: string) => void;
  onOpenRecord: (record: PlanScopeCoverageRecord) => void;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<CoverageFilter>("all");
  const getCoverageFn = useServerFn(getPlanScopeCoverage);
  const coverageQuery = useQuery({
    queryKey: ["plan-scope-coverage", estimateId],
    queryFn: () => getCoverageFn({ data: { estimate_id: estimateId } }),
    enabled: Boolean(planSet?.id),
  });
  const setSheets = useMemo(
    () =>
      sheets
        .filter((sheet) => sheet.plan_set_id === planSet?.id)
        .sort((left, right) => left.sort_order - right.sort_order),
    [planSet?.id, sheets],
  );
  const sheetIds = useMemo(() => new Set(setSheets.map((sheet) => sheet.id)), [setSheets]);
  const records = useMemo(
    () => (coverageQuery.data?.records ?? []).filter((record) => sheetIds.has(record.sheet_id)),
    [coverageQuery.data?.records, sheetIds],
  );
  const recordBySheet = useMemo(
    () => new Map(records.map((record) => [record.sheet_id, record])),
    [records],
  );
  const queueItemBySuggestion = useMemo(() => {
    const items = new Map<string, MeasurementScopeQueueItem>();
    for (const item of queueItems) {
      if (!sheetIds.has(item.plan_sheet_id)) continue;
      items.set(`${item.plan_sheet_id}:${item.suggestion_key}`, item);
    }
    return items;
  }, [queueItems, sheetIds]);
  const setQueueItems = useMemo(
    () => queueItems.filter((item) => sheetIds.has(item.plan_sheet_id)),
    [queueItems, sheetIds],
  );
  const citedCount = records.reduce((sum, record) => sum + record.plan.suggestions.length, 0);
  const rows = useMemo(
    () =>
      setSheets
        .map((sheet) => {
          const record = recordBySheet.get(sheet.id) ?? null;
          const decisions = record
            ? record.plan.suggestions
                .map((suggestion) =>
                  queueItemBySuggestion.get(
                    `${sheet.id}:${measurementSuggestionKey(sheet.id, suggestion)}`,
                  ),
                )
                .filter((item): item is MeasurementScopeQueueItem => Boolean(item))
            : [];
          return { sheet, record, decisions };
        })
        .filter((row) => {
          if (filter === "unreviewed") return !row.record;
          if (filter === "cited") return Boolean(row.record?.plan.suggestions.length);
          if (filter === "decided") return row.decisions.length > 0;
          return true;
        }),
    [filter, queueItemBySuggestion, recordBySheet, setSheets],
  );
  const groupedRows = useMemo(() => {
    const groups = new Map<string, typeof rows>();
    for (const row of rows) {
      const discipline = planScopeCoverageDiscipline(row.sheet);
      const current = groups.get(discipline) ?? [];
      current.push(row);
      groups.set(discipline, current);
    }
    return [...groups.entries()];
  }, [rows]);

  const reviewSheet = (sheetId: string) => {
    setOpen(false);
    onReviewSheet(sheetId);
  };
  const openRecord = (record: PlanScopeCoverageRecord) => {
    setOpen(false);
    onOpenRecord(record);
  };

  return (
    <>
      <section
        className="rounded-lg border border-hairline bg-card p-4 shadow-card"
        data-testid="plan-scope-coverage-launcher"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="eyebrow flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5" /> AI scope coverage
            </div>
            <h2 className="mt-1 font-serif text-xl">Plan-set review matrix</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              See which sheets have cited note reviews. Unreviewed does not mean missing scope.
            </p>
          </div>
          <Badge variant="outline">
            {records.length}/{setSheets.length} reviewed
          </Badge>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
          <div className="border-r border-hairline px-1">
            <p className="font-serif text-lg text-foreground">{citedCount}</p>
            <p className="text-[10px] text-muted-foreground">cited candidates</p>
          </div>
          <div className="border-r border-hairline px-1">
            <p className="font-serif text-lg text-foreground">{setQueueItems.length}</p>
            <p className="text-[10px] text-muted-foreground">decisions</p>
          </div>
          <div className="px-1">
            <p className="font-serif text-lg text-foreground">
              {Math.max(0, setSheets.length - records.length)}
            </p>
            <p className="text-[10px] text-muted-foreground">not reviewed</p>
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          className="mt-3 w-full gap-1.5"
          onClick={() => setOpen(true)}
          disabled={!planSet || setSheets.length === 0}
        >
          <ClipboardCheck className="h-4 w-4" /> Open scope coverage
        </Button>
      </section>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[88vh] max-w-6xl overflow-hidden p-0">
          <DialogHeader className="border-b border-hairline px-6 py-5">
            <div className="eyebrow flex items-center gap-1.5">
              <FileSearch className="h-3.5 w-3.5" /> Estimator-controlled plan review
            </div>
            <DialogTitle className="font-serif text-2xl">Scope Coverage Matrix</DialogTitle>
            <DialogDescription>
              {planSet?.name || planSet?.source_file_name || "Current drawing set"}. AI has not
              taken off this set. Each reviewed row shows only note text that survived the evidence
              gate; the estimator still decides whether it belongs in the estimate.
            </DialogDescription>
          </DialogHeader>

          <div className="overflow-y-auto px-6 py-5">
            <div className="grid gap-px overflow-hidden rounded-lg border border-hairline bg-hairline sm:grid-cols-4">
              {[
                ["Reviewed", `${records.length} / ${setSheets.length}`],
                ["Needs review", String(Math.max(0, setSheets.length - records.length))],
                ["Cited candidates", String(citedCount)],
                ["Estimator decisions", String(setQueueItems.length)],
              ].map(([label, value]) => (
                <div key={label} className="bg-card px-4 py-3">
                  <p className="eyebrow">{label}</p>
                  <p className="mt-1 font-serif text-2xl text-foreground">{value}</p>
                </div>
              ))}
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-b border-hairline pb-3">
              <div className="flex flex-wrap gap-1.5" aria-label="Scope coverage filters">
                {(
                  [
                    ["all", `All ${setSheets.length}`],
                    [
                      "unreviewed",
                      `Needs review ${Math.max(0, setSheets.length - records.length)}`,
                    ],
                    [
                      "cited",
                      `Cited ${records.filter((record) => record.plan.suggestions.length > 0).length}`,
                    ],
                    ["decided", `Decided ${setQueueItems.length}`],
                  ] as Array<[CoverageFilter, string]>
                ).map(([value, label]) => (
                  <Button
                    key={value}
                    type="button"
                    size="sm"
                    variant={filter === value ? "secondary" : "ghost"}
                    className="h-8 text-xs"
                    onClick={() => setFilter(value)}
                  >
                    {label}
                  </Button>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground">
                One selected sheet review = 1 credit. Platform admins are unmetered.
              </p>
            </div>

            {!coverageQuery.data?.ready && !coverageQuery.isLoading ? (
              <div className="mt-4 rounded-md border border-dashed border-hairline p-4 text-sm text-muted-foreground">
                AI review history is not available yet. Manual takeoff remains available.
              </div>
            ) : coverageQuery.isLoading ? (
              <div className="mt-4 rounded-md border border-dashed border-hairline p-4 text-sm text-muted-foreground">
                Loading cited sheet-review history…
              </div>
            ) : groupedRows.length === 0 ? (
              <div className="mt-4 rounded-md border border-dashed border-hairline p-4 text-sm text-muted-foreground">
                No sheets match this coverage filter.
              </div>
            ) : (
              <div className="mt-4 space-y-5" data-testid="plan-scope-coverage-matrix">
                {groupedRows.map(([discipline, disciplineRows]) => (
                  <section key={discipline}>
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <h3 className="font-serif text-lg">{discipline}</h3>
                      <Badge variant="outline">{disciplineRows.length} sheets</Badge>
                    </div>
                    <div className="divide-y divide-hairline overflow-hidden rounded-lg border border-hairline">
                      {disciplineRows.map(({ sheet, record, decisions }) => (
                        <div
                          key={sheet.id}
                          className="grid gap-3 bg-card px-4 py-3 lg:grid-cols-[150px_minmax(0,1fr)_150px_150px] lg:items-start"
                        >
                          <div>
                            <p className="text-sm font-medium text-foreground">
                              {sheet.sheet_number || `Page ${sheet.page_number}`}
                            </p>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              {sheet.sheet_name || "Unnamed sheet"}
                            </p>
                            {record && (
                              <p className="mt-1 text-[10px] text-muted-foreground">
                                {record.source_line_count} lines ·{" "}
                                {reviewedDate(record.reviewed_at)}
                              </p>
                            )}
                          </div>

                          <div>
                            {!record ? (
                              <p className="text-xs text-muted-foreground">
                                Not reviewed. This is a coverage gap, not a claim that the sheet has
                                no estimating scope.
                              </p>
                            ) : record.plan.suggestions.length === 0 ? (
                              <div className="flex items-start gap-2 text-xs text-muted-foreground">
                                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
                                <span>
                                  Reviewed; no sufficiently supported LF/SF note candidate was
                                  retained. Manual visual review is still required.
                                </span>
                              </div>
                            ) : (
                              <div className="space-y-2">
                                {record.plan.suggestions.slice(0, 3).map((suggestion) => {
                                  const decision = queueItemBySuggestion.get(
                                    `${sheet.id}:${measurementSuggestionKey(sheet.id, suggestion)}`,
                                  );
                                  return (
                                    <div key={suggestion.id} className="text-xs">
                                      <div className="flex flex-wrap items-center gap-1.5">
                                        <span className="font-medium text-foreground">
                                          {suggestion.label}
                                        </span>
                                        <Badge variant="outline">{suggestion.unit}</Badge>
                                        {decision && (
                                          <Badge variant="secondary">
                                            {measurementScopeStatusLabel(decision.status)}
                                          </Badge>
                                        )}
                                      </div>
                                      <p className="mt-1 text-[11px] text-muted-foreground">
                                        {suggestion.source_line} · “{suggestion.source_excerpt}”
                                      </p>
                                    </div>
                                  );
                                })}
                                {record.plan.suggestions.length > 3 && (
                                  <p className="text-[11px] text-muted-foreground">
                                    +{record.plan.suggestions.length - 3} more cited candidates
                                  </p>
                                )}
                              </div>
                            )}
                          </div>

                          <div>
                            <p className="eyebrow">Disposition</p>
                            <p className="mt-1 text-xs text-foreground">
                              {decisions.length > 0
                                ? `${decisions.length} estimator decision${decisions.length === 1 ? "" : "s"}`
                                : record
                                  ? "Awaiting estimator"
                                  : "Not available"}
                            </p>
                          </div>

                          <div className="flex justify-start lg:justify-end">
                            {record ? (
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="gap-1.5"
                                onClick={() => openRecord(record)}
                              >
                                Open cited review <ArrowRight className="h-3.5 w-3.5" />
                              </Button>
                            ) : (
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="gap-1.5"
                                disabled={Boolean(reviewingSheetId)}
                                onClick={() => reviewSheet(sheet.id)}
                              >
                                <ScanText className="h-3.5 w-3.5" />
                                {reviewingSheetId === sheet.id
                                  ? "Reviewing…"
                                  : "Review notes · 1 credit"}
                              </Button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
