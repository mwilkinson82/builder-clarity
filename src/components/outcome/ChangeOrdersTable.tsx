import { useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { DialogHeaderV2 } from "@/components/ui/dialog-header-v2";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Download,
  FileText,
  MinusCircle,
  Paperclip,
  Plus,
  Pencil,
  ShieldAlert,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { downloadTextFile } from "@/lib/download-file";
import { MoneyInput } from "@/components/ui/money-input";
import { fmtUSD } from "@/lib/format";
import type {
  ChangeOrderDocumentRow,
  ChangeOrderRow,
  ClientChangeOrderStatus,
  COFinancialDirection,
  CoDocType,
  COPricingMethod,
  COStatus,
  COType,
  ExposureRow,
  ProjectRow,
} from "@/lib/projects.functions";
import { ChangeOrderDocumentsDialog } from "@/components/outcome/ChangeOrderDocumentsDialog";
import type { Rollup } from "@/lib/ior";
import type { ChangeOrderAllocationRow } from "@/lib/billing.functions";

const statusStyles: Record<COStatus, string> = {
  Approved: "bg-success/15 text-success border-success/30",
  Pending: "bg-warning/15 text-warning border-warning/30",
  Denied: "bg-danger/15 text-danger border-danger/30",
};

const CO_TYPE_LABELS: Record<COType, string> = {
  owner_change: "Owner change",
  design_error: "Design error",
  design_omission: "Design omission",
  unforeseen_condition: "Unforeseen field condition",
  missed_scope: "Missed scope (our side)",
  sub_issued: "Issued to sub",
  other: "Other",
};

/** Short chip labels for the Reason chips (full labels stay in the edit dialog). */
const CO_TYPE_SHORT: Record<COType, string> = {
  owner_change: "Owner change",
  design_error: "Design error",
  design_omission: "Design omission",
  unforeseen_condition: "Unforeseen",
  missed_scope: "Missed scope",
  sub_issued: "Sub issued",
  other: "Other",
};

const FINANCIAL_DIRECTION_LABELS: Record<COFinancialDirection, string> = {
  addition: "Add to contract",
  credit: "Credit / deduct",
};

/** Plain-English pricing-method labels (full labels for the edit dialog). */
const PRICING_METHOD_LABELS: Record<COPricingMethod, string> = {
  lump_sum: "Lump sum",
  time_and_materials: "Time & materials",
  unit_price: "Unit price",
  allowance: "Allowance",
  other: "Other",
};

/** Short pricing-method chip labels for the log/cards. */
const PRICING_METHOD_SHORT: Record<COPricingMethod, string> = {
  lump_sum: "Lump sum",
  time_and_materials: "T&M",
  unit_price: "Unit price",
  allowance: "Allowance",
  other: "Other",
};

const PRICING_METHOD_ORDER: COPricingMethod[] = [
  "lump_sum",
  "time_and_materials",
  "unit_price",
  "allowance",
  "other",
];

const CLIENT_STATUS_DISPLAY: Record<ClientChangeOrderStatus, { label: string; className: string }> =
  {
    not_sent: { label: "Not sent", className: "text-muted-foreground" },
    sent: { label: "Client: sent", className: "text-warning" },
    approved: { label: "Client approved", className: "text-success" },
    rejected: { label: "Client rejected", className: "text-danger" },
  };

const marginPctLabel = (contract: number, cost: number): string | null =>
  contract !== 0 ? `${(((contract - cost) / contract) * 100).toFixed(1)}%` : null;

const truncate = (s: string, n = 24) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

// CSV export of the change-order log. Raw dollar amounts (no $ formatting) so
// the file drops straight into a spreadsheet; every field is RFC-4180 escaped.
const csvCell = (value: string | number): string => {
  const s = String(value ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
function buildCoLogCsv(rows: ChangeOrderRow[]): string {
  const header = [
    "CO #",
    "Description",
    "Financial direction",
    "Reason",
    "Status",
    "Client status",
    "Contract",
    "Cost",
    "Margin",
    "Probability %",
    "Owner",
  ];
  const body = rows.map((c) => {
    const contract = c.contract_amount ?? 0;
    const cost = c.cost_amount ?? 0;
    return [
      c.number,
      c.description,
      FINANCIAL_DIRECTION_LABELS[c.financial_direction],
      CO_TYPE_SHORT[c.co_type] ?? "Other",
      c.status,
      CLIENT_STATUS_DISPLAY[c.client_status]?.label ?? c.client_status,
      contract,
      cost,
      contract - cost,
      c.status === "Pending" ? (c.probability ?? 0) : "",
      c.owner ?? "",
    ]
      .map(csvCell)
      .join(",");
  });
  return [header.map(csvCell).join(","), ...body].join("\n");
}

function ReasonChip({ type }: { type: COType }) {
  return (
    <span className="whitespace-nowrap rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
      {CO_TYPE_SHORT[type] ?? "Other"}
    </span>
  );
}

function DirectionChip({ direction }: { direction: COFinancialDirection }) {
  return direction === "credit" ? (
    <span className="inline-flex items-center gap-1 whitespace-nowrap rounded border border-danger/25 bg-danger/5 px-1.5 py-0.5 font-mono text-[11px] font-bold uppercase tracking-[0.06em] text-danger">
      <MinusCircle className="h-3 w-3" /> Owner credit
    </span>
  ) : null;
}

/** How the CO is priced — a quiet mono chip beside the reason. */
function PricingChip({ method }: { method: COPricingMethod }) {
  return (
    <span
      className="whitespace-nowrap rounded border border-hairline bg-surface px-1.5 py-0.5 font-mono text-[11px] font-bold uppercase tracking-[0.06em] text-muted-foreground"
      title={`Priced as ${PRICING_METHOD_LABELS[method].toLowerCase()}`}
    >
      {PRICING_METHOD_SHORT[method]}
    </span>
  );
}

/** "+N days" schedule-impact chip; renders nothing when there's no time impact. */
function ScheduleChip({ days }: { days: number }) {
  if (!days) return null;
  return (
    <span
      className="whitespace-nowrap rounded bg-warning/15 px-1.5 py-0.5 font-mono text-[11px] font-bold uppercase tracking-[0.06em] text-warning"
      title={`Adds ${days} calendar ${days === 1 ? "day" : "days"} to the schedule`}
    >
      +{days} {days === 1 ? "day" : "days"}
    </span>
  );
}

export type ChangeOrderDraft = {
  number: string;
  description: string;
  contract_amount: number;
  cost_amount: number;
  financial_direction: COFinancialDirection;
  status: COStatus;
  probability: number;
  owner: string;
  notes: string;
  co_type: COType;
  pricing_method: COPricingMethod;
  schedule_impact_days: number;
  requested_by: string;
  date_initiated: string | null;
};

const empty: ChangeOrderDraft = {
  number: "",
  description: "",
  contract_amount: 0,
  cost_amount: 0,
  financial_direction: "addition",
  status: "Pending",
  probability: 100,
  owner: "",
  notes: "",
  co_type: "owner_change",
  pricing_method: "lump_sum",
  schedule_impact_days: 0,
  requested_by: "",
  date_initiated: null,
};

export function ChangeOrdersTable({
  changeOrders,
  onCreate,
  onUpdate,
  onDelete,
  onCreateRisk,
  creatingRiskId,
  project,
  rollup,
  allocations,
  exposures,
  onOpenClientPortal,
  onSendToClient,
  sendingClientId,
  onQuickStatus,
  documents,
  onUploadDocument,
  onViewDocument,
  onDeleteDocument,
  uploadingDocId,
}: {
  changeOrders: ChangeOrderRow[];
  onCreate: (d: ChangeOrderDraft) => Promise<boolean>;
  onUpdate: (
    id: string,
    p: Partial<ChangeOrderDraft>,
    expectedUpdatedAt: string,
  ) => Promise<boolean>;
  onDelete: (changeOrder: ChangeOrderRow) => Promise<boolean>;
  onCreateRisk?: (changeOrder: ChangeOrderRow) => void;
  creatingRiskId?: string | null;
  project?: ProjectRow;
  rollup?: Rollup;
  // Structural pick so both billing's ChangeOrderAllocationRow and the route's
  // ChangeOrderAllocationListRow satisfy it — the log only reads these two.
  allocations?: Array<Pick<ChangeOrderAllocationRow, "change_order_id" | "cost_code">>;
  exposures?: ExposureRow[];
  onOpenClientPortal?: () => void;
  // Send a CO to the client / nudge one already sent (stamps client_sent_at).
  onSendToClient?: (co: ChangeOrderRow) => void;
  sendingClientId?: string | null;
  onQuickStatus?: (co: ChangeOrderRow, status: "Approved" | "Denied") => Promise<boolean>;
  // Optional CO-document plumbing (backup/quote/correspondence). All optional so
  // existing call sites keep compiling; the Paperclip action only shows when the
  // upload handler is wired.
  documents?: ChangeOrderDocumentRow[];
  onUploadDocument?: (changeOrderId: string, file: File, docType: CoDocType, note: string) => void;
  onViewDocument?: (path: string) => void;
  onDeleteDocument?: (id: string, path: string) => void;
  uploadingDocId?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingUpdatedAt, setEditingUpdatedAt] = useState("");
  const [draft, setDraft] = useState<ChangeOrderDraft>(empty);
  const [saving, setSaving] = useState(false);
  const [changingStatusId, setChangingStatusId] = useState<string | null>(null);
  const [deleteCandidate, setDeleteCandidate] = useState<ChangeOrderRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  // Which CO's documents dialog is open (null = closed).
  const [docCo, setDocCo] = useState<ChangeOrderRow | null>(null);

  const openNew = () => {
    setEditingId(null);
    setEditingUpdatedAt("");
    setDraft(empty);
    setOpen(true);
  };
  const openEdit = (c: ChangeOrderRow) => {
    setEditingId(c.id);
    setEditingUpdatedAt(c.updated_at);
    setDraft({
      number: c.number,
      description: c.description,
      contract_amount: c.contract_amount,
      cost_amount: c.cost_amount,
      financial_direction: c.financial_direction,
      status: c.status,
      probability: c.probability,
      owner: c.owner,
      notes: c.notes,
      co_type: c.co_type,
      pricing_method: c.pricing_method,
      schedule_impact_days: c.schedule_impact_days,
      requested_by: c.requested_by,
      date_initiated: c.date_initiated,
    });

    setOpen(true);
  };
  const save = async () => {
    if (!draft.description.trim()) return;
    setSaving(true);
    try {
      const saved = editingId
        ? await onUpdate(editingId, draft, editingUpdatedAt)
        : await onCreate(draft);
      if (saved) setOpen(false);
    } finally {
      setSaving(false);
    }
  };

  const changeStatus = async (co: ChangeOrderRow, status: "Approved" | "Denied") => {
    if (!onQuickStatus || changingStatusId) return;
    setChangingStatusId(co.id);
    try {
      await onQuickStatus(co, status);
    } finally {
      setChangingStatusId(null);
    }
  };

  const confirmDelete = async () => {
    if (!deleteCandidate) return;
    setDeleting(true);
    try {
      const deleted = await onDelete(deleteCandidate);
      if (deleted) setDeleteCandidate(null);
    } finally {
      setDeleting(false);
    }
  };

  // ── Derived money (live rows; rollup fields preferred when supplied) ──────
  const pending = changeOrders.filter((c) => c.status === "Pending");
  const approvedRows = changeOrders.filter((c) => c.status === "Approved");
  const deniedRows = changeOrders.filter((c) => c.status === "Denied");
  const pendingCredits = pending.filter((c) => c.financial_direction === "credit");

  const pendingContract = pending.reduce((s, c) => s + c.contract_amount, 0);
  const approvedContract =
    rollup?.approvedCOContract ?? approvedRows.reduce((s, c) => s + c.contract_amount, 0);
  const approvedCost =
    rollup?.approvedCOCost ?? approvedRows.reduce((s, c) => s + c.cost_amount, 0);
  const deniedContract = deniedRows.reduce((s, c) => s + c.contract_amount, 0);
  const originalContract = project?.original_contract ?? rollup?.originalContract ?? 0;
  const coMargin = approvedContract - approvedCost;
  const coMarginPct = marginPctLabel(approvedContract, approvedCost);

  // Rows arrive ordered by CO number ascending — reverse for newest first.
  const pendingCards = [...pending].reverse().slice(0, 4);

  // Unsent design errors/omissions still pending → the "Needs attention" callout.
  const unsentDesign = pending
    .filter(
      (c) =>
        (c.co_type === "design_error" || c.co_type === "design_omission") &&
        c.client_status === "not_sent",
    )
    .sort((a, b) => b.cost_amount - a.cost_amount);
  const attention = unsentDesign[0];

  // ── By-reason buckets (all COs, contract dollars) ──────────────────────────
  const bucketDefs: { label: string; match: (t: COType) => boolean; bar: string }[] = [
    { label: "Owner change", match: (t) => t === "owner_change", bar: "bg-success/70" },
    { label: "Missed scope", match: (t) => t === "missed_scope", bar: "bg-success/70" },
    {
      label: "Unforeseen condition",
      match: (t) => t === "unforeseen_condition",
      bar: "bg-warning/70",
    },
    {
      label: "Design error",
      match: (t) => t === "design_error" || t === "design_omission",
      bar: "bg-danger/70",
    },
  ];
  const matchedTypes = (t: COType) => bucketDefs.some((b) => b.match(t));
  const additiveChangeOrders = changeOrders.filter((c) => c.financial_direction !== "credit");
  const buckets = bucketDefs.map((b) => ({
    label: b.label,
    bar: b.bar,
    sum: additiveChangeOrders
      .filter((c) => b.match(c.co_type))
      .reduce((s, c) => s + c.contract_amount, 0),
  }));
  const otherSum = additiveChangeOrders
    .filter((c) => !matchedTypes(c.co_type))
    .reduce((s, c) => s + c.contract_amount, 0);
  if (otherSum > 0) buckets.push({ label: "Other", bar: "bg-muted-foreground/50", sum: otherSum });
  const creditSum = changeOrders
    .filter((c) => c.financial_direction === "credit")
    .reduce((sum, c) => sum + c.contract_amount, 0);
  if (creditSum < 0) buckets.push({ label: "Owner credits", bar: "bg-danger/70", sum: creditSum });
  const maxBucket = Math.max(...buckets.map((b) => Math.abs(b.sum)), 0);
  const barWidth = (sum: number) =>
    maxBucket > 0 && sum !== 0 ? Math.max((Math.abs(sum) / maxBucket) * 100, 8) : 0;

  const linksFor = (c: ChangeOrderRow) => {
    const parts = (allocations ?? [])
      .filter((a) => a.change_order_id === c.id)
      .map((a) => `→ ${a.cost_code}`);
    if (c.linked_exposure_id) parts.push("↔ Risk");
    return parts;
  };

  const docsFor = (id: string) => (documents ?? []).filter((d) => d.change_order_id === id);
  const docCount = (id: string) => docsFor(id).length;

  return (
    <div className="space-y-4">
      {/* 1 · Verdict headline */}
      <div>
        <h2 className="max-w-[30ch] font-serif text-3xl font-normal leading-[1.15]">
          {pending.length > 0 ? (
            <>
              {pending.length} contract {pending.length === 1 ? "adjustment is" : "adjustments are"}{" "}
              pending — <b className="font-semibold text-warning">{fmtUSD(pendingContract)}</b> net
              awaiting a decision.
              {pendingCredits.length > 0
                ? ` ${pendingCredits.length} ${pendingCredits.length === 1 ? "is an owner credit" : "are owner credits"}.`
                : ""}
            </>
          ) : (
            <>No change orders are waiting on a decision.</>
          )}
        </h2>
        {attention && (
          <div className="mt-3 flex max-w-[74ch] items-start gap-2.5">
            <span className="mt-0.5 flex-none whitespace-nowrap rounded-full border border-warning/35 bg-warning/10 px-2.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-warning">
              Needs attention
            </span>
            <span className="text-[13.5px] leading-relaxed text-muted-foreground">
              <b className="font-semibold text-foreground">
                {attention.number} ({attention.description})
              </b>{" "}
              is a {CO_TYPE_SHORT[attention.co_type].toLowerCase()} and hasn&apos;t been sent to the
              client — {fmtUSD(attention.cost_amount)} of cost sits unbilled until it moves.
              {unsentDesign.length > 1 &&
                ` ${unsentDesign.length - 1} more unsent design ${
                  unsentDesign.length - 1 === 1 ? "change hasn't" : "changes haven't"
                } been sent either.`}
            </span>
          </div>
        )}
      </div>

      {/* 2 · Pending your decision */}
      {pendingCards.length > 0 && (
        <div>
          <div className="eyebrow mt-6">Pending your decision</div>
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            {pendingCards.map((c) => {
              const margin = c.contract_amount - c.cost_amount;
              const pct = marginPctLabel(c.contract_amount, c.cost_amount);
              const client = CLIENT_STATUS_DISPLAY[c.client_status];
              const riskTitle = c.linked_exposure_id
                ? exposures?.find((e) => e.id === c.linked_exposure_id)?.title
                : undefined;
              return (
                <div key={c.id} className="rounded-xl border border-hairline bg-card p-4">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <span className="font-mono text-[10px] text-muted-foreground">{c.number}</span>
                    <ReasonChip type={c.co_type} />
                    <DirectionChip direction={c.financial_direction} />
                    <PricingChip method={c.pricing_method} />
                    <ScheduleChip days={c.schedule_impact_days} />
                    <span className="whitespace-nowrap text-[10px] text-muted-foreground">
                      {c.probability}% likely
                    </span>
                    <span
                      className={`ml-auto whitespace-nowrap font-mono text-[10px] font-bold uppercase tracking-[0.06em] ${client.className}`}
                    >
                      {client.label}
                    </span>
                  </div>
                  <div className="mt-2 text-[15px] font-semibold">{c.description}</div>
                  <div className="mt-2.5 flex gap-6 border-t border-hairline pt-2.5">
                    <div>
                      <div className="text-[11px] text-muted-foreground">
                        {c.financial_direction === "credit" ? "Owner credit" : "Contract"}
                      </div>
                      <div className="mt-0.5 font-serif text-[17px] tabular">
                        {fmtUSD(c.contract_amount)}
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] text-muted-foreground">
                        {c.financial_direction === "credit" ? "Cost removed" : "Cost"}
                      </div>
                      <div className="mt-0.5 font-serif text-[17px] tabular text-muted-foreground">
                        {fmtUSD(c.cost_amount)}
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] text-clay">
                        {c.financial_direction === "credit" ? "Margin impact" : "Margin"}
                      </div>
                      <div
                        className={`mt-0.5 font-serif text-[17px] tabular ${
                          margin < 0 ? "text-danger" : "text-success"
                        }`}
                      >
                        {fmtUSD(margin)}
                        {pct ? ` · ${pct}` : ""}
                      </div>
                    </div>
                    {c.linked_exposure_id && (
                      <div className="ml-auto min-w-0 self-center">
                        <span
                          className="font-mono text-[11px] text-muted-foreground"
                          title={riskTitle}
                        >
                          ↔ Risk{riskTitle ? `: ${truncate(riskTitle)}` : ""}
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="mt-3.5 flex gap-2">
                    <Button
                      size="sm"
                      disabled={sendingClientId === c.id}
                      onClick={() => (onSendToClient ? onSendToClient(c) : onOpenClientPortal?.())}
                    >
                      {sendingClientId === c.id
                        ? "Sending…"
                        : c.client_sent_at
                          ? "Nudge client"
                          : "Send to client"}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={changingStatusId === c.id}
                      onClick={() => void changeStatus(c, "Approved")}
                    >
                      {changingStatusId === c.id ? "Saving…" : "Approve"}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={changingStatusId === c.id}
                      onClick={() => void changeStatus(c, "Denied")}
                    >
                      {changingStatusId === c.id ? "Saving…" : "Deny"}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 3 · Analysis grid */}
      <div className="grid items-start gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-hairline bg-card px-5 py-4">
          <div className="eyebrow">What change orders did to the contract</div>
          <div className="mt-2.5 flex items-baseline justify-between border-t border-hairline py-2.5">
            <span className="text-[12.5px] text-muted-foreground">Original contract sum</span>
            <span className="font-serif text-[17px] tabular">{fmtUSD(originalContract)}</span>
          </div>
          <div className="flex items-baseline justify-between border-t border-hairline py-2.5">
            <span className="text-[12.5px] text-muted-foreground">
              Approved contract adjustments ({approvedRows.length} approved)
            </span>
            <span className="font-serif text-[17px] tabular text-success">
              {fmtUSD(approvedContract, { sign: true })}
            </span>
          </div>
          <div className="flex items-baseline justify-between border-t-2 py-2.5">
            <span className="text-[12.5px] font-semibold">Contract sum to date</span>
            <span className="font-serif text-[19px] tabular">
              {fmtUSD(originalContract + approvedContract)}
            </span>
          </div>
          <div className="mt-2 flex border-t border-hairline pt-3">
            <div className="flex-1">
              <div className="text-xs text-muted-foreground">Approved CO revenue</div>
              <div className="mt-0.5 font-serif text-[17px] tabular">
                {fmtUSD(approvedContract)}
              </div>
            </div>
            <div className="flex-1">
              <div className="text-xs text-muted-foreground">Approved CO cost</div>
              <div className="mt-0.5 font-serif text-[17px] tabular text-muted-foreground">
                {fmtUSD(approvedCost)}
              </div>
            </div>
            <div className="flex-1">
              <div className="text-xs text-clay">CO margin</div>
              <div
                className={`mt-0.5 font-serif text-[17px] tabular ${
                  coMargin < 0 ? "text-danger" : "text-success"
                }`}
              >
                {fmtUSD(coMargin)}
                {coMarginPct ? ` · ${coMarginPct}` : ""}
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-hairline bg-card px-5 py-4">
          <div className="eyebrow">By reason · all COs</div>
          <p className="mb-2 mt-1.5 max-w-[52ch] text-[11.5px] text-muted-foreground">
            Additions increase the contract. Owner credits deduct from it. Design errors and
            omissions may not be billable — watch the margin.
          </p>
          {buckets.map((b) => (
            <div
              key={b.label}
              className="grid grid-cols-[140px_1fr_84px] items-center gap-2.5 py-1.5"
            >
              <span className="text-[12.5px]">{b.label}</span>
              <span className="block h-1.5 rounded-full bg-muted">
                <span
                  className={`block h-full rounded-full ${b.bar}`}
                  style={{ width: `${barWidth(b.sum)}%` }}
                />
              </span>
              <span className="text-right font-serif text-sm tabular">{fmtUSD(b.sum)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="flex justify-end gap-2">
        {changeOrders.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() =>
              downloadTextFile(
                `change-orders-${project?.job_number || "log"}.csv`,
                buildCoLogCsv(changeOrders),
                "text/csv;charset=utf-8",
              )
            }
          >
            <Download className="h-3.5 w-3.5" /> Export CO log
          </Button>
        )}
        <Button size="sm" className="gap-1.5" onClick={openNew}>
          <Plus className="h-3.5 w-3.5" /> Add change order
        </Button>
      </div>

      {/* 4 · Full change order log */}
      <div className="overflow-x-auto rounded-xl border border-hairline bg-card">
        <div className="flex items-center gap-3 px-5 pb-3 pt-4">
          <div className="text-[13px] font-semibold">Full change order log</div>
          <span className="ml-auto text-xs text-muted-foreground">
            {changeOrders.length} total · {fmtUSD(approvedContract)} approved net contract
            adjustment · {fmtUSD(pendingContract)} pending · {fmtUSD(deniedContract)} denied
          </span>
        </div>
        <Table className="min-w-[1120px]">
          <TableHeader>
            <TableRow className="bg-surface">
              <TableHead className="w-[90px]">CO #</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead className="text-right">Contract</TableHead>
              <TableHead className="text-right">Cost</TableHead>
              <TableHead className="text-right">Margin</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Client</TableHead>
              <TableHead>Links</TableHead>
              <TableHead className="w-[150px] text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {changeOrders.map((c) => {
              const margin = c.contract_amount - c.cost_amount;
              const pct = marginPctLabel(c.contract_amount, c.cost_amount);
              const client = CLIENT_STATUS_DISPLAY[c.client_status];
              const links = linksFor(c);
              return (
                <TableRow key={c.id}>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {c.number}
                  </TableCell>
                  <TableCell className="font-medium">
                    {c.description}
                    {c.owner && (
                      <div className="text-[11px] font-normal text-muted-foreground">{c.owner}</div>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <ReasonChip type={c.co_type} />
                      <DirectionChip direction={c.financial_direction} />
                      <PricingChip method={c.pricing_method} />
                      <ScheduleChip days={c.schedule_impact_days} />
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-serif tabular">
                    {fmtUSD(c.contract_amount)}
                  </TableCell>
                  <TableCell className="text-right font-serif tabular text-muted-foreground">
                    {fmtUSD(c.cost_amount)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-right">
                    <span
                      className={`font-serif tabular ${margin < 0 ? "text-danger" : "text-success"}`}
                    >
                      {fmtUSD(margin)}
                    </span>
                    {pct && <span className="ml-1 text-[10.5px] text-muted-foreground">{pct}</span>}
                  </TableCell>
                  <TableCell>
                    <span
                      className={`inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${statusStyles[c.status]}`}
                    >
                      {c.status}
                      {c.status === "Pending" ? ` · ${c.probability}%` : ""}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className={`whitespace-nowrap text-xs ${client.className}`}>
                      {client.label}
                    </span>
                  </TableCell>
                  <TableCell>
                    {links.length > 0 ? (
                      <span className="whitespace-nowrap font-mono text-[11px] text-muted-foreground">
                        {links.join(" ")}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      {c.linked_exposure_id ? (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-accent-foreground"
                          disabled
                          title="Already in the risk tally"
                          aria-label={`${c.number || c.description} is already in the risk tally`}
                        >
                          <ShieldCheck className="h-3.5 w-3.5" />
                        </Button>
                      ) : (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          onClick={() => onCreateRisk?.(c)}
                          disabled={!onCreateRisk || creatingRiskId === c.id}
                          title="Send to risk tally"
                          aria-label={`Send ${c.number || c.description} to risk tally`}
                        >
                          <ShieldAlert className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      {onUploadDocument && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="relative h-7 w-7"
                          onClick={() => setDocCo(c)}
                          title="Backup / supporting documents"
                          aria-label={`Documents for ${c.number || c.description}`}
                        >
                          <Paperclip className="h-3.5 w-3.5" />
                          {docCount(c.id) > 0 && (
                            <span className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-clay px-0.5 font-mono text-[8px] font-bold leading-none text-white">
                              {docCount(c.id)}
                            </span>
                          )}
                        </Button>
                      )}
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        disabled={c.status !== "Pending"}
                        onClick={() => openEdit(c)}
                        title={
                          c.status === "Pending"
                            ? "Edit change order"
                            : "Finalized change orders are immutable"
                        }
                        aria-label={`Edit ${c.number || c.description}`}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        disabled={c.status !== "Pending"}
                        onClick={() => setDeleteCandidate(c)}
                        title={
                          c.status === "Pending"
                            ? "Delete pending change order"
                            : "Finalized change orders cannot be deleted"
                        }
                        aria-label={`Delete ${c.number || c.description}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
            {changeOrders.length === 0 && (
              <TableRow>
                <TableCell colSpan={10} className="py-8">
                  <EmptyState
                    icon={FileText}
                    title="No change orders yet"
                    description="Add approved and pending change orders so they roll into the forecasted final contract."
                    action={
                      <Button size="sm" className="gap-1.5" onClick={openNew}>
                        <Plus className="h-3.5 w-3.5" /> Add change order
                      </Button>
                    }
                  />
                </TableCell>
              </TableRow>
            )}
          </TableBody>
          {changeOrders.length > 0 && (
            <TableFooter className="bg-transparent">
              <TableRow className="border-t-2 hover:bg-transparent">
                <TableCell />
                <TableCell className="font-bold">
                  {changeOrders.length} change order{changeOrders.length === 1 ? "" : "s"}
                </TableCell>
                <TableCell />
                <TableCell className="text-right font-serif text-[15px] tabular">
                  {fmtUSD(approvedContract)}
                </TableCell>
                <TableCell className="text-right font-serif text-[15px] tabular text-muted-foreground">
                  {fmtUSD(approvedCost)}
                </TableCell>
                <TableCell
                  className={`text-right font-serif text-[15px] tabular ${
                    coMargin < 0 ? "text-danger" : "text-success"
                  }`}
                >
                  {fmtUSD(coMargin)}
                </TableCell>
                <TableCell colSpan={4}>
                  <span className="text-[11px] font-normal text-muted-foreground">
                    {fmtUSD(approvedContract)} in contract · {fmtUSD(pendingContract)} pending ·{" "}
                    {fmtUSD(deniedContract)} denied
                  </span>
                </TableCell>
              </TableRow>
            </TableFooter>
          )}
        </Table>
      </div>

      <Dialog open={open} onOpenChange={(next) => !saving && setOpen(next)}>
        <DialogTrigger asChild>
          <span />
        </DialogTrigger>
        <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-2xl">
          <DialogHeaderV2
            eyebrow="Change order"
            title={editingId ? "Edit change order" : "Add change order"}
          />
          <div className="grid gap-4 py-2 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Financial direction</Label>
              <Select
                value={draft.financial_direction}
                onValueChange={(value) => {
                  const financial_direction = value as COFinancialDirection;
                  const sign = financial_direction === "credit" ? -1 : 1;
                  setDraft({
                    ...draft,
                    financial_direction,
                    contract_amount: Math.abs(draft.contract_amount) * sign,
                    cost_amount: Math.abs(draft.cost_amount) * sign,
                  });
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(FINANCIAL_DIRECTION_LABELS) as COFinancialDirection[]).map(
                    (direction) => (
                      <SelectItem key={direction} value={direction}>
                        {FINANCIAL_DIRECTION_LABELS[direction]}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                Use Credit / deduct when money is returned to the owner or removed from the
                contract. Enter positive amounts below; OverWatch carries the deduction through the
                contract, SOV, billing, budget, and margin.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:col-span-2 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label>CO number</Label>
                <Input
                  value={draft.number}
                  onChange={(e) => setDraft({ ...draft, number: e.target.value })}
                  placeholder="CO-005"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Status</Label>
                <Select
                  value={draft.status}
                  onValueChange={(v) => setDraft({ ...draft, status: v as COStatus })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Approved">Approved</SelectItem>
                    <SelectItem value="Pending">Pending</SelectItem>
                    <SelectItem value="Denied">Denied</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Probability %</Label>
                <Input
                  type="number"
                  disabled={draft.status !== "Pending"}
                  value={draft.probability}
                  onChange={(e) => setDraft({ ...draft, probability: Number(e.target.value) })}
                />
              </div>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Description</Label>
              <Input
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Change order type</Label>
              <Select
                value={draft.co_type}
                onValueChange={(v) => setDraft({ ...draft, co_type: v as COType })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(CO_TYPE_LABELS) as COType[]).map((k) => (
                    <SelectItem key={k} value={k}>
                      {CO_TYPE_LABELS[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                What caused this CO? Used to spot patterns (design errors vs. owner adds vs. field
                conditions) across the portfolio.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>How it&apos;s priced</Label>
              <Select
                value={draft.pricing_method}
                onValueChange={(v) => setDraft({ ...draft, pricing_method: v as COPricingMethod })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRICING_METHOD_ORDER.map((k) => (
                    <SelectItem key={k} value={k}>
                      {PRICING_METHOD_LABELS[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>
                {draft.financial_direction === "credit"
                  ? "Owner credit (USD)"
                  : "Contract amount (USD)"}
              </Label>
              <MoneyInput
                value={Math.abs(draft.contract_amount)}
                onValueChange={(value) =>
                  setDraft({
                    ...draft,
                    contract_amount:
                      Math.abs(value) * (draft.financial_direction === "credit" ? -1 : 1),
                  })
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label>
                {draft.financial_direction === "credit"
                  ? "Cost removed / avoided (USD)"
                  : "Cost amount (USD)"}
              </Label>
              <MoneyInput
                value={Math.abs(draft.cost_amount)}
                onValueChange={(value) =>
                  setDraft({
                    ...draft,
                    cost_amount:
                      Math.abs(value) * (draft.financial_direction === "credit" ? -1 : 1),
                  })
                }
              />
              {draft.financial_direction === "credit" ? (
                <p className="text-[11px] text-muted-foreground">
                  Enter only cost that truly leaves the forecast. If the credit does not reduce your
                  cost, leave this at $0.
                </p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label>Days added to schedule</Label>
              <Input
                type="number"
                min={0}
                value={draft.schedule_impact_days}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    schedule_impact_days: Math.max(0, Math.trunc(Number(e.target.value) || 0)),
                  })
                }
              />
              <p className="text-[11px] text-muted-foreground">
                Calendar days this change adds. Leave 0 if none.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>Date initiated</Label>
              <Input
                type="date"
                value={draft.date_initiated ?? ""}
                onChange={(e) => setDraft({ ...draft, date_initiated: e.target.value || null })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Requested by</Label>
              <Input
                value={draft.requested_by}
                onChange={(e) => setDraft({ ...draft, requested_by: e.target.value })}
                placeholder="e.g. Owner, architect, PM"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Owner</Label>
              <Input
                value={draft.owner}
                onChange={(e) => setDraft({ ...draft, owner: e.target.value })}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Notes</Label>
              <Textarea
                rows={2}
                value={draft.notes}
                onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" disabled={saving} onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button disabled={saving || !draft.description.trim()} onClick={() => void save()}>
              {saving ? "Saving…" : editingId ? "Save changes" : "Add change order"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={deleteCandidate != null}
        onOpenChange={(next) => !deleting && !next && setDeleteCandidate(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this pending change order?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteCandidate?.number || deleteCandidate?.description || "This change order"} will
              be removed from the project. Approved and denied records remain permanent financial
              history.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Keep it</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={(event) => {
                event.preventDefault();
                void confirmDelete();
              }}
            >
              {deleting ? "Deleting…" : "Delete pending change order"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {onUploadDocument && (
        <ChangeOrderDocumentsDialog
          changeOrder={docCo}
          documents={docCo ? docsFor(docCo.id) : []}
          onClose={() => setDocCo(null)}
          onUpload={onUploadDocument}
          onView={onViewDocument}
          onDelete={onDeleteDocument}
          uploading={uploadingDocId != null && docCo != null && uploadingDocId === docCo.id}
        />
      )}
    </div>
  );
}
