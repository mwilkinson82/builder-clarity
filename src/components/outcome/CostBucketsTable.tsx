import { useEffect, useMemo, useRef, useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { MoneyInput } from "@/components/ui/money-input";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState } from "@/components/ui/empty-state";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Check, FileSpreadsheet, Info, LockKeyhole, Plus, Search, Trash2 } from "lucide-react";
import { fmtUSD } from "@/lib/format";
import {
  sovLineForecastWithSubs,
  sovTotalsWithSubs,
  type SubBucketCostLite,
} from "@/lib/sov-rollup";
import type { BucketRow } from "@/lib/projects.functions";

type BucketSource = BucketRow["source_type"];
type BucketPatch = Partial<
  Pick<
    BucketRow,
    | "cost_code"
    | "actual_to_date"
    | "ftc"
    | "contract_value"
    | "original_budget"
    | "bucket"
    | "source_type"
    | "source_date"
    | "source_note"
  >
>;
type NewBucketInput = {
  cost_code: string;
  bucket: string;
  source_type: BucketSource;
  source_date: string;
  source_note: string;
};

const SOURCE_LABEL: Record<BucketSource, string> = {
  original_sov: "Original budget",
  change_order: "Change Order",
  added_cost: "Added Cost",
};

// Stable empty fallback so an omitted subCostByBucket prop doesn't churn memos.
const NO_SUB_COST: ReadonlyMap<string, SubBucketCostLite> = new Map();

// Reads the same as the budget-vs-cost ledger: "$3,000 under" (green) /
// "$3,000 over" (red) / "On budget" — never a bare parenthesized or signed
// number. Variance is budget − projected cost, so positive means under budget.
function overUnder(value: number): { text: string; tone: string } {
  if (value === 0) return { text: "On budget", tone: "text-muted-foreground" };
  const under = value > 0;
  return {
    text: `${fmtUSD(Math.abs(value))} ${under ? "under" : "over"}`,
    tone: under ? "text-success" : "text-danger",
  };
}

// A right-aligned column header whose plain-English meaning is one hover away —
// matching the budget-vs-cost ledger so the editable grid reads the same.
function HelpHead({ label, help }: { label: string; help: string }) {
  return (
    <TableHead className="text-right">
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex cursor-help items-center gap-1">
            {label}
            <Info className="h-3 w-3 opacity-60" />
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-[260px] text-xs font-normal normal-case leading-snug tracking-normal">
          {help}
        </TooltipContent>
      </Tooltip>
    </TableHead>
  );
}

export function CostBucketsTable({
  buckets,
  subCostByBucket,
  onUpdate,
  onCreate,
  onDelete,
  budgetLocked = false,
}: {
  buckets: BucketRow[];
  /**
   * Subcontractor cost per cost-bucket id (buyout committed / paid / open). Folded
   * into each line's projected cost + over/under with the same displace-not-stack
   * model as the budget ledger, so a bought-out line stops reading a bogus "under
   * budget". Omitted → the grid behaves exactly as before (self-perform only).
   */
  subCostByBucket?: ReadonlyMap<string, SubBucketCostLite>;
  /**
   * Commits one cell edit. Return the save promise so the committed cell can
   * show its saved-tick only after the write actually landed.
   */
  onUpdate: (id: string, patch: BucketPatch) => void | Promise<unknown>;
  onCreate?: (input: NewBucketInput) => void;
  onDelete?: (id: string) => void;
  /**
   * BUDGETLOCK1: when the project's budget baseline is locked, the budget
   * column is read-only — budget changes come through change orders. Actuals
   * and forecast-to-complete stay editable (they are cost, not budget).
   */
  budgetLocked?: boolean;
}) {
  const subCosts = subCostByBucket ?? NO_SUB_COST;
  const [newCode, setNewCode] = useState("");
  const [newName, setNewName] = useState("");
  const [newSource, setNewSource] = useState<BucketSource>("added_cost");
  const [search, setSearch] = useState("");
  const today = new Date().toISOString().slice(0, 10);
  const visibleGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const sorted = [...buckets].sort(compareBucketByCode);
    const filtered = !q
      ? sorted
      : sorted.filter((b) => {
          const division = divisionForBucket(b);
          return [
            b.cost_code,
            b.bucket,
            b.source_note ?? "",
            SOURCE_LABEL[b.source_type],
            division.code,
            division.label,
          ]
            .join(" ")
            .toLowerCase()
            .includes(q);
        });

    const groups: DivisionGroup[] = [];
    const byKey = new Map<string, DivisionGroup>();
    for (const bucket of filtered) {
      const division = divisionForBucket(bucket);
      let group = byKey.get(division.key);
      if (!group) {
        group = { division, buckets: [] };
        byKey.set(division.key, group);
        groups.push(group);
      }
      group.buckets.push(bucket);
    }
    return groups.sort(
      (a, b) =>
        a.division.sort - b.division.sort || a.division.label.localeCompare(b.division.label),
    );
  }, [buckets, search]);
  const visibleCount = visibleGroups.reduce((sum, group) => sum + group.buckets.length, 0);

  const submitNew = () => {
    const n = newName.trim();
    if (!n || !onCreate) return;
    onCreate({
      cost_code: newCode.trim(),
      bucket: n,
      source_type: newSource,
      source_date: today,
      source_note: SOURCE_LABEL[newSource],
    });
    setNewCode("");
    setNewName("");
    setNewSource("added_cost");
  };

  return (
    <TooltipProvider delayDuration={150}>
      <div className="overflow-hidden rounded-lg border border-hairline bg-card">
        <div className="flex flex-col gap-3 border-b border-hairline bg-card px-3 py-3 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Grouped by code / division
            </div>
            <div className="text-xs text-muted-foreground">
              Showing {visibleCount} of {buckets.length} budget line
              {buckets.length === 1 ? "" : "s"}.
            </div>
          </div>
          <div className="relative md:w-80">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search code, division, bucket, or source"
              className="h-9 pl-8"
            />
          </div>
        </div>
        <Table>
          <TableHeader>
            <TableRow className="bg-surface">
              <TableHead>Code / Division</TableHead>
              <TableHead>Bucket</TableHead>
              <TableHead>Source</TableHead>
              <HelpHead
                label="Contract value"
                help="What the client pays for this line — your SOV price. NOT your budget: the difference between the two is your margin. 0 shows as unpriced on the ledger, never as zero margin."
              />
              <HelpHead
                label="Original Budget"
                help="What you expect this line to cost you — the internal budget you drive the job on. Distinct from contract value; billing never pulls from this."
              />
              <TableHead className="text-right">Actual to Date</TableHead>
              <TableHead className="text-right">Forecast to Complete</TableHead>
              <HelpHead
                label="Committed (subs)"
                help="Subcontractor buyout committed on this cost code — the total you've bought this scope out for. It's already folded into Actual to Date (earned) and Forecast to Complete (remaining)."
              />
              <HelpHead
                label="Projected cost"
                help="Actual to date + forecast-to-complete — everything you've spent plus everything still committed, including any subcontractor buyout on this code. The projected final cost of this line."
              />
              <HelpHead
                label="Over / under budget"
                help="Budget minus projected cost. Green means you're coming in under budget; red means over."
              />
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleGroups.flatMap((group) => {
              const totals = sovTotalsWithSubs(group.buckets, subCosts);
              const facTotal = totals.fac;
              const varianceTotal = totals.variance;
              const committedSubtotal = group.buckets.reduce(
                (sum, bucket) => sum + (bucket.id ? (subCosts.get(bucket.id)?.committed ?? 0) : 0),
                0,
              );
              const groupRows = [
                <TableRow key={`division-${group.division.key}`} className="bg-surface/80">
                  <TableCell colSpan={3}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                        {group.division.code}
                      </span>
                      <span className="font-semibold text-foreground">{group.division.label}</span>
                      <span className="rounded-full bg-background px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                        {group.buckets.length} line{group.buckets.length === 1 ? "" : "s"}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular text-muted-foreground">
                    {(() => {
                      const contractSubtotal = group.buckets.reduce(
                        (sum, bucket) => sum + (bucket.contract_value || 0),
                        0,
                      );
                      return contractSubtotal > 0 ? fmtUSD(contractSubtotal) : "—";
                    })()}
                  </TableCell>
                  <TableCell className="text-right tabular text-muted-foreground">
                    {fmtUSD(totals.budget)}
                  </TableCell>
                  <TableCell className="text-right tabular text-muted-foreground">
                    {fmtUSD(totals.actual)}
                  </TableCell>
                  <TableCell className="text-right tabular text-muted-foreground">
                    {fmtUSD(totals.ftc)}
                  </TableCell>
                  <TableCell className="text-right tabular text-muted-foreground">
                    {committedSubtotal > 0 ? fmtUSD(committedSubtotal) : "—"}
                  </TableCell>
                  <TableCell className="text-right tabular font-medium">
                    {fmtUSD(facTotal)}
                  </TableCell>
                  <TableCell className={`text-right tabular ${overUnder(varianceTotal).tone}`}>
                    {overUnder(varianceTotal).text}
                  </TableCell>
                  <TableCell />
                </TableRow>,
              ];

              for (const b of group.buckets) {
                const subCost = b.id ? subCosts.get(b.id) : undefined;
                const { fac, variance } = sovLineForecastWithSubs(b, subCost);
                const neg = variance < 0;
                // A bought-out line's actual/forecast come from the subcontractor
                // buyout, not manual entry — so show the sub-inclusive NUMBERS in
                // the cells (read-only) instead of empty inputs, matching the top
                // ledger. actual = manual + sub paid; forecast = the rest of the
                // projected cost. Self-perform lines keep their editable inputs.
                const hasSub = Boolean(
                  subCost && ((subCost.paid ?? 0) > 0 || (subCost.committed ?? 0) > 0),
                );
                const actualInclusive = b.actual_to_date + (subCost?.paid ?? 0);
                const forecastInclusive = fac - actualInclusive;
                const subEarned = subCost?.earned ?? 0;
                groupRows.push(
                  <TableRow key={b.id}>
                    <TableCell className="font-mono text-xs">
                      <CodeCell
                        value={b.cost_code}
                        onCommit={(v) => onUpdate(b.id, { cost_code: v })}
                      />
                    </TableCell>
                    <TableCell className="font-medium">
                      <NameCell value={b.bucket} onCommit={(v) => onUpdate(b.id, { bucket: v })} />
                    </TableCell>
                    <TableCell className="min-w-[150px]">
                      <SourceCell
                        value={b.source_type}
                        date={b.source_date}
                        onChange={(source_type) => onUpdate(b.id, { source_type })}
                      />
                    </TableCell>
                    <TableCell className="text-right tabular text-foreground/80">
                      {budgetLocked ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="inline-flex cursor-help items-center justify-end gap-1.5">
                              <LockKeyhole className="h-3 w-3 opacity-50" />
                              {b.contract_value > 0 ? fmtUSD(b.contract_value) : "—"}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-[240px] text-xs">
                            The baseline is locked. Contract value changes come through change
                            orders — the approved CO's contract amount layers onto this line.
                          </TooltipContent>
                        </Tooltip>
                      ) : (
                        <NumCell
                          value={b.contract_value}
                          onCommit={(v) => onUpdate(b.id, { contract_value: v })}
                        />
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular text-foreground/80">
                      {budgetLocked ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="inline-flex cursor-help items-center justify-end gap-1.5">
                              <LockKeyhole className="h-3 w-3 opacity-50" />
                              {fmtUSD(b.original_budget)}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-[240px] text-xs">
                            The budget is locked. Budget changes come through change orders — price
                            the change order and its budgeted cost layers onto this baseline.
                          </TooltipContent>
                        </Tooltip>
                      ) : (
                        <NumCell
                          value={b.original_budget}
                          onCommit={(v) => onUpdate(b.id, { original_budget: v })}
                        />
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular">
                      {hasSub ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="cursor-help font-medium text-foreground">
                              {fmtUSD(actualInclusive)}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-[240px] text-xs">
                            Actual cost is driven by the subcontractor buyout on this code —{" "}
                            {fmtUSD(subCost?.paid ?? 0)} paid to date. Enter manual cost on
                            self-perform lines only.
                          </TooltipContent>
                        </Tooltip>
                      ) : (
                        <NumCell
                          value={b.actual_to_date}
                          onCommit={(v) => onUpdate(b.id, { actual_to_date: v })}
                        />
                      )}
                      {hasSub && subEarned > (subCost?.paid ?? 0) ? (
                        <div className="mt-0.5 text-[10px] font-normal text-muted-foreground">
                          {fmtUSD(subEarned)} earned
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right tabular">
                      {hasSub ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="cursor-help font-medium text-foreground">
                              {fmtUSD(forecastInclusive)}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-[240px] text-xs">
                            Remaining commitment on the subcontractor buyout — the buyout (
                            {fmtUSD(subCost?.committed ?? 0)}) less what's been paid.
                          </TooltipContent>
                        </Tooltip>
                      ) : (
                        <NumCell value={b.ftc} onCommit={(v) => onUpdate(b.id, { ftc: v })} />
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular text-muted-foreground">
                      {subCost && subCost.committed && subCost.committed > 0
                        ? fmtUSD(subCost.committed)
                        : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular font-medium">{fmtUSD(fac)}</TableCell>
                    <TableCell
                      className={`text-right tabular ${overUnder(variance).tone} ${neg ? "font-medium" : ""}`}
                    >
                      {overUnder(variance).text}
                    </TableCell>
                    <TableCell>
                      {onDelete && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-muted-foreground hover:text-danger"
                          onClick={() => {
                            if (confirm(`Delete cost bucket "${b.bucket}"?`)) onDelete(b.id);
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>,
                );
              }
              return groupRows;
            })}
            {buckets.length === 0 && (
              <TableRow>
                <TableCell colSpan={11} className="py-8">
                  <EmptyState
                    icon={FileSpreadsheet}
                    title="No budget lines yet"
                    description='Use "Build budget from estimate" or "Import budget" above to bring your cost budget in — or add the first line below.'
                  />
                </TableCell>
              </TableRow>
            )}
            {buckets.length > 0 && visibleCount === 0 && (
              <TableRow>
                <TableCell colSpan={11} className="py-8 text-center text-sm text-muted-foreground">
                  No budget lines match that search.
                </TableCell>
              </TableRow>
            )}
            {onCreate && (
              <TableRow className="bg-surface/40">
                <TableCell colSpan={10}>
                  <div className="flex flex-col gap-2 md:flex-row md:items-center">
                    <Input
                      value={newCode}
                      onChange={(e) => setNewCode(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") submitNew();
                      }}
                      placeholder="Code / division"
                      className="h-8 md:w-28"
                    />
                    <Input
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") submitNew();
                      }}
                      placeholder="Add a cost line (e.g. Owner-direct allowance, CO-cost holdback, Permits)"
                      className="h-8 md:max-w-md"
                    />
                    <Select
                      value={newSource}
                      onValueChange={(v) => setNewSource(v as BucketSource)}
                    >
                      <SelectTrigger className="h-8 md:w-[170px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="original_sov">Original budget</SelectItem>
                        <SelectItem value="change_order">Change Order</SelectItem>
                        <SelectItem value="added_cost">Added Cost</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={submitNew}
                      disabled={!newName.trim()}
                      className="gap-1.5"
                    >
                      <Plus className="h-3.5 w-3.5" /> Add line
                    </Button>
                  </div>
                </TableCell>
                <TableCell />
              </TableRow>
            )}
          </TableBody>
          {buckets.length > 0 &&
            (() => {
              const t = sovTotalsWithSubs(buckets, subCosts, true);
              const neg = t.variance < 0;
              // Contract value total mirrors the division-subtotal reduce above,
              // so this row lines up with the Contract value column (added by
              // BUDGETVSCONTRACT1). Without its own cell the totals rendered one
              // column to the left of their headers — the field-reported shift.
              const contractTotal = buckets.reduce(
                (sum, bucket) => sum + (bucket.contract_value || 0),
                0,
              );
              const committedTotal = buckets.reduce(
                (sum, bucket) => sum + (bucket.id ? (subCosts.get(bucket.id)?.committed ?? 0) : 0),
                0,
              );
              return (
                <TableFooter>
                  <TableRow className="bg-surface font-semibold">
                    <TableCell />
                    <TableCell>Total</TableCell>
                    <TableCell />
                    <TableCell className="text-right tabular">
                      {contractTotal > 0 ? fmtUSD(contractTotal) : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular">{fmtUSD(t.budget)}</TableCell>
                    <TableCell className="text-right tabular">{fmtUSD(t.actual)}</TableCell>
                    <TableCell className="text-right tabular">{fmtUSD(t.ftc)}</TableCell>
                    <TableCell className="text-right tabular">
                      {committedTotal > 0 ? fmtUSD(committedTotal) : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular">{fmtUSD(t.fac)}</TableCell>
                    <TableCell
                      className={`text-right tabular ${neg ? "text-danger" : "text-success"}`}
                    >
                      {neg
                        ? `−${fmtUSD(Math.abs(t.variance)).replace("−", "")}`
                        : fmtUSD(t.variance)}
                    </TableCell>
                    <TableCell />
                  </TableRow>
                </TableFooter>
              );
            })()}
        </Table>
      </div>
    </TooltipProvider>
  );
}

function compareBucketByCode(a: BucketRow, b: BucketRow) {
  const aDivision = divisionForBucket(a);
  const bDivision = divisionForBucket(b);
  if (aDivision.sort !== bDivision.sort) return aDivision.sort - bDivision.sort;

  const aCode = a.cost_code.trim();
  const bCode = b.cost_code.trim();
  if (aCode && bCode) {
    const codeOrder = aCode.localeCompare(bCode, undefined, {
      numeric: true,
      sensitivity: "base",
    });
    if (codeOrder !== 0) return codeOrder;
  } else if (aCode) {
    return -1;
  } else if (bCode) {
    return 1;
  }

  return a.sort_order - b.sort_order || a.bucket.localeCompare(b.bucket);
}

type DivisionInfo = {
  key: string;
  code: string;
  label: string;
  sort: number;
};

type DivisionGroup = {
  division: DivisionInfo;
  buckets: BucketRow[];
};

const CSI_DIVISION_LABELS: Record<string, string> = {
  "00": "Procurement and contracting",
  "01": "General requirements",
  "02": "Existing conditions",
  "03": "Concrete",
  "04": "Masonry",
  "05": "Metals",
  "06": "Wood, plastics, and composites",
  "07": "Thermal and moisture protection",
  "08": "Openings",
  "09": "Finishes",
  "10": "Specialties",
  "11": "Equipment",
  "12": "Furnishings",
  "13": "Special construction",
  "14": "Conveying equipment",
  "15": "Mechanical / MEP",
  "21": "Fire suppression",
  "22": "Plumbing",
  "23": "HVAC",
  "26": "Electrical",
  "27": "Communications",
  "28": "Electronic safety and security",
  "31": "Earthwork",
  "32": "Exterior improvements",
  "33": "Utilities",
};

const BUCKET_LABEL_HINTS: Array<[RegExp, string]> = [
  [/site\s*work|earthwork|excavat|grading|utilities?/i, "Sitework"],
  [/foundation|concrete|slab/i, "Concrete / foundation"],
  [/structure|framing|steel|lumber|rough carpentry/i, "Structure"],
  [/envelope|roof|window|door|siding|waterproof|moisture/i, "Envelope"],
  [/mep|mechanical|plumb|hvac|electrical/i, "MEP"],
  [/finish|millwork|cabinet|paint|floor|tile|trim/i, "Finishes"],
  [/gc|general condition|overhead|supervision|project management/i, "GC / OH"],
];

function divisionForBucket(bucket: BucketRow): DivisionInfo {
  const rawCode = bucket.cost_code.trim();
  const digits = rawCode.replace(/\D/g, "");
  const firstTwo = digits.slice(0, 2);
  const code = firstTwo || "NA";
  const hintedLabel = BUCKET_LABEL_HINTS.find(([pattern]) => pattern.test(bucket.bucket))?.[1];
  const csiLabel = firstTwo ? CSI_DIVISION_LABELS[firstTwo] : "";
  const label =
    hintedLabel ?? csiLabel ?? (firstTwo ? `Division ${firstTwo}` : "Uncoded budget lines");
  const sort = firstTwo ? Number(firstTwo) : 999;
  const key = firstTwo ? `division-${firstTwo}` : `division-uncoded-${label}`;
  return { key, code: firstTwo ? `Div ${firstTwo}` : "No code", label, sort };
}

/**
 * Saved-tick for a committed cell: resolves true only after the save promise
 * lands, so the ✓ means "written", never "sent". The founder must never
 * wonder whether a save happened.
 */
function useSavedTick() {
  const [saved, setSaved] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );
  const showTick = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setSaved(true);
    timerRef.current = setTimeout(() => setSaved(false), 1800);
  };
  const commit = async (run: () => void | Promise<unknown>) => {
    try {
      await run();
      showTick();
    } catch {
      // The mutation owner surfaces the error toast; no tick on failure.
    }
  };
  return { saved, commit };
}

function SavedTick({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <span
      data-testid="sov-saved-tick"
      className="pointer-events-none absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-success text-success-foreground shadow-sm"
    >
      <Check className="h-3 w-3" />
    </span>
  );
}

// Money cell: keystrokes stay local; the save commits ONCE on blur/Enter.
// The pre-fix behavior committed a mutation per keystroke, and the racing
// refetches could resolve out of order — group headers kept stale sums and a
// mid-refetch rerender could eat the next edit. Local state + focus guard
// means an in-flight edit survives any refetch.
function NumCell({
  value,
  onCommit,
}: {
  value: number;
  onCommit: (v: number) => void | Promise<unknown>;
}) {
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);
  const { saved, commit } = useSavedTick();
  useEffect(() => {
    if (!focused) setDraft(value);
  }, [value, focused]);
  return (
    <div className="relative ml-auto w-32">
      <MoneyInput
        value={draft}
        onValueChange={setDraft}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          if (draft !== value) void commit(() => onCommit(draft));
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        align="right"
        className="h-8 w-32"
      />
      <SavedTick visible={saved} />
    </div>
  );
}

function NameCell({
  value,
  onCommit,
}: {
  value: string;
  onCommit: (v: string) => void | Promise<unknown>;
}) {
  const [v, setV] = useState(value);
  const [focused, setFocused] = useState(false);
  const { saved, commit } = useSavedTick();
  useEffect(() => {
    if (!focused) setV(value);
  }, [value, focused]);
  return (
    <div className="relative">
      <Textarea
        value={v}
        onChange={(e) => setV(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          const t = v.trim();
          if (t && t !== value) void commit(() => onCommit(t));
          else setV(value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        rows={2}
        className="min-h-[44px] w-full min-w-[220px] resize-y border-transparent bg-transparent px-1.5 py-1.5 leading-snug focus-visible:border-input focus-visible:bg-background"
      />
      <SavedTick visible={saved} />
    </div>
  );
}

function CodeCell({
  value,
  onCommit,
}: {
  value: string;
  onCommit: (v: string) => void | Promise<unknown>;
}) {
  const [v, setV] = useState(value);
  const [focused, setFocused] = useState(false);
  const { saved, commit } = useSavedTick();
  useEffect(() => {
    if (!focused) setV(value);
  }, [value, focused]);
  return (
    <div className="relative w-24">
      <Input
        value={v}
        onChange={(e) => setV(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          const t = v.trim();
          if (t !== value) void commit(() => onCommit(t));
          else setV(value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        className="h-8 w-24 border-transparent bg-transparent px-1.5 font-mono text-xs focus-visible:border-input focus-visible:bg-background"
      />
      <SavedTick visible={saved} />
    </div>
  );
}

function SourceCell({
  value,
  date,
  onChange,
}: {
  value: BucketSource;
  date: string | null;
  onChange: (v: BucketSource) => void | Promise<unknown>;
}) {
  const { saved, commit } = useSavedTick();
  return (
    <div className="relative space-y-1">
      <Select value={value} onValueChange={(v) => void commit(() => onChange(v as BucketSource))}>
        <SelectTrigger className="h-8">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="original_sov">Original budget</SelectItem>
          <SelectItem value="change_order">Change Order</SelectItem>
          <SelectItem value="added_cost">Added Cost</SelectItem>
        </SelectContent>
      </Select>
      {date && <div className="text-[10px] tabular text-muted-foreground">Added {date}</div>}
      <SavedTick visible={saved} />
    </div>
  );
}
