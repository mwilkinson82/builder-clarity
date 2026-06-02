import { fmtPct, fmtUSD } from "@/lib/format";
import { Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

type Row = {
  label: string;
  value: number;
  kind?: "header" | "add" | "less" | "total" | "result";
  emphasis?: boolean;
  tooltip?: string;
};

export function OutcomeWaterfall(props: {
  originalContract: number;
  approvedCOs: number;
  pendingCOs: number;
  forecastedFinalContract: number;
  originalCostBudget: number;
  forecastedFinalCost: number;
  forecastedGPBeforeHolds: number;
  exposureHolds: number;
  contingencyHold: number;
  indicatedGP: number;
  indicatedGPpct: number;
}) {
  const max = Math.max(
    props.forecastedFinalContract,
    props.forecastedFinalCost,
    props.originalCostBudget,
    props.originalContract,
  );

  const sections: { title: string; rows: Row[] }[] = [
    {
      title: "Revenue",
      rows: [
        { label: "Original Contract", value: props.originalContract },
        { label: "+ Approved Change Orders", value: props.approvedCOs, kind: "add" },
        { label: "+ Pending Change Orders", value: props.pendingCOs, kind: "add" },
        { label: "Forecasted Final Contract", value: props.forecastedFinalContract, kind: "total" },
      ],
    },
    {
      title: "Cost",
      rows: [
        { label: "Original Cost Budget", value: props.originalCostBudget },
        { label: "Forecasted Final Cost (before holds)", value: props.forecastedFinalCost, kind: "total" },
      ],
    },
    {
      title: "Outcome",
      rows: [
        { label: "Forecasted GP Before Holds", value: props.forecastedGPBeforeHolds, kind: "total" },
        { label: "− Exposure Holds", value: props.exposureHolds, kind: "less", tooltip: "E-Holds: reserved for specific identified risks." },
        { label: "− Contingency Hold", value: props.contingencyHold, kind: "less", tooltip: "C-Hold: reserved for general remaining uncertainty." },
        { label: "Indicated Gross Profit", value: props.indicatedGP, kind: "result", emphasis: true, tooltip: "What we believe we'll actually earn based on current reality." },
      ],
    },
  ];

  return (
    <TooltipProvider delayDuration={150}>
      <div className="space-y-8">
        {sections.map((s) => (
          <div key={s.title}>
            <div className="mb-3 flex items-baseline justify-between border-b border-hairline pb-2">
              <h3 className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                {s.title}
              </h3>
            </div>
            <div className="divide-y divide-hairline">
              {s.rows.map((r) => {
                const pct = (Math.abs(r.value) / max) * 100;
                const isLess = r.kind === "less";
                const isTotal = r.kind === "total";
                const isResult = r.kind === "result";
                return (
                  <div key={r.label} className="grid grid-cols-12 items-center gap-4 py-3">
                    <div className="col-span-5 flex items-center gap-1.5">
                      <span
                        className={`text-sm ${
                          isResult
                            ? "font-serif text-lg text-foreground"
                            : isTotal
                              ? "font-medium text-foreground"
                              : isLess
                                ? "text-muted-foreground"
                                : "text-foreground/85"
                        }`}
                      >
                        {r.label}
                      </span>
                      {r.tooltip && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button className="text-muted-foreground/70 hover:text-foreground">
                              <Info className="h-3 w-3" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-xs">{r.tooltip}</TooltipContent>
                        </Tooltip>
                      )}
                    </div>
                    <div className="col-span-5">
                      <div className="relative h-2 overflow-hidden rounded-full bg-secondary">
                        <div
                          className={`absolute left-0 top-0 h-full rounded-full ${
                            isResult
                              ? "bg-accent"
                              : isLess
                                ? "bg-warning/70"
                                : isTotal
                                  ? "bg-foreground"
                                  : "bg-foreground/40"
                          }`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                    <div
                      className={`col-span-2 text-right tabular ${
                        isResult
                          ? "font-serif text-xl text-foreground"
                          : isTotal
                            ? "font-medium text-foreground"
                            : isLess
                              ? "text-warning"
                              : "text-foreground/85"
                      }`}
                    >
                      {isLess ? `−${fmtUSD(r.value).replace("−", "")}` : fmtUSD(r.value)}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        <div className="flex items-center justify-between rounded-lg border border-hairline bg-surface px-6 py-5">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Indicated GP %
            </div>
            <div className="mt-1 text-sm text-muted-foreground">Realized margin against forecasted final contract</div>
          </div>
          <div className="font-serif text-4xl tabular text-accent">{fmtPct(props.indicatedGPpct)}</div>
        </div>
      </div>
    </TooltipProvider>
  );
}
