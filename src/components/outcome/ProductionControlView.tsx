import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowDownRight,
  ArrowLeft,
  ArrowUpRight,
  BarChart3,
  Gauge,
  HardHat,
  Minus,
  TrendingDown,
  Users,
} from "lucide-react";
import { Bar, CartesianGrid, ComposedChart, Line, ReferenceLine, XAxis, YAxis } from "recharts";

import { Button } from "@/components/ui/button";
import { CpmProgressReviewPanel } from "@/components/outcome/CpmProgressReviewPanel";
import { PaceToForecastPanel } from "@/components/outcome/PaceToForecastPanel";
import {
  LegendSwatch,
  PulseTile,
  ScopeStatus,
  TrendValue,
} from "@/components/outcome/ProductionControlPresenters";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Input } from "@/components/ui/input";
import { fmtUSDCents as fmtUSD } from "@/lib/billing-format";
import type { DailyWipEntryRow } from "@/lib/daily-wip.functions";
import {
  formatIndex,
  formatLaborImpact,
  formatNumber,
  formatRate,
  laborImpactClass,
  signedPercent,
  statusClass,
  statusCopy,
} from "@/lib/production-control-format";
import {
  aggregateProductionSeries,
  inclusiveDateSpan,
  productionScopeKey,
  shiftIsoDate,
  summarizeProduction,
  summarizeProductionScopes,
  type ProductionAnalyticsRow,
  type ProductionGrain,
  type ProductionScopeSummary,
} from "@/lib/production-analytics";
import type { ProductionScopePlan } from "@/lib/production-forecast";

type RangePreset = "7" | "30" | "90" | "all" | "custom";

interface ProductionControlViewProps {
  projectId: string;
  rows: ProductionAnalyticsRow[];
  plans: ProductionScopePlan[];
  buckets: {
    id: string;
    cost_code: string;
    bucket: string;
    earned_percent_complete: number;
  }[];
  entries: DailyWipEntryRow[];
  loading?: boolean;
  onShowDaily: () => void;
}

const chartConfig = {
  actual: { label: "Actual", color: "var(--muted-foreground)" },
  trend: { label: "Weighted trend", color: "var(--clay)" },
  target: { label: "Target", color: "var(--foreground)" },
  volume: { label: "Field volume", color: "var(--muted)" },
} satisfies ChartConfig;

const chartMargin = { top: 10, right: 8, left: 0, bottom: 4 };
const actualPoint = { r: 3, fill: "var(--surface)", strokeWidth: 1.5 };

function localToday(): string {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

function shortDate(value: string): string {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function verdictHeadline(index: number | null, coverage: number): string {
  if (index == null) {
    return "Production is being recorded, but the selected work still needs comparable targets.";
  }
  const variance = Math.abs((index - 1) * 100).toFixed(1);
  const pace =
    index > 1.05 ? `${variance}% ahead` : index < 0.95 ? `${variance}% behind` : "on target";
  return `Production is ${pace} across ${(coverage * 100).toFixed(0)}% of logged labor-hours.`;
}

function performerLabel(row: ProductionAnalyticsRow): string {
  return row.performerType === "self-perform" ? "Self-perform" : row.performerName;
}

function scopeLabel(scope: ProductionScopeSummary): string {
  return [scope.costCode, scope.scopeName, scope.unit].filter(Boolean).join(" · ");
}

export function ProductionControlView({
  projectId,
  rows,
  plans,
  buckets,
  entries,
  loading = false,
  onShowDaily,
}: ProductionControlViewProps) {
  const latestDate = useMemo(
    () =>
      rows
        .map((row) => row.date)
        .filter(Boolean)
        .sort()
        .at(-1) ?? localToday(),
    [rows],
  );
  const earliestDate = useMemo(
    () =>
      rows
        .map((row) => row.date)
        .filter(Boolean)
        .sort()[0] ?? latestDate,
    [rows, latestDate],
  );
  const [rangePreset, setRangePreset] = useState<RangePreset>("30");
  const [grain, setGrain] = useState<ProductionGrain>("day");
  const [performerKey, setPerformerKey] = useState("all");
  const [scopeKey, setScopeKey] = useState("all");
  const [customFrom, setCustomFrom] = useState(() => shiftIsoDate(latestDate, -29));
  const [customTo, setCustomTo] = useState(latestDate);

  useEffect(() => {
    if (rangePreset !== "custom") {
      setCustomFrom(shiftIsoDate(latestDate, -29));
      setCustomTo(latestDate);
    }
  }, [latestDate, rangePreset]);

  const performers = useMemo(() => {
    const map = new Map<string, { key: string; label: string; type: string }>();
    for (const row of rows) {
      map.set(row.performerKey, {
        key: row.performerKey,
        label: performerLabel(row),
        type: row.performerType,
      });
    }
    return [...map.values()].sort((a, b) => {
      if (a.type !== b.type) return a.type === "self-perform" ? -1 : 1;
      return a.label.localeCompare(b.label);
    });
  }, [rows]);

  const performerRows = useMemo(
    () => rows.filter((row) => performerKey === "all" || row.performerKey === performerKey),
    [rows, performerKey],
  );
  const scopeOptions = useMemo(() => summarizeProductionScopes(performerRows), [performerRows]);

  useEffect(() => {
    if (scopeKey === "all") return;
    if (!scopeOptions.some((scope) => scope.key === scopeKey)) setScopeKey("all");
  }, [scopeKey, scopeOptions]);

  const range = useMemo(() => {
    if (rangePreset === "all") return { from: earliestDate, to: latestDate };
    if (rangePreset === "custom") {
      return customFrom <= customTo
        ? { from: customFrom, to: customTo }
        : { from: customTo, to: customFrom };
    }
    const days = Number(rangePreset);
    return { from: shiftIsoDate(latestDate, -(days - 1)), to: latestDate };
  }, [rangePreset, earliestDate, latestDate, customFrom, customTo]);

  const selectedRows = useMemo(
    () =>
      performerRows.filter(
        (row) =>
          (scopeKey === "all" || productionScopeKey(row) === scopeKey) &&
          row.date >= range.from &&
          row.date <= range.to,
      ),
    [performerRows, scopeKey, range],
  );
  const selectedHistory = useMemo(
    () => performerRows.filter((row) => scopeKey === "all" || productionScopeKey(row) === scopeKey),
    [performerRows, scopeKey],
  );
  const periodDays = inclusiveDateSpan(range.from, range.to);
  const priorRange = useMemo(() => {
    const to = shiftIsoDate(range.from, -1);
    return { from: shiftIsoDate(to, -(periodDays - 1)), to };
  }, [range.from, periodDays]);
  const priorRows = useMemo(
    () => selectedHistory.filter((row) => row.date >= priorRange.from && row.date <= priorRange.to),
    [selectedHistory, priorRange],
  );

  const summary = useMemo(() => summarizeProduction(selectedRows), [selectedRows]);
  const priorSummary = useMemo(() => summarizeProduction(priorRows), [priorRows]);
  const scopeSummaries = useMemo(() => summarizeProductionScopes(selectedRows), [selectedRows]);
  const priorScopes = useMemo(
    () => new Map(summarizeProductionScopes(priorRows).map((scope) => [scope.key, scope])),
    [priorRows],
  );
  const series = useMemo(
    () => aggregateProductionSeries(selectedRows, grain),
    [selectedRows, grain],
  );

  const comparableRate = summary.unit != null;
  const chartData = useMemo(
    () =>
      series.map((point) => ({
        label: point.label,
        actual: comparableRate ? point.actualRate : point.performanceIndex,
        trend: comparableRate ? point.trendRate : point.trendPerformanceIndex,
        target: comparableRate ? point.targetRate : 1,
        volume: comparableRate ? point.quantity : point.laborHours,
      })),
    [series, comparableRate],
  );
  const performanceTrend =
    summary.performanceIndex != null && priorSummary.performanceIndex != null
      ? summary.performanceIndex - priorSummary.performanceIndex
      : null;
  const behindCount = scopeSummaries.filter((scope) => scope.status === "behind").length;
  const selectedScope =
    scopeKey === "all" ? null : scopeOptions.find((scope) => scope.key === scopeKey);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-lg border border-hairline bg-surface p-1">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-8 gap-1.5"
            aria-pressed="false"
            onClick={onShowDaily}
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Daily WIP
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="h-8 gap-1.5"
            aria-pressed="true"
          >
            <BarChart3 className="h-3.5 w-3.5" /> Production Control
          </Button>
        </div>
        <span className="text-xs text-muted-foreground">Internal management intelligence</span>
      </div>

      <header>
        <div className="eyebrow">Field · Production control</div>
        <h1 className="mt-2 max-w-[38ch] font-serif text-[30px] font-normal leading-[1.15] text-foreground">
          {verdictHeadline(summary.performanceIndex, summary.coveragePercent)}
        </h1>
        <p className="mt-2 max-w-4xl text-sm leading-relaxed text-muted-foreground">
          Rates are weighted by labor-hours. Different units never get averaged together; mixed
          scopes roll up through earned labor-hours versus actual labor-hours.
        </p>
      </header>

      <section className="rounded-xl border border-hairline bg-surface p-4">
        <div className="grid gap-3 xl:grid-cols-[auto_auto_1fr_auto] xl:items-end">
          <div>
            <div className="font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
              Time period
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {(["7", "30", "90", "all", "custom"] as RangePreset[]).map((preset) => (
                <Button
                  key={preset}
                  type="button"
                  size="sm"
                  variant={rangePreset === preset ? "secondary" : "ghost"}
                  className="h-8 px-3 text-xs"
                  aria-pressed={rangePreset === preset}
                  onClick={() => setRangePreset(preset)}
                >
                  {preset === "all" ? "All" : preset === "custom" ? "Custom" : `${preset}D`}
                </Button>
              ))}
            </div>
          </div>
          <div>
            <div className="font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
              Plot by
            </div>
            <div className="mt-1.5 flex gap-1">
              {(["day", "week", "month"] as ProductionGrain[]).map((option) => (
                <Button
                  key={option}
                  type="button"
                  size="sm"
                  variant={grain === option ? "secondary" : "ghost"}
                  className="h-8 px-3 text-xs capitalize"
                  aria-pressed={grain === option}
                  onClick={() => setGrain(option)}
                >
                  {option}
                </Button>
              ))}
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1">
              <span className="font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
                Performer
              </span>
              <select
                value={performerKey}
                onChange={(event) => {
                  setPerformerKey(event.target.value);
                  setScopeKey("all");
                }}
                className="h-9 rounded-md border border-input bg-surface px-3 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="all">All performers</option>
                {performers.map((performer) => (
                  <option key={performer.key} value={performer.key}>
                    {performer.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1">
              <span className="font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
                Scope / measure
              </span>
              <select
                value={scopeKey}
                onChange={(event) => setScopeKey(event.target.value)}
                className="h-9 min-w-0 rounded-md border border-input bg-surface px-3 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="all">All measured scopes</option>
                {scopeOptions.map((scope) => (
                  <option key={scope.key} value={scope.key}>
                    {scope.performerName} · {scopeLabel(scope)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="text-right text-xs text-muted-foreground">
            <div className="font-medium text-foreground">
              {shortDate(range.from)}–{shortDate(range.to)}
            </div>
            <div>{periodDays} calendar days</div>
          </div>
        </div>
        {rangePreset === "custom" ? (
          <div className="mt-3 flex flex-wrap items-end gap-3 border-t border-hairline pt-3">
            <label className="grid gap-1">
              <span className="text-xs text-muted-foreground">From</span>
              <Input
                type="date"
                value={customFrom}
                onChange={(event) => setCustomFrom(event.target.value)}
              />
            </label>
            <label className="grid gap-1">
              <span className="text-xs text-muted-foreground">Through</span>
              <Input
                type="date"
                value={customTo}
                onChange={(event) => setCustomTo(event.target.value)}
              />
            </label>
          </div>
        ) : null}
      </section>

      {loading ? (
        <div className="rounded-xl border border-hairline bg-surface px-5 py-12 text-center text-sm text-muted-foreground">
          Loading production history…
        </div>
      ) : selectedRows.length === 0 ? (
        <div className="rounded-xl border border-hairline bg-surface px-5 py-12 text-center">
          <Activity className="mx-auto h-5 w-5 text-muted-foreground" />
          <h2 className="mt-3 font-serif text-xl text-foreground">
            No production evidence in this view
          </h2>
          <p className="mx-auto mt-1 max-w-xl text-sm text-muted-foreground">
            Widen the date range or clear a filter. Daily Reports need installed quantity and crew
            hours before OverWatch can plot a production rate.
          </p>
        </div>
      ) : (
        <>
          <section className="grid gap-4 lg:grid-cols-[1.25fr_1fr]">
            <div className="rounded-xl bg-dark-panel p-5 text-dark-panel-foreground">
              <div className="font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-dark-panel-foreground/50">
                Production pulse
              </div>
              <div className="mt-4 flex flex-wrap items-end justify-between gap-5">
                <div>
                  <div className="font-serif text-[48px] leading-none tabular-nums">
                    {formatIndex(summary.performanceIndex)}
                  </div>
                  <div className={`mt-2 text-sm font-semibold ${statusClass(summary.status)}`}>
                    {statusCopy(summary.status)}
                    {summary.variancePercent != null
                      ? ` · ${signedPercent(summary.variancePercent)}`
                      : ""}
                  </div>
                  <p className="mt-2 max-w-md text-xs leading-relaxed text-dark-panel-foreground/55">
                    1.00 is target. The index combines different production units through earned
                    labor-hours, weighted by actual field hours.
                  </p>
                </div>
                <div className="grid min-w-[260px] grid-cols-2 gap-x-5 gap-y-3 text-xs">
                  <div>
                    <div className="text-dark-panel-foreground/45">Coverage</div>
                    <div className="mt-0.5 font-serif text-xl tabular-nums">
                      {(summary.coveragePercent * 100).toFixed(0)}%
                    </div>
                  </div>
                  <div>
                    <div className="text-dark-panel-foreground/45">Vs prior period</div>
                    <div className="mt-0.5 flex items-center gap-1 font-serif text-xl tabular-nums">
                      {performanceTrend == null ? (
                        "—"
                      ) : performanceTrend > 0 ? (
                        <>
                          <ArrowUpRight className="h-4 w-4 text-success" />
                          {signedPercent(performanceTrend)}
                        </>
                      ) : performanceTrend < 0 ? (
                        <>
                          <ArrowDownRight className="h-4 w-4 text-danger" />
                          {signedPercent(performanceTrend)}
                        </>
                      ) : (
                        <>
                          <Minus className="h-4 w-4 text-warning" />
                          0.0%
                        </>
                      )}
                    </div>
                  </div>
                  <div>
                    <div className="text-dark-panel-foreground/45">Actual labor</div>
                    <div className="mt-0.5 font-serif text-xl tabular-nums">
                      {formatNumber(summary.laborHours)} hrs
                    </div>
                  </div>
                  <div>
                    <div className="text-dark-panel-foreground/45">Labor impact</div>
                    <div
                      className={`mt-0.5 font-serif text-xl tabular-nums ${laborImpactClass(summary.hoursVariance)}`}
                    >
                      {formatLaborImpact(summary.hoursVariance)}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <PulseTile
                icon={<Gauge className="h-4 w-4" />}
                label={comparableRate ? "Weighted actual rate" : "Measured scopes"}
                value={
                  comparableRate
                    ? formatRate(summary.actualRate, summary.unit)
                    : String(summary.measuredScopeCount)
                }
                note={
                  comparableRate && summary.targetRate != null
                    ? `Target ${formatRate(summary.targetRate, summary.unit)}`
                    : "Across comparable field measures"
                }
              />
              <PulseTile
                icon={<TrendingDown className="h-4 w-4" />}
                label="Scopes behind"
                value={String(behindCount)}
                note={`${scopeSummaries.length} scope${scopeSummaries.length === 1 ? "" : "s"} in this view`}
                danger={behindCount > 0}
              />
              <PulseTile
                icon={<Users className="h-4 w-4" />}
                label="Target-covered hours"
                value={`${formatNumber(summary.coveredLaborHours)} hrs`}
                note={`${formatNumber(summary.earnedLaborHours)} labor-equivalent hrs earned`}
              />
              <PulseTile
                icon={<HardHat className="h-4 w-4" />}
                label={selectedScope ? "Selected performer" : "Performers tracked"}
                value={
                  selectedScope?.performerName ??
                  String(new Set(selectedRows.map((row) => row.performerKey)).size)
                }
                note={
                  selectedScope ? scopeLabel(selectedScope) : "Self-perform and subcontract crews"
                }
              />
            </div>
          </section>

          <PaceToForecastPanel
            projectId={projectId}
            rows={selectedHistory}
            plans={plans}
            buckets={buckets}
            entries={entries}
            periodFrom={range.from}
            periodTo={range.to}
          />

          <section className="rounded-xl border border-hairline bg-surface">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-hairline px-5 py-4">
              <div>
                <div className="eyebrow">Weighted production trend</div>
                <h2 className="mt-1 font-serif text-[22px] font-normal text-foreground">
                  {comparableRate
                    ? `${summary.unit} installed per labor-hour`
                    : "Production index across unlike field measures"}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Actual points show each {grain}; the clay line is the weighted rolling trend.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
                <LegendSwatch className="bg-muted-foreground" label="Actual" />
                <LegendSwatch className="bg-clay" label="Weighted trend" />
                <LegendSwatch className="border border-foreground bg-transparent" label="Target" />
              </div>
            </div>
            <div className="p-4 sm:p-5">
              {chartData.some((point) => point.actual != null || point.trend != null) ? (
                <ChartContainer config={chartConfig} className="h-[330px] w-full aspect-auto">
                  <ComposedChart data={chartData} margin={chartMargin}>
                    <CartesianGrid vertical={false} strokeDasharray="3 3" />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={28} />
                    <YAxis
                      yAxisId="metric"
                      tickLine={false}
                      axisLine={false}
                      width={48}
                      domain={[0, "auto"]}
                      tickFormatter={(value: number) => value.toFixed(comparableRate ? 1 : 2)}
                    />
                    <YAxis yAxisId="volume" orientation="right" hide />
                    <ChartTooltip content={<ChartTooltipContent indicator="line" />} />
                    <Bar
                      yAxisId="volume"
                      dataKey="volume"
                      fill="var(--color-volume)"
                      fillOpacity={0.75}
                      radius={[3, 3, 0, 0]}
                      maxBarSize={22}
                    />
                    {!comparableRate ? (
                      <ReferenceLine
                        yAxisId="metric"
                        y={1}
                        stroke="var(--color-target)"
                        strokeDasharray="6 5"
                      />
                    ) : (
                      <Line
                        yAxisId="metric"
                        type="monotone"
                        dataKey="target"
                        stroke="var(--color-target)"
                        strokeWidth={1.5}
                        strokeDasharray="6 5"
                        dot={false}
                        connectNulls
                      />
                    )}
                    <Line
                      yAxisId="metric"
                      type="monotone"
                      dataKey="actual"
                      stroke="var(--color-actual)"
                      strokeWidth={1.25}
                      dot={actualPoint}
                      connectNulls={false}
                    />
                    <Line
                      yAxisId="metric"
                      type="monotone"
                      dataKey="trend"
                      stroke="var(--color-trend)"
                      strokeWidth={3}
                      dot={false}
                      connectNulls
                    />
                  </ComposedChart>
                </ChartContainer>
              ) : (
                <div className="flex h-[260px] items-center justify-center text-center text-sm text-muted-foreground">
                  <div className="max-w-md">
                    {comparableRate
                      ? "Add installed quantity and labor-hours to plot this scope's production rate."
                      : "Set target rates on the measured scopes to plot a combined production index."}
                  </div>
                </div>
              )}
            </div>
          </section>

          <section className="rounded-xl border border-hairline bg-surface">
            <div className="border-b border-hairline px-5 py-4">
              <div className="eyebrow">Scope performance ledger</div>
              <h2 className="mt-1 font-serif text-[22px] font-normal text-foreground">
                The work losing pace rises to the top
              </h2>
              <p className="mt-1 max-w-4xl text-sm text-muted-foreground">
                Self-perform rows show observed field cost per unit. Subcontract rows show earned
                buyout value per logged unit—not the subcontractor&apos;s internal wage or cost.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1060px] border-collapse text-sm">
                <thead className="border-b border-hairline bg-muted/35">
                  <tr className="font-mono text-[9px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
                    <th className="px-5 py-2.5 text-left">Performer / scope</th>
                    <th className="px-4 py-2.5 text-right">Installed</th>
                    <th className="px-4 py-2.5 text-right">Actual / target</th>
                    <th className="px-4 py-2.5 text-right">Production index</th>
                    <th className="px-4 py-2.5 text-right">Period trend</th>
                    <th className="px-4 py-2.5 text-right">Labor impact</th>
                    <th className="px-5 py-2.5 text-right">Observed $ / unit</th>
                  </tr>
                </thead>
                <tbody>
                  {scopeSummaries.map((scope) => {
                    const prior = priorScopes.get(scope.key);
                    const trend =
                      scope.performanceIndex != null && prior?.performanceIndex != null
                        ? scope.performanceIndex - prior.performanceIndex
                        : null;
                    return (
                      <tr key={scope.key} className="border-b border-hairline last:border-0">
                        <td className="px-5 py-4 align-top">
                          <div className="flex items-center gap-2 font-semibold text-foreground">
                            {scope.performerType === "self-perform" ? (
                              <Users className="h-3.5 w-3.5 text-clay" />
                            ) : (
                              <HardHat className="h-3.5 w-3.5 text-clay" />
                            )}
                            {scope.performerName}
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {[scope.costCode, scope.scopeName].filter(Boolean).join(" · ")}
                          </div>
                          <div className="mt-1 font-mono text-[9px] uppercase tracking-wide text-muted-foreground">
                            {scope.loggedDays} field day{scope.loggedDays === 1 ? "" : "s"} ·{" "}
                            {scope.unit ?? "unit not set"}
                          </div>
                        </td>
                        <td className="px-4 py-4 text-right align-top tabular-nums">
                          <div className="font-serif text-[18px] text-foreground">
                            {formatNumber(scope.quantity)} {scope.unit ?? ""}
                          </div>
                          <div className="mt-0.5 text-[11px] text-muted-foreground">
                            {formatNumber(scope.laborHours)} labor hrs
                          </div>
                        </td>
                        <td className="px-4 py-4 text-right align-top tabular-nums">
                          <div className="font-medium text-foreground">
                            {formatRate(scope.actualRate, scope.unit)}
                          </div>
                          <div className="mt-0.5 text-[11px] text-muted-foreground">
                            target {formatRate(scope.targetRate, scope.unit)}
                          </div>
                        </td>
                        <td className="px-4 py-4 text-right align-top tabular-nums">
                          <div className="font-serif text-[20px] text-foreground">
                            {formatIndex(scope.performanceIndex)}
                          </div>
                          <div className="mt-1">
                            <ScopeStatus status={scope.status} />
                          </div>
                          <div className="mt-1 text-[10px] text-muted-foreground">
                            {(scope.coveragePercent * 100).toFixed(0)}% hour coverage
                          </div>
                        </td>
                        <td className="px-4 py-4 text-right align-top tabular-nums">
                          <TrendValue value={trend} />
                          <div className="mt-1 text-[10px] text-muted-foreground">
                            vs prior period
                          </div>
                        </td>
                        <td
                          className={`px-4 py-4 text-right align-top font-serif text-[18px] tabular-nums ${laborImpactClass(scope.hoursVariance)}`}
                        >
                          {formatLaborImpact(scope.hoursVariance)}
                        </td>
                        <td className="px-5 py-4 text-right align-top tabular-nums">
                          <div className="font-serif text-[18px] text-foreground">
                            {scope.fieldValuePerUnit == null
                              ? "—"
                              : `${fmtUSD(scope.fieldValuePerUnit)}/${scope.unit}`}
                          </div>
                          <div className="mt-0.5 text-[10px] text-muted-foreground">
                            {scope.performerType === "self-perform"
                              ? "field work cost"
                              : "earned buyout value"}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      <CpmProgressReviewPanel projectId={projectId} />
    </div>
  );
}
