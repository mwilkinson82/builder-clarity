import { Button } from "@/components/ui/button";

export type CommandCenterToolsView = "ai" | "measure" | "review" | "worksheet";

const TOOLS_VIEWS: Array<{ value: CommandCenterToolsView; label: string }> = [
  { value: "ai", label: "Read Notes & AI" },
  { value: "measure", label: "Measure" },
  { value: "review", label: "Review Work" },
  { value: "worksheet", label: "Estimate Worksheet" },
];

export function CommandCenterToolsNav({
  value,
  onChange,
  expanded = false,
}: {
  value: CommandCenterToolsView;
  onChange: (value: CommandCenterToolsView) => void;
  expanded?: boolean;
}) {
  return (
    <nav
      className={`sticky top-0 z-20 grid gap-1 rounded-lg border border-hairline bg-card/95 p-1 shadow-sm backdrop-blur ${
        expanded ? "grid-cols-4" : "grid-cols-2"
      }`}
      aria-label="Takeoff workspace sections"
      data-testid="plan-cockpit-tools-tabs"
    >
      {TOOLS_VIEWS.map((view) => (
        <Button
          key={view.value}
          type="button"
          size="sm"
          variant={value === view.value ? "default" : "ghost"}
          className="h-auto min-h-8 min-w-0 whitespace-normal px-2 py-1.5 text-center text-xs leading-tight"
          aria-current={value === view.value ? "page" : undefined}
          onClick={() => onChange(view.value)}
          data-testid={`plan-cockpit-tools-tab-${view.value}`}
        >
          {view.label}
        </Button>
      ))}
    </nav>
  );
}
