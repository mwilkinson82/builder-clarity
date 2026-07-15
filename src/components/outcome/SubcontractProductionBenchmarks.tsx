import { fmtUSDCents as fmtUSD } from "@/lib/billing-format";
import {
  subcontractProductionBenchmarks,
  type ProductionBucketLike,
  type ProductionBenchmarkSetting,
  type SubcontractProductionEntry,
} from "@/lib/subcontract-production";

interface SubcontractProductionBenchmarksProps {
  entries: readonly SubcontractProductionEntry[];
  buckets: readonly ProductionBucketLike[];
  commitments: ReadonlyMap<string, number>;
  subcontractorNames: ReadonlyMap<string, string>;
  settings: ReadonlyMap<string, ProductionBenchmarkSetting>;
}

const quantity = (value: number, unit: string) =>
  `${value.toLocaleString("en-US", { maximumFractionDigits: 1 })} ${unit}`;

const rate = (value: number, unit: string) =>
  `${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${unit}/labor hr`;

function alignmentCopy(
  status: ReturnType<typeof subcontractProductionBenchmarks>[number]["alignmentStatus"],
  variancePercent: number | null,
) {
  if (status === "aligned") return "Quantity and certified progress align";
  if (status === "above-progress") {
    return `${Math.abs((variancePercent ?? 0) * 100).toFixed(0)}% more quantity than certified progress`;
  }
  if (status === "below-progress") {
    return `${Math.abs((variancePercent ?? 0) * 100).toFixed(0)}% less quantity than certified progress`;
  }
  return "Add planned SOV units and certified progress to reconcile";
}

function alignmentClass(
  status: ReturnType<typeof subcontractProductionBenchmarks>[number]["alignmentStatus"],
) {
  if (status === "aligned") return "text-success";
  if (status === "unmeasured") return "text-muted-foreground";
  return "text-warning";
}

function paceCopy(
  status: ReturnType<typeof subcontractProductionBenchmarks>[number]["paceStatus"],
  variancePercent: number | null,
) {
  if (status == null) return "No production target set";
  const variance = Math.abs((variancePercent ?? 0) * 100).toFixed(1);
  if (status === "ahead") return `${variance}% ahead of target`;
  if (status === "behind") return `${variance}% behind target`;
  return "On target";
}

function paceClass(
  status: ReturnType<typeof subcontractProductionBenchmarks>[number]["paceStatus"],
) {
  if (status === "ahead") return "text-success";
  if (status === "behind") return "text-danger";
  if (status === "on-pace") return "text-warning";
  return "text-muted-foreground";
}

export function SubcontractProductionBenchmarks({
  entries,
  buckets,
  commitments,
  subcontractorNames,
  settings,
}: SubcontractProductionBenchmarksProps) {
  const benchmarks = subcontractProductionBenchmarks(entries, buckets, commitments, settings);
  if (benchmarks.length === 0) return null;

  return (
    <section className="rounded-xl border border-hairline bg-surface">
      <div className="border-b border-hairline px-5 py-4">
        <div className="eyebrow">Subcontract production history</div>
        <div className="mt-1 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="font-serif text-[22px] font-normal text-foreground">
              Purchased cost and field production, in one benchmark
            </h2>
            <p className="mt-1 max-w-4xl text-sm text-muted-foreground">
              Buyout $/unit comes from the executed commitment and planned SOV quantity. Field
              $/logged unit compares earned subcontract cost with quantities recorded in Daily
              Reports. This measures the GC&apos;s purchased cost and field pace—not the
              subcontractor&apos;s internal labor cost.
            </p>
          </div>
          <span className="rounded-md bg-muted px-2 py-1 font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
            {benchmarks.length} measured scope{benchmarks.length === 1 ? "" : "s"}
          </span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[1120px] border-collapse text-sm">
          <thead className="border-b border-hairline bg-muted/40">
            <tr className="font-mono text-[9px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
              <th className="px-5 py-2.5 text-left">Sub / scope</th>
              <th className="px-4 py-2.5 text-right">Buyout benchmark</th>
              <th className="px-4 py-2.5 text-right">Labor-equivalent plan</th>
              <th className="px-4 py-2.5 text-right">Field evidence</th>
              <th className="px-4 py-2.5 text-right">Production pace</th>
              <th className="px-5 py-2.5 text-left">Management check</th>
            </tr>
          </thead>
          <tbody>
            {benchmarks.map((benchmark) => {
              const subName = subcontractorNames.get(benchmark.subcontractorId) ?? "Subcontractor";
              return (
                <tr key={benchmark.key} className="border-b border-hairline last:border-0">
                  <td className="px-5 py-4 align-top">
                    <div className="font-semibold text-foreground">{subName}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {[benchmark.costCode, benchmark.scope].filter(Boolean).join(" · ")}
                    </div>
                    <div className="mt-1 font-mono text-[9px] uppercase tracking-wide text-muted-foreground">
                      {benchmark.loggedDays} field day{benchmark.loggedDays === 1 ? "" : "s"} ·{" "}
                      {benchmark.latestPercent}% certified
                    </div>
                  </td>
                  <td className="px-4 py-4 text-right align-top tabular-nums">
                    {benchmark.laborEquivalentHours != null && benchmark.targetRate != null ? (
                      <>
                        <div className="font-serif text-[19px] text-foreground">
                          {benchmark.laborEquivalentHours.toLocaleString("en-US", {
                            maximumFractionDigits: 1,
                          })}{" "}
                          labor hrs
                        </div>
                        <div className="mt-0.5 text-[11px] text-muted-foreground">
                          {fmtUSD(benchmark.commitment)} ÷{" "}
                          {fmtUSD(benchmark.benchmarkLaborRate ?? 0)}/hr
                        </div>
                        <div className="mt-1 text-[11px] font-semibold text-success">
                          requires {rate(benchmark.targetRate, benchmark.unit)}
                        </div>
                      </>
                    ) : (
                      <div className="text-muted-foreground">
                        Set planned units and a GC loaded labor benchmark on the buyout allocation
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-4 text-right align-top tabular-nums">
                    {benchmark.buyoutUnitCost != null ? (
                      <>
                        <div className="font-serif text-[19px] text-foreground">
                          {fmtUSD(benchmark.buyoutUnitCost)}/{benchmark.unit}
                        </div>
                        <div className="mt-0.5 text-[11px] text-muted-foreground">
                          {fmtUSD(benchmark.commitment)} ÷{" "}
                          {quantity(benchmark.plannedQuantity ?? 0, benchmark.unit)}
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="text-muted-foreground">Not comparable yet</div>
                        <div className="mt-0.5 max-w-[220px] text-[11px] text-muted-foreground">
                          {benchmark.sharedSovLine
                            ? "More than one sub shares this SOV line. Split the planned quantity by scope."
                            : benchmark.mixedUnits
                              ? "Daily Report units do not match the SOV unit."
                              : "Set contract quantity and unit on the SOV line."}
                        </div>
                      </>
                    )}
                  </td>
                  <td className="px-4 py-4 text-right align-top tabular-nums">
                    <div className="font-serif text-[19px] text-foreground">
                      {quantity(benchmark.installedQuantity, benchmark.unit)}
                    </div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">
                      {benchmark.earnedCostPerLoggedUnit != null
                        ? `${fmtUSD(benchmark.earnedCostPerLoggedUnit)}/${benchmark.unit} field $/logged unit`
                        : "Log installed quantity to calculate $/unit"}
                    </div>
                    {benchmark.benchmarkLaborCostPerActualUnit != null ? (
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        {fmtUSD(benchmark.benchmarkLaborCostPerActualUnit)}/{benchmark.unit} at the
                        GC benchmark rate
                      </div>
                    ) : null}
                  </td>
                  <td className="px-4 py-4 text-right align-top tabular-nums">
                    {benchmark.actualRate != null ? (
                      <>
                        <div className="font-serif text-[19px] text-foreground">
                          {rate(benchmark.actualRate, benchmark.unit)}
                        </div>
                        <div
                          className={`mt-0.5 text-[11px] font-medium ${paceClass(benchmark.paceStatus)}`}
                        >
                          {paceCopy(benchmark.paceStatus, benchmark.paceVariancePercent)}
                          {benchmark.targetRate != null
                            ? ` · ${benchmark.targetSource === "derived" ? "derived target" : "target"} ${benchmark.targetRate.toFixed(2)}`
                            : ""}
                        </div>
                      </>
                    ) : (
                      <div className="text-muted-foreground">
                        Log crew size, hours, and quantity
                      </div>
                    )}
                  </td>
                  <td className="px-5 py-4 align-top">
                    <div
                      className={`text-xs font-semibold ${alignmentClass(benchmark.alignmentStatus)}`}
                    >
                      {alignmentCopy(benchmark.alignmentStatus, benchmark.quantityVariancePercent)}
                    </div>
                    {benchmark.expectedInstalledQuantity != null ? (
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        {benchmark.latestPercent}% of plan implies{" "}
                        {quantity(benchmark.expectedInstalledQuantity, benchmark.unit)}; field
                        logged {quantity(benchmark.installedQuantity, benchmark.unit)}.
                      </div>
                    ) : null}
                    {benchmark.allInCarryPerObservedHour != null ? (
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        Buyout carry at observed pace: {fmtUSD(benchmark.allInCarryPerObservedHour)}
                        /observed labor hr. This is not the sub&apos;s wage.
                      </div>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
