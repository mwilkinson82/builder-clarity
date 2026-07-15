import type { ProductionStatus } from "@/lib/production-analytics";

export function formatNumber(value: number, digits = 1): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: digits });
}

export function formatRate(value: number | null, unit: string | null): string {
  if (value == null || !unit) return "—";
  return `${formatNumber(value, 2)} ${unit}/labor hr`;
}

export function formatIndex(value: number | null): string {
  return value == null ? "—" : value.toFixed(2);
}

export function signedPercent(value: number | null, digits = 1): string {
  if (value == null) return "—";
  const percent = value * 100;
  return `${percent >= 0 ? "+" : ""}${percent.toFixed(digits)}%`;
}

export function formatLaborImpact(value: number | null): string {
  if (value == null) return "—";
  if (Math.abs(value) < 0.05) return "On plan";
  return value > 0
    ? `${formatNumber(value)} hrs lost`
    : `${formatNumber(Math.abs(value))} hrs saved`;
}

export function laborImpactClass(value: number | null): string {
  if (value == null) return "text-muted-foreground";
  if (Math.abs(value) < 0.05) return "text-warning";
  return value > 0 ? "text-danger" : "text-success";
}

export function statusCopy(status: ProductionStatus): string {
  if (status === "ahead") return "Ahead of target";
  if (status === "behind") return "Behind target";
  if (status === "on-pace") return "On target";
  return "Not fully measured";
}

export function statusClass(status: ProductionStatus): string {
  if (status === "ahead") return "text-success";
  if (status === "behind") return "text-danger";
  if (status === "on-pace") return "text-warning";
  return "text-muted-foreground";
}
