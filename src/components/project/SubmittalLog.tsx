// RFI & SUBMITTALS LOG (docs/compliance arc, module 3). Two Excel-style logs —
// RFIs and Submittals — the way GCs already run them: number, spec section,
// sub/rev, item, description, manufacturer/supplier, dates out/back, a color-
// coded status (A / AAN / RAR / U/R), and comments. Rows edit inline (commit on
// blur). From the Submittals log you generate a branded Letter of Transmittal to
// send the architect/engineer.
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { FileDown, FileText, Plus, Trash2, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { WorkspaceHeader } from "@/components/project/billing/billing-workspace-atoms";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import {
  deleteSubmittalLogEntry,
  getProjectLetterhead,
  listSubmittalLog,
  patchSubmittalLogEntry,
  saveSubmittalLogEntry,
  type SubmittalLogEntryRow,
  type SubmittalLogKind,
  type SubmittalLogStatus,
} from "@/lib/submittal-log.functions";
import { generateTransmittalPdf, type TransmittalAttachment } from "@/lib/transmittal-pdf";
import { daysOutstanding, isOverdue, pipelineCounts } from "@/lib/submittal-domain";

const STATUS: { value: SubmittalLogStatus; short: string; label: string; tone: string }[] = [
  { value: "", short: "—", label: "Not set", tone: "text-muted-foreground" },
  { value: "pending", short: "P", label: "Pending — not sent yet", tone: "text-muted-foreground" },
  { value: "ur", short: "U/R", label: "Under review", tone: "text-warning" },
  { value: "rar", short: "RAR", label: "Revise & resubmit", tone: "text-danger" },
  { value: "aan", short: "AAN", label: "Approved as noted", tone: "text-accent" },
  { value: "a", short: "A", label: "Approved", tone: "text-success" },
];
const statusTone = (s: SubmittalLogStatus) => STATUS.find((x) => x.value === s)?.tone ?? "";

const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

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

  const [kind, setKind] = useState<SubmittalLogKind>("submittal");

  const entriesQuery = useQuery({
    queryKey: ["submittal-log", projectId],
    queryFn: () => listFn({ data: { projectId } }),
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

  // ── Transmittal builder (submittals only) ──
  const [txOpen, setTxOpen] = useState(false);
  const [txTo, setTxTo] = useState("");
  const [txAttn, setTxAttn] = useState("");
  const [txRe, setTxRe] = useState("");
  const [txNo, setTxNo] = useState("");
  const [txBy, setTxBy] = useState("");
  const [txPicked, setTxPicked] = useState<Set<string>>(new Set());
  const [txBusy, setTxBusy] = useState(false);

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
      // cover letter followed by the actual submittals (field request
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
      const { skipped } = await generateTransmittalPdf({
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
      const notIncluded = [...failed, ...skipped];
      if (notIncluded.length > 0) {
        toast("Transmittal downloaded — some attachments weren't included", {
          description: `${notIncluded.join(", ")} couldn't be added to the PDF. Send ${
            notIncluded.length === 1 ? "it" : "them"
          } separately.`,
        });
      }
    } catch (e) {
      toast.error("Could not build the transmittal", {
        description: e instanceof Error ? e.message : "Try again.",
      });
    } finally {
      setTxBusy(false);
    }
  };

  // New rows start as PENDING — the planned-at-job-start stage. If the pipeline
  // migration isn't applied yet, fall back to the legacy blank status so adding
  // rows keeps working.
  const addRow = async () => {
    try {
      await save.mutateAsync({ kind, sort_order: rows.length, status: "pending" });
    } catch (e) {
      if (e instanceof Error && /database update pending/i.test(e.message)) {
        save.mutate({ kind, sort_order: rows.length, status: "" });
      }
    }
  };

  return (
    <section className="space-y-5">
      <WorkspaceHeader
        title="RFIs & Submittals"
        subtitle="Track every RFI and submittal the way you already do in Excel — spec section, dates out and back, and the architect's action. From the submittals log, generate a branded letter of transmittal to send for approval."
      />

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
                  onClick={() => setKind(k)}
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
          {kind === "submittal" ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() => setTxOpen((v) => !v)}
            >
              <FileDown className="h-3.5 w-3.5" /> Transmittal
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            className="gap-1.5"
            onClick={addRow}
            disabled={save.isPending}
          >
            <Plus className="h-3.5 w-3.5" /> Add {kind === "rfi" ? "RFI" : "submittal"}
          </Button>
        </div>
      </div>

      {/* Pipeline at a glance (field request 2026-07-10): plan the list up
          front as PENDING, then track what's out, what's overdue, what's back. */}
      {rows.length > 0
        ? (() => {
            const counts = pipelineCounts(rows, todayStr());
            const tiles = [
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

      {/* Transmittal builder */}
      {txOpen && kind === "submittal" ? (
        <div className="rounded-lg border border-hairline bg-card p-4 shadow-card">
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Letter of transmittal
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
          <div className="mt-3 flex items-center justify-between">
            <p className="text-[11px] text-muted-foreground">
              {txPicked.size > 0
                ? `${txPicked.size} item${txPicked.size === 1 ? "" : "s"} selected (check the rows below).`
                : "No rows checked — all submittals will be included."}
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

      {/* Log table */}
      <div className="overflow-x-auto rounded-lg border border-hairline bg-card shadow-card">
        <table className="w-full min-w-[1050px] text-sm">
          <thead>
            <tr className="border-b border-hairline bg-surface text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
              {txOpen && kind === "submittal" ? <th className="w-8 px-2 py-2" /> : null}
              <th className="px-2 py-2 text-left">No.</th>
              <th className="px-2 py-2 text-left">Spec</th>
              <th className="px-2 py-2 text-left">Sub/Rev</th>
              <th className="px-2 py-2 text-left">Item</th>
              <th className="px-2 py-2 text-left">Description</th>
              <th className="px-2 py-2 text-left">Mfgr / Supplier</th>
              <th className="px-2 py-2 text-left">Submitted</th>
              <th className="px-2 py-2 text-left">Returned</th>
              <th className="px-2 py-2 text-left">Due</th>
              <th className="px-2 py-2 text-left">Days out</th>
              <th className="px-2 py-2 text-left">Status</th>
              <th className="px-2 py-2 text-left">Comments</th>
              <th className="w-16 px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((entry) => (
              <LogRow
                key={entry.id}
                entry={entry}
                projectId={projectId}
                pickable={txOpen && kind === "submittal"}
                picked={txPicked.has(entry.id)}
                onPick={() => togglePick(entry.id)}
                onPatch={(p) => patch.mutate({ id: entry.id, ...p })}
                onDelete={() => {
                  if (confirm("Delete this row?")) remove.mutate(entry.id);
                }}
              />
            ))}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={14} className="px-3 py-8 text-center text-sm text-muted-foreground">
                  No {kind === "rfi" ? "RFIs" : "submittals"} logged yet. Add one above.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 text-[11px]">
        {STATUS.filter((s) => s.value).map((s) => (
          <span key={s.value} className={s.tone}>
            <span className="font-semibold">{s.short}</span> {s.label}
          </span>
        ))}
      </div>
    </section>
  );
}

function LogRow({
  entry,
  projectId,
  pickable,
  picked,
  onPick,
  onPatch,
  onDelete,
}: {
  entry: SubmittalLogEntryRow;
  projectId: string;
  pickable: boolean;
  picked: boolean;
  onPick: () => void;
  onPatch: (patch: Partial<SubmittalLogEntryRow>) => void;
  onDelete: () => void;
}) {
  const [d, setD] = useState(entry);
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
    <td className="px-1 py-1">
      <input
        defaultValue={String(entry[field] ?? "")}
        onBlur={(e) => commit(field, e.target.value)}
        className={`w-full ${w} rounded border border-transparent bg-transparent px-1.5 py-1 text-sm focus:border-input focus:bg-background`}
      />
    </td>
  );
  const dateCell = (field: "date_submitted" | "date_returned" | "due_date") => (
    <td className="px-1 py-1">
      <input
        type="date"
        defaultValue={entry[field] ?? ""}
        onBlur={(e) => commit(field, e.target.value)}
        className="w-[122px] rounded border border-transparent bg-transparent px-1 py-1 text-xs focus:border-input focus:bg-background"
      />
    </td>
  );

  return (
    <tr className="border-b border-hairline/70 last:border-0 align-top">
      {pickable ? (
        <td className="px-2 py-2">
          <input type="checkbox" checked={picked} onChange={onPick} className="h-3.5 w-3.5" />
        </td>
      ) : null}
      {cell("number", "min-w-[52px] font-mono text-xs")}
      {cell("spec_section", "min-w-[60px]")}
      {cell("sub_rev", "min-w-[52px]")}
      {cell("item", "min-w-[80px]")}
      {cell("description", "min-w-[200px]")}
      {cell("mfgr_supplier", "min-w-[130px]")}
      {dateCell("date_submitted")}
      {dateCell("date_returned")}
      {dateCell("due_date")}
      <td className="px-1 py-1">
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
      <td className="px-1 py-1">
        <select
          value={d.status}
          onChange={(e) => commit("status", e.target.value)}
          className={`rounded border border-input bg-surface px-1.5 py-1 text-xs font-semibold ${statusTone(d.status)}`}
        >
          {STATUS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.short === "—" ? "—" : `${s.short} · ${s.label}`}
            </option>
          ))}
        </select>
      </td>
      {cell("comments", "min-w-[160px]")}
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
