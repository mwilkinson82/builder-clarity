import { AlertTriangle } from "lucide-react";
import type { Warning } from "@/lib/ior";

export function RiskWarnings({ warnings }: { warnings: Warning[] }) {
  if (warnings.length === 0) {
    return (
      <div className="rounded-lg border border-success/30 bg-success/5 px-5 py-4 text-sm text-success">
        No system-detected risks. Holds and forecast posture are aligned with conservative guidance.
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-hairline bg-card p-5 shadow-card">
      <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
        <span className="inline-block h-px w-6 bg-danger" />
        Risks the system sees
      </div>
      <ul className="mt-4 space-y-3">
        {warnings.map((w) => (
          <li
            key={w.id}
            className={`flex items-start gap-3 rounded-md border px-4 py-3 ${
              w.severity === "high"
                ? "border-danger/40 bg-danger/5"
                : "border-warning/40 bg-warning/5"
            }`}
          >
            <AlertTriangle
              className={`mt-0.5 h-4 w-4 shrink-0 ${
                w.severity === "high" ? "text-danger" : "text-warning"
              }`}
            />
            <div>
              <div className="text-sm font-medium text-foreground">{w.title}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">{w.detail}</div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
