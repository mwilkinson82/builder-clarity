import type { ReactNode } from "react";
import { Minus, TrendingDown, TrendingUp } from "lucide-react";

import type { ProductionStatus } from "@/lib/production-analytics";
import { signedPercent, statusClass, statusCopy } from "@/lib/production-control-format";

function statusDotClass(status: ProductionStatus): string {
  if (status === "ahead") return "bg-success";
  if (status === "behind") return "bg-danger";
  if (status === "on-pace") return "bg-warning";
  return "bg-muted-foreground";
}

export function ScopeStatus({ status }: { status: ProductionStatus }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs font-semibold ${statusClass(status)}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${statusDotClass(status)}`} aria-hidden="true" />
      {statusCopy(status)}
    </span>
  );
}

export function PulseTile({
  icon,
  label,
  value,
  note,
  danger = false,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  note: string;
  danger?: boolean;
}) {
  return (
    <div className="rounded-xl border border-hairline bg-surface p-4">
      <div className="flex items-center gap-2 text-muted-foreground">
        {icon}
        <span className="font-mono text-[9px] font-bold uppercase tracking-[0.1em]">{label}</span>
      </div>
      <div
        className={`mt-3 font-serif text-[22px] leading-tight tabular-nums ${danger ? "text-danger" : "text-foreground"}`}
      >
        {value}
      </div>
      <div className="mt-1 text-[11px] leading-snug text-muted-foreground">{note}</div>
    </div>
  );
}

export function LegendSwatch({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-1.5 w-5 rounded-full ${className}`} aria-hidden="true" />
      {label}
    </span>
  );
}

export function TrendValue({ value }: { value: number | null }) {
  if (value == null) return <span className="text-muted-foreground">—</span>;
  if (value > 0.001) {
    return (
      <span className="inline-flex items-center justify-end gap-1 font-semibold text-success">
        <TrendingUp className="h-3.5 w-3.5" />
        {signedPercent(value)}
      </span>
    );
  }
  if (value < -0.001) {
    return (
      <span className="inline-flex items-center justify-end gap-1 font-semibold text-danger">
        <TrendingDown className="h-3.5 w-3.5" />
        {signedPercent(value)}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center justify-end gap-1 font-semibold text-warning">
      <Minus className="h-3.5 w-3.5" />
      0.0%
    </span>
  );
}
