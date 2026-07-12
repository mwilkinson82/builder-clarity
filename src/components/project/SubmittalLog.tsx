// RFI & SUBMITTALS LOG (docs/compliance arc, module 3). Two Excel-style logs —
// RFIs and Submittals — the way GCs already run them: number, spec section,
// sub/rev, item, description, manufacturer/supplier, dates out/back, a color-
// coded status (A / AAN / RAR / U/R), and comments. Rows edit inline (commit on
// blur). A List/Board toggle shows the same log as a table or a pipeline of
// kanban columns. From either log you generate a branded Letter of Transmittal /
// cover letter to send the architect/engineer.
//
// The RFI tab wears RFI-native vocabulary (Subject / Question / Ball in court /
// Answered / Days open) mapped ONTO the existing submittal columns — no DB field
// is renamed and no column is added (see PER-KIND CONFIG below). The underlying
// status ladder ('' | pending | ur | rar | aan | a) and every mutation are
// unchanged; only the labels the user reads differ per kind.
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { FileDown, FileText, Paperclip, Plus, Trash2, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import {
  deleteSubmittalLogEntry,
  deleteTransmittal,
  getProjectLetterhead,
  listSubmittalLog,
  listTransmittals,
  patchSubmittalLogEntry,
  saveSubmittalLogEntry,
  saveTransmittal,
  type SubmittalLogEntryRow,
  type SubmittalLogKind,
  type SubmittalLogStatus,
  type TransmittalRow,
} from "@/lib/submittal-log.functions";
import { generateTransmittalPdf, type TransmittalAttachment } from "@/lib/transmittal-pdf";
import { daysOutstanding, isOverdue, isReturned, pipelineCounts } from "@/lib/submittal-domain";

// ── Status ladder, per-kind vocabulary ─────────────────────────────────────
// Same underlying enum for both logs; only the words differ. Submittals read
// with the architect's action codes (A / AAN / RAR / U/R); RFIs read in the
// question-and-answer language GCs use for design queries.
type StatusOpt = { value: SubmittalLogStatus; short: string; label: string; tone: string };
const STATUS_OPTIONS: Record<SubmittalLogKind, StatusOpt[]> = {
  submittal: [
    { value: "", short: "—", label: "Not set", tone: "text-muted-foreground" },
    {
      value: "pending",
      short: "P",
      label: "Pending — not sent yet",
      tone: "text-muted-foreground",
    },
    { value: "ur", short: "U/R", label: "Under review", tone: "text-warning" },
    { value: "rar", short: "RAR", label: "Revise & resubmit", tone: "text-danger" },
    { value: "aan", short: "AAN", label: "Approved as noted", tone: "text-accent" },
    { value: "a", short: "A", label: "Approved", tone: "text-success" },
  ],
  rfi: [
    { value: "", short: "—", label: "Not set", tone: "text-muted-foreground" },
    { value: "pending", short: "Open", label: "Open — not sent", tone: "text-warning" },
    { value: "ur", short: "Awaiting", label: "Awaiting answer", tone: "text-warning" },
    { value: "rar", short: "Revise", label: "Revise & resubmit", tone: "text-danger" },
    { value: "aan", short: "Answered*", label: "Answered — with notes", tone: "text-success" },
    { value: "a", short: "Answered", label: "Answered", tone: "text-success" },
  ],
};
const statusTone = (kind: SubmittalLogKind, s: SubmittalLogStatus) =>
  STATUS_OPTIONS[kind].find((x) => x.value === s)?.tone ?? "";
const optionText = (kind: SubmittalLogKind, o: StatusOpt) =>
  o.value === "" ? "—" : kind === "submittal" ? `${o.short} · ${o.label}` : o.label;

// Legend under the log — submittals list the action codes; RFIs describe the
// three states a question moves through.
const LEGEND: Record<SubmittalLogKind, { short: string; label: string; tone: string }[]> = {
  submittal: STATUS_OPTIONS.submittal
    .filter((s) => s.value)
    .map((s) => ({ short: s.short, label: s.label, tone: s.tone })),
  rfi: [
    { short: "Open", label: "Awaiting an answer", tone: "text-warning" },
    { short: "Overdue", label: "Past the needed-by date", tone: "text-danger" },
    { short: "Answered", label: "Response received", tone: "text-success" },
  ],
};

// ── PER-KIND COLUMN CONFIG ──────────────────────────────────────────────────
// One table renderer, two column lists. Every text/date column names a REAL DB
// field; the RFI headers relabel three existing columns (item → Subject,
// description → Question, mfgr_supplier → Ball in court). "days" and "status"
// are derived/enum cells with no direct one-field mapping.
type CellKind = "text" | "date" | "days" | "status";
interface ColDef {
  key: string;
  header: string;
  cell: CellKind;
  w?: string;
}
const COLUMNS: Record<SubmittalLogKind, ColDef[]> = {
  submittal: [
    { key: "number", header: "No.", cell: "text", w: "min-w-[52px] font-mono text-xs" },
    { key: "spec_section", header: "Spec", cell: "text", w: "min-w-[60px]" },
    { key: "sub_rev", header: "Sub/Rev", cell: "text", w: "min-w-[52px]" },
    { key: "item", header: "Item", cell: "text", w: "min-w-[80px]" },
    { key: "description", header: "Description", cell: "text", w: "min-w-[200px]" },
    { key: "mfgr_supplier", header: "Mfgr / Supplier", cell: "text", w: "min-w-[130px]" },
    { key: "date_submitted", header: "Submitted", cell: "date" },
    { key: "date_returned", header: "Returned", cell: "date" },
    { key: "due_date", header: "Due", cell: "date" },
    { key: "days", header: "Days out", cell: "days" },
    { key: "status", header: "Status", cell: "status" },
    { key: "comments", header: "Comments", cell: "text", w: "min-w-[160px]" },
  ],
  rfi: [
    { key: "number", header: "No.", cell: "text", w: "min-w-[64px] font-mono text-xs" },
    { key: "spec_section", header: "Spec", cell: "text", w: "min-w-[60px]" },
    { key: "item", header: "Subject", cell: "text", w: "min-w-[150px]" },
    { key: "description", header: "Question", cell: "text", w: "min-w-[220px]" },
    { key: "mfgr_supplier", header: "Ball in court", cell: "text", w: "min-w-[120px]" },
    { key: "date_submitted", header: "Submitted", cell: "date" },
    { key: "date_returned", header: "Answered", cell: "date" },
    { key: "due_date", header: "Due", cell: "date" },
    { key: "days", header: "Days open", cell: "days" },
    { key: "status", header: "Status", cell: "status" },
  ],
};
const MIN_TABLE_W: Record<SubmittalLogKind, string> = {
  submittal: "min-w-[1050px]",
  rfi: "min-w-[940px]",
};

// ── Board (kanban) config ───────────────────────────────────────────────────
// Single-placement pipeline stage derived INLINE from the same predicates the
// tiles use (isReturned / isOverdue / date_submitted). Unlike pipelineCounts —
// where an overdue item is ALSO counted in its base bucket — a kanban card lives
// in exactly one column, so Overdue is pulled out with precedence.
type Stage = "pending" | "out" | "overdue" | "returned";
function stageOf(entry: SubmittalLogEntryRow, today: string): Stage {
  if (isReturned(entry)) return "returned";
  if (isOverdue(entry, today)) return "overdue";
  if (entry.date_submitted) return "out";
  return "pending";
}
const BOARD_COLUMNS: Record<SubmittalLogKind, { key: Stage; label: string; tone: string }[]> = {
  rfi: [
    { key: "pending", label: "Open", tone: "text-warning" },
    { key: "out", label: "Awaiting answer", tone: "text-warning" },
    { key: "overdue", label: "Overdue", tone: "text-danger" },
    { key: "returned", label: "Answered", tone: "text-success" },
  ],
  submittal: [
    { key: "pending", label: "Pending", tone: "text-muted-foreground" },
    { key: "out", label: "Out for review", tone: "text-warning" },
    { key: "overdue", label: "Overdue", tone: "text-danger" },
    { key: "returned", label: "Returned", tone: "text-success" },
  ],
};

const VERDICT: Record<SubmittalLogKind, string> = {
  rfi: "The RFI log — questions out, answers back, and who's holding the ball.",
  submittal: "The submittal log — what's out for review and who owes a return.",
};
const CHIP: Record<SubmittalLogKind, string> = { rfi: "RFI LOG", submittal: "SUBMITTAL LOG" };

const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// Best-effort next number for the Add dialog: reuse the most recent numbered
// row's non-digit prefix + width and increment. Editable — never authoritative.
function suggestNextNumber(kind: SubmittalLogKind, rows: readonly SubmittalLogEntryRow[]): string {
  let prefix: string | null = null;
  let width = 3;
  let max = 0;
  for (const r of rows) {
    const m = r.number.match(/^(.*?)(\d+)\s*$/);
    if (!m) continue;
    const val = Number(m[2]);
    if (val >= max) {
      max = val;
      prefix = m[1];
      width = m[2].length;
    }
  }
  if (prefix === null) return kind === "rfi" ? "RFI-001" : "";
  return `${prefix}${String(max + 1).padStart(width, "0")}`;
}

async function uploadLogFile(projectId: string, file: File) {
  const safe = file.name.replace(/[^a-zA-Z0-9._-]+/g, "-");
  const path = `${projectId}/logs/${crypto.randomUUID()}-${safe}`;
  const { error } = await supabase.storage
    .from("project-docs")
    .upload(path, file, { contentType: file.type || "application/octet-stream", upsert: false });
  if (error) {
    toast.error("Upload failed", { description: error.message });
    return null;
  }
  return { path, name: file.name };
}
async function viewLogFile(path: string) {
  if (!path) return;
  const { data, error } = await supabase.storage.from("project-docs").createSignedUrl(path, 600);
  if (error || !data?.signedUrl) return toast.error("Could not open the document");
  window.open(data.signedUrl, "_blank", "noopener,noreferrer");
}
// Pull a log attachment's bytes for the transmittal package (signed URL → fetch).
// Returns null on any failure so one bad file never sinks the whole transmittal.
async function fetchLogFileBytes(
  path: string,
): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  const { data, error } = await supabase.storage.from("project-docs").createSignedUrl(path, 600);
  if (error || !data?.signedUrl) return null;
  try {
    const res = await fetch(data.signedUrl);
    if (!res.ok) return null;
    return {
      bytes: new Uint8Array(await res.arrayBuffer()),
      contentType: res.headers.get("content-type") ?? "",
    };
  } catch {
    return null;
  }
}

interface Props {
  projectId: string;
  projectName: string;
  jobNumber: string;
}

export function SubmittalLog({ projectId, projectName, jobNumber }: Props) {
  const qc = useQueryClient();
  const listFn = useServerFn(listSubmittalLog);
  const saveFn = useServerFn(saveSubmittalLogEntry);
  const patchFn = useServerFn(patchSubmittalLogEntry);
  const deleteFn = useServerFn(deleteSubmittalLogEntry);
  const letterheadFn = useServerFn(getProjectLetterhead);
  const listTxFn = useServerFn(listTransmittals);
  const saveTxFn = useServerFn(saveTransmittal);
  const deleteTxFn = useServerFn(deleteTransmittal);

  const [kind, setKind] = useState<SubmittalLogKind>("submittal");
  const [viewMode, setViewMode] = useState<"list" | "board">("list");
  const [addOpen, setAddOpen] = useState(false);
  // Set when a board card is clicked → jump to the list and scroll the row in.
  const [focusId, setFocusId] = useState<string | null>(null);

  const entriesQuery = useQuery({
    queryKey: ["submittal-log", projectId],
    queryFn: () => listFn({ data: { projectId } }),
  });
  // The durable transmittal register — every cover letter generated for this
  // project. Degrades to [] before the migration lands (see listTransmittals).
  const txQuery = useQuery({
    queryKey: ["transmittals", projectId],
    queryFn: () => listTxFn({ data: { projectId } }),
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: ["submittal-log", projectId] });
  const save = useMutation({
    mutationFn: (input: Record<string, unknown>) =>
      saveFn({ data: { projectId, ...input } as never }),
    onSuccess: invalidate,
    onError: (e) =>
      toast.error("Could not save", { description: e instanceof Error ? e.message : "" }),
  });
  // One field at a time — a partial update, so two quick cell edits never
  // overwrite each other's columns.
  const patch = useMutation({
    mutationFn: (input: { id: string } & Record<string, unknown>) =>
      patchFn({ data: input as never }),
    onSuccess: invalidate,
    onError: (e) =>
      toast.error("Could not save", { description: e instanceof Error ? e.message : "" }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: invalidate,
  });

  const rows = useMemo(
    () => (entriesQuery.data ?? []).filter((e) => e.kind === kind),
    [entriesQuery.data, kind],
  );

  // Clear the board-focus highlight shortly after it lands.
  useEffect(() => {
    if (!focusId) return;
    const t = setTimeout(() => setFocusId(null), 1800);
    return () => clearTimeout(t);
  }, [focusId]);

  // ── Transmittal / cover-letter builder (RFIs and submittals both) ──
  const [txOpen, setTxOpen] = useState(false);
  const [txTo, setTxTo] = useState("");
  const [txAttn, setTxAttn] = useState("");
  const [txRe, setTxRe] = useState("");
  const [txNo, setTxNo] = useState("");
  const [txBy, setTxBy] = useState("");
  const [txPicked, setTxPicked] = useState<Set<string>>(new Set());
  const [txBusy, setTxBusy] = useState(false);

  // Switching logs clears any half-made transmittal selection and board focus.
  const switchKind = (k: SubmittalLogKind) => {
    setKind(k);
    setTxPicked(new Set());
    setFocusId(null);
  };

  const kindNoun = kind === "rfi" ? "RFI" : "submittal";
  const kindNounPlural = kind === "rfi" ? "RFIs" : "submittals";

  const togglePick = (id: string) =>
    setTxPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const generate = async () => {
    setTxBusy(true);
    try {
      const letterhead = await letterheadFn({ data: { projectId } });
      const picked = rows.filter((r) => txPicked.has(r.id));
      const entries = picked.length > 0 ? picked : rows;
      // Pull each transmitted item's attached document so the download is the
      // cover letter followed by the actual documents (field request
      // 2026-07-09). A file that can't be fetched is reported, not fatal.
      const attachments: TransmittalAttachment[] = [];
      const failed: string[] = [];
      for (const entry of entries) {
        if (!entry.storage_path) continue;
        const label = [entry.number, entry.description || entry.item].filter(Boolean).join(" · ");
        const file = await fetchLogFileBytes(entry.storage_path);
        if (!file) {
          failed.push(entry.file_name || label || entry.number || "attachment");
          continue;
        }
        attachments.push({
          label,
          fileName: entry.file_name,
          bytes: file.bytes,
          contentType: file.contentType,
        });
      }
      const result = await generateTransmittalPdf({
        letterhead,
        projectName,
        jobNumber,
        kind,
        entries,
        to: txTo,
        attn: txAttn,
        re: txRe,
        transmittalNumber: txNo,
        senderName: txBy,
        generatedAt: new Date(),
        attachments,
      });
      const notIncluded = [...failed, ...result.skipped];
      if (notIncluded.length > 0) {
        toast("Transmittal downloaded — some attachments weren't included", {
          description: `${notIncluded.join(", ")} couldn't be added to the PDF. Send ${
            notIncluded.length === 1 ? "it" : "them"
          } separately.`,
        });
      }

      // ── Best-effort persistence (ADDITIVE) ──────────────────────────────────
      // The user already has the download (generateTransmittalPdf triggered it
      // above). Recording it must NEVER block or undo that, so ALL of this runs
      // in its own try/catch: upload the PDF bytes to 'project-docs', then log a
      // durable transmittal record. Any failure — storage down, table missing,
      // network — just skips persistence with a soft toast.
      try {
        const safeName = result.fileName.replace(/[^a-zA-Z0-9._-]+/g, "-");
        const path = `${projectId}/transmittals/${crypto.randomUUID()}-${safeName}`;
        const { error: upErr } = await supabase.storage
          .from("project-docs")
          .upload(path, result.bytes, {
            contentType: "application/pdf",
            upsert: false,
          });
        const saved = await saveTxFn({
          data: {
            projectId,
            kind,
            number: txNo,
            to_party: txTo,
            attn: txAttn,
            re: txRe,
            sent_by: txBy,
            sent_at: todayStr(),
            entry_ids: entries.map((e) => e.id),
            storage_path: upErr ? "" : path,
            file_name: result.fileName,
            notes: "",
          },
        });
        if ("persisted" in saved && saved.persisted === false) {
          toast("Transmittal downloaded; log entry not saved", {
            description: "The transmittal log isn't enabled on this workspace yet.",
          });
        } else {
          qc.invalidateQueries({ queryKey: ["transmittals", projectId] });
        }
      } catch {
        // Persistence is best-effort — the download already succeeded.
        toast("Transmittal downloaded; log entry not saved");
      }
    } catch (e) {
      toast.error("Could not build the transmittal", {
        description: e instanceof Error ? e.message : "Try again.",
      });
    } finally {
      setTxBusy(false);
    }
  };

  // Persist a new row via the SAME save mutation the inline add used. New rows
  // start as PENDING — the planned-at-job-start stage. If the pipeline migration
  // isn't applied yet, fall back to the legacy blank status so adding keeps
  // working. Throws on any other failure (the mutation's onError toasts).
  const submitAdd = async (fields: Record<string, unknown>) => {
    const base = { ...fields, kind, sort_order: rows.length };
    const wanted = (fields.status as SubmittalLogStatus) || "pending";
    try {
      await save.mutateAsync({ ...base, status: wanted });
    } catch (e) {
      if (e instanceof Error && /database update pending/i.test(e.message)) {
        await save.mutateAsync({ ...base, status: "" });
      } else {
        throw e;
      }
    }
  };

  const columns = COLUMNS[kind];
  const statusOptions = STATUS_OPTIONS[kind];
  const pickable = txOpen && viewMode === "list";
  // Every transmittal ever generated for this project (both kinds) — the log
  // shows the complete send history regardless of which log is toggled above.
  const txRecords = txQuery.data ?? [];

  // Remove a transmittal from the register: clear its archived PDF (best-effort),
  // then delete the row. Confirmed because it's a durable audit record.
  const removeTransmittal = async (t: TransmittalRow) => {
    if (
      !window.confirm(
        `Delete transmittal ${t.number ? `#${t.number}` : ""}? This removes the register record${
          t.storage_path ? " and its archived PDF" : ""
        }.`,
      )
    )
      return;
    try {
      if (t.storage_path) await supabase.storage.from("project-docs").remove([t.storage_path]);
      await deleteTxFn({ data: { id: t.id } });
      qc.invalidateQueries({ queryKey: ["transmittals", projectId] });
      toast.success("Transmittal removed");
    } catch (e) {
      toast.error("Could not remove the transmittal", {
        description: e instanceof Error ? e.message : "Try again.",
      });
    }
  };

  return (
    <section className="space-y-5">
      {/* Header — breadcrumb + log chip + List/Board toggle, then the verdict. */}
      <div>
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="text-xs text-muted-foreground">Docs / RFIs &amp; submittals</span>
          <span className="rounded-md border border-hairline px-1.5 py-0.5 font-mono text-[8.5px] font-bold uppercase tracking-[0.12em] text-clay">
            {CHIP[kind]}
          </span>
          <div className="ml-auto inline-flex gap-0.5 rounded-lg bg-muted p-0.5">
            {(["list", "board"] as const).map((v) => {
              const active = viewMode === v;
              return (
                <button
                  key={v}
                  type="button"
                  onClick={() => setViewMode(v)}
                  aria-pressed={active}
                  className={cn(
                    "cursor-pointer rounded-md px-3.5 py-1.5 text-xs font-semibold capitalize transition-colors",
                    active
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {v}
                </button>
              );
            })}
          </div>
        </div>
        <div className="mt-4">
          <h1 className="max-w-[36ch] font-serif text-[30px] font-normal leading-tight text-foreground">
            {VERDICT[kind]}
          </h1>
          <p className="mt-2 max-w-[72ch] text-sm leading-relaxed text-muted-foreground">
            Toggle between Submittals and RFIs. Every item sends with a cover letter / transmittal;
            switch to the Board view to see the pipeline as columns.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3">
        {/* Segmented switch — makes it obvious these are two separate logs you
            pick between (the plain-text tabs read as non-clickable labels). */}
        <div>
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Which log
          </div>
          <div
            role="tablist"
            aria-label="Choose log"
            className="inline-flex rounded-lg border border-hairline bg-surface p-1"
          >
            {(["submittal", "rfi"] as SubmittalLogKind[]).map((k) => {
              const active = kind === k;
              const count = (entriesQuery.data ?? []).filter((e) => e.kind === k).length;
              return (
                <button
                  key={k}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => switchKind(k)}
                  className={cn(
                    "cursor-pointer rounded-md px-4 py-1.5 text-sm font-medium transition-colors",
                    active
                      ? "bg-accent text-accent-foreground shadow-sm"
                      : "text-muted-foreground hover:bg-background hover:text-foreground",
                  )}
                >
                  {k === "submittal" ? "Submittals" : "RFIs"}
                  <span
                    className={cn(
                      "ml-2 rounded-full px-1.5 py-0.5 text-[11px] tabular-nums",
                      active ? "bg-white/25" : "bg-hairline/70 text-muted-foreground",
                    )}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() => setTxOpen((v) => !v)}
          >
            <FileDown className="h-3.5 w-3.5" /> Transmittal
          </Button>
          <Button type="button" size="sm" className="gap-1.5" onClick={() => setAddOpen(true)}>
            <Plus className="h-3.5 w-3.5" /> Add {kindNoun}
          </Button>
        </div>
      </div>

      {/* Pipeline at a glance (field request 2026-07-10): plan the list up
          front, then track what's out, what's overdue, what's back. */}
      {rows.length > 0
        ? (() => {
            const counts = pipelineCounts(rows, todayStr());
            const tiles =
              kind === "rfi"
                ? [
                    { label: "Open", value: counts.pending, sub: "", tone: "text-warning" },
                    {
                      label: "Awaiting answer",
                      value: counts.outForReview,
                      sub: counts.maxDaysOut > 0 ? `longest ${counts.maxDaysOut}d` : "",
                      tone: "text-warning",
                    },
                    {
                      label: "Overdue",
                      value: counts.overdue,
                      sub: "",
                      tone: counts.overdue > 0 ? "text-danger" : "text-muted-foreground",
                    },
                    { label: "Answered", value: counts.returned, sub: "", tone: "text-success" },
                  ]
                : [
                    {
                      label: "Pending — not sent",
                      value: counts.pending,
                      sub: "",
                      tone: "text-muted-foreground",
                    },
                    {
                      label: "Out for review",
                      value: counts.outForReview,
                      sub: counts.maxDaysOut > 0 ? `longest wait ${counts.maxDaysOut}d` : "",
                      tone: "text-warning",
                    },
                    {
                      label: "Overdue",
                      value: counts.overdue,
                      sub: "",
                      tone: counts.overdue > 0 ? "text-danger" : "text-muted-foreground",
                    },
                    { label: "Returned", value: counts.returned, sub: "", tone: "text-success" },
                  ];
            return (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {tiles.map((t) => (
                  <div
                    key={t.label}
                    className="rounded-md border border-hairline bg-surface px-3 py-2"
                  >
                    <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                      {t.label}
                    </div>
                    <div className={`mt-0.5 text-lg font-semibold tabular-nums ${t.tone}`}>
                      {t.value}
                      {t.sub ? (
                        <span className="ml-2 text-[11px] font-normal text-muted-foreground">
                          {t.sub}
                        </span>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            );
          })()
        : null}

      {/* Transmittal / cover-letter builder */}
      {txOpen ? (
        <div className="rounded-lg border border-hairline bg-card p-4 shadow-card">
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            {kind === "rfi" ? "Cover letter / transmittal" : "Letter of transmittal"}
          </div>
          <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <LabeledInput
              label="To (architect / engineer)"
              value={txTo}
              onChange={setTxTo}
              placeholder="e.g. Nassau County DPW"
            />
            <LabeledInput
              label="Attn"
              value={txAttn}
              onChange={setTxAttn}
              placeholder="Reviewer name"
            />
            <LabeledInput label="Re" value={txRe} onChange={setTxRe} placeholder="Subject" />
            <LabeledInput
              label="Transmittal No."
              value={txNo}
              onChange={setTxNo}
              placeholder="001"
            />
            <LabeledInput
              label="Transmitted by"
              value={txBy}
              onChange={setTxBy}
              placeholder="Your name"
            />
          </div>
          <div className="mt-3 flex items-center justify-between gap-3">
            <p className="text-[11px] text-muted-foreground">
              {txPicked.size > 0
                ? `${txPicked.size} item${txPicked.size === 1 ? "" : "s"} selected${
                    viewMode === "list" ? " (check the rows below)" : ""
                  }.`
                : `No rows checked — all ${kindNounPlural} will be included.`}
            </p>
            <Button
              type="button"
              size="sm"
              className="gap-1.5"
              onClick={generate}
              disabled={txBusy}
            >
              <FileDown className="h-3.5 w-3.5" /> {txBusy ? "Building…" : "Generate PDF"}
            </Button>
          </div>
        </div>
      ) : null}

      {/* Log — table or board */}
      {viewMode === "board" ? (
        <BoardView
          rows={rows}
          kind={kind}
          statusOptions={statusOptions}
          onCardClick={(id) => {
            setViewMode("list");
            setFocusId(id);
          }}
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-hairline bg-card shadow-card">
          <table className={cn("w-full text-sm", MIN_TABLE_W[kind])}>
            <thead>
              <tr className="border-b border-hairline bg-surface text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
                {pickable ? <th className="w-8 px-2 py-2" /> : null}
                {columns.map((c) => (
                  <th key={c.key} className="px-2 py-2 text-left">
                    {c.header}
                  </th>
                ))}
                <th className="w-16 px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((entry) => (
                <LogRow
                  key={entry.id}
                  entry={entry}
                  kind={kind}
                  columns={columns}
                  statusOptions={statusOptions}
                  projectId={projectId}
                  pickable={pickable}
                  picked={txPicked.has(entry.id)}
                  focused={focusId === entry.id}
                  onPick={() => togglePick(entry.id)}
                  onPatch={(p) => patch.mutate({ id: entry.id, ...p })}
                  onDelete={() => {
                    if (confirm("Delete this row?")) remove.mutate(entry.id);
                  }}
                />
              ))}
              {rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={columns.length + (pickable ? 2 : 1)}
                    className="px-3 py-8 text-center text-sm text-muted-foreground"
                  >
                    No {kindNounPlural} logged yet. Add one above.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}

      {/* Legend */}
      <div className="flex flex-wrap gap-3 text-[11px]">
        {LEGEND[kind].map((s) => (
          <span key={s.short} className={s.tone}>
            <span className="font-semibold">{s.short}</span> {s.label}
          </span>
        ))}
      </div>

      {/* Transmittal log — the durable record of every cover letter generated
          for this project (submittals and RFIs alike). Best-effort: absent until
          the transmittals table lands, then it just fills in. Quietly renders
          nothing when there's nothing to show. */}
      {txRecords.length > 0 ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="font-mono text-[8.5px] font-bold uppercase tracking-[0.12em] text-clay">
              Transmittal log
            </span>
            <span className="text-[11px] text-muted-foreground">
              Every cover letter sent from this project.
            </span>
          </div>
          <div className="overflow-x-auto rounded-lg border border-hairline bg-card shadow-card">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-hairline bg-surface text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
                  <th className="px-2 py-2 text-left">No.</th>
                  <th className="px-2 py-2 text-left">To</th>
                  <th className="px-2 py-2 text-left">Re</th>
                  <th className="px-2 py-2 text-left">Items</th>
                  <th className="px-2 py-2 text-left">Sent</th>
                  <th className="w-28 px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {txRecords.map((t) => (
                  <tr key={t.id} className="border-b border-hairline/60 last:border-0">
                    <td className="px-2 py-2 font-mono text-xs">{t.number || "—"}</td>
                    <td className="px-2 py-2">{t.to_party || "—"}</td>
                    <td className="px-2 py-2 text-muted-foreground">{t.re || "—"}</td>
                    <td className="px-2 py-2 tabular-nums">{t.entry_ids.length}</td>
                    <td className="px-2 py-2 tabular-nums text-muted-foreground">
                      {t.sent_at || "—"}
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex items-center justify-end gap-3">
                        {t.storage_path ? (
                          <button
                            type="button"
                            onClick={() => viewLogFile(t.storage_path)}
                            className="inline-flex items-center gap-1 text-xs font-medium text-clay hover:underline"
                          >
                            <FileDown className="h-3 w-3" /> Download
                          </button>
                        ) : (
                          <span className="text-[11px] text-muted-foreground">—</span>
                        )}
                        <button
                          type="button"
                          onClick={() => removeTransmittal(t)}
                          className="text-muted-foreground hover:text-danger"
                          aria-label={`Delete transmittal ${t.number || ""}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <AddEntryDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        kind={kind}
        statusOptions={statusOptions}
        projectId={projectId}
        suggestedNumber={suggestNextNumber(kind, rows)}
        submitting={save.isPending}
        onSubmit={submitAdd}
      />
    </section>
  );
}

// ── Board view ──────────────────────────────────────────────────────────────
function BoardView({
  rows,
  kind,
  statusOptions,
  onCardClick,
}: {
  rows: SubmittalLogEntryRow[];
  kind: SubmittalLogKind;
  statusOptions: StatusOpt[];
  onCardClick: (id: string) => void;
}) {
  const today = todayStr();
  const cols = BOARD_COLUMNS[kind];
  const grouped = useMemo(() => {
    const map: Record<Stage, SubmittalLogEntryRow[]> = {
      pending: [],
      out: [],
      overdue: [],
      returned: [],
    };
    for (const r of rows) map[stageOf(r, today)].push(r);
    return map;
  }, [rows, today]);

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {cols.map((col) => {
        const items = grouped[col.key];
        return (
          <div key={col.key} className="rounded-lg border border-hairline bg-surface p-2.5">
            <div className="mb-2 flex items-center justify-between px-0.5">
              <span
                className={cn(
                  "font-mono text-[8.5px] font-bold uppercase tracking-[0.12em]",
                  col.tone,
                )}
              >
                {col.label}
              </span>
              <span className="text-[11px] font-semibold tabular-nums text-muted-foreground">
                {items.length}
              </span>
            </div>
            <div className="space-y-2">
              {items.length === 0 ? (
                <div className="px-1 py-3 text-center text-[11px] text-muted-foreground">None</div>
              ) : (
                items.map((entry) => (
                  <BoardCard
                    key={entry.id}
                    entry={entry}
                    kind={kind}
                    stage={col}
                    statusOptions={statusOptions}
                    today={today}
                    onClick={() => onCardClick(entry.id)}
                  />
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function BoardCard({
  entry,
  kind,
  stage,
  statusOptions,
  today,
  onClick,
}: {
  entry: SubmittalLogEntryRow;
  kind: SubmittalLogKind;
  stage: { key: Stage; label: string; tone: string };
  statusOptions: StatusOpt[];
  today: string;
  onClick: () => void;
}) {
  const days = daysOutstanding(entry, today);
  const overdue = isOverdue(entry, today);
  const subject = entry.item || entry.description || "Untitled";
  const court = entry.mfgr_supplier;
  const statusOpt = statusOptions.find((s) => s.value === entry.status);
  // A short due/timing hint, whichever is most useful for this card.
  const timing =
    overdue && entry.due_date
      ? "overdue"
      : days !== null
        ? `${days}d ${kind === "rfi" ? "open" : "out"}`
        : entry.due_date
          ? `due ${entry.due_date}`
          : "";

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full rounded-md border border-hairline bg-card p-2.5 text-left transition-colors hover:border-clay/40 hover:bg-background"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[11px] text-muted-foreground">{entry.number || "—"}</span>
        <span
          className={cn(
            "rounded border border-current px-1.5 py-0.5 font-mono text-[8.5px] font-bold uppercase tracking-[0.04em]",
            stage.tone,
          )}
        >
          {stage.label}
        </span>
      </div>
      <div className="mt-1 line-clamp-2 text-[12.5px] font-medium leading-snug text-foreground">
        {subject}
      </div>
      {court ? (
        <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{court}</div>
      ) : null}
      <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px]">
        <span
          className={cn(
            "tabular-nums",
            overdue ? "text-danger" : days !== null ? "text-warning" : "text-muted-foreground",
          )}
        >
          {timing || "—"}
        </span>
        {statusOpt && statusOpt.value ? (
          <span className={cn("font-semibold", statusOpt.tone)}>{statusOpt.short}</span>
        ) : null}
      </div>
    </button>
  );
}

function LogRow({
  entry,
  kind,
  columns,
  statusOptions,
  projectId,
  pickable,
  picked,
  focused,
  onPick,
  onPatch,
  onDelete,
}: {
  entry: SubmittalLogEntryRow;
  kind: SubmittalLogKind;
  columns: ColDef[];
  statusOptions: StatusOpt[];
  projectId: string;
  pickable: boolean;
  picked: boolean;
  focused: boolean;
  onPick: () => void;
  onPatch: (patch: Partial<SubmittalLogEntryRow>) => void;
  onDelete: () => void;
}) {
  const [d, setD] = useState(entry);
  const rowRef = useRef<HTMLTableRowElement>(null);
  // A board card click routes here — scroll the focused row into view.
  useEffect(() => {
    if (!focused) return;
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    rowRef.current?.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
  }, [focused]);

  // Each field commits as its OWN partial update (see patchSubmittalLogEntry), so
  // a second cell edit never overwrites the first with a stale full-row payload.
  const commit = (field: keyof SubmittalLogEntryRow, value: string) => {
    if (String(d[field] ?? "") === value) return;
    // Filling in the submitted date moves a planned item forward on its own:
    // pending (or legacy not-set) -> Under review. One patch, no extra click.
    if (field === "date_submitted" && value && (d.status === "pending" || d.status === "")) {
      setD({ ...d, date_submitted: value, status: "ur" });
      onPatch({ date_submitted: value, status: "ur" } as Partial<SubmittalLogEntryRow>);
      return;
    }
    setD({ ...d, [field]: value });
    onPatch({ [field]: value } as Partial<SubmittalLogEntryRow>);
  };
  const cell = (field: keyof SubmittalLogEntryRow, w = "") => (
    <td key={field} className="px-1 py-1">
      <input
        defaultValue={String(entry[field] ?? "")}
        onBlur={(e) => commit(field, e.target.value)}
        className={`w-full ${w} rounded border border-transparent bg-transparent px-1.5 py-1 text-sm focus:border-input focus:bg-background`}
      />
    </td>
  );
  const dateCell = (field: "date_submitted" | "date_returned" | "due_date") => (
    <td key={field} className="px-1 py-1">
      <input
        type="date"
        defaultValue={entry[field] ?? ""}
        onBlur={(e) => commit(field, e.target.value)}
        className="w-[122px] rounded border border-transparent bg-transparent px-1 py-1 text-xs focus:border-input focus:bg-background"
      />
    </td>
  );
  const daysCell = () => (
    <td key="days" className="px-1 py-1">
      {(() => {
        const today = todayStr();
        const days = daysOutstanding(d, today);
        const overdue = isOverdue(d, today);
        if (days === null && !overdue)
          return <span className="text-xs text-muted-foreground">{"—"}</span>;
        return (
          <span
            className={`text-xs font-semibold tabular-nums ${overdue ? "text-danger" : "text-warning"}`}
          >
            {days !== null ? `${days}d` : ""}
            {overdue ? (days !== null ? " · overdue" : "overdue") : ""}
          </span>
        );
      })()}
    </td>
  );
  const statusCell = () => (
    <td key="status" className="px-1 py-1">
      <select
        value={d.status}
        onChange={(e) => commit("status", e.target.value)}
        className={`rounded border border-input bg-surface px-1.5 py-1 text-xs font-semibold ${statusTone(kind, d.status)}`}
      >
        {statusOptions.map((s) => (
          <option key={s.value} value={s.value}>
            {optionText(kind, s)}
          </option>
        ))}
      </select>
    </td>
  );

  return (
    <tr
      ref={rowRef}
      className={cn(
        "border-b border-hairline/70 align-top last:border-0",
        focused && "bg-accent/10 ring-2 ring-clay/40",
      )}
    >
      {pickable ? (
        <td className="px-2 py-2">
          <input type="checkbox" checked={picked} onChange={onPick} className="h-3.5 w-3.5" />
        </td>
      ) : null}
      {columns.map((col) => {
        if (col.cell === "date")
          return dateCell(col.key as "date_submitted" | "date_returned" | "due_date");
        if (col.cell === "days") return daysCell();
        if (col.cell === "status") return statusCell();
        return cell(col.key as keyof SubmittalLogEntryRow, col.w);
      })}
      <td className="px-2 py-2">
        <div className="flex items-center gap-1.5">
          {entry.storage_path ? (
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground"
              onClick={() => viewLogFile(entry.storage_path)}
              aria-label="View doc"
            >
              <FileText className="h-3.5 w-3.5" />
            </button>
          ) : (
            <label
              className="cursor-pointer text-muted-foreground hover:text-foreground"
              aria-label="Attach doc"
            >
              <Upload className="h-3.5 w-3.5" />
              <input
                type="file"
                className="hidden"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  const up = await uploadLogFile(projectId, f);
                  if (up) onPatch({ storage_path: up.path, file_name: up.name });
                }}
              />
            </label>
          )}
          <button
            type="button"
            className="text-muted-foreground hover:text-danger"
            onClick={onDelete}
            aria-label="Delete row"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </td>
    </tr>
  );
}

// ── Add / Send dialog ───────────────────────────────────────────────────────
// Replaces the blank-inline-row add. Every field maps to an existing column;
// on submit it calls the SAME save mutation (submitAdd) the inline add used.
// The attach control reuses the existing per-row upload path.
interface AddDraft {
  number: string;
  spec_section: string;
  item: string;
  mfgr_supplier: string;
  description: string;
  date_submitted: string;
  due_date: string;
  status: SubmittalLogStatus;
  comments: string;
  storage_path: string;
  file_name: string;
}
const emptyDraft = (suggested: string): AddDraft => ({
  number: suggested,
  spec_section: "",
  item: "",
  mfgr_supplier: "",
  description: "",
  date_submitted: "",
  due_date: "",
  status: "pending",
  comments: "",
  storage_path: "",
  file_name: "",
});

function AddEntryDialog({
  open,
  onOpenChange,
  kind,
  statusOptions,
  projectId,
  suggestedNumber,
  submitting,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  kind: SubmittalLogKind;
  statusOptions: StatusOpt[];
  projectId: string;
  suggestedNumber: string;
  submitting: boolean;
  onSubmit: (fields: Record<string, unknown>) => Promise<void>;
}) {
  const [draft, setDraft] = useState<AddDraft>(() => emptyDraft(suggestedNumber));
  const [attaching, setAttaching] = useState(false);
  // Reseed the form each time the dialog opens (fresh number, cleared fields).
  useEffect(() => {
    if (open) setDraft(emptyDraft(suggestedNumber));
  }, [open, suggestedNumber]);

  const isRfi = kind === "rfi";
  const set = <K extends keyof AddDraft>(k: K, v: AddDraft[K]) =>
    setDraft((prev) => ({ ...prev, [k]: v }));

  const attach = async (file: File) => {
    setAttaching(true);
    const up = await uploadLogFile(projectId, file);
    setAttaching(false);
    if (up) setDraft((prev) => ({ ...prev, storage_path: up.path, file_name: up.name }));
  };

  const submit = async () => {
    try {
      await onSubmit({
        number: draft.number,
        spec_section: draft.spec_section,
        item: draft.item,
        mfgr_supplier: draft.mfgr_supplier,
        description: draft.description,
        date_submitted: draft.date_submitted || null,
        due_date: draft.due_date || null,
        status: draft.status,
        comments: draft.comments,
        storage_path: draft.storage_path,
        file_name: draft.file_name,
      });
      onOpenChange(false);
    } catch {
      /* the save mutation's onError already surfaced a toast */
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <div className="eyebrow">{isRfi ? "Request for information" : "Submittal"}</div>
          <DialogTitle className="font-serif text-2xl">
            Add {isRfi ? "RFI" : "submittal"}
          </DialogTitle>
          <DialogDescription>
            {isRfi ? "A question to the design team. " : ""}On send, OverWatch generates a cover
            letter / transmittal to accompany it.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={isRfi ? "RFI #" : "No."}>
            <Input
              value={draft.number}
              onChange={(e) => set("number", e.target.value)}
              placeholder={isRfi ? "RFI-015" : "e.g. 4000-R"}
            />
          </Field>
          <Field label={isRfi ? "Subject" : "Item"}>
            <Input
              value={draft.item}
              onChange={(e) => set("item", e.target.value)}
              placeholder={isRfi ? "Short subject line" : "What's being submitted"}
            />
          </Field>
          <Field label="Spec section">
            <Input
              value={draft.spec_section}
              onChange={(e) => set("spec_section", e.target.value)}
              placeholder="03 30 00"
            />
          </Field>
          <Field label={isRfi ? "Ball in court" : "Mfgr / Supplier"}>
            <Input
              value={draft.mfgr_supplier}
              onChange={(e) => set("mfgr_supplier", e.target.value)}
              placeholder={isRfi ? "Architect" : "Manufacturer or supplier"}
              list={isRfi ? "rfi-courts" : undefined}
            />
            {isRfi ? (
              <datalist id="rfi-courts">
                <option value="Architect" />
                <option value="Engineer of Record" />
                <option value="EOR of record" />
                <option value="Owner" />
                <option value="Owner's rep" />
                <option value="General contractor" />
              </datalist>
            ) : null}
          </Field>
        </div>

        <Field label={isRfi ? "Question" : "Description"}>
          <Textarea
            value={draft.description}
            onChange={(e) => set("description", e.target.value)}
            rows={3}
            placeholder={
              isRfi
                ? "State the question and the field condition or drawing reference behind it."
                : "Describe the submittal."
            }
          />
        </Field>

        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Date submitted">
            <Input
              type="date"
              value={draft.date_submitted}
              onChange={(e) => set("date_submitted", e.target.value)}
            />
          </Field>
          <Field label={isRfi ? "Needed by" : "Due"}>
            <Input
              type="date"
              value={draft.due_date}
              onChange={(e) => set("due_date", e.target.value)}
            />
          </Field>
          <Field label="Status">
            <select
              value={draft.status}
              onChange={(e) => set("status", e.target.value as SubmittalLogStatus)}
              className="h-9 w-full rounded-md border border-input bg-surface px-2 text-sm"
            >
              {statusOptions.map((s) => (
                <option key={s.value} value={s.value}>
                  {optionText(kind, s)}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="Comments">
          <Textarea
            value={draft.comments}
            onChange={(e) => set("comments", e.target.value)}
            rows={2}
            placeholder="Internal notes or context."
          />
        </Field>

        {/* Cover letter / transmittal — reuses the per-row attach path. */}
        <div className="flex items-center gap-3 rounded-xl border border-hairline bg-background p-3.5">
          <FileText className="h-5 w-5 flex-none text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <div className="text-[12.5px] font-semibold text-foreground">
              Cover letter / transmittal
            </div>
            <div className="mt-0.5 truncate text-[11.5px] text-muted-foreground">
              {draft.file_name
                ? `Attached: ${draft.file_name}`
                : "Attach the reference file and OverWatch builds a branded transmittal to send with this " +
                  (isRfi ? "RFI." : "submittal.")}
            </div>
          </div>
          <label className="flex-none cursor-pointer rounded-md border border-hairline px-3 py-1.5 text-[11.5px] font-semibold text-foreground hover:bg-muted">
            <span className="inline-flex items-center gap-1.5">
              <Paperclip className="h-3.5 w-3.5" />
              {attaching ? "Uploading…" : draft.file_name ? "Replace" : "Attach"}
            </span>
            <input
              type="file"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void attach(f);
              }}
            />
          </label>
        </div>

        <DialogFooter className="items-center sm:justify-between">
          <span className="text-[11px] text-muted-foreground">
            Saved as Draft until you send it.
          </span>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={submitting || attaching}>
              Add {isRfi ? "RFI" : "submittal"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="text-[8.5px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </div>
      {children}
    </div>
  );
}

function LabeledInput({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="text-[11px] text-muted-foreground">
      {label}
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-8"
      />
    </label>
  );
}
