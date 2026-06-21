import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Info } from "lucide-react";
import { fmtUSD, fmtPct } from "@/lib/format";

type Kpi = {
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "warn" | "danger" | "accent" | "good";
  tooltip?: string;
};

function ToneBar({ tone }: { tone: Kpi["tone"] }) {
  const map: Record<string, string> = {
    default: "bg-foreground/60",
    accent: "bg-accent",
    warn: "bg-warning",
    danger: "bg-danger",
    good: "bg-success",
  };
  return <span className={`absolute left-0 top-0 h-full w-px ${map[tone ?? "default"]}`} />;
}

export function KpiStrip(props: {
  originalGP: number;
  forecastedGP: number;
  indicatedGP: number;
  indicatedGPpct: number;
  originalGPpct: number;
  gpAtRisk: number;
  exposureHolds: number;
  contingencyHold: number;
  pendingCOs: number;
  scheduleWeeks: number;
}) {
  const items: Kpi[] = [
    { label: "Original GP", value: fmtUSD(props.originalGP), sub: fmtPct(props.originalGPpct) },
    {
      label: "GP At Risk",
      value: fmtUSD(props.gpAtRisk),
      sub: "Original − Indicated",
      tone: "danger",
      tooltip:
        "The amount of margin erosion between the original gross profit and the indicated outcome.",
    },
    {
      label: "Indicated GP",
      value: fmtUSD(props.indicatedGP),
      sub: fmtPct(props.indicatedGPpct),
      tone: "accent",
      tooltip:
        "Forecasted GP before holds, less Exposure Holds and Contingency Hold. Represents the GP we believe we'll actually deliver.",
    },
    { label: "Forecasted GP", value: fmtUSD(props.forecastedGP), sub: "Before holds" },
    {
      label: "Exposure Holds",
      value: fmtUSD(props.exposureHolds),
      sub: "Specific known risks",
      tone: "warn",
      tooltip:
        "E-Holds reserve against specific identified risks (a delayed window package, an overrun allowance, etc.).",
    },
    {
      label: "Contingency Hold",
      value: fmtUSD(props.contingencyHold),
      sub: "General uncertainty",
      tone: "warn",
      tooltip: "C-Hold reserves general remaining uncertainty in the unbought scope.",
    },
    { label: "Pending COs", value: fmtUSD(props.pendingCOs), sub: "Not yet approved" },
    {
      label: "Schedule Variance",
      value: `+${props.scheduleWeeks} wk`,
      sub: "vs. original completion",
      tone: "danger",
    },
  ];

  return (
    <TooltipProvider delayDuration={150}>
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-hairline bg-hairline md:grid-cols-4 xl:grid-cols-8">
        {items.map((k) => (
          <div key={k.label} className="relative bg-card px-5 py-5">
            <ToneBar tone={k.tone} />
            <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              {k.label}
              {k.tooltip && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button className="text-muted-foreground/70 transition-colors hover:text-foreground">
                      <Info className="h-3 w-3" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">{k.tooltip}</TooltipContent>
                </Tooltip>
              )}
            </div>
            <div className="mt-2 font-serif text-2xl leading-none tabular text-foreground">
              {k.value}
            </div>
            {k.sub && <div className="mt-1.5 text-xs text-muted-foreground tabular">{k.sub}</div>}
          </div>
        ))}
      </div>
    </TooltipProvider>
  );
}
