// One subcontract's card on the Subcontractors tab: the versioned contract paper
// trail, the buyout (committed cost), its cost-code allocations, and progress
// payments (actual cost). The commitment moves for a change order or credit, an
// allocation re-prices per code, and a draft payment can be corrected before it
// is approved. Approved and paid records remain immutable. Extracted from
// SubcontractorsWorkspace so both files stay well under the size limit.
import { useState } from "react";
import {
  Check,
  FileText,
  HardHat,
  Pencil,
  Plus,
  ShieldAlert,
  Trash2,
  Upload,
  X,
} from "lucide-react";

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
import { MoneyInput } from "@/components/ui/money-input";
import { fmtUSDCents as fmtUSD } from "@/lib/billing-format";
import {
  reviseSubSummary,
  sumChangeOrders,
  type summarizeSubPayments,
} from "@/lib/subcontract-budget";
import type { InsuranceStatus } from "@/lib/compliance-domain";
import { PaymentSplitEditor, type SplitRowDraft } from "@/components/project/PaymentSplitEditor";
import type { SubcontractDocumentRow } from "@/lib/subcontracts.functions";

interface BucketOption {
  id: string;
  cost_code: string;
  bucket: string;
}
export interface CardAllocation {
  id: string;
  cost_code: string;
  description: string;
  amount: number;
  planned_quantity: number;
  unit: string;
  benchmark_labor_rate: number;
  updated_at?: string;
}
export interface CardChangeOrder {
  id: string;
  subcontract_id: string;
  cost_code: string;
  description: string;
  amount: number; // signed dollars: change order +, credit −
  co_date: string;
  exposure_id: string | null;
  updated_at?: string;
}
export interface CardPayment {
  id: string;
  amount: number;
  retainage_held: number;
  payment_date: string;
  notes: string;
  // Lifecycle: draft (pay app received) → approved (for payment) → paid.
  status: string;
  // Non-empty when this pay app was paid despite a failing compliance gate
  // (field request 2026-07-10) — surfaced on the row so the override is visible.
  compliance_override_reason?: string;
  // How it was paid (field request 2026-07-10, mirrors cost #273): method +
  // the check#/wire confirmation (reference), shown on the paid row.
  payment_method?: string;
  reference?: string;
  exposure_id: string | null;
}

interface RiskOption {
  id: string;
  title: string;
  status: string;
}

const SUB_PAY_METHOD_LABEL: Record<string, string> = {
  wire: "Wire",
  check: "Check",
  card: "Card",
  ach: "ACH",
  other: "Other",
};
// A saved explicit split row for one of this sub's payments.
export interface CardPaymentSplit {
  id: string;
  payment_id: string;
  cost_bucket_id: string | null;
  cost_code: string;
  description: string;
  amount: number;
}
// A lien waiver as the pay-app rows see it: either attached to one payment
// (payment_id) or sitting in the sub's on-file pool waiting to be attached.
export interface CardWaiver {
  id: string;
  payment_id: string | null;
  waiver_type: string;
  through_date: string | null;
  amount: number;
  signed_date: string | null;
  storage_path: string;
  file_name: string;
}

export type PayStage = "draft" | "approved" | "paid";

// House chip (v2): mono, bordered, uppercase pill. Tone carries the semantic —
// good/warn/crit follow the schedule-health rule, never a brand accent.
const CHIP_BASE =
  "inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 font-mono text-[8px] font-bold uppercase tracking-[0.06em]";
const CHIP_TONE: Record<"muted" | "good" | "warn" | "crit", string> = {
  muted: "border-hairline text-muted-foreground",
  good: "border-success/40 bg-success/[0.06] text-success",
  warn: "border-warning/40 bg-warning/[0.06] text-warning",
  crit: "border-destructive/40 bg-destructive/[0.06] text-danger",
};
function Chip({
  tone = "muted",
  children,
}: {
  tone?: keyof typeof CHIP_TONE;
  children: React.ReactNode;
}) {
  return <span className={`${CHIP_BASE} ${CHIP_TONE[tone]}`}>{children}</span>;
}

// Plain-English chip per lifecycle stage; paid rows are the only ones that
// count as job cost, so the pending stages read as clearly not-money-yet.
const STAGE_CHIP: Record<string, { label: string; tone: keyof typeof CHIP_TONE }> = {
  draft: { label: "Draft — not approved", tone: "muted" },
  approved: { label: "Approved for payment", tone: "warn" },
  paid: { label: "Paid", tone: "good" },
};
// COI chip per the sub's best insurance standing (bound to the compliance query).
const COI_CHIP: Record<InsuranceStatus, { label: string; tone: keyof typeof CHIP_TONE }> = {
  valid: { label: "COI valid", tone: "good" },
  expiring_soon: { label: "COI expiring soon", tone: "warn" },
  unverified: { label: "COI unverified", tone: "warn" },
  expired: { label: "COI expired", tone: "crit" },
  missing: { label: "COI missing", tone: "crit" },
};
export interface PaymentEdit {
  amount: number;
  retainageHeld: number;
  paymentDate: string;
  notes: string;
}

const today = () => new Date().toISOString().slice(0, 10);

function newSubcontractPaymentOperationKey() {
  const operationId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  return `subcontract-payment:${operationId}`;
}

const CARD_WAIVER_LABEL: Record<string, string> = {
  conditional_progress: "Conditional / progress",
  unconditional_progress: "Unconditional / progress",
  conditional_final: "Conditional / final",
  unconditional_final: "Unconditional / final",
};

// One pay app's lien-waiver state (field request 2026-07-10): attached →
// shows it (view/detach); not attached → says what's blocking approval and
// takes either an on-file waiver pick or a direct signed-waiver upload.
function PaymentWaiverLine({
  payment,
  attached,
  pool,
  gatingEnabled,
  onAttach,
  onDetach,
  onUpload,
  onView,
}: {
  payment: CardPayment;
  attached: CardWaiver | null;
  pool: CardWaiver[];
  gatingEnabled: boolean;
  onAttach: (waiverId: string) => void;
  onDetach: (waiverId: string) => void;
  onUpload: (file: File) => void;
  onView: (path: string) => void;
}) {
  const [pickId, setPickId] = useState("");
  const eligiblePool = pool.filter(
    (waiver) =>
      Boolean(waiver.signed_date) &&
      Boolean(waiver.storage_path.trim()) &&
      Boolean(waiver.file_name.trim()) &&
      Boolean(waiver.through_date) &&
      (waiver.through_date ?? "") >= payment.payment_date &&
      waiver.amount >= payment.amount,
  );
  if (attached) {
    return (
      <span className="flex flex-wrap items-center gap-2 text-[11px]">
        <span className="text-success">
          Lien waiver attached — {CARD_WAIVER_LABEL[attached.waiver_type] ?? "waiver"}
          {attached.through_date ? ` through ${attached.through_date}` : ""}
        </span>
        {attached.storage_path ? (
          <button
            type="button"
            className="font-medium text-accent-foreground hover:underline"
            onClick={() => onView(attached.storage_path)}
          >
            view
          </button>
        ) : null}
        {payment.status !== "paid" ? (
          <button
            type="button"
            className="text-muted-foreground hover:text-danger"
            onClick={() => onDetach(attached.id)}
            aria-label="Detach lien waiver"
            title="Detach — attached in error"
          >
            <X className="h-3 w-3" />
          </button>
        ) : null}
      </span>
    );
  }
  // A paid row without a waiver predates per-payment tracking — don't nag.
  if (payment.status === "paid") return null;
  return (
    <span className="flex flex-wrap items-center gap-2 text-[11px]">
      <span className={gatingEnabled ? "text-warning" : "text-muted-foreground"}>
        {gatingEnabled
          ? "Needs a lien waiver + verified insurance before approval."
          : "No lien waiver attached."}
      </span>
      {eligiblePool.length > 0 ? (
        <>
          <select
            value={pickId}
            onChange={(e) => setPickId(e.target.value)}
            className="rounded-md border border-hairline bg-surface px-1.5 py-0.5 text-[11px] text-foreground focus:outline-none focus:ring-2 focus:ring-accent/40"
            aria-label="Pick an on-file lien waiver"
          >
            <option value="">On-file waiver…</option>
            {eligiblePool.map((w) => (
              <option key={w.id} value={w.id}>
                {CARD_WAIVER_LABEL[w.waiver_type] ?? "Waiver"}
                {w.through_date ? ` · through ${w.through_date}` : ""}
                {w.amount > 0 ? ` · ${fmtUSD(w.amount)}` : ""}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="font-medium text-accent-foreground hover:underline disabled:opacity-50"
            disabled={!pickId}
            onClick={() => {
              if (pickId) onAttach(pickId);
              setPickId("");
            }}
          >
            Attach
          </button>
          <span className="text-muted-foreground">or</span>
        </>
      ) : null}
      <label className="inline-flex cursor-pointer items-center gap-1 font-medium text-accent-foreground hover:underline">
        <Upload className="h-3 w-3" />
        Upload signed waiver
        <input
          type="file"
          accept="application/pdf,image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onUpload(f);
            e.target.value = "";
          }}
        />
      </label>
    </span>
  );
}

function Stat({
  label,
  value,
  tone,
  quiet,
}: {
  label: string;
  value: string;
  tone?: "good" | "warn";
  quiet?: boolean;
}) {
  const valueColor = quiet
    ? "text-muted-foreground"
    : tone === "good"
      ? "text-success"
      : tone === "warn"
        ? "text-warning"
        : "text-foreground";
  return (
    <div
      className={
        quiet ? "min-w-0" : "min-w-0 rounded-md border border-hairline bg-surface px-3 py-2"
      }
    >
      <div className="font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </div>
      <div
        className={`mt-1 font-serif tabular-nums ${quiet ? "text-[15px]" : "text-base"} ${valueColor}`}
      >
        {value}
      </div>
    </div>
  );
}

interface CardProps {
  subLabel: string;
  summary: ReturnType<typeof summarizeSubPayments>;
  allocations: CardAllocation[];
  payments: CardPayment[];
  buckets: BucketOption[];
  allocatedTotal: number;
  defaultRetainagePct: number;
  // Card-chrome inputs (v2): the sub's trade + executed/draft status, and the
  // sub's best insurance standing (bound to the same compliance query the panel
  // uses) so the header can show the COI chip without owning the certs.
  trade?: string;
  subStatus?: string;
  coiStatus?: InsuranceStatus;
  onEditBuyout: (contractValue: number, retainagePct: number) => Promise<void>;
  onAllocate: (costBucketId: string, amount: number) => Promise<void>;
  onUpdateAllocation: (id: string, amount: number) => Promise<void>;
  onUpdateProductionBenchmark: (
    id: string,
    plannedQuantity: number,
    unit: string,
    benchmarkLaborRate: number,
  ) => Promise<void>;
  onRemoveAllocation: (id: string) => Promise<void>;
  changeOrders: CardChangeOrder[];
  exposures: RiskOption[];
  onRecordChangeOrder: (
    costBucketId: string | null,
    description: string,
    amount: number,
    coDate: string,
    exposureId: string | null,
  ) => Promise<void>;
  onSetChangeOrderExposure: (id: string, exposureId: string | null) => Promise<void>;
  onRemoveChangeOrder: (id: string) => Promise<void>;
  onPay: (
    amount: number,
    retainageHeld: number,
    paymentDate: string,
    notes: string,
    stage: PayStage,
    exposureId: string | null,
    idempotencyKey: string,
  ) => Promise<void>;
  onSetPaymentExposure: (id: string, exposureId: string | null) => void;
  onUpdatePayment: (id: string, edit: PaymentEdit) => Promise<void>;
  onSetPaymentStage: (id: string, stage: "approved" | "paid") => void;
  // Marking paid opens a "how paid" dialog in the workspace (field request
  // 2026-07-10) — method/check#/date, and the override path if the gate blocks.
  onMarkPaid: (payment: CardPayment) => void;
  onRemovePayment: (id: string) => void;
  // Explicit per-payment cost-code splits (field request 2026-07-09): saved
  // rows per payment, and the save handler (empty rows = reset to automatic).
  paymentSplits: CardPaymentSplit[];
  onSaveSplit: (paymentId: string, rows: SplitRowDraft[]) => void;
  savingSplit?: boolean;
  // Lien waivers per pay app (field request 2026-07-10): a pay app can't be
  // approved until its waiver is attached and insurance is verified. The rows
  // show the attach state and take an on-file pick or a direct doc upload.
  waivers: CardWaiver[];
  gatingEnabled: boolean;
  onAttachWaiver: (paymentId: string, waiverId: string) => void;
  onDetachWaiver: (paymentId: string, waiverId: string) => void;
  onUploadWaiverForPayment: (payment: CardPayment, file: File) => void;
  onViewWaiverDoc: (path: string) => void;
  onRemoveSub: () => Promise<void>;
  documents: SubcontractDocumentRow[];
  onUploadDoc: (file: File) => void;
  onViewDoc: (path: string) => void;
  onSetActiveDoc: (docId: string) => void;
  onRemoveDoc: (docId: string, path: string) => void;
  // COMPLIANCE (module 2): the insurance + lien-waiver panel for this sub,
  // rendered by the workspace so the card stays payment/paper-trail focused.
  complianceSlot?: React.ReactNode;
}

export function SubcontractCard({
  subLabel,
  summary,
  allocations,
  payments,
  buckets,
  allocatedTotal,
  defaultRetainagePct,
  trade,
  subStatus,
  coiStatus,
  onEditBuyout,
  onAllocate,
  onUpdateAllocation,
  onUpdateProductionBenchmark,
  onRemoveAllocation,
  changeOrders,
  exposures,
  onRecordChangeOrder,
  onSetChangeOrderExposure,
  onRemoveChangeOrder,
  onPay,
  onSetPaymentExposure,
  onUpdatePayment,
  onSetPaymentStage,
  onMarkPaid,
  onRemovePayment,
  paymentSplits,
  onSaveSplit,
  savingSplit = false,
  waivers,
  gatingEnabled,
  onAttachWaiver,
  onDetachWaiver,
  onUploadWaiverForPayment,
  onViewWaiverDoc,
  onRemoveSub,
  documents,
  onUploadDoc,
  onViewDoc,
  onSetActiveDoc,
  onRemoveDoc,
  complianceSlot,
}: CardProps) {
  const splitsByPayment = new Map<string, CardPaymentSplit[]>();
  for (const split of paymentSplits) {
    const list = splitsByPayment.get(split.payment_id) ?? [];
    list.push(split);
    splitsByPayment.set(split.payment_id, list);
  }
  const [allocBucket, setAllocBucket] = useState("");
  const [allocAmount, setAllocAmount] = useState(0);
  const [payAmount, setPayAmount] = useState(0);
  const [payDate, setPayDate] = useState(today);
  const [payNotes, setPayNotes] = useState("");
  const [payExposure, setPayExposure] = useState("");
  // New pay apps land as a draft (field request 2026-07-09) — nothing hits the
  // budget until the PM approves it and marks it paid.
  const [payStage, setPayStage] = useState<PayStage>("draft");
  // The new-pay-app entry lives in a modal now (v2). Split-manually toggle only
  // affects the modal's preview copy — the live split editor stays on each row.
  const [payModalOpen, setPayModalOpen] = useState(false);
  const [modalSplitManual, setModalSplitManual] = useState(false);
  const [payOperationKey, setPayOperationKey] = useState("");
  const [payError, setPayError] = useState("");
  const [paySubmitting, setPaySubmitting] = useState(false);

  // Inline editors, keyed by the row being edited (null = closed).
  const [editingBuyout, setEditingBuyout] = useState(false);
  const [buyoutValue, setBuyoutValue] = useState(0);
  const [buyoutRetainage, setBuyoutRetainage] = useState(0);
  const [editAllocId, setEditAllocId] = useState<string | null>(null);
  const [editAllocAmount, setEditAllocAmount] = useState(0);
  const [benchmarkAllocId, setBenchmarkAllocId] = useState<string | null>(null);
  const [benchmarkQuantity, setBenchmarkQuantity] = useState(0);
  const [benchmarkUnit, setBenchmarkUnit] = useState("");
  const [benchmarkRate, setBenchmarkRate] = useState(0);
  const [buyoutSubmitting, setBuyoutSubmitting] = useState(false);
  const [buyoutError, setBuyoutError] = useState("");
  const [allocationSubmitting, setAllocationSubmitting] = useState(false);
  const [allocationError, setAllocationError] = useState("");
  const [changeOrderSubmitting, setChangeOrderSubmitting] = useState(false);
  const [changeOrderError, setChangeOrderError] = useState("");
  const [editPayId, setEditPayId] = useState<string | null>(null);
  const [editPay, setEditPay] = useState<PaymentEdit>({
    amount: 0,
    retainageHeld: 0,
    paymentDate: today(),
    notes: "",
  });
  const [editPayError, setEditPayError] = useState("");
  const [editPaySubmitting, setEditPaySubmitting] = useState(false);

  // CO/credit entry form
  const [coKind, setCoKind] = useState<"co" | "credit">("co");
  const [coAmount, setCoAmount] = useState(0);
  const [coDesc, setCoDesc] = useState("");
  const [coBucket, setCoBucket] = useState("");
  const [coDate, setCoDate] = useState(today);
  const [coExposure, setCoExposure] = useState("");
  // Which payments show their per-cost-code split
  const [splitOpen, setSplitOpen] = useState<Record<string, boolean>>({});

  // Change orders live SEPARATE from the base contract; the revised numbers are
  // derived, never written back onto the buyout.
  const revised = reviseSubSummary(summary, sumChangeOrders(changeOrders));
  const hasChangeOrders = changeOrders.length > 0;

  const unallocated = revised.revised - allocatedTotal;
  const retainageHeld = Math.round(payAmount * defaultRetainagePct) / 100;
  // The buyout's biggest cost code drives the header "allocated to" line and the
  // modal eyebrow / automatic-split copy.
  const topAlloc =
    allocations.length > 0 ? [...allocations].sort((a, b) => b.amount - a.amount)[0] : null;
  const splitCodes = allocations
    .map((a) => a.cost_code)
    .filter(Boolean)
    .join(", ");
  const coiChip = coiStatus ? COI_CHIP[coiStatus] : null;
  const hasWaiverOnFile = waivers.length > 0;
  // Active version first, then newest — the current contract sits on top, the
  // superseded ones stay below as the paper trail.
  const orderedDocs = [...documents].sort(
    (a, b) =>
      Number(b.is_active) - Number(a.is_active) || b.uploaded_at.localeCompare(a.uploaded_at),
  );

  const openBuyoutEditor = () => {
    setBuyoutValue(summary.committed);
    setBuyoutRetainage(defaultRetainagePct);
    setBuyoutError("");
    setEditingBuyout(true);
  };
  const openAllocEditor = (a: CardAllocation) => {
    setEditAllocId(a.id);
    setEditAllocAmount(a.amount);
    setAllocationError("");
  };
  const openBenchmarkEditor = (a: CardAllocation) => {
    setBenchmarkAllocId(a.id);
    setBenchmarkQuantity(a.planned_quantity);
    setBenchmarkUnit(a.unit);
    setBenchmarkRate(a.benchmark_labor_rate);
    setAllocationError("");
  };
  const errorMessage = (error: unknown, fallback: string) =>
    error instanceof Error ? error.message : fallback;
  const submitBuyout = async () => {
    if (buyoutSubmitting) return;
    setBuyoutError("");
    setBuyoutSubmitting(true);
    try {
      await onEditBuyout(buyoutValue, buyoutRetainage);
      setEditingBuyout(false);
    } catch (error) {
      setBuyoutError(errorMessage(error, "The commitment did not save."));
    } finally {
      setBuyoutSubmitting(false);
    }
  };
  const submitAllocationUpdate = async (allocationId: string) => {
    if (allocationSubmitting) return;
    setAllocationError("");
    setAllocationSubmitting(true);
    try {
      await onUpdateAllocation(allocationId, editAllocAmount);
      setEditAllocId(null);
    } catch (error) {
      setAllocationError(errorMessage(error, "The allocation did not save."));
    } finally {
      setAllocationSubmitting(false);
    }
  };
  const submitBenchmark = async (allocationId: string) => {
    if (allocationSubmitting) return;
    setAllocationError("");
    setAllocationSubmitting(true);
    try {
      await onUpdateProductionBenchmark(
        allocationId,
        benchmarkQuantity,
        benchmarkUnit.trim(),
        benchmarkRate,
      );
      setBenchmarkAllocId(null);
    } catch (error) {
      setAllocationError(errorMessage(error, "The production benchmark did not save."));
    } finally {
      setAllocationSubmitting(false);
    }
  };
  const submitAllocation = async () => {
    if (allocationSubmitting) return;
    setAllocationError("");
    setAllocationSubmitting(true);
    try {
      await onAllocate(allocBucket, allocAmount);
      setAllocBucket("");
      setAllocAmount(0);
    } catch (error) {
      setAllocationError(errorMessage(error, "The allocation did not save."));
    } finally {
      setAllocationSubmitting(false);
    }
  };
  const submitChangeOrder = async () => {
    if (changeOrderSubmitting) return;
    setChangeOrderError("");
    setChangeOrderSubmitting(true);
    try {
      await onRecordChangeOrder(
        coBucket || null,
        coDesc.trim(),
        coKind === "credit" ? -coAmount : coAmount,
        coDate,
        coExposure || null,
      );
      setCoAmount(0);
      setCoDesc("");
      setCoBucket("");
      setCoExposure("");
    } catch (error) {
      setChangeOrderError(errorMessage(error, "The change order did not save."));
    } finally {
      setChangeOrderSubmitting(false);
    }
  };
  const openPayEditor = (p: CardPayment) => {
    if (p.status !== "draft") return;
    setEditPayId(p.id);
    setEditPay({
      amount: p.amount,
      retainageHeld: p.retainage_held,
      paymentDate: p.payment_date || today(),
      notes: p.notes,
    });
    setEditPayError("");
  };
  const closePayEditor = () => {
    if (editPaySubmitting) return;
    setEditPayId(null);
    setEditPayError("");
  };
  const submitPayEdit = async () => {
    if (!editPayId || editPaySubmitting) return;
    setEditPayError("");
    setEditPaySubmitting(true);
    try {
      await onUpdatePayment(editPayId, editPay);
      setEditPayId(null);
      setEditPay({
        amount: 0,
        retainageHeld: 0,
        paymentDate: today(),
        notes: "",
      });
    } catch (error) {
      setEditPayError(error instanceof Error ? error.message : "Payment did not update.");
    } finally {
      setEditPaySubmitting(false);
    }
  };
  const openPayModal = () => {
    setPayAmount(0);
    setPayNotes("");
    setPayDate(today());
    setPayStage("draft");
    setPayExposure("");
    setModalSplitManual(false);
    setPayOperationKey(newSubcontractPaymentOperationKey());
    setPayError("");
    setPayModalOpen(true);
  };
  const reviseFailedPayDraft = () => {
    if (!payError) return;
    setPayOperationKey(newSubcontractPaymentOperationKey());
    setPayError("");
  };
  const submitPayModal = async () => {
    if (paySubmitting) return;
    setPayError("");
    setPaySubmitting(true);
    try {
      await onPay(
        payAmount,
        retainageHeld,
        payDate,
        payNotes.trim(),
        payStage,
        payExposure || null,
        payOperationKey,
      );
      setPayAmount(0);
      setPayNotes("");
      setPayDate(today());
      setPayStage("draft");
      setPayExposure("");
      setModalSplitManual(false);
      setPayOperationKey("");
      setPayModalOpen(false);
    } catch (error) {
      setPayError(error instanceof Error ? error.message : "Pay application did not save.");
    } finally {
      setPaySubmitting(false);
    }
  };

  const STAGE_SEG: { value: PayStage; label: string }[] = [
    { value: "draft", label: "Draft" },
    { value: "approved", label: "Approved" },
    { value: "paid", label: "Paid" },
  ];
  const PRIMARY_LABEL: Record<PayStage, string> = {
    draft: "Save draft",
    approved: "Approve for payment",
    paid: "Mark paid",
  };

  return (
    <article className="rounded-xl border border-hairline bg-card p-5 shadow-card">
      {/* Header chrome (v2): icon tile · name · trade + status chips, with the
          COI / waiver compliance chips and the remove control to the right. */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted">
              <HardHat className="h-4 w-4 text-muted-foreground" />
            </span>
            <span className="font-serif text-lg text-foreground">{subLabel}</span>
            {trade ? <Chip>{trade}</Chip> : null}
            {subStatus ? (
              <Chip tone={subStatus === "executed" ? "good" : "muted"}>
                {subStatus === "executed" ? "Executed" : "Draft"}
              </Chip>
            ) : null}
          </div>
          {topAlloc ? (
            <div className="mt-1.5 text-xs text-muted-foreground">
              Allocated to{" "}
              <b className="font-medium text-foreground">
                {topAlloc.cost_code}
                {topAlloc.description ? ` ${topAlloc.description}` : ""}
              </b>
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {coiChip ? <Chip tone={coiChip.tone}>{coiChip.label}</Chip> : null}
          <Chip tone={hasWaiverOnFile ? "good" : "warn"}>
            {hasWaiverOnFile ? "Waiver on file" : "Waiver missing"}
          </Chip>
          {subStatus === "draft" ? (
            <button
              type="button"
              className="ml-0.5 text-muted-foreground hover:text-danger"
              onClick={() => void onRemoveSub()}
              aria-label="Remove untouched subcontract draft"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      </div>

      {/* Contracts — the versioned paper trail; exactly one is the active contract */}
      <div className="mt-4">
        <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Contracts
        </div>
        {orderedDocs.length > 0 ? (
          <ul className="mt-2 divide-y divide-hairline text-sm">
            {orderedDocs.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-2 py-1.5">
                <span className="flex min-w-0 items-center gap-2">
                  <FileText className="h-3.5 w-3.5 shrink-0 text-accent-foreground" />
                  <button
                    type="button"
                    className="max-w-[240px] truncate font-medium text-foreground underline"
                    onClick={() => onViewDoc(d.storage_path)}
                    title={d.file_name}
                  >
                    {d.file_name || "Contract"}
                  </button>
                  {d.is_active ? (
                    <span className="rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-success">
                      Active
                    </span>
                  ) : null}
                </span>
                <span className="flex items-center gap-3 text-[11px] text-muted-foreground">
                  <span className="tabular-nums">{d.uploaded_at.slice(0, 10)}</span>
                  {!d.is_active ? (
                    <button
                      type="button"
                      className="font-medium text-accent-foreground hover:underline"
                      onClick={() => onSetActiveDoc(d.id)}
                    >
                      Make active
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-danger"
                    onClick={() => onRemoveDoc(d.id, d.storage_path)}
                    aria-label={`Remove ${d.file_name || "contract"}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-[11px] text-muted-foreground">No contract on file yet.</p>
        )}
        <label className="mt-2 inline-flex cursor-pointer items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <Upload className="h-3.5 w-3.5" />
          {orderedDocs.length > 0 ? "Upload amendment / new version" : "Upload executed contract"}
          <input
            type="file"
            accept="application/pdf,image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onUploadDoc(file);
              e.target.value = "";
            }}
          />
        </label>
      </div>

      {/* Primary stat row (v2): six always-on tiles per the mock. */}
      <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-y border-hairline py-4 sm:grid-cols-3 lg:grid-cols-6">
        <div className="relative min-w-0 rounded-md border border-hairline bg-surface px-3 py-2">
          <div className="font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
            Contract
          </div>
          <div className="mt-1 font-serif text-base tabular-nums text-foreground">
            {fmtUSD(summary.committed)}
          </div>
          <button
            type="button"
            className="absolute right-1.5 top-1.5 text-muted-foreground hover:text-foreground"
            onClick={openBuyoutEditor}
            aria-label="Edit the base contract amount"
            title="Edit the base contract amount"
          >
            <Pencil className="h-3 w-3" />
          </button>
        </div>
        <Stat
          label="Change orders"
          value={`${revised.changeOrders < 0 ? "−" : "+"}${fmtUSD(Math.abs(revised.changeOrders))}`}
          tone={revised.changeOrders !== 0 ? "warn" : undefined}
        />
        <Stat label="Revised" value={fmtUSD(revised.revised)} />
        <Stat label="Paid to date" value={fmtUSD(summary.paid)} tone="good" />
        <Stat label="Retainage held" value={fmtUSD(summary.retainageHeld)} />
        <Stat label="Remaining" value={fmtUSD(revised.remaining)} />
      </div>

      {/* Quieter second row — the pipeline totals, kept (not dropped). */}
      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
        {summary.draftTotal > 0 ? (
          <Stat label="Draft pay apps" value={fmtUSD(summary.draftTotal)} quiet />
        ) : null}
        {summary.approvedTotal > 0 ? (
          <Stat label="Approved to pay" value={fmtUSD(summary.approvedTotal)} quiet />
        ) : null}
        <Stat label="Net paid" value={fmtUSD(summary.netPaid)} quiet />
        <Stat label="% paid" value={`${revised.paidPct.toFixed(1)}%`} quiet />
      </div>

      {/* Change-the-commitment editor — a change order or credit moves the buyout */}
      {editingBuyout ? (
        <div className="mt-3 flex flex-col gap-2 rounded-md border border-accent/30 bg-accent/5 p-3 sm:flex-row sm:items-center">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            New commitment
          </span>
          <MoneyInput
            value={buyoutValue}
            onValueChange={setBuyoutValue}
            align="right"
            disabled={buyoutSubmitting}
          />
          <label className="flex items-center gap-1 text-xs text-muted-foreground">
            <Input
              type="number"
              value={buyoutRetainage}
              onChange={(e) => setBuyoutRetainage(Number(e.target.value) || 0)}
              className="w-16"
              disabled={buyoutSubmitting}
            />
            % ret.
          </label>
          <span className="text-[11px] text-muted-foreground">
            Use for a change order (raise) or credit (lower). Re-allocate to codes below.
          </span>
          <div className="flex items-center gap-1 sm:ml-auto">
            <Button
              type="button"
              size="sm"
              className="gap-1"
              disabled={buyoutSubmitting || buyoutValue <= 0}
              onClick={() => void submitBuyout()}
            >
              <Check className="h-3.5 w-3.5" /> {buyoutSubmitting ? "Saving…" : "Save"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                if (!buyoutSubmitting) setEditingBuyout(false);
              }}
              aria-label="Cancel"
              disabled={buyoutSubmitting}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
          {buyoutError ? (
            <p role="alert" className="basis-full text-xs text-danger">
              {buyoutError} Your entered values are still here.
            </p>
          ) : null}
        </div>
      ) : null}

      {/* Change orders & credits — their own trail, separate from the base contract */}
      <div className="mt-4">
        <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Change orders &amp; credits (kept separate from the contracted amount)
        </div>
        {changeOrders.length > 0 ? (
          <ul className="mt-2 divide-y divide-hairline text-sm">
            {changeOrders.map((co) => (
              <li key={co.id} className="flex items-center justify-between gap-2 py-1.5">
                <span className="flex min-w-0 flex-col">
                  <span className="text-foreground">
                    <span className="font-medium">{co.amount < 0 ? "Credit" : "Change order"}</span>
                    {co.description ? (
                      <span className="ml-2 text-muted-foreground">{co.description}</span>
                    ) : null}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    {co.co_date}
                    {co.cost_code ? ` · ${co.cost_code}` : ""}
                  </span>
                  <label className="mt-1 flex max-w-sm items-center gap-2 text-[10px] text-muted-foreground">
                    Risk Tally
                    <select
                      value={co.exposure_id ?? ""}
                      onChange={(event) => {
                        void onSetChangeOrderExposure(co.id, event.target.value || null);
                      }}
                      onClick={(event) => event.stopPropagation()}
                      className="min-w-0 flex-1 rounded-md border border-hairline bg-surface px-2 py-1 text-[11px] text-foreground focus:outline-none focus:ring-2 focus:ring-accent/40"
                      aria-label="Risk Tally attribution for subcontract change order"
                    >
                      <option value="">Not linked</option>
                      {exposures.map((exposure) => (
                        <option key={exposure.id} value={exposure.id}>
                          {exposure.title} · {exposure.status}
                        </option>
                      ))}
                    </select>
                  </label>
                </span>
                <span className="flex items-center gap-3">
                  <span
                    className={`font-semibold tabular-nums ${
                      co.amount < 0 ? "text-warning" : "text-foreground"
                    }`}
                  >
                    {co.amount < 0 ? "−" : "+"}
                    {fmtUSD(Math.abs(co.amount))}
                  </span>
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-danger"
                    onClick={() => void onRemoveChangeOrder(co.id)}
                    aria-label="Remove change order"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="mt-2 grid gap-2 sm:grid-cols-12 sm:items-center">
          <select
            value={coKind}
            onChange={(e) => setCoKind(e.target.value as "co" | "credit")}
            className="h-9 w-full rounded-md border border-hairline bg-surface px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent/40 sm:col-span-4 lg:col-span-3"
            aria-label="Change order or credit"
            disabled={changeOrderSubmitting}
          >
            <option value="co">Change order (adds)</option>
            <option value="credit">Credit (deducts)</option>
          </select>
          <Input
            value={coDesc}
            onChange={(e) => setCoDesc(e.target.value)}
            placeholder="What changed (e.g. Added 2 dock pits)"
            className="sm:col-span-8 lg:col-span-5"
            disabled={changeOrderSubmitting}
          />
          <select
            value={coBucket}
            onChange={(e) => setCoBucket(e.target.value)}
            className="h-9 w-full rounded-md border border-hairline bg-surface px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent/40 sm:col-span-6 lg:col-span-4"
            aria-label="Cost code (optional)"
            disabled={changeOrderSubmitting}
          >
            <option value="">Cost code (optional)…</option>
            {buckets.map((b) => (
              <option key={b.id} value={b.id}>
                {b.cost_code} · {b.bucket}
              </option>
            ))}
          </select>
          <Input
            type="date"
            value={coDate}
            onChange={(e) => setCoDate(e.target.value)}
            className="w-full sm:col-span-6 lg:col-span-3"
            aria-label="Change order date"
            disabled={changeOrderSubmitting}
          />
          <MoneyInput
            value={coAmount}
            onValueChange={setCoAmount}
            align="right"
            className="sm:col-span-4 lg:col-span-3"
            disabled={changeOrderSubmitting}
          />
          <select
            value={coExposure}
            onChange={(event) => setCoExposure(event.target.value)}
            className="h-9 w-full rounded-md border border-hairline bg-surface px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent/40 sm:col-span-6 lg:col-span-4"
            aria-label="Risk Tally attribution (optional)"
            disabled={changeOrderSubmitting}
          >
            <option value="">Risk Tally (optional)…</option>
            {exposures.map((exposure) => (
              <option key={exposure.id} value={exposure.id}>
                {exposure.title} · {exposure.status}
              </option>
            ))}
          </select>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-9 w-full gap-1.5 sm:col-span-2 lg:col-span-2"
            disabled={changeOrderSubmitting || coAmount <= 0 || !coDate}
            onClick={() => void submitChangeOrder()}
          >
            <Plus className="h-3.5 w-3.5" />
            {changeOrderSubmitting ? "Saving…" : "Add"}
          </Button>
        </div>
        {changeOrderError ? (
          <p role="alert" className="mt-2 text-xs text-danger">
            {changeOrderError} Your entered change order is still here.
          </p>
        ) : null}
        <p className="mt-1 text-[11px] text-muted-foreground">
          The base contract stays untouched — the revised total is shown above. A change order
          tagged to a cost code carries into that code&apos;s committed on the job budget. Link a
          Risk Tally item to show committed subcontract exposure before it becomes paid cost.
        </p>
      </div>

      {/* Allocations */}
      <div className="mt-4">
        <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Cost codes (buyout = committed cost on these codes)
        </div>
        {allocations.length > 0 ? (
          <ul className="mt-2 divide-y divide-hairline text-sm">
            {allocations.map((a) => {
              const unitCost = a.planned_quantity > 0 ? a.amount / a.planned_quantity : null;
              const laborEquivalentHours =
                a.benchmark_labor_rate > 0 ? a.amount / a.benchmark_labor_rate : null;
              const derivedTarget =
                laborEquivalentHours != null && laborEquivalentHours > 0 && a.planned_quantity > 0
                  ? a.planned_quantity / laborEquivalentHours
                  : null;
              return (
                <li key={a.id} className="py-2">
                  {editAllocId === a.id ? (
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <span className="text-foreground">
                        <span className="font-medium">{a.cost_code || "No code"}</span>
                        <span className="ml-2 text-muted-foreground">{a.description}</span>
                      </span>
                      <div className="flex items-center gap-1 sm:ml-auto">
                        <MoneyInput
                          value={editAllocAmount}
                          onValueChange={setEditAllocAmount}
                          align="right"
                          disabled={allocationSubmitting}
                        />
                        <Button
                          type="button"
                          size="sm"
                          className="gap-1"
                          disabled={allocationSubmitting || editAllocAmount < 0}
                          onClick={() => void submitAllocationUpdate(a.id)}
                        >
                          <Check className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            if (!allocationSubmitting) setEditAllocId(null);
                          }}
                          aria-label="Cancel"
                          disabled={allocationSubmitting}
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between">
                      <span className="text-foreground">
                        <span className="font-medium">{a.cost_code || "No code"}</span>
                        <span className="ml-2 text-muted-foreground">{a.description}</span>
                      </span>
                      <span className="flex items-center gap-3">
                        <span className="font-semibold tabular-nums">{fmtUSD(a.amount)}</span>
                        <button
                          type="button"
                          className="text-muted-foreground hover:text-foreground"
                          onClick={() => openAllocEditor(a)}
                          aria-label="Edit allocation amount"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          className="text-muted-foreground hover:text-danger"
                          onClick={() => void onRemoveAllocation(a.id)}
                          aria-label="Remove allocation"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </span>
                    </div>
                  )}
                  {benchmarkAllocId === a.id ? (
                    <div className="mt-2 rounded-md border border-accent/25 bg-accent/5 p-3">
                      <div className="font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
                        Production benchmark
                      </div>
                      <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_110px_1fr_auto] sm:items-end">
                        <label className="text-[11px] text-muted-foreground">
                          Planned scope quantity
                          <Input
                            type="number"
                            min={0}
                            value={benchmarkQuantity || ""}
                            onChange={(event) =>
                              setBenchmarkQuantity(Number(event.target.value) || 0)
                            }
                            disabled={allocationSubmitting}
                          />
                        </label>
                        <label className="text-[11px] text-muted-foreground">
                          Unit
                          <Input
                            value={benchmarkUnit}
                            placeholder="SF"
                            onChange={(event) => setBenchmarkUnit(event.target.value)}
                            disabled={allocationSubmitting}
                          />
                        </label>
                        <label className="text-[11px] text-muted-foreground">
                          GC loaded benchmark $/labor hr
                          <MoneyInput
                            value={benchmarkRate}
                            onValueChange={setBenchmarkRate}
                            disabled={allocationSubmitting}
                          />
                        </label>
                        <div className="flex gap-1">
                          <Button
                            type="button"
                            size="sm"
                            disabled={
                              allocationSubmitting ||
                              benchmarkQuantity <= 0 ||
                              !benchmarkUnit.trim() ||
                              benchmarkRate <= 0
                            }
                            onClick={() => void submitBenchmark(a.id)}
                          >
                            {allocationSubmitting ? "Saving…" : "Save"}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              if (!allocationSubmitting) setBenchmarkAllocId(null);
                            }}
                            disabled={allocationSubmitting}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                      <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                        This is your estimating benchmark, not the subcontractor&apos;s payroll
                        rate. OverWatch uses it to translate the lump-sum buyout into
                        labor-equivalent hours and a required production pace.
                      </p>
                    </div>
                  ) : a.planned_quantity > 0 && a.unit && a.benchmark_labor_rate > 0 ? (
                    <button
                      type="button"
                      onClick={() => openBenchmarkEditor(a)}
                      className="mt-1.5 flex w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-md bg-surface px-2.5 py-2 text-left text-[11px] text-muted-foreground transition-colors hover:bg-secondary/70"
                    >
                      <span className="font-semibold text-foreground">Production benchmark</span>
                      <span>
                        {a.planned_quantity.toLocaleString()} {a.unit}
                      </span>
                      <span>{unitCost == null ? "—" : `${fmtUSD(unitCost)}/${a.unit}`}</span>
                      <span>{fmtUSD(a.benchmark_labor_rate)}/labor hr</span>
                      <span className="font-semibold text-success">
                        {derivedTarget == null
                          ? "—"
                          : `${derivedTarget.toFixed(2)} ${a.unit}/labor hr target`}
                      </span>
                      <Pencil className="ml-auto h-3 w-3" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => openBenchmarkEditor(a)}
                      className="mt-1.5 text-[11px] font-semibold text-clay hover:underline"
                    >
                      + Set production benchmark
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        ) : null}
        {unallocated > 0.005 ? (
          <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
            <select
              value={allocBucket}
              onChange={(e) => setAllocBucket(e.target.value)}
              className="min-w-[220px] rounded-md border border-hairline bg-surface px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent/40"
              disabled={allocationSubmitting}
            >
              <option value="">Allocate to cost code…</option>
              {buckets.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.cost_code} · {b.bucket}
                </option>
              ))}
            </select>
            <MoneyInput
              value={allocAmount}
              onValueChange={setAllocAmount}
              align="right"
              disabled={allocationSubmitting}
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="gap-1.5"
              disabled={allocationSubmitting || !allocBucket || allocAmount <= 0}
              onClick={() => void submitAllocation()}
            >
              <Plus className="h-3.5 w-3.5" />
              {allocationSubmitting ? "Saving…" : "Allocate"}
            </Button>
            <span className="text-[11px] text-muted-foreground">
              {fmtUSD(unallocated)} left to allocate
            </span>
          </div>
        ) : null}
        {allocationError ? (
          <p role="alert" className="mt-2 text-xs text-danger">
            {allocationError} Your allocation values are still here.
          </p>
        ) : null}
      </div>

      {/* Payments — the pay-app pipeline: draft → approved for payment → paid */}
      <div className="mt-5 border-t border-hairline pt-4">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
            Pay applications
          </div>
          <span className="text-[11px] text-muted-foreground">
            buyout = committed cost · a paid app becomes actual cost on the code
          </span>
          <Button type="button" size="sm" className="ml-auto gap-1.5" onClick={openPayModal}>
            <Plus className="h-3.5 w-3.5" /> Record pay app
          </Button>
        </div>
        {payments.length > 0 ? (
          <ul className="mt-2 divide-y divide-hairline text-sm">
            {payments.map((p) => {
              const stage = STAGE_CHIP[p.status] ?? STAGE_CHIP.paid;
              const attachedWaiver = waivers.find((w) => w.payment_id === p.id) ?? null;
              const compliant = p.status === "paid" || !!attachedWaiver;
              return (
                <li key={p.id} className="py-1.5">
                  {editPayId === p.id && p.status === "draft" ? (
                    <div className="flex flex-col gap-2">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                        <Input
                          type="date"
                          value={editPay.paymentDate}
                          onChange={(e) =>
                            setEditPay((s) => ({ ...s, paymentDate: e.target.value }))
                          }
                          className="w-40"
                          disabled={editPaySubmitting}
                        />
                        <MoneyInput
                          value={editPay.amount}
                          onValueChange={(v) => setEditPay((s) => ({ ...s, amount: v }))}
                          align="right"
                          disabled={editPaySubmitting}
                        />
                        <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
                          ret.
                          <MoneyInput
                            value={editPay.retainageHeld}
                            onValueChange={(v) => setEditPay((s) => ({ ...s, retainageHeld: v }))}
                            align="right"
                            disabled={editPaySubmitting}
                          />
                        </label>
                      </div>
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                        <Input
                          value={editPay.notes}
                          onChange={(e) => setEditPay((s) => ({ ...s, notes: e.target.value }))}
                          placeholder="Description (e.g. Pay app #3, foundations)"
                          className="flex-1"
                          disabled={editPaySubmitting}
                        />
                        <div className="flex items-center gap-1">
                          <Button
                            type="button"
                            size="sm"
                            className="gap-1"
                            disabled={editPaySubmitting || editPay.amount <= 0}
                            onClick={submitPayEdit}
                          >
                            <Check className="h-3.5 w-3.5" />
                            {editPaySubmitting ? "Saving…" : "Save"}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={closePayEditor}
                            aria-label="Cancel"
                            disabled={editPaySubmitting}
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                      {editPayError ? (
                        <div
                          role="alert"
                          className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
                        >
                          {editPayError} Your changes are still here. Retry when ready.
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <div className="flex items-center justify-between">
                      <span className="flex min-w-0 flex-col gap-1">
                        <span className="flex flex-wrap items-center gap-2 text-muted-foreground">
                          {p.payment_date}
                          <Chip tone={stage.tone}>{stage.label}</Chip>
                          {compliant ? (
                            <Chip tone="good">Compliant</Chip>
                          ) : gatingEnabled ? (
                            <Chip tone="warn">Waiver needed</Chip>
                          ) : null}
                        </span>
                        {p.notes ? (
                          <span className="truncate text-[11px] text-muted-foreground/80">
                            {p.notes}
                          </span>
                        ) : null}
                        {p.compliance_override_reason ? (
                          <span className="text-[11px] text-warning">
                            ⚠ Paid without compliance — {p.compliance_override_reason}
                          </span>
                        ) : null}
                        {p.status === "paid" && (p.payment_method || p.reference) ? (
                          <span className="text-[11px] text-success">
                            Paid
                            {p.payment_method
                              ? ` by ${SUB_PAY_METHOD_LABEL[p.payment_method] ?? p.payment_method}`
                              : ""}
                            {p.reference ? ` · ${p.reference}` : ""}
                          </span>
                        ) : null}
                        <label className="flex max-w-sm items-center gap-2 text-[10px] text-muted-foreground">
                          Risk Tally
                          <select
                            value={p.exposure_id ?? ""}
                            disabled={p.status !== "draft"}
                            title={
                              p.status === "draft"
                                ? "Link this draft to Risk Tally"
                                : "Risk attribution is locked after approval"
                            }
                            onChange={(event) =>
                              onSetPaymentExposure(p.id, event.target.value || null)
                            }
                            className="min-w-0 flex-1 rounded-md border border-hairline bg-surface px-2 py-1 text-[11px] text-foreground focus:outline-none focus:ring-2 focus:ring-accent/40 disabled:cursor-not-allowed disabled:opacity-60"
                            aria-label="Risk Tally attribution for subcontract pay app"
                          >
                            <option value="">Not linked</option>
                            {exposures.map((exposure) => (
                              <option key={exposure.id} value={exposure.id}>
                                {exposure.title} · {exposure.status}
                              </option>
                            ))}
                          </select>
                        </label>
                        <span className="flex items-center gap-3">
                          {p.status === "draft" ? (
                            <button
                              type="button"
                              className="w-fit text-[11px] font-medium text-accent-foreground hover:underline"
                              onClick={() => onSetPaymentStage(p.id, "approved")}
                            >
                              Approve for payment
                            </button>
                          ) : null}
                          {p.status === "draft" || p.status === "approved" ? (
                            <button
                              type="button"
                              className="w-fit text-[11px] font-medium text-accent-foreground hover:underline"
                              onClick={() => onMarkPaid(p)}
                            >
                              Mark paid
                            </button>
                          ) : null}
                        </span>
                        <PaymentWaiverLine
                          payment={p}
                          attached={attachedWaiver}
                          pool={waivers.filter((w) => !w.payment_id)}
                          gatingEnabled={gatingEnabled}
                          onAttach={(waiverId) => onAttachWaiver(p.id, waiverId)}
                          onDetach={(waiverId) => onDetachWaiver(p.id, waiverId)}
                          onUpload={(file) => onUploadWaiverForPayment(p, file)}
                          onView={onViewWaiverDoc}
                        />
                        {p.status === "draft" && (allocations.length > 0 || buckets.length > 0) ? (
                          <button
                            type="button"
                            className="w-fit text-[11px] font-medium text-accent-foreground hover:underline"
                            onClick={() =>
                              setSplitOpen((open) => ({ ...open, [p.id]: !open[p.id] }))
                            }
                          >
                            {splitOpen[p.id] ? "Hide cost codes" : "Where this payment goes"}
                            {(splitsByPayment.get(p.id)?.length ?? 0) > 0 ? " · custom split" : ""}
                          </button>
                        ) : p.status !== "draft" && (splitsByPayment.get(p.id)?.length ?? 0) > 0 ? (
                          <span className="text-[11px] text-muted-foreground">
                            Cost coding locked · custom split
                          </span>
                        ) : null}
                      </span>
                      <span className="flex items-center gap-3">
                        <span className="font-semibold tabular-nums text-foreground">
                          {fmtUSD(p.amount)}
                        </span>
                        {p.retainage_held > 0 ? (
                          <span className="text-[11px] text-warning">
                            −{fmtUSD(p.retainage_held)} ret.
                          </span>
                        ) : null}
                        {p.status === "draft" ? (
                          <>
                            <button
                              type="button"
                              className="text-muted-foreground hover:text-foreground"
                              onClick={() => openPayEditor(p)}
                              aria-label="Edit payment"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              className="text-muted-foreground hover:text-danger"
                              onClick={() => onRemovePayment(p.id)}
                              aria-label="Remove payment"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </>
                        ) : null}
                      </span>
                    </div>
                  )}
                  {p.status === "draft" && editPayId !== p.id && splitOpen[p.id] ? (
                    // Editable split (field request 2026-07-09): starts from the
                    // saved explicit rows, else the pro-rata derivation the budget
                    // layer uses; saving replaces the payment's coding exactly.
                    <PaymentSplitEditor
                      key={`${p.id}:${splitsByPayment.get(p.id)?.length ?? 0}`}
                      paymentAmount={p.amount}
                      buckets={buckets}
                      allocations={allocations}
                      savedRows={splitsByPayment.get(p.id) ?? []}
                      onSave={(rows) => onSaveSplit(p.id, rows)}
                      saving={savingSplit}
                    />
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-2 text-[11px] text-muted-foreground">
            No pay apps yet. Record the first one — a draft won&apos;t touch the budget until
            it&apos;s approved and marked paid.
          </p>
        )}
      </div>

      {complianceSlot}

      {/* Record pay app (v2): the new-pay-app form, relocated into a modal with a
          3-segment stage control, an automatic-split preview, and the compliance
          gate copy. Recording calls the same onPay as before. */}
      <Dialog
        open={payModalOpen}
        onOpenChange={(open) => {
          if (!paySubmitting) setPayModalOpen(open);
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <div className="eyebrow">
              {subLabel}
              {topAlloc?.cost_code ? ` · ${topAlloc.cost_code}` : ""}
            </div>
            <DialogTitle className="font-serif text-2xl">Record pay application</DialogTitle>
            <DialogDescription>
              A draft won&apos;t touch the budget. Approve it, then mark it paid — that&apos;s when
              it becomes job cost.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Payment amount
              <MoneyInput
                value={payAmount}
                onValueChange={(value) => {
                  reviseFailedPayDraft();
                  setPayAmount(value);
                }}
                align="right"
                disabled={paySubmitting}
              />
            </label>
            <div className="space-y-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Retainage held ({defaultRetainagePct}%)
              <div className="flex h-9 items-center rounded-md border border-hairline bg-surface px-3 text-sm tabular-nums text-foreground">
                {fmtUSD(retainageHeld)}
              </div>
            </div>
            <label className="space-y-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Payment date
              <Input
                type="date"
                value={payDate}
                onChange={(e) => {
                  reviseFailedPayDraft();
                  setPayDate(e.target.value);
                }}
                aria-label="Payment date"
                disabled={paySubmitting}
              />
            </label>
            <label className="space-y-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground sm:col-span-1">
              Notes
              <Input
                value={payNotes}
                onChange={(e) => {
                  reviseFailedPayDraft();
                  setPayNotes(e.target.value);
                }}
                placeholder="Description (e.g. Pay app #3, foundations)"
                disabled={paySubmitting}
              />
            </label>
            <label className="space-y-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground sm:col-span-2">
              Risk Tally attribution (optional)
              <select
                value={payExposure}
                onChange={(event) => {
                  reviseFailedPayDraft();
                  setPayExposure(event.target.value);
                }}
                disabled={paySubmitting}
                className="h-9 w-full rounded-md border border-hairline bg-surface px-3 text-sm font-normal normal-case tracking-normal text-foreground focus:outline-none focus:ring-2 focus:ring-accent/40 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="">Not linked to a risk</option>
                {exposures.map((exposure) => (
                  <option key={exposure.id} value={exposure.id}>
                    {exposure.title} · {exposure.status}
                  </option>
                ))}
              </select>
              <span className="block text-[11px] font-normal normal-case tracking-normal text-muted-foreground">
                The link is visible immediately; only a paid app counts as actual incurred on the
                risk.
              </span>
            </label>
          </div>

          <div className="mt-1 space-y-1.5">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Stage
            </div>
            <div className="flex gap-0.5 rounded-lg bg-muted p-0.5">
              {STAGE_SEG.map((s) => (
                <button
                  key={s.value}
                  type="button"
                  onClick={() => {
                    reviseFailedPayDraft();
                    setPayStage(s.value);
                  }}
                  disabled={paySubmitting}
                  className={`flex-1 rounded-md px-3 py-2 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                    payStage === s.value
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {/* Cost-code split preview. The live per-payment split editor stays on
              the pay-app's row (it needs the recorded payment) — here we preview
              the automatic pro-rata distribution and point to it. */}
          <div className="rounded-xl border border-hairline bg-background p-4">
            <div className="font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
              Cost-code split
            </div>
            <div className="mt-1.5 text-[12.5px] text-muted-foreground">
              Automatic — distributes pro-rata across{" "}
              <b className="font-medium text-foreground">
                {splitCodes || "the buyout's cost codes"}
              </b>
              .{" "}
              <button
                type="button"
                className="font-medium text-foreground underline disabled:cursor-not-allowed disabled:opacity-50"
                onClick={() => setModalSplitManual((v) => !v)}
                disabled={paySubmitting}
              >
                {modalSplitManual ? "Use automatic split" : "Split manually →"}
              </button>
            </div>
            {modalSplitManual ? (
              <p className="mt-2 text-[11px] text-muted-foreground">
                Record the pay app first, then open{" "}
                <b className="text-foreground">Where this payment goes</b> on its row to set an
                exact cost-code split.
              </p>
            ) : null}
          </div>

          {/* Compliance gate copy. The live attach / upload / override controls
              live on the pay-app row and the how-paid → override dialog. */}
          {gatingEnabled ? (
            <div className="rounded-xl border border-warning/40 bg-warning/[0.06] p-4">
              <div className="flex items-center gap-2">
                <ShieldAlert className="h-4 w-4 text-warning" />
                <span className="text-sm font-semibold text-foreground">Compliance gate is on</span>
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                Marking this app <b className="text-foreground">paid</b> needs a valid COI (
                {coiStatus === "valid" || coiStatus === "expiring_soon"
                  ? "✓ on file"
                  : "✗ not verified"}
                ) and a signed lien waiver for this payment. Attach it on the pay app&apos;s row
                after recording, or override when you mark it paid.
              </p>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Compliance gating is off for this project — payments are never blocked.
            </p>
          )}

          {payError ? (
            <div
              role="alert"
              className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
            >
              {payError} Your entries are still here. Retry when ready.
            </div>
          ) : null}

          <DialogFooter className="items-center sm:justify-between">
            <span className="text-[11px] text-muted-foreground">
              This app: {fmtUSD(payAmount)} · retainage {fmtUSD(retainageHeld)}
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                onClick={() => setPayModalOpen(false)}
                disabled={paySubmitting}
              >
                Cancel
              </Button>
              <Button
                disabled={paySubmitting || payAmount <= 0 || !payDate}
                onClick={submitPayModal}
              >
                {paySubmitting ? "Saving…" : PRIMARY_LABEL[payStage]}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </article>
  );
}
