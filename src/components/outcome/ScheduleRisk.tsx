import { project } from "./data";
import { AlertTriangle, Clock, PackageSearch, Users } from "lucide-react";

export function ScheduleRisk() {
  const risks = [
    {
      icon: AlertTriangle,
      title: "Critical delayed decisions",
      items: [
        "Appliance package selection (owner) — blocking MEP rough-in",
        "Lighting allowance reconciliation — blocking final electrical layout",
        "Steel railing fabrication release — blocking stair install",
      ],
    },
    {
      icon: PackageSearch,
      title: "Procurement risks",
      items: [
        "Window package — manufacturer slip of 5 weeks",
        "Custom millwork — final shop drawings outstanding",
        "Imported stone — single-source vendor, no slack",
      ],
    },
    {
      icon: Users,
      title: "Trade performance risks",
      items: [
        "Drywall subcontractor — quality + manpower concerns",
        "Electrical — unapproved field changes accumulating",
        "Tile — schedule sensitivity to outstanding selections",
      ],
    },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-hairline bg-hairline md:grid-cols-3">
        <div className="bg-card px-6 py-5">
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Original Completion</div>
          <div className="mt-1 font-serif text-2xl tabular">{project.originalCompletion}</div>
        </div>
        <div className="bg-card px-6 py-5">
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Forecast Completion</div>
          <div className="mt-1 font-serif text-2xl tabular text-accent">{project.forecastCompletion}</div>
        </div>
        <div className="bg-card px-6 py-5">
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Variance</div>
          <div className="mt-1 flex items-center gap-2 font-serif text-2xl tabular text-danger">
            <Clock className="h-5 w-5" /> +{project.scheduleVarianceWeeks} weeks
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {risks.map((r) => (
          <div key={r.title} className="rounded-lg border border-hairline bg-card p-5">
            <div className="mb-3 flex items-center gap-2">
              <div className="rounded-md bg-accent/10 p-1.5 text-accent">
                <r.icon className="h-4 w-4" />
              </div>
              <h4 className="text-sm font-semibold text-foreground">{r.title}</h4>
            </div>
            <ul className="space-y-2 text-sm text-muted-foreground">
              {r.items.map((it) => (
                <li key={it} className="flex gap-2">
                  <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-accent" />
                  <span>{it}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
