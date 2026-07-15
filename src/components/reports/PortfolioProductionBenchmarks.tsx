import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { BookOpen, Download, Gauge, HardHat, Layers3, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  canonicalProductionUnit,
  shiftIsoDate,
  summarizeProduction,
  summarizeProductionBenchmarks,
  type PortfolioProductionAnalyticsRow,
  type ProductionBenchmarkConfidence,
  type ProductionPerformerType,
  type ProductionProjectMeta,
} from "@/lib/production-analytics";

type PeriodPreset = "90" | "180" | "365" | "all";
type PerformerLens = "all" | ProductionPerformerType;
type ConfidenceLens = "all" | ProductionBenchmarkConfidence;

interface PortfolioProductionBenchmarksProps {
  projects: ProductionProjectMeta[];
  rows: PortfolioProductionAnalyticsRow[];
  loading?: boolean;
}

const confidenceOrder: ProductionBenchmarkConfidence[] = ["strong", "building", "low"];

function formatNumber(value: number, digits = 1): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: digits });
}

function formatMoney(value: number | null): string {
  if (value == null) return "—";
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: value >= 100 ? 0 : 2,
    maximumFractionDigits: value >= 100 ? 0 : 2,
  });
}

function shortDate(value: string): string {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function confidenceLabel(confidence: ProductionBenchmarkConfidence): string {
  if (confidence === "strong") return "Strong evidence";
  if (confidence === "building") return "Building evidence";
  return "Early evidence";
}

function confidenceClass(confidence: ProductionBenchmarkConfidence): string {
  if (confidence === "strong") return "border-success/25 bg-success/10 text-success";
  if (confidence === "building") return "border-warning/25 bg-warning/10 text-warning";
  return "border-hairline bg-muted text-muted-foreground";
}

function performerLabel(performerType: ProductionPerformerType): string {
  return performerType === "subcontractor" ? "Subcontractor" : "Self-perform";
}

function csvCell(value: string | number | null): string {
  const text = value == null ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function downloadBenchmarkCsv(
  benchmarks: ReturnType<typeof summarizeProductionBenchmarks>,
  periodLabel: string,
): void {
  const header = [
    "Cost code",
    "Scope",
    "Unit",
    "Crew source",
    "Confidence",
    "Projects",
    "Field days",
    "Labor hours",
    "Installed quantity",
    "Observed units per labor-hour",
    "Planning units per labor-hour",
    "Current target",
    "Target coverage",
    "Blended benchmark rate",
    "Modeled labor cost per unit",
    "Observed field or buyout value per unit",
    "Typical people per crew",
    "Typical crew count",
    "Last field date",
    "Period",
  ];
  const lines = benchmarks.map((benchmark) =>
    [
      benchmark.costCode,
      benchmark.scopeName,
      benchmark.unit,
      performerLabel(benchmark.performerType),
      confidenceLabel(benchmark.confidence),
      benchmark.projectCount,
      benchmark.fieldDays,
      benchmark.laborHours,
      benchmark.quantity,
      benchmark.actualRate,
      benchmark.planningRate,
      benchmark.targetRate,
      benchmark.targetCoveragePercent,
      benchmark.blendedLaborRate,
      benchmark.modeledLaborCostPerUnit,
      benchmark.fieldValuePerUnit,
      benchmark.typicalPeoplePerCrew,
      benchmark.typicalCrewCount,
      benchmark.lastFieldDate,
      periodLabel,
    ]
      .map(csvCell)
      .join(","),
  );
  const blob = new Blob([[header.map(csvCell).join(","), ...lines].join("\n")], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "overwatch-production-benchmarks.csv";
  anchor.click();
  URL.revokeObjectURL(url);
}

export function PortfolioProductionBenchmarks({
  projects,
  rows,
  loading = false,
}: PortfolioProductionBenchmarksProps) {
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
  const [period, setPeriod] = useState<PeriodPreset>("365");
  const [performerLens, setPerformerLens] = useState<PerformerLens>("all");
  const [unit, setUnit] = useState("all");
  const [confidence, setConfidence] = useState<ConfidenceLens>("all");
  const [search, setSearch] = useState("");

  const units = useMemo(
    () =>
      [...new Set(rows.map((row) => canonicalProductionUnit(row.unit)))]
        .filter((value) => value !== "UNMEASURED")
        .sort(),
    [rows],
  );
  const from = useMemo(() => {
    if (!latestDate) return "";
    if (period === "all") return earliestDate;
    return shiftIsoDate(latestDate, -(Number(period) - 1));
  }, [earliestDate, latestDate, period]);
  const periodLabel = latestDate ? `${shortDate(from)}–${shortDate(latestDate)}` : "No field dates";
  const selectedRows = useMemo(
    () =>
      rows.filter(
        (row) =>
          (!from || (row.date >= from && row.date <= latestDate)) &&
          (performerLens === "all" || row.performerType === performerLens) &&
          (unit === "all" || canonicalProductionUnit(row.unit) === unit),
      ),
    [rows, from, latestDate, performerLens, unit],
  );
  const benchmarks = useMemo(() => summarizeProductionBenchmarks(selectedRows), [selectedRows]);
  const visibleBenchmarks = useMemo(() => {
    const query = search.trim().toLowerCase();
    return benchmarks.filter(
      (benchmark) =>
        (confidence === "all" || benchmark.confidence === confidence) &&
        (!query ||
          [
            benchmark.costCode,
            benchmark.scopeName,
            benchmark.unit,
            ...benchmark.performerNames,
            ...benchmark.projectNames,
          ]
            .join(" ")
            .toLowerCase()
            .includes(query)),
    );
  }, [benchmarks, confidence, search]);
  const evidence = useMemo(() => summarizeProduction(selectedRows), [selectedRows]);
  const contributingProjects = new Set(selectedRows.map((row) => row.projectId)).size;
  const strongCount = benchmarks.filter((benchmark) => benchmark.confidence === "strong").length;
  const buildingCount = benchmarks.filter(
    (benchmark) => benchmark.confidence === "building",
  ).length;
  const targetReadyCount = benchmarks.filter((benchmark) => benchmark.targetRate != null).length;

  const verdict =
    benchmarks.length === 0
      ? "The company does not have reusable production evidence in this view yet."
      : strongCount > 0
        ? `${strongCount} production benchmark${strongCount === 1 ? " is" : "s are"} ready for planning decisions.`
        : `${benchmarks.length} production benchmark${benchmarks.length === 1 ? " is" : "s are"} building from field evidence.`;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="eyebrow">Portfolio · Production benchmarks</div>
          <h2 className="mt-2 max-w-[38ch] font-serif text-[30px] font-normal leading-[1.15] text-foreground">
            {verdict}
          </h2>
          <p className="mt-2 max-w-4xl text-sm leading-relaxed text-muted-foreground">
            Actual Daily WIP becomes estimating intelligence. OverWatch keeps self-perform and
            subcontract evidence separate and never claims to know a subcontractor&apos;s internal
            wage or labor cost.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          className="gap-2"
          disabled={visibleBenchmarks.length === 0}
          onClick={() => downloadBenchmarkCsv(visibleBenchmarks, periodLabel)}
        >
          <Download className="h-4 w-4" /> Export benchmark CSV
        </Button>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          {
            label: "Benchmark scopes",
            value: String(benchmarks.length),
            note: `${strongCount} strong · ${buildingCount} building`,
            icon: <Layers3 className="h-4 w-4" />,
          },
          {
            label: "Projects contributing",
            value: String(contributingProjects),
            note: `${projects.length} active company projects`,
            icon: <HardHat className="h-4 w-4" />,
          },
          {
            label: "Field evidence",
            value: `${formatNumber(evidence.laborHours, 0)} hrs`,
            note: "Actual labor-hours behind the library",
            icon: <Gauge className="h-4 w-4" />,
          },
          {
            label: "Target-ready scopes",
            value: String(targetReadyCount),
            note: `${benchmarks.length - targetReadyCount} still need a management target`,
            icon: <ShieldCheck className="h-4 w-4" />,
          },
        ].map((tile) => (
          <div key={tile.label} className="rounded-xl border border-hairline bg-surface p-4">
            <div className="flex items-center gap-2 text-muted-foreground">
              {tile.icon}
              <span className="font-mono text-[9px] font-bold uppercase tracking-[0.1em]">
                {tile.label}
              </span>
            </div>
            <div className="mt-3 font-serif text-[28px] tabular-nums text-foreground">
              {tile.value}
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground">{tile.note}</div>
          </div>
        ))}
      </section>

      <section className="rounded-xl bg-dark-panel p-5 text-dark-panel-foreground">
        <div className="flex items-start gap-3">
          <BookOpen className="mt-0.5 h-5 w-5 shrink-0 text-clay" />
          <div>
            <div className="font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-dark-panel-foreground/50">
              How the planning benchmark is built
            </div>
            <p className="mt-2 max-w-5xl text-sm leading-relaxed text-dark-panel-foreground/75">
              Observed rate is total installed quantity divided by actual labor-hours. Planning rate
              uses the slower observed quartile so one exceptional day does not underprice the next
              job. Modeled labor cost divides the GC&apos;s blended benchmark rate by that planning
              rate. Bought value per unit stays separate because a subcontract includes its own
              labor, material, equipment, overhead, and profit.
            </p>
            <div className="mt-3 font-mono text-[10px] uppercase tracking-[0.08em] text-dark-panel-foreground/55">
              Strong = 3+ projects · 10+ field days · 160+ labor-hours
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-hairline bg-surface p-4" data-print-hide>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[1.4fr_repeat(4,minmax(0,1fr))]">
          <label className="grid gap-1">
            <span className="font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
              Search evidence
            </span>
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Cost code, scope, project, or performer"
            />
          </label>
          <label className="grid gap-1">
            <span className="font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
              History
            </span>
            <select
              value={period}
              onChange={(event) => setPeriod(event.target.value as PeriodPreset)}
              className="h-9 min-w-0 rounded-md border border-input bg-surface px-3 text-sm"
            >
              <option value="90">Last 90 days</option>
              <option value="180">Last 6 months</option>
              <option value="365">Last 12 months</option>
              <option value="all">All field history</option>
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
              <option value="all">All units</option>
              {units.map((option) => (
                <option key={option} value={option}>
                  {option} per labor-hour
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1">
            <span className="font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
              Evidence quality
            </span>
            <select
              value={confidence}
              onChange={(event) => setConfidence(event.target.value as ConfidenceLens)}
              className="h-9 min-w-0 rounded-md border border-input bg-surface px-3 text-sm"
            >
              <option value="all">All evidence</option>
              {confidenceOrder.map((option) => (
                <option key={option} value={option}>
                  {confidenceLabel(option)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="mt-3 text-right text-xs text-muted-foreground">{periodLabel}</div>
      </section>

      {loading ? (
        <div className="rounded-xl border border-hairline bg-surface px-5 py-12 text-center text-sm text-muted-foreground">
          Building company benchmarks…
        </div>
      ) : visibleBenchmarks.length === 0 ? (
        <div className="rounded-xl border border-hairline bg-surface px-5 py-12 text-center">
          <BookOpen className="mx-auto h-5 w-5 text-muted-foreground" />
          <h3 className="mt-3 font-serif text-xl text-foreground">
            No matching benchmark evidence
          </h3>
          <p className="mx-auto mt-1 max-w-xl text-sm text-muted-foreground">
            Widen the history window or clear a filter. A benchmark needs installed quantity and
            actual labor-hours from Daily Reports.
          </p>
        </div>
      ) : (
        <section className="rounded-xl border border-hairline bg-surface">
          <div className="border-b border-hairline px-5 py-4">
            <div className="eyebrow">Company production library</div>
            <h3 className="mt-1 font-serif text-[22px] font-normal text-foreground">
              Field evidence for the next estimate and buyout
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Every recommendation remains traceable to the projects, crews, dates, quantities, and
              hours that produced it.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1320px] border-collapse text-sm">
              <thead className="border-b border-hairline bg-muted/35">
                <tr className="font-mono text-[9px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
                  <th className="px-5 py-2.5 text-left">Scope / source</th>
                  <th className="px-4 py-2.5 text-left">Evidence</th>
                  <th className="px-4 py-2.5 text-right">Observed rate</th>
                  <th className="px-4 py-2.5 text-right">Planning rate</th>
                  <th className="px-4 py-2.5 text-right">Current target</th>
                  <th className="px-4 py-2.5 text-right">GC labor model</th>
                  <th className="px-4 py-2.5 text-right">Observed value</th>
                  <th className="px-4 py-2.5 text-right">Typical crew</th>
                  <th className="px-5 py-2.5 text-right">Evidence trail</th>
                </tr>
              </thead>
              <tbody>
                {visibleBenchmarks.map((benchmark) => (
                  <tr key={benchmark.key} className="border-b border-hairline last:border-0">
                    <td className="px-5 py-4 align-top">
                      <div className="font-semibold text-foreground">
                        {benchmark.costCode} · {benchmark.scopeName}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {performerLabel(benchmark.performerType)} · {benchmark.unit}
                      </div>
                      <div className="mt-1 max-w-[260px] truncate text-[10px] text-muted-foreground">
                        {benchmark.performerNames.join(", ")}
                      </div>
                    </td>
                    <td className="px-4 py-4 align-top">
                      <span
                        className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold ${confidenceClass(benchmark.confidence)}`}
                      >
                        {confidenceLabel(benchmark.confidence)}
                      </span>
                      <div className="mt-2 text-xs text-foreground">
                        {benchmark.projectCount} project{benchmark.projectCount === 1 ? "" : "s"} ·{" "}
                        {benchmark.fieldDays} field day{benchmark.fieldDays === 1 ? "" : "s"}
                      </div>
                      <div className="mt-1 text-[10px] text-muted-foreground">
                        {formatNumber(benchmark.laborHours)} labor hrs ·{" "}
                        {formatNumber(benchmark.quantity)} {benchmark.unit}
                      </div>
                    </td>
                    <td className="px-4 py-4 text-right align-top tabular-nums">
                      <div className="font-serif text-[19px] text-foreground">
                        {formatNumber(benchmark.actualRate, 2)}
                      </div>
                      <div className="mt-1 text-[10px] text-muted-foreground">
                        {benchmark.unit}/labor hr
                      </div>
                    </td>
                    <td className="px-4 py-4 text-right align-top tabular-nums">
                      <div className="font-serif text-[19px] text-foreground">
                        {formatNumber(benchmark.planningRate, 2)}
                      </div>
                      <div className="mt-1 text-[10px] text-muted-foreground">
                        slower observed quartile
                      </div>
                    </td>
                    <td className="px-4 py-4 text-right align-top tabular-nums">
                      <div className="font-serif text-[18px] text-foreground">
                        {benchmark.targetRate == null ? "—" : formatNumber(benchmark.targetRate, 2)}
                      </div>
                      <div className="mt-1 text-[10px] text-muted-foreground">
                        {benchmark.targetRate == null
                          ? "Management target needed"
                          : `${(benchmark.targetCoveragePercent * 100).toFixed(0)}% hour coverage`}
                      </div>
                    </td>
                    <td className="px-4 py-4 text-right align-top tabular-nums">
                      <div className="font-serif text-[18px] text-foreground">
                        {benchmark.modeledLaborCostPerUnit == null
                          ? "—"
                          : `${formatMoney(benchmark.modeledLaborCostPerUnit)}/${benchmark.unit}`}
                      </div>
                      <div className="mt-1 text-[10px] text-muted-foreground">
                        {benchmark.blendedLaborRate == null
                          ? "Blended rate needed"
                          : `${formatMoney(benchmark.blendedLaborRate)}/labor hr`}
                      </div>
                    </td>
                    <td className="px-4 py-4 text-right align-top tabular-nums">
                      <div className="font-serif text-[18px] text-foreground">
                        {benchmark.fieldValuePerUnit == null
                          ? "—"
                          : `${formatMoney(benchmark.fieldValuePerUnit)}/${benchmark.unit}`}
                      </div>
                      <div className="mt-1 max-w-[150px] text-[10px] text-muted-foreground">
                        {benchmark.performerType === "subcontractor"
                          ? "Earned buyout value per installed unit"
                          : "Observed field cost per installed unit"}
                      </div>
                    </td>
                    <td className="px-4 py-4 text-right align-top tabular-nums">
                      <div className="font-serif text-[18px] text-foreground">
                        {benchmark.typicalPeoplePerCrew == null
                          ? "—"
                          : `${formatNumber(benchmark.typicalPeoplePerCrew, 1)} people`}
                      </div>
                      <div className="mt-1 text-[10px] text-muted-foreground">
                        {benchmark.typicalCrewCount == null
                          ? "Crew count not logged"
                          : `${formatNumber(benchmark.typicalCrewCount, 1)} crews observed`}
                      </div>
                    </td>
                    <td className="px-5 py-4 text-right align-top">
                      <div className="text-xs text-muted-foreground">
                        Last {shortDate(benchmark.lastFieldDate)}
                      </div>
                      <div className="mt-1 max-w-[180px] truncate text-[10px] text-muted-foreground">
                        {benchmark.projectNames.join(", ")}
                      </div>
                      <Button asChild size="sm" variant="outline" className="mt-2 gap-1.5">
                        <Link
                          to="/projects/$projectId"
                          params={{ projectId: benchmark.lastProjectId }}
                          search={{ tab: "daily-wip", wipView: "production" }}
                        >
                          <HardHat className="h-3.5 w-3.5" /> Open evidence
                        </Link>
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
