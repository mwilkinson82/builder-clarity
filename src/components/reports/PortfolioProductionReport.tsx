import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  Building2,
  Gauge,
  HardHat,
  Minus,
  Target,
  Users,
} from "lucide-react";
import { Bar, CartesianGrid, ComposedChart, Line, ReferenceLine, XAxis, YAxis } from "recharts";

import { Button } from "@/components/ui/button";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Input } from "@/components/ui/input";
import {
  aggregateProductionSeries,
  canonicalProductionUnit,
  inclusiveDateSpan,
  shiftIsoDate,
  summarizeProduction,
  summarizeProductionProjects,
  type PortfolioProductionAnalyticsRow,
  type ProductionGrain,
  type ProductionProjectMeta,
  type ProductionStatus,
} from "@/lib/production-analytics";

type RangePreset = "7" | "30" | "90" | "all" | "custom";
type PerformerLens = "all" | "self-perform" | "subcontractor";

interface PortfolioProductionReportProps {
  projects: ProductionProjectMeta[];
  rows: PortfolioProductionAnalyticsRow[];
  loading?: boolean;
}

const chartConfig = {
  actual: { label: "Actual", color: "var(--muted-foreground)" },
  trend: { label: "Weighted trend", color: "var(--clay)" },
  target: { label: "Target", color: "var(--foreground)" },
  volume: { label: "Labor hours", color: "var(--muted)" },
} satisfies ChartConfig;

const chartMargin = { top: 10, right: 8, left: 0, bottom: 4 };
const actualPoint = { r: 3, fill: "var(--surface)", strokeWidth: 1.5 };

function formatNumber(value: number, digits = 1): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: digits });
}

function formatIndex(value: number | null): string {
  return value == null ? "—" : value.toFixed(2);
}

function signedPercent(value: number | null): string {
  if (value == null) return "—";
  const percent = value * 100;
  return `${percent >= 0 ? "+" : ""}${percent.toFixed(1)}%`;
}

function shortDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function statusClass(status: ProductionStatus): string {
  if (status === "ahead") return "text-success";
  if (status === "behind") return "text-danger";
  if (status === "on-pace") return "text-warning";
  return "text-muted-foreground";
}

function statusLabel(status: ProductionStatus): string {
  if (status === "ahead") return "Ahead";
  if (status === "behind") return "Behind";
  if (status === "on-pace") return "On target";
  return "Needs targets";
}

function portfolioVerdict(
  index: number | null,
  projectsWithEvidence: number,
  behindProjects: number,
): string {
  if (projectsWithEvidence === 0) {
    return "The portfolio does not have production evidence in this view yet.";
  }
  if (index == null) {
    return `${projectsWithEvidence} project${projectsWithEvidence === 1 ? " is" : "s are"} recording production, but target coverage is not ready for a company pace.`;
  }
  if (behindProjects > 0) {
    return `${behindProjects} project${behindProjects === 1 ? " is" : "s are"} behind production target and need attention.`;
  }
  const variance = Math.abs((index - 1) * 100).toFixed(1);
  if (index > 1.05) return `Portfolio production is ${variance}% ahead of target.`;
  if (index < 0.95) return `Portfolio production is ${variance}% behind target.`;
  return "Portfolio production is holding its target pace.";
}

export function PortfolioProductionReport({
  projects,
  rows,
  loading = false,
}: PortfolioProductionReportProps) {
  const latestDate = useMemo(
    () =>
      rows
        .map((row) => row.date)
        .filter(Boolean)
        .sort()
        .at(-1) ?? "",
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
  const [grain, setGrain] = useState<ProductionGrain>("week");
  const [projectId, setProjectId] = useState("all");
  const [manager, setManager] = useState("all");
  const [performerLens, setPerformerLens] = useState<PerformerLens>("all");
  const [unit, setUnit] = useState("all");
  const [customFrom, setCustomFrom] = useState(() => shiftIsoDate(latestDate, -29));
  const [customTo, setCustomTo] = useState(latestDate);

  useEffect(() => {
    if (rangePreset !== "custom") {
      setCustomFrom(shiftIsoDate(latestDate, -29));
      setCustomTo(latestDate);
    }
  }, [latestDate, rangePreset]);

  const managers = useMemo(
    () => [...new Set(projects.map((project) => project.projectManager).filter(Boolean))].sort(),
    [projects],
  );
  const units = useMemo(
    () =>
      [...new Set(rows.map((row) => canonicalProductionUnit(row.unit)))]
        .filter((value) => value !== "UNMEASURED")
        .sort(),
    [rows],
  );

  const range = useMemo(() => {
    if (!latestDate) return { from: "", to: "" };
    if (rangePreset === "all") return { from: earliestDate, to: latestDate };
    if (rangePreset === "custom") {
      return customFrom <= customTo
        ? { from: customFrom, to: customTo }
        : { from: customTo, to: customFrom };
    }
    return { from: shiftIsoDate(latestDate, -(Number(rangePreset) - 1)), to: latestDate };
  }, [rangePreset, earliestDate, latestDate, customFrom, customTo]);

  const filteredProjects = useMemo(
    () =>
      projects.filter(
        (project) =>
          (projectId === "all" || project.id === projectId) &&
          (manager === "all" || project.projectManager === manager),
      ),
    [projects, projectId, manager],
  );
  const filteredProjectIds = useMemo(
    () => new Set(filteredProjects.map((project) => project.id)),
    [filteredProjects],
  );
  const selectedRows = useMemo(
    () =>
      rows.filter(
        (row) =>
          filteredProjectIds.has(row.projectId) &&
          (performerLens === "all" || row.performerType === performerLens) &&
          (unit === "all" || canonicalProductionUnit(row.unit) === unit) &&
          (!range.from || (row.date >= range.from && row.date <= range.to)),
      ),
    [rows, filteredProjectIds, performerLens, unit, range],
  );
  const historyRows = useMemo(
    () =>
      rows.filter(
        (row) =>
          filteredProjectIds.has(row.projectId) &&
          (performerLens === "all" || row.performerType === performerLens) &&
          (unit === "all" || canonicalProductionUnit(row.unit) === unit),
      ),
    [rows, filteredProjectIds, performerLens, unit],
  );

  const periodDays = range.from && range.to ? inclusiveDateSpan(range.from, range.to) : 1;
  const priorRange = useMemo(() => {
    if (!range.from) return { from: "", to: "" };
    const to = shiftIsoDate(range.from, -1);
    return { from: shiftIsoDate(to, -(periodDays - 1)), to };
  }, [range.from, periodDays]);
  const priorRows = useMemo(
    () => historyRows.filter((row) => row.date >= priorRange.from && row.date <= priorRange.to),
    [historyRows, priorRange],
  );

  const summary = useMemo(() => summarizeProduction(selectedRows), [selectedRows]);
  const priorSummary = useMemo(() => summarizeProduction(priorRows), [priorRows]);
  const projectSummaries = useMemo(
    () => summarizeProductionProjects(selectedRows, filteredProjects),
    [selectedRows, filteredProjects],
  );
  const projectsWithEvidence = projectSummaries.filter((project) => project.rowCount > 0).length;
  const projectsBehind = projectSummaries.filter((project) => project.status === "behind").length;
  const projectsWithoutTargets = projectSummaries.filter(
    (project) => project.rowCount > 0 && project.performanceIndex == null,
  ).length;
  const performanceTrend =
    summary.performanceIndex != null && priorSummary.performanceIndex != null
      ? summary.performanceIndex - priorSummary.performanceIndex
      : null;
  const series = useMemo(
    () => aggregateProductionSeries(selectedRows, grain),
    [selectedRows, grain],
  );
  const comparableRate = unit !== "all" && summary.unit != null;
  const chartData = useMemo(
    () =>
      series.map((point) => ({
        label: point.label,
        actual: comparableRate ? point.actualRate : point.performanceIndex,
        trend: comparableRate ? point.trendRate : point.trendPerformanceIndex,
        target: comparableRate ? point.targetRate : 1,
        volume: point.laborHours,
      })),
    [series, comparableRate],
  );

  return (
    <div className="space-y-5">
      <header>
        <div className="eyebrow">Portfolio · Production intelligence</div>
        <h2 className="mt-2 max-w-[40ch] font-serif text-[30px] font-normal leading-[1.15] text-foreground">
          {portfolioVerdict(summary.performanceIndex, projectsWithEvidence, projectsBehind)}
        </h2>
        <p className="mt-2 max-w-4xl text-sm leading-relaxed text-muted-foreground">
          Company pace is weighted by labor-hours and target coverage. Unlike units never get
          averaged together; choose one measure when you want a physical units-per-hour trend.
        </p>
      </header>

      <section className="rounded-xl border border-hairline bg-surface p-4" data-print-hide>
        <div className="grid gap-4 xl:grid-cols-[auto_auto_1fr] xl:items-end">
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
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <label className="grid gap-1">
              <span className="font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
                Project
              </span>
              <select
                value={projectId}
                onChange={(event) => setProjectId(event.target.value)}
                className="h-9 min-w-0 rounded-md border border-input bg-surface px-3 text-sm"
              >
                <option value="all">All projects</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1">
              <span className="font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
                Project manager
              </span>
              <select
                value={manager}
                onChange={(event) => setManager(event.target.value)}
                className="h-9 min-w-0 rounded-md border border-input bg-surface px-3 text-sm"
              >
                <option value="all">All project managers</option>
                {managers.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1">
              <span className="font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
                Crew source
              </span>
              <select
                value={performerLens}
                onChange={(event) => setPerformerLens(event.target.value as PerformerLens)}
                className="h-9 min-w-0 rounded-md border border-input bg-surface px-3 text-sm"
              >
                <option value="all">Self-perform + subs</option>
                <option value="self-perform">Self-perform only</option>
                <option value="subcontractor">Subcontractors only</option>
              </select>
            </label>
            <label className="grid gap-1">
              <span className="font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
                Production measure
              </span>
              <select
                value={unit}
                onChange={(event) => setUnit(event.target.value)}
                className="h-9 min-w-0 rounded-md border border-input bg-surface px-3 text-sm"
              >
                <option value="all">All measures · index</option>
                {units.map((option) => (
                  <option key={option} value={option}>
                    {option} per labor-hour
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-end justify-between gap-3 border-t border-hairline pt-3">
          {rangePreset === "custom" ? (
            <div className="flex flex-wrap items-end gap-3">
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
          ) : (
            <span />
          )}
          <div className="text-right text-xs text-muted-foreground">
            <div className="font-medium text-foreground">
              {range.from ? `${shortDate(range.from)}–${shortDate(range.to)}` : "No field dates"}
            </div>
            <div>{range.from ? `${periodDays} calendar days` : "Waiting for Daily WIP"}</div>
          </div>
        </div>
      </section>

      {loading ? (
        <div className="rounded-xl border border-hairline bg-surface px-5 py-12 text-center text-sm text-muted-foreground">
          Loading portfolio production…
        </div>
      ) : selectedRows.length === 0 ? (
        <div className="rounded-xl border border-hairline bg-surface px-5 py-12 text-center">
          <Activity className="mx-auto h-5 w-5 text-muted-foreground" />
          <h3 className="mt-3 font-serif text-xl text-foreground">
            No production evidence in this portfolio view
          </h3>
          <p className="mx-auto mt-1 max-w-xl text-sm text-muted-foreground">
            Widen the date range or clear a filter. Daily Reports need installed quantity and crew
            hours before OverWatch can plot company production.
          </p>
        </div>
      ) : (
        <>
          <section className="grid gap-4 lg:grid-cols-[1.25fr_1fr]">
            <div className="rounded-xl bg-dark-panel p-5 text-dark-panel-foreground">
              <div className="font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-dark-panel-foreground/50">
                Company production pulse
              </div>
              <div className="mt-4 flex flex-wrap items-end justify-between gap-5">
                <div>
                  <div className="font-serif text-[48px] leading-none tabular-nums">
                    {formatIndex(summary.performanceIndex)}
                  </div>
                  <div className={`mt-2 text-sm font-semibold ${statusClass(summary.status)}`}>
                    {statusLabel(summary.status)}
                    {summary.variancePercent != null
                      ? ` · ${signedPercent(summary.variancePercent)}`
                      : ""}
                  </div>
                  <p className="mt-2 max-w-md text-xs leading-relaxed text-dark-panel-foreground/55">
                    1.00 is target. Every project and unit rolls up through labor-equivalent hours,
                    never through a false average of feet, yards, and counts.
                  </p>
                </div>
                <div className="grid min-w-[270px] grid-cols-2 gap-x-5 gap-y-3 text-xs">
                  <div>
                    <div className="text-dark-panel-foreground/45">Target coverage</div>
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
                          <Minus className="h-4 w-4 text-warning" /> 0.0%
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
                    <div className="text-dark-panel-foreground/45">Hours gained / lost</div>
                    <div
                      className={`mt-0.5 font-serif text-xl tabular-nums ${
                        summary.hoursVariance == null
                          ? ""
                          : summary.hoursVariance > 0
                            ? "text-danger"
                            : "text-success"
                      }`}
                    >
                      {summary.hoursVariance == null
                        ? "—"
                        : `${summary.hoursVariance > 0 ? "+" : ""}${formatNumber(summary.hoursVariance)} hrs`}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {[
                {
                  label: "Projects measured",
                  value: String(projectsWithEvidence),
                  note: `${filteredProjects.length} active in this view`,
                  icon: <Building2 className="h-4 w-4" />,
                },
                {
                  label: "Projects behind",
                  value: String(projectsBehind),
                  note: "Ranked first below",
                  icon: <Gauge className="h-4 w-4" />,
                  danger: projectsBehind > 0,
                },
                {
                  label: "Need target coverage",
                  value: String(projectsWithoutTargets),
                  note: "Production exists; comparison does not",
                  icon: <Target className="h-4 w-4" />,
                },
                {
                  label: "Performers tracked",
                  value: String(new Set(selectedRows.map((row) => row.performerKey)).size),
                  note: "Self-perform and subcontract crews",
                  icon: <Users className="h-4 w-4" />,
                },
              ].map((tile) => (
                <div key={tile.label} className="rounded-xl border border-hairline bg-surface p-4">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    {tile.icon}
                    <span className="font-mono text-[9px] font-bold uppercase tracking-[0.1em]">
                      {tile.label}
                    </span>
                  </div>
                  <div
                    className={`mt-3 font-serif text-[28px] tabular-nums ${tile.danger ? "text-danger" : "text-foreground"}`}
                  >
                    {tile.value}
                  </div>
                  <div className="mt-1 text-[11px] text-muted-foreground">{tile.note}</div>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-xl border border-hairline bg-surface">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-hairline px-5 py-4">
              <div>
                <div className="eyebrow">Company production trend</div>
                <h3 className="mt-1 font-serif text-[22px] font-normal text-foreground">
                  {comparableRate
                    ? `${summary.unit} installed per labor-hour`
                    : "Production index across projects and field measures"}
                </h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Actual points show each {grain}; the clay line is the rolling labor-weighted
                  trend.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <span className="h-0.5 w-5 bg-muted-foreground" /> Actual
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-0.5 w-5 bg-clay" /> Weighted trend
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-0.5 w-5 border-t border-dashed border-foreground" /> Target
                </span>
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
                    {comparableRate ? (
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
                    ) : (
                      <ReferenceLine
                        yAxisId="metric"
                        y={1}
                        stroke="var(--color-target)"
                        strokeDasharray="6 5"
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
                  Set production targets on measured work to plot a company production index.
                </div>
              )}
            </div>
          </section>

          <section className="rounded-xl border border-hairline bg-surface">
            <div className="border-b border-hairline px-5 py-4">
              <div className="eyebrow">Project production ranking</div>
              <h3 className="mt-1 font-serif text-[22px] font-normal text-foreground">
                The jobs losing production pace rise to the top
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Open the project control to see its individual crews, scopes, rates, and daily
                evidence.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] border-collapse text-sm">
                <thead className="border-b border-hairline bg-muted/35">
                  <tr className="font-mono text-[9px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
                    <th className="px-5 py-2.5 text-left">Project</th>
                    <th className="px-4 py-2.5 text-right">Production index</th>
                    <th className="px-4 py-2.5 text-right">Target coverage</th>
                    <th className="px-4 py-2.5 text-right">Hours gained / lost</th>
                    <th className="px-4 py-2.5 text-right">Scopes behind</th>
                    <th className="px-4 py-2.5 text-right">Last field date</th>
                    <th className="px-5 py-2.5 text-right">Drill down</th>
                  </tr>
                </thead>
                <tbody>
                  {projectSummaries.map((project) => (
                    <tr key={project.id} className="border-b border-hairline last:border-0">
                      <td className="px-5 py-4 align-top">
                        <div className="font-semibold text-foreground">{project.name}</div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {[project.jobNumber, project.projectManager].filter(Boolean).join(" · ")}
                        </div>
                        <div className="mt-1 font-mono text-[9px] uppercase tracking-wide text-muted-foreground">
                          {project.loggedDays} field day{project.loggedDays === 1 ? "" : "s"} ·{" "}
                          {project.performerCount} performer
                          {project.performerCount === 1 ? "" : "s"}
                        </div>
                      </td>
                      <td className="px-4 py-4 text-right align-top tabular-nums">
                        <div className="font-serif text-[20px] text-foreground">
                          {formatIndex(project.performanceIndex)}
                        </div>
                        <div
                          className={`mt-1 text-xs font-semibold ${statusClass(project.status)}`}
                        >
                          {project.rowCount > 0 ? statusLabel(project.status) : "No production"}
                        </div>
                      </td>
                      <td className="px-4 py-4 text-right align-top tabular-nums">
                        <div className="font-serif text-[18px] text-foreground">
                          {(project.coveragePercent * 100).toFixed(0)}%
                        </div>
                        <div className="mt-1 text-[10px] text-muted-foreground">
                          {formatNumber(project.coveredLaborHours)} of{" "}
                          {formatNumber(project.laborHours)} hrs
                        </div>
                      </td>
                      <td
                        className={`px-4 py-4 text-right align-top font-serif text-[18px] tabular-nums ${
                          project.hoursVariance == null
                            ? "text-muted-foreground"
                            : project.hoursVariance > 0
                              ? "text-danger"
                              : "text-success"
                        }`}
                      >
                        {project.hoursVariance == null
                          ? "—"
                          : `${project.hoursVariance > 0 ? "+" : ""}${formatNumber(project.hoursVariance)} hrs`}
                      </td>
                      <td className="px-4 py-4 text-right align-top">
                        <div
                          className={`font-serif text-[18px] ${project.scopesBehind > 0 ? "text-danger" : "text-foreground"}`}
                        >
                          {project.scopesBehind}
                        </div>
                      </td>
                      <td className="px-4 py-4 text-right align-top text-xs text-muted-foreground">
                        {shortDate(project.lastFieldDate)}
                      </td>
                      <td className="px-5 py-4 text-right align-top">
                        <Button asChild size="sm" variant="outline" className="gap-1.5">
                          <Link
                            to="/projects/$projectId"
                            params={{ projectId: project.id }}
                            search={{ tab: "daily-wip", wipView: "production" }}
                          >
                            <HardHat className="h-3.5 w-3.5" /> Open production
                          </Link>
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
