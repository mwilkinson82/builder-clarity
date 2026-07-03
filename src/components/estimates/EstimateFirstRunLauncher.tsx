import { PencilRuler, Plus, Upload } from "lucide-react";

// First-run launcher: three doors instead of an empty spreadsheet. A blank
// grid reads as "type rows here" — the Excel reflex this product replaces —
// so a fresh estimate (no line items AND no real plan sets) leads with the
// three ways rows actually get built. Once the estimate has content the cards
// never come back (per-estimate flag below), even if every row is deleted.

const LAUNCHER_DONE_STORAGE_PREFIX = "overwatch.estimate.first-run-done.v1.";
const launcherDoneMemoryStore = new Set<string>();

export const readFirstRunLauncherDone = (estimateId: string): boolean => {
  if (launcherDoneMemoryStore.has(estimateId)) return true;
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(`${LAUNCHER_DONE_STORAGE_PREFIX}${estimateId}`) === "1";
  } catch {
    return false;
  }
};

export const writeFirstRunLauncherDone = (estimateId: string) => {
  launcherDoneMemoryStore.add(estimateId);
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(`${LAUNCHER_DONE_STORAGE_PREFIX}${estimateId}`, "1");
  } catch {
    // Storage is blocked; the in-memory copy above covers the session.
  }
};

export function EstimateFirstRunLauncher({
  onTakeoff,
  onImportMasterSheet,
  onBuildByHand,
  disabled = false,
}: {
  onTakeoff: () => void;
  onImportMasterSheet: () => void;
  onBuildByHand: () => void;
  disabled?: boolean;
}) {
  const doors = [
    {
      icon: PencilRuler,
      title: "Take off from your drawings",
      detail: "Upload the plans, measure, and rows build themselves.",
      onClick: onTakeoff,
      testId: "first-run-takeoff",
    },
    {
      icon: Upload,
      title: "Start from your master sheet",
      detail: "Import your company pricing, then tune it for this job.",
      onClick: onImportMasterSheet,
      testId: "first-run-master-sheet",
    },
    {
      icon: Plus,
      title: "Build it by hand",
      detail: "Add rows and price from your Cost Library.",
      onClick: onBuildByHand,
      testId: "first-run-by-hand",
    },
  ];

  return (
    <div className="px-6 py-10" data-testid="estimate-first-run-launcher">
      <div className="mx-auto grid max-w-3xl gap-3 sm:grid-cols-3">
        {doors.map((door) => {
          const Icon = door.icon;
          return (
            <button
              key={door.testId}
              type="button"
              className="flex flex-col items-start gap-3 rounded-lg border border-hairline bg-surface p-5 text-left transition hover:border-primary/50 hover:bg-primary/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-60"
              onClick={door.onClick}
              disabled={disabled}
              data-testid={door.testId}
            >
              <span className="rounded-md border border-hairline bg-card p-2">
                <Icon className="h-5 w-5" />
              </span>
              <span>
                <span className="block font-serif text-lg leading-snug">{door.title}</span>
                <span className="mt-1 block text-sm text-muted-foreground">{door.detail}</span>
              </span>
            </button>
          );
        })}
      </div>
      <p className="mx-auto mt-6 max-w-3xl text-center text-sm text-muted-foreground">
        Measure it in the Plan Room, price it from your Cost Library, or import your master sheet —
        start wherever you like.
      </p>
    </div>
  );
}
