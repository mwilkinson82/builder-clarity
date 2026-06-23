import { useMemo, useState } from "react";
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
import { Plus, Search, Trash2 } from "lucide-react";
import { fmtUSD } from "@/lib/format";
import type { BucketRow } from "@/lib/projects.functions";

type BucketSource = BucketRow["source_type"];
type BucketPatch = Partial<
  Pick<
    BucketRow,
    | "cost_code"
    | "actual_to_date"
    | "ftc"
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
  original_sov: "Original SOV",
  change_order: "Change Order",
  added_cost: "Added Cost",
};

export function CostBucketsTable({
  buckets,
  onUpdate,
  onCreate,
  onDelete,
}: {
  buckets: BucketRow[];
  onUpdate: (id: string, patch: BucketPatch) => void;
  onCreate?: (input: NewBucketInput) => void;
  onDelete?: (id: string) => void;
}) {
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
    <div className="overflow-hidden rounded-lg border border-hairline bg-card">
      <div className="flex flex-col gap-3 border-b border-hairline bg-card px-3 py-3 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Grouped by code / division
          </div>
          <div className="text-xs text-muted-foreground">
            Showing {visibleCount} of {buckets.length} SOV line
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
            <TableHead className="text-right">Original Budget</TableHead>
            <TableHead className="text-right">Actual to Date</TableHead>
            <TableHead className="text-right">Forecast to Complete</TableHead>
            <TableHead className="text-right">Forecast at Completion</TableHead>
            <TableHead className="text-right">Variance vs Budget</TableHead>
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {visibleGroups.flatMap((group) => {
            const totals = group.buckets.reduce(
              (sum, b) => {
                sum.budget += b.original_budget;
                sum.actual += b.actual_to_date;
                sum.ftc += b.ftc;
                return sum;
              },
              { budget: 0, actual: 0, ftc: 0 },
            );
            const facTotal = totals.actual + totals.ftc;
            const varianceTotal = totals.budget - facTotal;
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
                  {fmtUSD(totals.budget)}
                </TableCell>
                <TableCell className="text-right tabular text-muted-foreground">
                  {fmtUSD(totals.actual)}
                </TableCell>
                <TableCell className="text-right tabular text-muted-foreground">
                  {fmtUSD(totals.ftc)}
                </TableCell>
                <TableCell className="text-right tabular font-medium">{fmtUSD(facTotal)}</TableCell>
                <TableCell
                  className={`text-right tabular ${varianceTotal < 0 ? "text-danger" : "text-success"}`}
                >
                  {varianceTotal < 0
                    ? `−${fmtUSD(Math.abs(varianceTotal)).replace("−", "")}`
                    : fmtUSD(varianceTotal)}
                </TableCell>
                <TableCell />
              </TableRow>,
            ];

            for (const b of group.buckets) {
              const fac = b.actual_to_date + b.ftc;
              const variance = b.original_budget - fac;
              const neg = variance < 0;
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
                    <NumCell
                      value={b.original_budget}
                      onCommit={(v) => onUpdate(b.id, { original_budget: v })}
                    />
                  </TableCell>
                  <TableCell className="text-right tabular">
                    <NumCell
                      value={b.actual_to_date}
                      onCommit={(v) => onUpdate(b.id, { actual_to_date: v })}
                    />
                  </TableCell>
                  <TableCell className="text-right tabular">
                    <NumCell value={b.ftc} onCommit={(v) => onUpdate(b.id, { ftc: v })} />
                  </TableCell>
                  <TableCell className="text-right tabular font-medium">{fmtUSD(fac)}</TableCell>
                  <TableCell
                    className={`text-right tabular ${neg ? "text-danger font-medium" : "text-success"}`}
                  >
                    {neg ? `−${fmtUSD(Math.abs(variance)).replace("−", "")}` : fmtUSD(variance)}
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
              <TableCell colSpan={9} className="py-8 text-center text-sm text-muted-foreground">
                No cost buckets yet. Use "Import SOV" to bring in your existing schedule of values
                from Excel or QuickBooks, or add the first line below.
              </TableCell>
            </TableRow>
          )}
          {buckets.length > 0 && visibleCount === 0 && (
            <TableRow>
              <TableCell colSpan={9} className="py-8 text-center text-sm text-muted-foreground">
                No SOV lines match that search.
              </TableCell>
            </TableRow>
          )}
          {onCreate && (
            <TableRow className="bg-surface/40">
              <TableCell colSpan={8}>
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
                  <Select value={newSource} onValueChange={(v) => setNewSource(v as BucketSource)}>
                    <SelectTrigger className="h-8 md:w-[170px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="original_sov">Original SOV</SelectItem>
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
            const tBudget = buckets.reduce((s, b) => s + b.original_budget, 0);
            const tActual = buckets.reduce((s, b) => s + b.actual_to_date, 0);
            const tFtc = buckets.reduce((s, b) => s + b.ftc, 0);
            const tFac = tActual + tFtc;
            const tVar = tBudget - tFac;
            const neg = tVar < 0;
            return (
              <TableFooter>
                <TableRow className="bg-surface font-semibold">
                  <TableCell />
                  <TableCell>Total</TableCell>
                  <TableCell />
                  <TableCell className="text-right tabular">{fmtUSD(tBudget)}</TableCell>
                  <TableCell className="text-right tabular">{fmtUSD(tActual)}</TableCell>
                  <TableCell className="text-right tabular">{fmtUSD(tFtc)}</TableCell>
                  <TableCell className="text-right tabular">{fmtUSD(tFac)}</TableCell>
                  <TableCell
                    className={`text-right tabular ${neg ? "text-danger" : "text-success"}`}
                  >
                    {neg ? `−${fmtUSD(Math.abs(tVar)).replace("−", "")}` : fmtUSD(tVar)}
                  </TableCell>
                  <TableCell />
                </TableRow>
              </TableFooter>
            );
          })()}
      </Table>
    </div>
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
    hintedLabel ?? csiLabel ?? (firstTwo ? `Division ${firstTwo}` : "Uncoded SOV lines");
  const sort = firstTwo ? Number(firstTwo) : 999;
  const key = firstTwo ? `division-${firstTwo}` : `division-uncoded-${label}`;
  return { key, code: firstTwo ? `Div ${firstTwo}` : "No code", label, sort };
}

function NumCell({ value, onCommit }: { value: number; onCommit: (v: number) => void }) {
  return (
    <MoneyInput
      value={value}
      onValueChange={(v) => {
        if (v !== value) onCommit(v);
      }}
      align="right"
      className="ml-auto h-8 w-32"
    />
  );
}

function NameCell({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [v, setV] = useState(value);
  return (
    <Textarea
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => {
        const t = v.trim();
        if (t && t !== value) onCommit(t);
        else setV(value);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      rows={2}
      className="min-h-[44px] w-full min-w-[220px] resize-y border-transparent bg-transparent px-1.5 py-1.5 leading-snug focus-visible:border-input focus-visible:bg-background"
    />
  );
}

function CodeCell({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [v, setV] = useState(value);
  return (
    <Input
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => {
        const t = v.trim();
        if (t !== value) onCommit(t);
        else setV(value);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      className="h-8 w-24 border-transparent bg-transparent px-1.5 font-mono text-xs focus-visible:border-input focus-visible:bg-background"
    />
  );
}

function SourceCell({
  value,
  date,
  onChange,
}: {
  value: BucketSource;
  date: string | null;
  onChange: (v: BucketSource) => void;
}) {
  return (
    <div className="space-y-1">
      <Select value={value} onValueChange={(v) => onChange(v as BucketSource)}>
        <SelectTrigger className="h-8">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="original_sov">Original SOV</SelectItem>
          <SelectItem value="change_order">Change Order</SelectItem>
          <SelectItem value="added_cost">Added Cost</SelectItem>
        </SelectContent>
      </Select>
      {date && <div className="text-[10px] tabular text-muted-foreground">Added {date}</div>}
    </div>
  );
}
