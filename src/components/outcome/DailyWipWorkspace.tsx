// Workspace B — the daily WIP recording surface (BILLINGDESIGN P2). Pick any
// date, see that day's daily report alongside it, and record the work put in
// place: self-perform crew (crew × hours × blended rate), materials, and
// equipment, against a cost code. The day's totals fall out cents-safe, and a
// production rate comes for free when a quantity is logged.
//
// The dependency rule: this FEEDS billing; billing never waits on it. Recording
// here is optional and additive.
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { CalendarDays, ChevronLeft, ChevronRight, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/money-input";
import { WorkspaceHeader } from "@/components/project/billing/billing-workspace-atoms";
import { fmtUSDCents as fmtUSD, formatBillingDate } from "@/lib/billing-format";
import {
  deleteDailyWipEntry,
  listDailyWipEntries,
  saveDailyWipEntry,
  type DailyWipEntryRow,
} from "@/lib/daily-wip.functions";
import { listDailyReports } from "@/lib/daily-reports.functions";
import { dailyWipTotals, laborCost, productionRate, rowWorkInPlace } from "@/lib/daily-wip";

interface BucketOption {
  id: string;
  cost_code: string;
  bucket: string;
}

interface DailyWipWorkspaceProps {
  projectId: string;
  buckets: BucketOption[];
}

interface SaveWipInput {
  projectId: string;
  id?: string;
  cost_bucket_id: string | null;
  entry_date: string;
  activity: string;
  crew_count: number;
  hours: number;
  labor_rate: number;
  material_cost: number;
  equipment_cost: number;
  quantity: number;
  unit: string;
  notes: string;
}

interface EntryDraft {
  cost_bucket_id: string;
  activity: string;
  crew_count: number;
  hours: number;
  labor_rate: number;
  material_cost: number;
  equipment_cost: number;
  quantity: number;
  unit: string;
  notes: string;
}

const emptyDraft: EntryDraft = {
  cost_bucket_id: "",
  activity: "",
  crew_count: 0,
  hours: 0,
  labor_rate: 0,
  material_cost: 0,
  equipment_cost: 0,
  quantity: 0,
  unit: "",
  notes: "",
};

function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

function shiftDate(iso: string, delta: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + delta);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

export function DailyWipWorkspace({ projectId, buckets }: DailyWipWorkspaceProps) {
  const queryClient = useQueryClient();
  const listEntries = useServerFn(listDailyWipEntries);
  const listReports = useServerFn(listDailyReports);
  const saveEntry = useServerFn(saveDailyWipEntry);
  const removeEntry = useServerFn(deleteDailyWipEntry);

  const [selectedDate, setSelectedDate] = useState<string>(() => localToday());
  const [draft, setDraft] = useState<EntryDraft>(emptyDraft);

  const entriesQuery = useQuery({
    queryKey: ["daily-wip-entries", projectId],
    queryFn: () => listEntries({ data: { projectId } }),
  });
  const reportsQuery = useQuery({
    queryKey: ["daily-reports", projectId],
    queryFn: () => listReports({ data: { projectId } }),
  });

  const entries = useMemo(
    () => (entriesQuery.data ?? []).filter((entry) => entry.entry_date === selectedDate),
    [entriesQuery.data, selectedDate],
  );
  const totals = useMemo(() => dailyWipTotals(entries), [entries]);
  const datesWithEntries = useMemo(() => {
    const set = new Set<string>();
    for (const entry of entriesQuery.data ?? []) set.add(entry.entry_date);
    return set;
  }, [entriesQuery.data]);
  const report = useMemo(
    () => (reportsQuery.data ?? []).find((r) => r.report_date === selectedDate) ?? null,
    [reportsQuery.data, selectedDate],
  );

  const bucketLabel = (id: string | null) => {
    if (!id) return "Uncoded";
    const bucket = buckets.find((b) => b.id === id);
    if (!bucket) return "Uncoded";
    return [bucket.cost_code, bucket.bucket].filter(Boolean).join(" · ") || "Uncoded";
  };

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["daily-wip-entries", projectId] });

  const saveMutation = useMutation({
    mutationFn: (input: SaveWipInput) => saveEntry({ data: input }),
    onSuccess: () => {
      setDraft(emptyDraft);
      toast.success("Day's work recorded");
      invalidate();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Could not save the entry"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => removeEntry({ data: { id } }),
    onSuccess: () => invalidate(),
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Could not remove the entry"),
  });

  const draftLabor = laborCost(draft);
  const draftHasWork =
    draftLabor > 0 || draft.material_cost > 0 || draft.equipment_cost > 0 || draft.activity.trim();

  const handleAdd = () => {
    if (!draftHasWork) {
      toast.error("Add crew, materials, equipment, or an activity before saving");
      return;
    }
    saveMutation.mutate({
      projectId,
      cost_bucket_id: draft.cost_bucket_id || null,
      entry_date: selectedDate,
      activity: draft.activity.trim(),
      crew_count: draft.crew_count,
      hours: draft.hours,
      labor_rate: draft.labor_rate,
      material_cost: draft.material_cost,
      equipment_cost: draft.equipment_cost,
      quantity: draft.quantity,
      unit: draft.unit.trim(),
      notes: draft.notes.trim(),
    });
  };

  const setDraftField = <K extends keyof EntryDraft>(key: K, value: EntryDraft[K]) =>
    setDraft((prev) => ({ ...prev, [key]: value }));

  return (
    <div className="space-y-6">
      <WorkspaceHeader
        title="Daily WIP"
        subtitle="Record the work put in place each day — self-perform crew, materials, and equipment against a cost code. It feeds your billing; billing never waits on it."
      />

      {/* Date navigator */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-hairline bg-surface p-3">
        <CalendarDays className="h-4 w-4 text-muted-foreground" />
        <Button
          size="icon"
          variant="outline"
          className="h-8 w-8"
          aria-label="Previous day"
          onClick={() => setSelectedDate((d) => shiftDate(d, -1))}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Input
          type="date"
          value={selectedDate}
          onChange={(event) => setSelectedDate(event.target.value || localToday())}
          className="w-[170px]"
        />
        <Button
          size="icon"
          variant="outline"
          className="h-8 w-8"
          aria-label="Next day"
          onClick={() => setSelectedDate((d) => shiftDate(d, 1))}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setSelectedDate(localToday())}>
          Today
        </Button>
        <div className="ml-auto text-sm font-medium text-foreground">
          {formatBillingDate(selectedDate)}
          {datesWithEntries.has(selectedDate) ? (
            <span className="ml-2 rounded-sm bg-accent/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-foreground">
              {entries.length} logged
            </span>
          ) : null}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        {/* Left: the day's WIP entries + add form */}
        <div className="space-y-4">
          <div className="overflow-x-auto rounded-lg border border-hairline bg-surface">
            <table className="w-full min-w-[820px] border-collapse text-sm">
              <thead className="border-b border-hairline bg-surface-elevated">
                <tr className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  <th className="px-3 py-2 text-left">Activity / cost code</th>
                  <th className="px-3 py-2 text-right">Crew</th>
                  <th className="px-3 py-2 text-right">Hours</th>
                  <th className="px-3 py-2 text-right">Rate</th>
                  <th className="px-3 py-2 text-right">Labor</th>
                  <th className="px-3 py-2 text-right">Materials</th>
                  <th className="px-3 py-2 text-right">Equipment</th>
                  <th className="px-3 py-2 text-right">Work in place</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {entriesQuery.isLoading ? (
                  <tr>
                    <td colSpan={9} className="px-3 py-6 text-center text-muted-foreground">
                      Loading…
                    </td>
                  </tr>
                ) : entries.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-3 py-6 text-center text-muted-foreground">
                      No work recorded for this day yet. Add the crew, materials, and equipment
                      below.
                    </td>
                  </tr>
                ) : (
                  entries.map((entry) => (
                    <EntryRow
                      key={entry.id}
                      entry={entry}
                      label={bucketLabel(entry.cost_bucket_id)}
                      onDelete={() => deleteMutation.mutate(entry.id)}
                      deleting={deleteMutation.isPending}
                    />
                  ))
                )}
              </tbody>
              {entries.length > 0 ? (
                <tfoot>
                  <tr className="border-t-2 border-hairline bg-surface-elevated font-semibold">
                    <td className="px-3 py-2.5 text-left text-foreground">
                      Day total
                      <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">
                        {totals.laborHours} labor-hours
                      </span>
                    </td>
                    <td colSpan={3} />
                    <td className="px-3 py-2.5 text-right tabular-nums">{fmtUSD(totals.labor)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {fmtUSD(totals.material)}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {fmtUSD(totals.equipment)}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{fmtUSD(totals.total)}</td>
                    <td />
                  </tr>
                </tfoot>
              ) : null}
            </table>
          </div>

          {/* Add-entry form */}
          <div className="rounded-lg border border-hairline bg-card p-4 shadow-card">
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Record work in place
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <label className="flex flex-col gap-1 sm:col-span-2">
                <span className="text-xs text-muted-foreground">Cost code</span>
                <select
                  value={draft.cost_bucket_id}
                  onChange={(event) => setDraftField("cost_bucket_id", event.target.value)}
                  className="rounded-md border border-hairline bg-surface px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent/40"
                >
                  <option value="">Uncoded (assign later)</option>
                  {buckets.map((bucket) => (
                    <option key={bucket.id} value={bucket.id}>
                      {[bucket.cost_code, bucket.bucket].filter(Boolean).join(" · ")}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 sm:col-span-2">
                <span className="text-xs text-muted-foreground">Activity / note</span>
                <Input
                  value={draft.activity}
                  onChange={(event) => setDraftField("activity", event.target.value)}
                  placeholder="e.g. Formwork north wall"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">Crew</span>
                <Input
                  type="number"
                  min={0}
                  value={draft.crew_count || ""}
                  onChange={(event) => setDraftField("crew_count", Number(event.target.value) || 0)}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">Hours</span>
                <Input
                  type="number"
                  min={0}
                  step="0.25"
                  value={draft.hours || ""}
                  onChange={(event) => setDraftField("hours", Number(event.target.value) || 0)}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">Blended rate ($/hr)</span>
                <MoneyInput
                  value={draft.labor_rate}
                  onValueChange={(n) => setDraftField("labor_rate", n)}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">Labor (derived)</span>
                <div className="flex h-9 items-center rounded-md border border-hairline bg-muted/40 px-3 text-sm tabular-nums text-foreground">
                  {fmtUSD(draftLabor)}
                </div>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">Materials</span>
                <MoneyInput
                  value={draft.material_cost}
                  onValueChange={(n) => setDraftField("material_cost", n)}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">Equipment</span>
                <MoneyInput
                  value={draft.equipment_cost}
                  onValueChange={(n) => setDraftField("equipment_cost", n)}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">Quantity placed</span>
                <Input
                  type="number"
                  min={0}
                  value={draft.quantity || ""}
                  onChange={(event) => setDraftField("quantity", Number(event.target.value) || 0)}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">Unit</span>
                <Input
                  value={draft.unit}
                  onChange={(event) => setDraftField("unit", event.target.value)}
                  placeholder="SF, CY, LF…"
                />
              </label>
            </div>
            <div className="mt-3 flex items-center justify-between gap-2">
              <span className="text-[11px] text-muted-foreground">
                Work in place ={" "}
                <span className="font-medium text-foreground">
                  {fmtUSD(
                    dailyWipTotals([
                      {
                        crew_count: draft.crew_count,
                        hours: draft.hours,
                        labor_rate: draft.labor_rate,
                        material_cost: draft.material_cost,
                        equipment_cost: draft.equipment_cost,
                        quantity: draft.quantity,
                      },
                    ]).total,
                  )}
                </span>
              </span>
              <Button
                size="sm"
                className="gap-1.5"
                onClick={handleAdd}
                disabled={saveMutation.isPending}
              >
                <Plus className="h-3.5 w-3.5" />
                {saveMutation.isPending ? "Saving…" : "Add to this day"}
              </Button>
            </div>
          </div>
        </div>

        {/* Right: the day's daily report, read-only reference */}
        <aside className="space-y-3">
          <div className="rounded-lg border border-hairline bg-surface p-4">
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Daily report · {formatBillingDate(selectedDate)}
            </div>
            {report ? (
              <div className="mt-2 space-y-2 text-sm">
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
                  {report.crew_count ? (
                    <span>
                      <span className="font-medium text-foreground">{report.crew_count}</span> crew
                    </span>
                  ) : null}
                  {report.weather ? <span>{report.weather}</span> : null}
                  {report.author ? <span>by {report.author}</span> : null}
                </div>
                {report.work_performed ? (
                  <p className="whitespace-pre-wrap text-foreground">{report.work_performed}</p>
                ) : (
                  <p className="text-muted-foreground">No work narrative recorded.</p>
                )}
                {report.delays ? (
                  <p className="text-warning">
                    <span className="font-medium">Delays:</span> {report.delays}
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">
                No daily report filed for this day. Add one in the{" "}
                <span className="font-medium text-foreground">Daily Reports</span> tab — it'll show
                here next to the WIP.
              </p>
            )}
          </div>

          {entries.length > 0 ? (
            <div className="rounded-lg border border-hairline bg-surface p-4">
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Production
              </div>
              <ul className="mt-2 space-y-1 text-sm">
                {entries
                  .map((entry) => ({ entry, rate: productionRate(entry) }))
                  .filter((row) => row.rate != null)
                  .map(({ entry, rate }) => (
                    <li key={entry.id} className="flex justify-between gap-2 text-muted-foreground">
                      <span className="truncate">
                        {entry.activity || bucketLabel(entry.cost_bucket_id)}
                      </span>
                      <span className="shrink-0 tabular-nums text-foreground">
                        {(rate as number).toFixed(2)} {entry.unit || "unit"}/hr
                      </span>
                    </li>
                  ))}
                {entries.every((entry) => productionRate(entry) == null) ? (
                  <li className="text-muted-foreground">
                    Log a quantity and hours to see production rates.
                  </li>
                ) : null}
              </ul>
            </div>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

function EntryRow({
  entry,
  label,
  onDelete,
  deleting,
}: {
  entry: DailyWipEntryRow;
  label: string;
  onDelete: () => void;
  deleting: boolean;
}) {
  const labor = laborCost(entry);
  const workInPlace = rowWorkInPlace(entry);
  return (
    <tr className="border-b border-hairline/70 last:border-0">
      <td className="px-3 py-2.5 text-left">
        <div className="font-medium text-foreground">{entry.activity || label}</div>
        {entry.activity ? <div className="text-[11px] text-muted-foreground">{label}</div> : null}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums">{entry.crew_count || "—"}</td>
      <td className="px-3 py-2.5 text-right tabular-nums">{entry.hours || "—"}</td>
      <td className="px-3 py-2.5 text-right tabular-nums">
        {entry.labor_rate ? fmtUSD(entry.labor_rate) : "—"}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums">{labor ? fmtUSD(labor) : "—"}</td>
      <td className="px-3 py-2.5 text-right tabular-nums">
        {entry.material_cost ? fmtUSD(entry.material_cost) : "—"}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums">
        {entry.equipment_cost ? fmtUSD(entry.equipment_cost) : "—"}
      </td>
      <td className="px-3 py-2.5 text-right font-medium tabular-nums">{fmtUSD(workInPlace)}</td>
      <td className="px-3 py-2.5 text-right">
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7 text-muted-foreground hover:text-danger"
          aria-label="Remove entry"
          onClick={onDelete}
          disabled={deleting}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </td>
    </tr>
  );
}
