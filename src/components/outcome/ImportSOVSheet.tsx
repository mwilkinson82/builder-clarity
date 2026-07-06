import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  SheetFooter,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Upload, Check, AlertTriangle, FileSpreadsheet, Sparkles } from "lucide-react";
import {
  parseCsv,
  parseXlsx,
  parsePaste,
  parsePdf,
  guessColumnMap,
  applyMapping,
  analyzeSovIntake,
  missingRequiredMappings,
  type Matrix,
  type ParsedSheet,
  type ColumnMap,
  type FieldKey,
  type BucketImportRow,
} from "@/lib/sov-import";
import { fmtUSD } from "@/lib/format";
import type { BucketRow, SovMappingProfileRow } from "@/lib/projects.functions";

const FIELD_LABELS: Record<FieldKey, string> = {
  cost_code: "Cost code",
  bucket: "Bucket name",
  original_budget: "Original budget",
  actual_to_date: "Actual to date",
  ftc: "Forecast to complete",
  sort_order: "Sort order",
  ignore: "Ignore",
};

export interface SovImportMetadata {
  source_type: string;
  source_name: string;
  source_sheet: string;
  profile: string;
  confidence: "high" | "medium" | "low" | "unknown";
  has_header: boolean;
  raw_rows: number;
  staged_rows: number;
  skipped_rows: number;
  merged_rows: number;
  total_budget: number;
  selected_budget_column: number | null;
  selected_budget_label: string;
  column_map: Record<string, string>;
  amount_choices: {
    columnIndex: number;
    label: string;
    total: number;
    sampleCount: number;
    recommended: boolean;
    basis: string;
    note: string;
  }[];
  warnings: string[];
}

export interface SovMappingProfileDraft {
  name: string;
  source_type: string;
  source_sheet: string;
  profile: string;
  confidence: "high" | "medium" | "low" | "unknown";
  has_header: boolean;
  column_map: Record<string, string>;
  selected_budget_column: number | null;
  selected_budget_label: string;
  sample_headers: string[];
  amount_choices: SovImportMetadata["amount_choices"];
  warnings: string[];
}

export function ImportSOVSheet({
  existingBuckets = [],
  onImport,
  mappingProfiles = [],
  onSaveProfile,
  savingProfile,
  pending,
}: {
  existingBuckets?: BucketRow[];
  onImport: (
    rows: {
      cost_code: string;
      bucket: string;
      original_budget: number;
      actual_to_date: number;
      ftc: number;
      actual_to_date_provided: boolean;
      ftc_provided: boolean;
      sort_order: number;
    }[],
    mode: "replace" | "append",
    metadata: SovImportMetadata,
  ) => void;
  mappingProfiles?: SovMappingProfileRow[];
  onSaveProfile?: (profile: SovMappingProfileDraft) => Promise<void> | void;
  savingProfile?: boolean;
  pending?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [parsed, setParsed] = useState<ParsedSheet | null>(null);
  const [map, setMap] = useState<ColumnMap>({});
  const [hasHeader, setHasHeader] = useState(true);
  const [sourceName, setSourceName] = useState("");
  const [profileName, setProfileName] = useState("");
  const [pasteText, setPasteText] = useState("");
  const [mode, setMode] = useState<"replace" | "append">("replace");
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const handleFile = async (file: File) => {
    setError(null);
    try {
      const ext = file.name.toLowerCase().split(".").pop();
      const p =
        ext === "pdf"
          ? await parsePdf(file)
          : ext === "xlsx" || ext === "xls"
            ? await parseXlsx(file)
            : await parseCsv(file);
      const guessedMap = guessColumnMap(p.matrix, p.hasHeader);
      setParsed(p);
      setHasHeader(p.hasHeader);
      setSourceName(file.name);
      setProfileName(`${file.name.replace(/\.[^.]+$/, "")} mapping`);
      setMap(guessedMap);
      if (p.matrix.length === 0) {
        setError(
          "No tabular rows detected. If this is a scanned PDF, export it as CSV/XLSX or paste the rows manually.",
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to parse file.");
    }
  };

  const handlePaste = () => {
    setError(null);
    if (!pasteText.trim()) {
      setError("Paste some rows first.");
      return;
    }
    const p = parsePaste(pasteText);
    setParsed(p);
    setHasHeader(p.hasHeader);
    setSourceName("Pasted rows");
    setProfileName("Pasted SOV mapping");
    setMap(guessColumnMap(p.matrix, p.hasHeader));
  };

  const reset = () => {
    setParsed(null);
    setMap({});
    setError(null);
    setSourceName("");
    setProfileName("");
    setPasteText("");
    if (fileRef.current) fileRef.current.value = "";
  };

  const rows: BucketImportRow[] = parsed ? applyMapping(parsed.matrix, hasHeader, map) : [];
  const plannedRows = planImportRows(rows, existingBuckets, mode);
  const valid = plannedRows.filter((r) => r.valid);
  const invalid = plannedRows.filter((r) => !r.valid);
  const createCount = plannedRows.filter((r) => r.valid && r.action === "create").length;
  const updateCount = plannedRows.filter((r) => r.valid && r.action === "update").length;
  const skippedCount = plannedRows.filter((r) => !r.valid || r.action === "skip").length;
  const total = valid.reduce((s, r) => s + r.original_budget, 0);
  const missingMappings = parsed ? missingRequiredMappings(map) : [];
  const intake = parsed ? analyzeSovIntake(parsed.matrix, hasHeader, map) : null;
  const compatibleProfiles = parsed
    ? mappingProfiles.filter(
        (profile) => !profile.source_type || profile.source_type === parsed.source,
      )
    : mappingProfiles;

  const setBudgetColumn = (columnIndex: number) => {
    const next = { ...map };
    for (const [k, field] of Object.entries(next)) {
      if (field === "original_budget") next[Number(k)] = "ignore";
    }
    next[columnIndex] = "original_budget";
    setMap(next);
  };

  const applyProfile = (profileId: string) => {
    const profile = mappingProfiles.find((item) => item.id === profileId);
    if (!profile) return;
    const nextMap = columnMapFromJson(profile.column_map);
    if (Object.keys(nextMap).length === 0) {
      setError("That saved mapping does not have any column assignments.");
      return;
    }
    setHasHeader(profile.has_header);
    setMap(nextMap);
    setProfileName(profile.name);
    setError(null);
  };

  const saveProfile = async () => {
    if (!parsed || !intake || !onSaveProfile) return;
    const name = profileName.trim() || `${intake.profile} mapping`;
    const selectedBudgetColumn = intake.selectedBudgetColumn ?? null;
    const selectedBudgetLabel =
      selectedBudgetColumn == null
        ? ""
        : (parsed.matrix[0]?.[selectedBudgetColumn] ?? `Column ${selectedBudgetColumn + 1}`);
    try {
      await onSaveProfile({
        name,
        source_type: parsed.source,
        source_sheet: parsed.sheetName ?? "",
        profile: intake.profile,
        confidence: intake.confidence,
        has_header: hasHeader,
        column_map: Object.fromEntries(
          Object.entries(map).map(([columnIndex, field]) => [columnIndex, field]),
        ),
        selected_budget_column: selectedBudgetColumn,
        selected_budget_label: selectedBudgetLabel.trim(),
        sample_headers: hasHeader ? (parsed.matrix[0] ?? []).slice(0, 80) : [],
        amount_choices: intake.amountChoices,
        warnings: intake.warnings,
      });
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Mapping profile did not save.");
    }
  };

  const commit = () => {
    if (missingMappings.length > 0) {
      setError(`Map these required columns before importing: ${missingMappings.join(", ")}.`);
      return;
    }
    if (valid.length === 0) {
      setError("No valid rows to import.");
      return;
    }
    const selectedBudgetColumn = intake?.selectedBudgetColumn ?? null;
    const selectedBudgetLabel =
      selectedBudgetColumn == null
        ? ""
        : (parsed?.matrix[0]?.[selectedBudgetColumn] ?? `Column ${selectedBudgetColumn + 1}`);
    const metadata: SovImportMetadata = {
      source_type: parsed?.source ?? "",
      source_name: sourceName,
      source_sheet: parsed?.sheetName ?? "",
      profile: intake?.profile ?? "",
      confidence: intake?.confidence ?? "unknown",
      has_header: hasHeader,
      raw_rows: intake?.rawRows ?? rows.length,
      staged_rows: valid.length,
      skipped_rows: skippedCount,
      merged_rows: intake?.mergedRows ?? 0,
      total_budget: total,
      selected_budget_column: selectedBudgetColumn,
      selected_budget_label: selectedBudgetLabel.trim(),
      column_map: Object.fromEntries(
        Object.entries(map).map(([columnIndex, field]) => [columnIndex, field]),
      ),
      amount_choices: intake?.amountChoices ?? [],
      warnings: intake?.warnings ?? [],
    };
    onImport(
      valid.map(({ valid: _v, reason: _r, action: _a, matchLabel: _m, ...row }) => row),
      mode,
      metadata,
    );
    setOpen(false);
    reset();
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <Upload className="h-3.5 w-3.5" /> Import budget
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-3xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="font-serif text-2xl">Budget Intake Assistant</SheetTitle>
          <SheetDescription>
            Drop in your cost spreadsheet as-is — SOV, estimate, or pay app. Overwatch maps it,
            stages the budget, flags the weird parts, and asks for confirmation before anything
            touches the job.
          </SheetDescription>
        </SheetHeader>

        {!parsed ? (
          <Tabs defaultValue="csv" className="mt-6">
            <div className="mb-4 rounded-md border border-hairline bg-surface p-3 text-xs text-muted-foreground">
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-foreground">
                What Overwatch will do
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <div>Detect cost codes, bucket names, and the most likely budget column.</div>
                <div>Stage the result first, including the total budget and any rejected rows.</div>
                <div>
                  Roll repeated estimate lines into cost-code buckets instead of rejecting them.
                </div>
                <div>
                  Keep the PM in control: replace the job budget or merge/update existing buckets.
                </div>
              </div>
            </div>
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="csv">CSV</TabsTrigger>
              <TabsTrigger value="xlsx">Excel (.xlsx)</TabsTrigger>
              <TabsTrigger value="pdf">PDF</TabsTrigger>
              <TabsTrigger value="paste">Paste</TabsTrigger>
            </TabsList>

            <TabsContent value="csv" className="space-y-3 pt-5">
              <Label>Choose a .csv file</Label>
              <Input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
              />
              <Tip>From QuickBooks: Reports → Budget vs Actuals → Export → CSV.</Tip>
            </TabsContent>

            <TabsContent value="xlsx" className="space-y-3 pt-5">
              <Label>Choose an .xlsx or .xls file</Label>
              <Input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
              />
              <Tip>
                BuilderTrend-style estimate reports, generic Excel files, and older .xls exports are
                supported. If multiple dollar columns exist, confirm which one is the budget.
              </Tip>
            </TabsContent>

            <TabsContent value="pdf" className="space-y-3 pt-5">
              <Label>Choose a .pdf file (AIA G702/G703, pay app, or SOV)</Label>
              <Input
                ref={fileRef}
                type="file"
                accept=".pdf,application/pdf"
                onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
              />
              <Tip>
                Works on text-based PDFs (most pay apps and exports). Scanned/image PDFs won't
                extract — export as CSV/XLSX or paste instead. After parsing, review the column
                mapping carefully; PDF tables are messier than spreadsheets.
              </Tip>
            </TabsContent>

            <TabsContent value="paste" className="space-y-3 pt-5">
              <Label>Paste the rows from Excel or your SOV worksheet</Label>
              <Textarea
                rows={10}
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                placeholder={
                  "In Excel: select your cost code / bucket / budget / actual / FTC columns including the header row, copy (Ctrl+C / ⌘+C), then paste here.\n\nIf you're starting the job, you can paste only codes, bucket names, and budgets.\n\nExample at job start:\nCode\tDivision\tBudget\n0100\tSitework\t220,000\n0200\tStructure\t540,000\n0300\tEnvelope\t430,000\n\nExample mid-job:\nCode\tDivision\tBudget\tActual\tFTC\n0100\tSitework\t220,000\t215,000\t8,000\n0200\tStructure\t540,000\t520,000\t35,000"
                }
                className="font-mono text-xs"
              />
              <Button onClick={handlePaste} variant="outline">
                Parse pasted rows
              </Button>
              <Tip>
                You can paste with just bucket and budget at job start. Actual becomes $0 and FTC
                becomes the remaining budget.
              </Tip>
            </TabsContent>
          </Tabs>
        ) : (
          <div className="mt-6 space-y-4">
            <div className="flex items-center justify-between gap-3 rounded-md border border-hairline bg-surface px-3 py-2 text-xs">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="h-4 w-4" />
                <span>
                  {parsed.source.toUpperCase()}
                  {parsed.sheetName ? ` · ${parsed.sheetName}` : ""} ·{" "}
                  {intake?.rawRows ?? rows.length} raw rows
                </span>
              </div>
              <Button size="sm" variant="ghost" onClick={reset}>
                Start over
              </Button>
            </div>

            {compatibleProfiles.length > 0 && (
              <div className="rounded-md border border-hairline bg-surface p-3">
                <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  Saved mapping
                </div>
                <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                  <Select onValueChange={applyProfile}>
                    <SelectTrigger>
                      <SelectValue placeholder="Apply a saved SOV mapping" />
                    </SelectTrigger>
                    <SelectContent>
                      {compatibleProfiles.map((profile) => (
                        <SelectItem key={profile.id} value={profile.id}>
                          {profile.name}
                          {profile.source_sheet ? ` · ${profile.source_sheet}` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="text-xs text-muted-foreground">
                    Reuse mappings for repeat BuilderTrend, QuickBooks, AIA, or estimator exports.
                  </div>
                </div>
              </div>
            )}

            {intake && <IntakeReview analysis={intake} onBudgetColumnChange={setBudgetColumn} />}

            <div className="flex items-center gap-4 text-xs">
              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={hasHeader}
                  onChange={(e) => setHasHeader(e.target.checked)}
                />
                First row is a header
              </label>
              <div className="ml-auto flex items-center gap-2">
                <span className="text-muted-foreground">After import:</span>
                <Select value={mode} onValueChange={(v) => setMode(v as "replace" | "append")}>
                  <SelectTrigger className="h-8 w-[160px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="replace">Replace all buckets</SelectItem>
                    <SelectItem value="append">Merge/update existing</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <ColumnMapper
              matrix={parsed.matrix}
              hasHeader={hasHeader}
              map={map}
              onChange={setMap}
            />

            {onSaveProfile && (
              <div className="rounded-md border border-hairline bg-surface p-3">
                <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
                  <div className="space-y-1.5">
                    <Label>Save this mapping for future imports</Label>
                    <Input
                      value={profileName}
                      onChange={(event) => setProfileName(event.target.value)}
                      placeholder="e.g. BuilderTrend estimate export"
                    />
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={saveProfile}
                    disabled={savingProfile || !parsed || missingMappings.length > 0}
                  >
                    {savingProfile ? "Saving…" : "Save mapping"}
                  </Button>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Saved mappings are shared with this company workspace so the next PM can import
                  the same spreadsheet format faster.
                </p>
              </div>
            )}

            {missingMappings.length > 0 && (
              <div className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
                Required mapping missing: {missingMappings.join(", ")}.
              </div>
            )}

            <div>
              <div className="mb-2 flex items-center gap-4 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1 text-success">
                  <Check className="h-3 w-3" /> {valid.length} staged
                </span>
                <span>{createCount} create</span>
                <span>{updateCount} update</span>
                {invalid.length > 0 && (
                  <span className="inline-flex items-center gap-1 text-danger">
                    <AlertTriangle className="h-3 w-3" /> {invalid.length} flagged
                  </span>
                )}
                {skippedCount > 0 && <span>{skippedCount} skip</span>}
                <span className="ml-auto tabular">Total budget: {fmtUSD(total)}</span>
              </div>
              <div className="max-h-[300px] overflow-auto rounded-md border border-hairline">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-surface">
                      <TableHead className="w-10" />
                      <TableHead>Action</TableHead>
                      <TableHead>Code</TableHead>
                      <TableHead>Bucket</TableHead>
                      <TableHead className="text-right">Budget</TableHead>
                      <TableHead className="text-right">Actual</TableHead>
                      <TableHead className="text-right">FTC</TableHead>
                      <TableHead>Note</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {plannedRows.slice(0, 50).map((r, i) => (
                      <TableRow key={i} className={!r.valid ? "bg-danger/5" : ""}>
                        <TableCell>
                          {r.valid ? (
                            <Check className="h-3.5 w-3.5 text-success" />
                          ) : (
                            <AlertTriangle className="h-3.5 w-3.5 text-danger" />
                          )}
                        </TableCell>
                        <TableCell className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
                          {r.valid ? r.action : "Skip"}
                        </TableCell>
                        <TableCell className="font-mono text-xs">{r.cost_code || "—"}</TableCell>
                        <TableCell className="font-medium">{r.bucket}</TableCell>
                        <TableCell className="text-right tabular">
                          {fmtUSD(r.original_budget)}
                        </TableCell>
                        <TableCell className="text-right tabular">
                          {fmtUSD(r.actual_to_date)}
                        </TableCell>
                        <TableCell className="text-right tabular">{fmtUSD(r.ftc)}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {r.reason ??
                            (r.action === "update"
                              ? `Matches ${r.matchLabel}. Blank actual/FTC cells preserve current values.`
                              : "—")}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {rows.length > 50 && (
                  <div className="border-t border-hairline px-3 py-2 text-center text-[11px] text-muted-foreground">
                    Showing first 50 of {rows.length} rows.
                  </div>
                )}
              </div>
            </div>

            {error && <p className="text-sm text-danger">{error}</p>}
          </div>
        )}

        <SheetFooter className="mt-6 flex items-center gap-2 sm:justify-between">
          <p className="text-xs text-muted-foreground">
            {mode === "replace"
              ? "Replacing will delete existing cost buckets and insert these rows."
              : "Merging updates matching cost codes or names, then adds new rows beneath them."}
          </p>
          <Button
            onClick={commit}
            disabled={!parsed || missingMappings.length > 0 || valid.length === 0 || pending}
          >
            {pending
              ? "Importing…"
              : `Import ${valid.length} bucket${valid.length === 1 ? "" : "s"}`}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

type PlannedImportRow = BucketImportRow & {
  action: "create" | "update" | "skip";
  matchLabel?: string;
};

const norm = (value: string) => value.trim().toLowerCase();
const FIELD_KEYS = [
  "cost_code",
  "bucket",
  "original_budget",
  "actual_to_date",
  "ftc",
  "sort_order",
  "ignore",
] as const satisfies readonly FieldKey[];

function columnMapFromJson(value: unknown): ColumnMap {
  const allowed = new Set<FieldKey>(FIELD_KEYS);
  const out: ColumnMap = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return out;
  for (const [columnIndex, field] of Object.entries(value)) {
    if (!allowed.has(field as FieldKey)) continue;
    const index = Number(columnIndex);
    if (!Number.isInteger(index) || index < 0) continue;
    out[index] = field as FieldKey;
  }
  return out;
}

function planImportRows(
  rows: BucketImportRow[],
  existingBuckets: BucketRow[],
  mode: "replace" | "append",
): PlannedImportRow[] {
  const byCode = new Map<string, BucketRow>();
  const byName = new Map<string, BucketRow>();
  for (const bucket of existingBuckets) {
    const codeKey = norm(bucket.cost_code);
    if (codeKey) byCode.set(codeKey, bucket);
    byName.set(norm(bucket.bucket), bucket);
  }

  return rows.map((row) => {
    if (!row.valid) return { ...row, action: "skip" as const };
    if (mode === "replace") return { ...row, action: "create" as const };

    const codeKey = norm(row.cost_code);
    const match = (codeKey ? byCode.get(codeKey) : null) ?? byName.get(norm(row.bucket));
    if (!match) return { ...row, action: "create" as const };

    return {
      ...row,
      action: "update" as const,
      matchLabel: match.cost_code ? `${match.cost_code} / ${match.bucket}` : match.bucket,
    };
  });
}

function Tip({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-md border border-hairline bg-surface px-3 py-2 text-xs text-muted-foreground">
      {children}
    </p>
  );
}

function IntakeReview({
  analysis,
  onBudgetColumnChange,
}: {
  analysis: ReturnType<typeof analyzeSovIntake>;
  onBudgetColumnChange: (columnIndex: number) => void;
}) {
  const confidenceClass =
    analysis.confidence === "high"
      ? "text-success"
      : analysis.confidence === "medium"
        ? "text-warning"
        : "text-danger";

  return (
    <div className="rounded-md border border-hairline bg-background">
      <div className="grid gap-0 border-b border-hairline sm:grid-cols-4">
        <div className="border-b border-hairline p-3 sm:border-b-0 sm:border-r">
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Detected
          </div>
          <div className="mt-1 font-medium">{analysis.profile}</div>
          <div
            className={`mt-1 text-xs font-semibold uppercase tracking-[0.14em] ${confidenceClass}`}
          >
            {analysis.confidence} confidence
          </div>
        </div>
        <Metric label="Raw rows" value={analysis.rawRows.toString()} />
        <Metric label="Staged buckets" value={analysis.importRows.toString()} />
        <Metric label="Budget total" value={fmtUSD(analysis.totalBudget)} tone="strong" />
      </div>

      <div className="grid gap-4 p-3 md:grid-cols-[minmax(0,1fr)_minmax(240px,0.7fr)]">
        <div className="space-y-2">
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Budget basis
          </div>
          {analysis.amountChoices.length > 0 ? (
            <Select
              value={
                analysis.selectedBudgetColumn == null
                  ? undefined
                  : String(analysis.selectedBudgetColumn)
              }
              onValueChange={(value) => onBudgetColumnChange(Number(value))}
            >
              <SelectTrigger className="h-auto min-h-10 text-left">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {analysis.amountChoices.map((choice) => (
                  <SelectItem key={choice.columnIndex} value={String(choice.columnIndex)}>
                    {choice.label} · {fmtUSD(choice.total)}
                    {choice.basis === "cost" ? " · cost" : ""}
                    {choice.basis === "sell" ? " · client price" : ""}
                    {choice.basis === "unit" ? " · unit" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <div className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
              No clear dollar column was detected. Map Original budget below before importing.
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Confirm this total against the estimate or SOV before importing. If it looks wrong,
            change the budget basis or fix the column map below.
          </p>
        </div>

        <div className="space-y-2">
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Review flags
          </div>
          {analysis.warnings.length > 0 ? (
            <div className="space-y-1.5">
              {analysis.warnings.slice(0, 4).map((warning, index) => (
                <div
                  key={`${warning}-${index}`}
                  className="rounded-md border border-warning/30 bg-warning/10 px-2.5 py-2 text-xs text-warning"
                >
                  {warning}
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-md border border-success/30 bg-success/10 px-2.5 py-2 text-xs text-success">
              No obvious import issues found.
            </div>
          )}
          {analysis.skippedRowReasons.length > 0 && (
            <div className="space-y-1.5">
              {analysis.skippedRowReasons.slice(0, 3).map((summary) => (
                <div
                  key={summary.reason}
                  className="rounded-md border border-hairline bg-muted/30 px-2.5 py-2 text-xs"
                >
                  <div className="font-medium">
                    {summary.count} {summary.reason.toLowerCase()}
                    {summary.count === 1 ? "" : "s"} skipped
                  </div>
                  {summary.examples.length > 0 && (
                    <div className="mt-1 text-muted-foreground">
                      Examples: {summary.examples.join("; ")}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-hairline p-3">
        <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          <Sparkles className="h-3.5 w-3.5 text-accent" />
          Contextual mapping assistant
        </div>
        <div className="grid gap-2 md:grid-cols-2">
          {analysis.columnSuggestions.map((suggestion) => (
            <div
              key={suggestion.columnIndex}
              className="rounded-md border border-hairline bg-surface px-3 py-2 text-xs"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-medium">{suggestion.label}</div>
                  <div className="mt-0.5 text-muted-foreground">
                    Mapped as {FIELD_LABELS[suggestion.field]}
                  </div>
                </div>
                <span
                  className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-[0.12em] ${
                    suggestion.confidence === "high"
                      ? "border-success/30 bg-success/10 text-success"
                      : suggestion.confidence === "medium"
                        ? "border-warning/30 bg-warning/10 text-warning"
                        : "border-danger/30 bg-danger/10 text-danger"
                  }`}
                >
                  {suggestion.confidence}
                </span>
              </div>
              <div className="mt-2 space-y-1 text-muted-foreground">
                {suggestion.reasons.slice(0, 2).map((reason) => (
                  <div key={reason}>{reason}</div>
                ))}
              </div>
              {suggestion.samples.length > 0 && (
                <div className="mt-2 truncate rounded border border-hairline bg-background px-2 py-1 font-mono text-[11px] text-muted-foreground">
                  {suggestion.samples.join(" | ")}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "strong" }) {
  return (
    <div className="border-b border-hairline p-3 sm:border-b-0 sm:border-r last:sm:border-r-0">
      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </div>
      <div className={`mt-1 text-lg tabular ${tone === "strong" ? "font-semibold" : ""}`}>
        {value}
      </div>
    </div>
  );
}

function ColumnMapper({
  matrix,
  hasHeader,
  map,
  onChange,
}: {
  matrix: Matrix;
  hasHeader: boolean;
  map: ColumnMap;
  onChange: (m: ColumnMap) => void;
}) {
  if (matrix.length === 0) return null;
  const ncols = Math.max(...matrix.map((r) => r.length));
  const header = hasHeader ? matrix[0] : [];
  const sample = matrix.slice(hasHeader ? 1 : 0, hasHeader ? 4 : 3);

  return (
    <div className="space-y-2">
      <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        Match columns to fields
      </div>
      <div className="overflow-x-auto rounded-md border border-hairline">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-surface">
              {Array.from({ length: ncols }).map((_, i) => (
                <th key={i} className="px-2 py-2 text-left font-medium">
                  <div className="text-muted-foreground">
                    {hasHeader ? (header[i] ?? `Col ${i + 1}`) : `Col ${i + 1}`}
                  </div>
                  <Select
                    value={map[i] ?? "ignore"}
                    onValueChange={(v) => {
                      const next = { ...map };
                      // Clear any other column claiming this non-ignore field
                      if (v !== "ignore") {
                        for (const [k, f] of Object.entries(next)) {
                          if (f === v && Number(k) !== i) next[Number(k)] = "ignore";
                        }
                      }
                      next[i] = v as FieldKey;
                      onChange(next);
                    }}
                  >
                    <SelectTrigger className="mt-1 h-7 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(
                        [
                          "bucket",
                          "cost_code",
                          "original_budget",
                          "actual_to_date",
                          "ftc",
                          "sort_order",
                          "ignore",
                        ] as FieldKey[]
                      ).map((f) => (
                        <SelectItem key={f} value={f}>
                          {FIELD_LABELS[f]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sample.map((r, ri) => (
              <tr key={ri} className="border-t border-hairline">
                {Array.from({ length: ncols }).map((_, ci) => (
                  <td key={ci} className="px-2 py-1.5 tabular text-foreground/80">
                    {r[ci] ?? ""}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
