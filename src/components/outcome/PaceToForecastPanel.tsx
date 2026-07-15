import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CalendarClock, CheckCircle2, CircleAlert, Gauge, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { CertificationHistoryPanel } from "@/components/outcome/CertificationHistoryPanel";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { DailyWipEntryRow } from "@/lib/daily-wip.functions";
import type { ProductionAnalyticsRow } from "@/lib/production-analytics";
import {
  certifyProductionSovPosition,
  loadProductionForecastContext,
  setProductionTargetBillingDate,
  type ProductionSovCertificationRow,
} from "@/lib/production-forecast.functions";
import {
  buildProductionForecast,
  buildSovCompletionRecommendations,
  type ProductionForecastScope,
  type ProductionForecastStatus,
  type ProductionScopePlan,
  type SovCompletionRecommendation,
} from "@/lib/production-forecast";

interface ForecastBucket {
  id: string;
  cost_code: string;
  bucket: string;
  earned_percent_complete: number;
}

interface PaceToForecastPanelProps {
  projectId: string;
  rows: ProductionAnalyticsRow[];
  plans: ProductionScopePlan[];
  buckets: ForecastBucket[];
  entries: DailyWipEntryRow[];
  periodFrom: string;
  periodTo: string;
}

function shortDate(value: string | null): string {
  if (!value) return "Not set";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function number(value: number | null, digits = 1): string {
  if (value == null) return "—";
  return value.toLocaleString("en-US", { maximumFractionDigits: digits });
}

function rate(value: number | null, unit: string, suffix: string): string {
  return value == null ? "—" : `${number(value, 2)} ${unit}/${suffix}`;
}

function statusLabel(status: ProductionForecastStatus): string {
  if (status === "ahead") return "Ahead of required pace";
  if (status === "on-pace") return "On required pace";
  if (status === "behind") return "Behind required pace";
  if (status === "complete") return "Planned quantity complete";
  if (status === "missing-plan") return "Planned quantity missing";
  if (status === "missing-date") return "Billing target date missing";
  return "Not enough recent field evidence";
}

function statusClass(status: ProductionForecastStatus): string {
  if (status === "ahead" || status === "complete") return "text-success";
  if (status === "on-pace") return "text-warning";
  if (status === "behind") return "text-danger";
  return "text-muted-foreground";
}

function statusDot(status: ProductionForecastStatus): string {
  if (status === "ahead" || status === "complete") return "bg-success";
  if (status === "on-pace") return "bg-warning";
  if (status === "behind") return "bg-danger";
  return "bg-muted-foreground";
}

function PaceStatus({ status }: { status: ProductionForecastStatus }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs font-semibold ${statusClass(status)}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${statusDot(status)}`} aria-hidden="true" />
      {statusLabel(status)}
    </span>
  );
}

function uniqueForecastForBucket(
  forecasts: readonly ProductionForecastScope[],
  costBucketId: string,
): ProductionForecastScope | null {
  const matches = forecasts.filter((forecast) => forecast.costBucketId === costBucketId);
  return matches.length === 1 ? matches[0] : null;
}

export function PaceToForecastPanel({
  projectId,
  rows,
  plans,
  buckets,
  entries,
  periodFrom,
  periodTo,
}: PaceToForecastPanelProps) {
  const queryClient = useQueryClient();
  const loadContext = useServerFn(loadProductionForecastContext);
  const saveTargetDate = useServerFn(setProductionTargetBillingDate);
  const certify = useServerFn(certifyProductionSovPosition);
  const contextQuery = useQuery({
    queryKey: ["production-forecast-context", projectId],
    queryFn: () => loadContext({ data: { projectId } }),
  });
  const [targetDateDraft, setTargetDateDraft] = useState("");
  const [selectedRecommendation, setSelectedRecommendation] =
    useState<SovCompletionRecommendation | null>(null);
  const [certifiedPercent, setCertifiedPercent] = useState(0);
  const [certificationNote, setCertificationNote] = useState("");

  const targetDate = contextQuery.data?.nextBillingDate ?? null;
  const forecasts = useMemo(
    () =>
      buildProductionForecast({
        rows,
        plans,
        periodFrom,
        periodTo,
        targetDate,
      }),
    [rows, plans, periodFrom, periodTo, targetDate],
  );
  const recommendations = useMemo(
    () => buildSovCompletionRecommendations(entries, buckets, periodTo),
    [entries, buckets, periodTo],
  );
  const certifications = contextQuery.data?.certifications;
  const latestCertificationByBucket = useMemo(() => {
    const map = new Map<string, ProductionSovCertificationRow>();
    for (const certification of certifications ?? []) {
      if (!map.has(certification.cost_bucket_id)) {
        map.set(certification.cost_bucket_id, certification);
      }
    }
    return map;
  }, [certifications]);
  const behindCount = forecasts.filter((forecast) => forecast.status === "behind").length;
  const missingCount = forecasts.filter((forecast) =>
    ["missing-plan", "missing-date", "no-evidence"].includes(forecast.status),
  ).length;

  const targetMutation = useMutation({
    mutationFn: (nextTargetDate: string | null) =>
      saveTargetDate({ data: { projectId, targetDate: nextTargetDate } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["production-forecast-context", projectId] });
      setTargetDateDraft("");
      toast.success("Production billing target saved");
    },
    onError: (error) =>
      toast.error("Target date did not save", {
        description: error instanceof Error ? error.message : "Try again.",
      }),
  });

  const certificationMutation = useMutation({
    mutationFn: async (recommendation: SovCompletionRecommendation) => {
      const forecast = uniqueForecastForBucket(forecasts, recommendation.costBucketId);
      return certify({
        data: {
          projectId,
          costBucketId: recommendation.costBucketId,
          sourcePeriodStart: periodFrom,
          sourcePeriodEnd: periodTo,
          certifiedPercent,
          targetDate,
          plannedQuantity: forecast?.plannedQuantity ?? null,
          installedQuantity: forecast?.installedQuantity ?? null,
          unit: forecast?.unit ?? "",
          recentDailyPace: forecast?.recentDailyPace ?? null,
          requiredDailyPace: forecast?.requiredDailyPace ?? null,
          note: certificationNote,
        },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["production-forecast-context", projectId] });
      setSelectedRecommendation(null);
      setCertificationNote("");
      toast.success("SOV position certified", {
        description: "The audit is saved. Billing was not changed.",
      });
    },
    onError: (error) =>
      toast.error("SOV position was not certified", {
        description: error instanceof Error ? error.message : "Try again.",
      }),
  });

  const openCertification = (recommendation: SovCompletionRecommendation) => {
    setSelectedRecommendation(recommendation);
    setCertifiedPercent(recommendation.recommendedPercent);
    setCertificationNote("");
  };

  return (
    <section className="rounded-xl border border-hairline bg-surface">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-hairline px-5 py-4">
        <div>
          <div className="eyebrow">Pace to forecast</div>
          <h2 className="mt-1 font-serif text-[22px] font-normal text-foreground">
            Will the field finish enough work for the next billing target?
          </h2>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            Daily pace uses installed quantity per working day. Crew productivity remains units per
            labor-hour. OverWatch shows both without pretending a missing plan or date is on track.
          </p>
        </div>
        <div className="min-w-[250px] rounded-lg border border-hairline bg-muted/30 p-3">
          <div className="font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
            Next production billing target
          </div>
          <div className="mt-1 font-serif text-xl text-foreground">{shortDate(targetDate)}</div>
          <div className="mt-2 flex gap-2">
            <Input
              type="date"
              aria-label="Next production billing target date"
              value={targetDateDraft || targetDate || ""}
              onChange={(event) => setTargetDateDraft(event.target.value)}
              className="h-8 min-w-0 text-xs"
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8"
              disabled={targetMutation.isPending || !(targetDateDraft || targetDate)}
              onClick={() => targetMutation.mutate(targetDateDraft || targetDate)}
            >
              Save
            </Button>
          </div>
          <p className="mt-1.5 text-[10px] leading-snug text-muted-foreground">
            This is the same planned billing date used by portfolio cash forecasting.
          </p>
        </div>
      </div>

      <div className="grid gap-px border-b border-hairline bg-hairline sm:grid-cols-3">
        <div className="bg-surface px-5 py-4">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Gauge className="h-4 w-4" />
            <span className="font-mono text-[9px] font-bold uppercase tracking-[0.1em]">
              Measured scopes
            </span>
          </div>
          <div className="mt-2 font-serif text-2xl text-foreground">{forecasts.length}</div>
        </div>
        <div className="bg-surface px-5 py-4">
          <div className="flex items-center gap-2 text-muted-foreground">
            <CircleAlert className="h-4 w-4" />
            <span className="font-mono text-[9px] font-bold uppercase tracking-[0.1em]">
              Behind required pace
            </span>
          </div>
          <div
            className={`mt-2 font-serif text-2xl ${behindCount ? "text-danger" : "text-foreground"}`}
          >
            {behindCount}
          </div>
        </div>
        <div className="bg-surface px-5 py-4">
          <div className="flex items-center gap-2 text-muted-foreground">
            <CalendarClock className="h-4 w-4" />
            <span className="font-mono text-[9px] font-bold uppercase tracking-[0.1em]">
              Needs setup or evidence
            </span>
          </div>
          <div className="mt-2 font-serif text-2xl text-foreground">{missingCount}</div>
        </div>
      </div>

      {contextQuery.isLoading ? (
        <div className="px-5 py-10 text-center text-sm text-muted-foreground">
          Loading production forecast…
        </div>
      ) : forecasts.length === 0 ? (
        <div className="px-5 py-10 text-center text-sm text-muted-foreground">
          No measured production scopes are available in this view yet.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1040px] border-collapse text-sm">
            <thead className="border-b border-hairline bg-muted/35">
              <tr className="font-mono text-[9px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
                <th className="px-5 py-2.5 text-left">Performer / scope</th>
                <th className="px-4 py-2.5 text-right">Installed / planned</th>
                <th className="px-4 py-2.5 text-right">Recent field pace</th>
                <th className="px-4 py-2.5 text-right">Required by billing</th>
                <th className="px-5 py-2.5 text-right">Forecast</th>
              </tr>
            </thead>
            <tbody>
              {forecasts.map((forecast) => (
                <tr key={forecast.key} className="border-b border-hairline last:border-0">
                  <td className="px-5 py-4 align-top">
                    <div className="font-semibold text-foreground">{forecast.performerName}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {[forecast.costCode, forecast.scopeName, forecast.unit]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  </td>
                  <td className="px-4 py-4 text-right align-top tabular-nums">
                    <div className="font-semibold text-foreground">
                      {number(forecast.installedQuantity)} / {number(forecast.plannedQuantity)}
                    </div>
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      {forecast.remainingQuantity == null
                        ? "Plan quantity not configured"
                        : `${number(forecast.remainingQuantity)} ${forecast.unit} remaining`}
                    </div>
                  </td>
                  <td className="px-4 py-4 text-right align-top tabular-nums">
                    <div className="font-semibold text-foreground">
                      {rate(forecast.recentDailyPace, forecast.unit, "workday")}
                    </div>
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      {rate(forecast.recentLaborRate, forecast.unit, "labor hr")} ·{" "}
                      {forecast.recentWorkingDays} recent workdays
                    </div>
                  </td>
                  <td className="px-4 py-4 text-right align-top tabular-nums">
                    <div className="font-semibold text-foreground">
                      {rate(forecast.requiredDailyPace, forecast.unit, "workday")}
                    </div>
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      {forecast.workingDaysRemaining == null
                        ? "Set the billing target date"
                        : `${forecast.workingDaysRemaining} working days left`}
                      {forecast.requiredLaborHoursPerDay != null
                        ? ` · ${number(forecast.requiredLaborHoursPerDay)} labor hrs/day at target`
                        : ""}
                    </div>
                  </td>
                  <td className="px-5 py-4 text-right align-top">
                    <PaceStatus status={forecast.status} />
                    {forecast.paceVariancePercent != null ? (
                      <div className={`mt-1 text-[11px] ${statusClass(forecast.status)}`}>
                        {forecast.paceVariancePercent >= 0 ? "+" : ""}
                        {(forecast.paceVariancePercent * 100).toFixed(1)}% vs required
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="border-t border-hairline px-5 py-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="eyebrow">Reviewed WIP → SOV recommendation</div>
            <h3 className="mt-1 font-serif text-xl font-normal text-foreground">
              Certify the billing position; never move it silently
            </h3>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
              Only PM-reviewed, SOV-basis WIP appears here. Certification records the decision and
              any adjustment; it does not create a pay application or edit the billing SOV.
            </p>
          </div>
          {!contextQuery.data?.certificationEnabled ? (
            <span className="rounded-full border border-warning/30 bg-warning/10 px-3 py-1 text-xs font-semibold text-warning">
              Migration required to certify
            </span>
          ) : null}
        </div>

        {recommendations.length === 0 ? (
          <div className="mt-4 rounded-lg border border-dashed border-hairline px-4 py-5 text-sm text-muted-foreground">
            Review and save a cost-coded line in Daily WIP with its completion basis set to SOV.
            Field-only percentages are intentionally excluded.
          </div>
        ) : (
          <div className="mt-4 divide-y divide-hairline rounded-lg border border-hairline">
            {recommendations.map((recommendation) => {
              const latest = latestCertificationByBucket.get(recommendation.costBucketId);
              return (
                <div
                  key={recommendation.costBucketId}
                  className="grid gap-3 px-4 py-3 sm:grid-cols-[1fr_auto_auto] sm:items-center"
                >
                  <div>
                    <div className="font-semibold text-foreground">
                      {[recommendation.costCode, recommendation.scopeName]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      Reviewed field evidence through {shortDate(recommendation.evidenceDate)}
                    </div>
                  </div>
                  <div className="text-left sm:text-right">
                    <div className="font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                      Current SOV → recommendation
                    </div>
                    <div className="mt-1 font-serif text-lg tabular-nums text-foreground">
                      {recommendation.currentSovPercent.toFixed(1)}% →{" "}
                      {recommendation.recommendedPercent.toFixed(1)}%
                    </div>
                    {latest ? (
                      <div className="mt-1 inline-flex items-center gap-1 text-[11px] text-success">
                        <CheckCircle2 className="h-3 w-3" /> Last certified{" "}
                        {latest.certified_percent.toFixed(1)}%
                      </div>
                    ) : null}
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={!contextQuery.data?.certificationEnabled}
                    onClick={() => openCertification(recommendation)}
                  >
                    <ShieldCheck className="h-3.5 w-3.5" /> Certify position
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <CertificationHistoryPanel
        certifications={certifications ?? []}
        buckets={buckets}
        isLoading={contextQuery.isLoading}
      />

      <Dialog
        open={selectedRecommendation != null}
        onOpenChange={(open) => {
          if (!open) setSelectedRecommendation(null);
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[620px]">
          <DialogHeader>
            <div className="eyebrow">PM certification</div>
            <DialogTitle className="font-serif text-2xl font-normal">
              Certify the recommended SOV position
            </DialogTitle>
            <DialogDescription>
              This saves an append-only management record. It does not change billing or create a
              pay application.
            </DialogDescription>
          </DialogHeader>
          {selectedRecommendation ? (
            <div className="space-y-4 py-2">
              <div className="rounded-lg border border-hairline bg-muted/30 p-4">
                <div className="font-semibold text-foreground">
                  {[selectedRecommendation.costCode, selectedRecommendation.scopeName]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
                <div className="mt-2 grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <div className="text-xs text-muted-foreground">Current billing SOV</div>
                    <div className="mt-0.5 font-serif text-xl">
                      {selectedRecommendation.currentSovPercent.toFixed(1)}%
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Reviewed WIP recommends</div>
                    <div className="mt-0.5 font-serif text-xl">
                      {selectedRecommendation.recommendedPercent.toFixed(1)}%
                    </div>
                  </div>
                </div>
              </div>
              <label className="grid gap-1.5">
                <span className="text-sm font-semibold text-foreground">
                  PM-certified completion
                </span>
                <div className="relative">
                  <Input
                    type="number"
                    min="0"
                    max="100"
                    step="0.1"
                    value={certifiedPercent}
                    onChange={(event) => setCertifiedPercent(Number(event.target.value))}
                    className="pr-9"
                  />
                  <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">
                    %
                  </span>
                </div>
              </label>
              <label className="grid gap-1.5">
                <span className="text-sm font-semibold text-foreground">Certification note</span>
                <textarea
                  value={certificationNote}
                  onChange={(event) => setCertificationNote(event.target.value)}
                  rows={4}
                  maxLength={2000}
                  placeholder="Explain any adjustment from the reviewed WIP recommendation."
                  className="min-h-24 rounded-md border border-input bg-surface px-3 py-2 text-sm text-foreground shadow-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </label>
              <div className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs leading-relaxed text-warning">
                After certification, the PM still opens Billing and separately enters the approved
                SOV position. This safeguard is intentional.
              </div>
            </div>
          ) : null}
          <DialogFooter className="sticky bottom-0 border-t border-hairline bg-surface pt-4">
            <Button type="button" variant="ghost" onClick={() => setSelectedRecommendation(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="signal"
              disabled={
                certificationMutation.isPending ||
                certifiedPercent < 0 ||
                certifiedPercent > 100 ||
                !selectedRecommendation
              }
              onClick={() => {
                if (selectedRecommendation) certificationMutation.mutate(selectedRecommendation);
              }}
            >
              {certificationMutation.isPending ? "Certifying…" : "Certify SOV position"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
