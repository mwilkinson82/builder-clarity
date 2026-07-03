import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertTriangle, FileSpreadsheet, ListChecks, Upload } from "lucide-react";
import { parseCsv, parseXlsx, type ParsedSheet } from "@/lib/sov-import";
import {
  SCHEDULE_IMPORT_DEFAULT_DURATION_DAYS,
  SCHEDULE_IMPORT_FIELD_LABELS,
  SCHEDULE_IMPORT_FIELD_ORDER,
  buildScheduleImportActivityInputs,
  buildScheduleImportPreviewRows,
  buildSovSchedulePreviewRows,
  guessScheduleImportColumnMap,
  type ScheduleImportColumnMap,
  type ScheduleImportField,
  type ScheduleImportPreviewRow,
  type SovScheduleLine,
} from "@/lib/schedule-import";
import type { ScheduleActivityRow } from "@/lib/schedule.functions";
import { type ActivityCreateInput, shortDate } from "./scheduleShared";

export type ScheduleImportWizardMode = "file" | "sov";

type WizardStep = "upload" | "map" | "preview";

// Import wizard for Tasks "bring your schedule in": Excel/CSV file import and
// Build-from-SOV share the same preview/confirm table. Rows import with NO
// logic ties by design — the schedule is a starting point the PM tweaks.
export function ScheduleImportWizard({
  open,
  mode,
  onOpenChange,
  activities,
  sovLines,
  projectId,
  anchorDate,
  isImporting,
  onImport,
}: {
  open: boolean;
  mode: ScheduleImportWizardMode;
  onOpenChange: (open: boolean) => void;
  activities: ScheduleActivityRow[];
  sovLines: SovScheduleLine[];
  projectId: string;
  anchorDate: string;
  isImporting: boolean;
  onImport: (rows: ActivityCreateInput[], summary: { sourceLabel: string }) => void;
}) {
  const [step, setStep] = useState<WizardStep>(mode === "file" ? "upload" : "preview");
  const [fileName, setFileName] = useState("");
  const [parseError, setParseError] = useState<string | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [sheet, setSheet] = useState<ParsedSheet | null>(null);
  const [hasHeader, setHasHeader] = useState(true);
  const [columnMap, setColumnMap] = useState<ScheduleImportColumnMap | null>(null);
  const [rows, setRows] = useState<ScheduleImportPreviewRow[]>([]);
  const [defaultDurationDraft, setDefaultDurationDraft] = useState(
    String(SCHEDULE_IMPORT_DEFAULT_DURATION_DAYS),
  );
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const resetWizard = () => {
    setStep(mode === "file" ? "upload" : "preview");
    setFileName("");
    setParseError(null);
    setSheet(null);
    setHasHeader(true);
    setColumnMap(null);
    setRows([]);
    setDefaultDurationDraft(String(SCHEDULE_IMPORT_DEFAULT_DURATION_DAYS));
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) resetWizard();
    onOpenChange(nextOpen);
  };

  const sheetRef = useRef<ParsedSheet | null>(null);
  sheetRef.current = sheet;

  // Snapshot the rows when the dialog opens. Not keyed on sovLines/activities:
  // a background refetch while the dialog is open must not clobber the
  // per-row include choices the user already made.
  useEffect(() => {
    if (!open) return;
    if (mode === "sov") {
      setRows(buildSovSchedulePreviewRows(sovLines, activities));
      setStep("preview");
    } else {
      setStep((current) => (sheetRef.current ? current : "upload"));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode]);

  const headerLabels = useMemo(() => {
    if (!sheet) return [];
    const width = Math.max(...sheet.matrix.map((row) => row.length), 0);
    return Array.from({ length: width }, (_, index) => {
      const header = hasHeader ? (sheet.matrix[0]?.[index] ?? "").trim() : "";
      const generic = `Column ${columnLetter(index)}`;
      return header ? `${header}` : generic;
    });
  }, [hasHeader, sheet]);

  const sampleRow = useMemo(() => {
    if (!sheet) return [];
    return sheet.matrix[hasHeader ? 1 : 0] ?? [];
  }, [hasHeader, sheet]);

  const handleFile = async (file: File | null | undefined) => {
    if (!file) return;
    setParseError(null);
    setIsParsing(true);
    try {
      const isCsv = /\.csv$/i.test(file.name);
      const parsed = isCsv ? await parseCsv(file) : await parseXlsx(file);
      if (parsed.matrix.length === 0) {
        setParseError("The file has no readable rows. Export the schedule tab and try again.");
        return;
      }
      setFileName(file.name);
      setSheet(parsed);
      setHasHeader(parsed.hasHeader);
      setColumnMap(guessScheduleImportColumnMap(parsed.hasHeader ? parsed.matrix[0] : []));
      setStep("map");
    } catch (error) {
      setParseError(
        error instanceof Error
          ? `The file could not be read: ${error.message}`
          : "The file could not be read. Save it as .xlsx or .csv and try again.",
      );
    } finally {
      setIsParsing(false);
    }
  };

  const applyHasHeader = (next: boolean) => {
    setHasHeader(next);
    if (sheet) {
      setColumnMap(guessScheduleImportColumnMap(next ? sheet.matrix[0] : []));
    }
  };

  const goToPreview = () => {
    if (!sheet || !columnMap) return;
    setRows(buildScheduleImportPreviewRows(sheet.matrix, hasHeader, columnMap));
    setStep("preview");
  };

  const includedRows = rows.filter((row) => row.include && row.description);
  const excludedCount = rows.length - includedRows.length;
  const defaultDurationDays = Math.max(
    1,
    Math.round(Number(defaultDurationDraft)) || SCHEDULE_IMPORT_DEFAULT_DURATION_DAYS,
  );
  const rowsNeedingPlacedDates = includedRows.filter(
    (row) => !row.startDate && !row.finishDate,
  ).length;

  const confirmImport = () => {
    const sourceLabel = mode === "sov" ? "the schedule of values" : fileName || "a schedule file";
    const inputs = buildScheduleImportActivityInputs(rows, activities, {
      defaultDurationDays,
      anchorDate,
      sourceLabel,
    });
    if (inputs.length === 0) return;
    onImport(inputs, { sourceLabel });
    resetWizard();
  };

  const toggleRow = (rowNumber: number, include: boolean) => {
    setRows((current) =>
      current.map((row) => (row.rowNumber === rowNumber ? { ...row, include } : row)),
    );
  };

  const setAllRows = (include: boolean) => {
    setRows((current) =>
      current.map((row) => ({ ...row, include: include && Boolean(row.description) })),
    );
  };

  const isSovWithoutLines = mode === "sov" && sovLines.length === 0;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-5xl gap-0 overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-serif text-2xl">
            <FileSpreadsheet className="h-5 w-5" />
            {mode === "sov" ? "Build schedule from the SOV" : "Import schedule"}
          </DialogTitle>
          <DialogDescription>
            {mode === "sov"
              ? "Each schedule-of-values line becomes a proposed activity. Uncheck anything that is not schedule work — this suggests, it never forces."
              : "Bring in the schedule you already have. Every activity and duration comes in as a starting point; you tag logic ties in Overwatch afterward."}
          </DialogDescription>
        </DialogHeader>

        {mode === "file" && (
          <div className="mt-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            <WizardStepChip index={1} label="Upload" active={step === "upload"} />
            <WizardStepChip index={2} label="Match columns" active={step === "map"} />
            <WizardStepChip index={3} label="Check rows" active={step === "preview"} />
          </div>
        )}

        {isSovWithoutLines ? (
          <div className="mt-4 rounded-md border border-hairline bg-surface p-5 text-sm text-foreground">
            <div className="font-semibold">This project has no schedule of values yet.</div>
            <p className="mt-2 text-muted-foreground">
              Build from SOV reads the project&apos;s budget lines and proposes one activity per
              line. Import or enter the SOV on the project&apos;s budget workspace first, then come
              back here.
            </p>
            <Button asChild type="button" variant="outline" className="mt-4">
              <a href={`/projects/${projectId}`}>Open the project budget</a>
            </Button>
          </div>
        ) : null}

        {!isSovWithoutLines && step === "upload" && (
          <div className="mt-4">
            <div
              className="flex flex-col items-center justify-center gap-3 rounded-md border border-dashed border-hairline bg-surface px-6 py-10 text-center"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                void handleFile(event.dataTransfer.files?.[0]);
              }}
            >
              <Upload className="h-6 w-6 text-muted-foreground" />
              <div className="text-sm text-foreground">
                Drop the schedule file here, or choose it below.
              </div>
              <div className="text-xs text-muted-foreground">
                Excel (.xlsx) or CSV — exports from Excel, MS Project, or Primavera work. The first
                sheet is read.
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={(event) => {
                  void handleFile(event.target.files?.[0]);
                  event.target.value = "";
                }}
              />
              <Button
                type="button"
                className="gap-2"
                disabled={isParsing}
                onClick={() => fileInputRef.current?.click()}
              >
                <FileSpreadsheet className="h-4 w-4" />
                {isParsing ? "Reading file..." : "Choose file"}
              </Button>
            </div>
            {parseError && (
              <div className="mt-3 rounded-md border border-danger/25 bg-danger/10 px-3 py-2 text-sm text-danger">
                {parseError}
              </div>
            )}
          </div>
        )}

        {!isSovWithoutLines && step === "map" && sheet && columnMap && (
          <div className="mt-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm text-muted-foreground">
                <span className="font-semibold text-foreground">{fileName}</span> ·{" "}
                {sheet.matrix.length - (hasHeader ? 1 : 0)} rows
                {sheet.sheetName ? ` · sheet "${sheet.sheetName}"` : ""}
              </div>
              <label className="flex items-center gap-2 text-sm text-foreground">
                <Checkbox
                  checked={hasHeader}
                  onCheckedChange={(checked) => applyHasHeader(checked === true)}
                />
                First row is column names
              </label>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Point each schedule field at the right column. Only Description is required —
              everything else is optional.
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {SCHEDULE_IMPORT_FIELD_ORDER.map((field) => (
                <ColumnMapField
                  key={field}
                  field={field}
                  columnMap={columnMap}
                  headerLabels={headerLabels}
                  sampleRow={sampleRow}
                  onChange={(column) =>
                    setColumnMap((current) => (current ? { ...current, [field]: column } : current))
                  }
                />
              ))}
            </div>
            {columnMap.description === -1 && (
              <div className="mt-3 rounded-md border border-warning/25 bg-warning/10 px-3 py-2 text-sm text-warning">
                Choose which column holds the activity description before continuing.
              </div>
            )}
            <div className="mt-4 flex justify-between gap-2">
              <Button type="button" variant="ghost" onClick={() => setStep("upload")}>
                Back
              </Button>
              <Button type="button" disabled={columnMap.description === -1} onClick={goToPreview}>
                Continue to row check
              </Button>
            </div>
          </div>
        )}

        {!isSovWithoutLines && step === "preview" && (
          <div className="mt-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="text-sm text-muted-foreground">
                <span className="font-semibold text-foreground">
                  {includedRows.length} of {rows.length} rows
                </span>{" "}
                will import{excludedCount > 0 ? ` · ${excludedCount} left out` : ""}. Activities
                import with no logic ties — you tag predecessors afterward.
              </div>
              <div className="flex items-end gap-2">
                <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  Default duration (days)
                  <Input
                    type="number"
                    min={1}
                    value={defaultDurationDraft}
                    onChange={(event) => setDefaultDurationDraft(event.target.value)}
                    className="h-9 w-28 tabular"
                  />
                </label>
                <Button type="button" variant="outline" size="sm" onClick={() => setAllRows(true)}>
                  Check all
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => setAllRows(false)}>
                  Uncheck all
                </Button>
              </div>
            </div>
            {rowsNeedingPlacedDates > 0 && (
              <div className="mt-2 text-xs text-muted-foreground">
                {rowsNeedingPlacedDates} {rowsNeedingPlacedDates === 1 ? "row has" : "rows have"} no
                dates — they are placed one after another starting {shortDate(anchorDate)} as
                placeholders to adjust after import.
              </div>
            )}
            <div className="mt-3 max-h-[42vh] overflow-auto rounded-md border border-hairline">
              <table className="w-full min-w-[760px] border-collapse text-sm">
                <thead className="sticky top-0 bg-card text-left text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                  <tr>
                    <th className="border-b border-hairline px-2 py-2 w-10"></th>
                    <th className="border-b border-hairline px-2 py-2 w-12">Row</th>
                    <th className="border-b border-hairline px-2 py-2 w-24">ID</th>
                    <th className="border-b border-hairline px-2 py-2">Description</th>
                    <th className="border-b border-hairline px-2 py-2 w-40">WBS / area</th>
                    <th className="border-b border-hairline px-2 py-2 w-20">Days</th>
                    <th className="border-b border-hairline px-2 py-2 w-24">Start</th>
                    <th className="border-b border-hairline px-2 py-2 w-24">Finish</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <PreviewRow
                      key={row.rowNumber}
                      row={row}
                      defaultDurationDays={defaultDurationDays}
                      onToggle={(include) => toggleRow(row.rowNumber, include)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4 flex justify-between gap-2">
              {mode === "file" ? (
                <Button type="button" variant="ghost" onClick={() => setStep("map")}>
                  Back to columns
                </Button>
              ) : (
                <span />
              )}
              <Button
                type="button"
                className="gap-2"
                disabled={includedRows.length === 0 || isImporting}
                onClick={confirmImport}
              >
                <ListChecks className="h-4 w-4" />
                {isImporting
                  ? "Importing..."
                  : `Import ${includedRows.length} ${
                      includedRows.length === 1 ? "activity" : "activities"
                    }`}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function WizardStepChip({
  index,
  label,
  active,
}: {
  index: number;
  label: string;
  active: boolean;
}) {
  return (
    <span
      className={
        active
          ? "rounded-full border border-foreground bg-foreground px-2.5 py-1 text-background"
          : "rounded-full border border-hairline bg-surface px-2.5 py-1"
      }
    >
      {index}. {label}
    </span>
  );
}

function ColumnMapField({
  field,
  columnMap,
  headerLabels,
  sampleRow,
  onChange,
}: {
  field: ScheduleImportField;
  columnMap: ScheduleImportColumnMap;
  headerLabels: string[];
  sampleRow: string[];
  onChange: (column: number) => void;
}) {
  const value = columnMap[field];
  const sample = value >= 0 ? (sampleRow[value] ?? "").trim() : "";
  return (
    <div className="rounded-md border border-hairline bg-surface p-3">
      <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {SCHEDULE_IMPORT_FIELD_LABELS[field]}
        {field === "description" ? " · required" : " · optional"}
      </div>
      <Select
        value={value === -1 ? "none" : String(value)}
        onValueChange={(next) => onChange(next === "none" ? -1 : Number(next))}
      >
        <SelectTrigger className="mt-2 h-9 bg-card">
          <SelectValue placeholder="Not mapped" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">Not mapped</SelectItem>
          {headerLabels.map((label, index) => (
            <SelectItem key={`${index}-${label}`} value={String(index)}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="mt-1.5 min-h-4 truncate text-xs text-muted-foreground">
        {sample ? `e.g. ${sample}` : value >= 0 ? "" : "Skipped"}
      </div>
    </div>
  );
}

function PreviewRow({
  row,
  defaultDurationDays,
  onToggle,
}: {
  row: ScheduleImportPreviewRow;
  defaultDurationDays: number;
  onToggle: (include: boolean) => void;
}) {
  const hasError = row.issues.some((issue) => issue.level === "error");
  const effectiveDuration = row.durationDays ?? defaultDurationDays;
  return (
    <>
      <tr className={row.include ? "bg-card" : "bg-surface text-muted-foreground"}>
        <td className="border-b border-hairline px-2 py-1.5 align-top">
          <Checkbox
            checked={row.include}
            disabled={hasError}
            onCheckedChange={(checked) => onToggle(checked === true)}
            aria-label={`Include row ${row.rowNumber}`}
          />
        </td>
        <td className="border-b border-hairline px-2 py-1.5 align-top tabular">{row.rowNumber}</td>
        <td className="border-b border-hairline px-2 py-1.5 align-top">
          {row.activityId || <span className="text-muted-foreground">auto</span>}
        </td>
        <td className="border-b border-hairline px-2 py-1.5 align-top">
          {row.description || <span className="italic text-danger">blank</span>}
        </td>
        <td className="border-b border-hairline px-2 py-1.5 align-top">{row.wbs || "General"}</td>
        <td className="border-b border-hairline px-2 py-1.5 align-top tabular">
          {row.startDate && row.finishDate ? (
            <span title="Read from the start and finish dates">from dates</span>
          ) : row.durationDays != null ? (
            `${row.durationDays}d`
          ) : (
            <span title="The default duration applies">{`${effectiveDuration}d default`}</span>
          )}
        </td>
        <td className="border-b border-hairline px-2 py-1.5 align-top tabular">
          {row.startDate ? shortDate(row.startDate) : "—"}
        </td>
        <td className="border-b border-hairline px-2 py-1.5 align-top tabular">
          {row.finishDate ? shortDate(row.finishDate) : "—"}
        </td>
      </tr>
      {row.issues.length > 0 && (
        <tr className={row.include ? "bg-card" : "bg-surface"}>
          <td className="border-b border-hairline" />
          <td colSpan={7} className="border-b border-hairline px-2 pb-2 pt-0">
            {row.issues.map((issue) => (
              <span
                key={issue.message}
                className={
                  issue.level === "error"
                    ? "mr-3 inline-flex items-center gap-1 text-xs text-danger"
                    : "mr-3 inline-flex items-center gap-1 text-xs text-warning"
                }
              >
                <AlertTriangle className="h-3 w-3 shrink-0" />
                {issue.message}
              </span>
            ))}
          </td>
        </tr>
      )}
    </>
  );
}

function columnLetter(index: number) {
  let label = "";
  let cursor = index;
  do {
    label = String.fromCharCode(65 + (cursor % 26)) + label;
    cursor = Math.floor(cursor / 26) - 1;
  } while (cursor >= 0);
  return label;
}
