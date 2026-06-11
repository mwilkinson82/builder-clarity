import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger, SheetFooter, SheetDescription,
} from "@/components/ui/sheet";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Upload, Check, AlertTriangle, FileSpreadsheet } from "lucide-react";
import {
  parseCsv, parseXlsx, parsePaste, guessColumnMap, applyMapping,
  type Matrix, type ParsedSheet, type ColumnMap, type FieldKey, type BucketImportRow,
} from "@/lib/sov-import";
import { fmtUSD } from "@/lib/format";

const FIELD_LABELS: Record<FieldKey, string> = {
  bucket: "Bucket name",
  original_budget: "Original budget",
  actual_to_date: "Actual to date",
  ftc: "Forecast to complete",
  sort_order: "Sort order",
  ignore: "Ignore",
};

export function ImportSOVSheet({
  onImport,
  pending,
}: {
  onImport: (rows: { bucket: string; original_budget: number; actual_to_date: number; ftc: number; sort_order: number }[], mode: "replace" | "append") => void;
  pending?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [parsed, setParsed] = useState<ParsedSheet | null>(null);
  const [map, setMap] = useState<ColumnMap>({});
  const [hasHeader, setHasHeader] = useState(true);
  const [pasteText, setPasteText] = useState("");
  const [mode, setMode] = useState<"replace" | "append">("replace");
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const handleFile = async (file: File) => {
    setError(null);
    try {
      const ext = file.name.toLowerCase().split(".").pop();
      const p = ext === "xlsx" || ext === "xls" ? await parseXlsx(file) : await parseCsv(file);
      setParsed(p);
      setHasHeader(p.hasHeader);
      setMap(guessColumnMap(p.matrix, p.hasHeader));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to parse file.");
    }
  };

  const handlePaste = () => {
    setError(null);
    if (!pasteText.trim()) { setError("Paste some rows first."); return; }
    const p = parsePaste(pasteText);
    setParsed(p);
    setHasHeader(p.hasHeader);
    setMap(guessColumnMap(p.matrix, p.hasHeader));
  };

  const reset = () => {
    setParsed(null); setMap({}); setError(null); setPasteText("");
    if (fileRef.current) fileRef.current.value = "";
  };

  const rows: BucketImportRow[] = parsed ? applyMapping(parsed.matrix, hasHeader, map) : [];
  const valid = rows.filter((r) => r.valid);
  const invalid = rows.filter((r) => !r.valid);
  const total = valid.reduce((s, r) => s + r.original_budget, 0);

  const commit = () => {
    if (valid.length === 0) { setError("No valid rows to import."); return; }
    onImport(valid.map(({ valid: _v, reason: _r, ...row }) => row), mode);
    setOpen(false);
    reset();
  };

  return (
    <Sheet open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <Upload className="h-3.5 w-3.5" /> Import SOV
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-3xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="font-serif text-2xl">Import Schedule of Values</SheetTitle>
          <SheetDescription>
            CSV from QuickBooks, an Excel file, or pasted cells from any spreadsheet. We'll auto-detect the columns and you confirm the mapping before anything is created.
          </SheetDescription>
        </SheetHeader>

        {!parsed ? (
          <Tabs defaultValue="csv" className="mt-6">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="csv">CSV</TabsTrigger>
              <TabsTrigger value="xlsx">Excel (.xlsx)</TabsTrigger>
              <TabsTrigger value="paste">Paste from spreadsheet</TabsTrigger>
            </TabsList>

            <TabsContent value="csv" className="space-y-3 pt-5">
              <Label>Choose a .csv file</Label>
              <Input ref={fileRef} type="file" accept=".csv,text/csv" onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
              <Tip>From QuickBooks: Reports → Budget vs Actuals → Export → CSV.</Tip>
            </TabsContent>

            <TabsContent value="xlsx" className="space-y-3 pt-5">
              <Label>Choose an .xlsx or .xls file</Label>
              <Input ref={fileRef} type="file" accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
              <Tip>We read the first sheet only. If your SOV is on a tab named differently, move it to the first tab before exporting.</Tip>
            </TabsContent>

            <TabsContent value="paste" className="space-y-3 pt-5">
              <Label>Paste the rows from Excel or your SOV worksheet</Label>
              <Textarea
                rows={10}
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                placeholder={"In Excel: select your bucket / budget / actual / FTC columns including the header row, copy (Ctrl+C / ⌘+C), then paste here.\n\nExample:\nDivision\tBudget\tActual\tFTC\nSitework\t220,000\t215,000\t8,000\nStructure\t540,000\t520,000\t35,000"}
                className="font-mono text-xs"
              />
              <Button onClick={handlePaste} variant="outline">Parse pasted rows</Button>
              <Tip>Tip: copy from Excel including the header row. We'll guess which column is which.</Tip>
            </TabsContent>
          </Tabs>
        ) : (
          <div className="mt-6 space-y-4">
            <div className="flex items-center justify-between gap-3 rounded-md border border-hairline bg-surface px-3 py-2 text-xs">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="h-4 w-4" />
                <span>{parsed.source.toUpperCase()}{parsed.sheetName ? ` · ${parsed.sheetName}` : ""}  ·  {rows.length} rows detected</span>
              </div>
              <Button size="sm" variant="ghost" onClick={reset}>Start over</Button>
            </div>

            <div className="flex items-center gap-4 text-xs">
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={hasHeader} onChange={(e) => setHasHeader(e.target.checked)} />
                First row is a header
              </label>
              <div className="ml-auto flex items-center gap-2">
                <span className="text-muted-foreground">After import:</span>
                <Select value={mode} onValueChange={(v) => setMode(v as "replace" | "append")}>
                  <SelectTrigger className="h-8 w-[160px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="replace">Replace all buckets</SelectItem>
                    <SelectItem value="append">Append to existing</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <ColumnMapper matrix={parsed.matrix} hasHeader={hasHeader} map={map} onChange={setMap} />

            <div>
              <div className="mb-2 flex items-center gap-4 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1 text-success"><Check className="h-3 w-3" /> {valid.length} valid</span>
                {invalid.length > 0 && <span className="inline-flex items-center gap-1 text-danger"><AlertTriangle className="h-3 w-3" /> {invalid.length} flagged</span>}
                <span className="ml-auto tabular">Total budget: {fmtUSD(total)}</span>
              </div>
              <div className="max-h-[300px] overflow-auto rounded-md border border-hairline">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-surface">
                      <TableHead className="w-10" />
                      <TableHead>Bucket</TableHead>
                      <TableHead className="text-right">Budget</TableHead>
                      <TableHead className="text-right">Actual</TableHead>
                      <TableHead className="text-right">FTC</TableHead>
                      <TableHead>Note</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.slice(0, 50).map((r, i) => (
                      <TableRow key={i} className={!r.valid ? "bg-danger/5" : ""}>
                        <TableCell>{r.valid ? <Check className="h-3.5 w-3.5 text-success" /> : <AlertTriangle className="h-3.5 w-3.5 text-danger" />}</TableCell>
                        <TableCell className="font-medium">{r.bucket}</TableCell>
                        <TableCell className="text-right tabular">{fmtUSD(r.original_budget)}</TableCell>
                        <TableCell className="text-right tabular">{fmtUSD(r.actual_to_date)}</TableCell>
                        <TableCell className="text-right tabular">{fmtUSD(r.ftc)}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{r.reason ?? "—"}</TableCell>
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
              : "Appending keeps existing buckets and adds these rows beneath them."}
          </p>
          <Button onClick={commit} disabled={!parsed || valid.length === 0 || pending}>
            {pending ? "Importing…" : `Import ${valid.length} bucket${valid.length === 1 ? "" : "s"}`}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function Tip({ children }: { children: React.ReactNode }) {
  return <p className="rounded-md border border-hairline bg-surface px-3 py-2 text-xs text-muted-foreground">{children}</p>;
}

function ColumnMapper({
  matrix, hasHeader, map, onChange,
}: { matrix: Matrix; hasHeader: boolean; map: ColumnMap; onChange: (m: ColumnMap) => void }) {
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
                  <div className="text-muted-foreground">{hasHeader ? (header[i] ?? `Col ${i + 1}`) : `Col ${i + 1}`}</div>
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
                    <SelectTrigger className="mt-1 h-7 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(["bucket","original_budget","actual_to_date","ftc","sort_order","ignore"] as FieldKey[]).map((f) => (
                        <SelectItem key={f} value={f}>{FIELD_LABELS[f]}</SelectItem>
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
                  <td key={ci} className="px-2 py-1.5 tabular text-foreground/80">{r[ci] ?? ""}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
