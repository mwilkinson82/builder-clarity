// One subcontract's card on the Subcontractors tab: the versioned contract paper
// trail, the buyout (committed cost), its cost-code allocations, and progress
// payments (actual cost). Everything is editable in place — the commitment moves
// for a change order or credit, an allocation re-prices per code, and a payment's
// date/amount/description can be corrected after the fact. Extracted from
// SubcontractorsWorkspace so both files stay well under the size limit.
import { useState } from "react";
import { Check, FileText, Pencil, Plus, ReceiptText, Trash2, Upload, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/money-input";
import { fmtUSDCents as fmtUSD } from "@/lib/billing-format";
import {
  allocatePaymentAcrossCodes,
  reviseSubSummary,
  sumChangeOrders,
  type summarizeSubPayments,
} from "@/lib/subcontract-budget";
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
}
export interface CardChangeOrder {
  id: string;
  cost_code: string;
  description: string;
  amount: number; // signed dollars: change order +, credit −
  co_date: string;
}
export interface CardPayment {
  id: string;
  amount: number;
  retainage_held: number;
  payment_date: string;
  notes: string;
}
export interface PaymentEdit {
  amount: number;
  retainageHeld: number;
  paymentDate: string;
  notes: string;
}

const today = () => new Date().toISOString().slice(0, 10);

function Stat({ label, value, tone }: { label: string; value: string; tone?: "good" | "warn" }) {
  return (
    <div className="rounded-md border border-hairline bg-surface px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </div>
      <div
        className={`mt-0.5 text-sm font-semibold tabular-nums ${
          tone === "good" ? "text-success" : tone === "warn" ? "text-warning" : "text-foreground"
        }`}
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
  onEditBuyout: (contractValue: number, retainagePct: number) => void;
  onAllocate: (costBucketId: string, amount: number) => void;
  onUpdateAllocation: (id: string, amount: number) => void;
  onRemoveAllocation: (id: string) => void;
  changeOrders: CardChangeOrder[];
  onRecordChangeOrder: (
    costBucketId: string | null,
    description: string,
    amount: number,
    coDate: string,
  ) => void;
  onRemoveChangeOrder: (id: string) => void;
  onPay: (amount: number, retainageHeld: number, paymentDate: string, notes: string) => void;
  onUpdatePayment: (id: string, edit: PaymentEdit) => void;
  onRemovePayment: (id: string) => void;
  onRemoveSub: () => void;
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
  onEditBuyout,
  onAllocate,
  onUpdateAllocation,
  onRemoveAllocation,
  changeOrders,
  onRecordChangeOrder,
  onRemoveChangeOrder,
  onPay,
  onUpdatePayment,
  onRemovePayment,
  onRemoveSub,
  documents,
  onUploadDoc,
  onViewDoc,
  onSetActiveDoc,
  onRemoveDoc,
  complianceSlot,
}: CardProps) {
  const [allocBucket, setAllocBucket] = useState("");
  const [allocAmount, setAllocAmount] = useState(0);
  const [payAmount, setPayAmount] = useState(0);
  const [payDate, setPayDate] = useState(today);
  const [payNotes, setPayNotes] = useState("");

  // Inline editors, keyed by the row being edited (null = closed).
  const [editingBuyout, setEditingBuyout] = useState(false);
  const [buyoutValue, setBuyoutValue] = useState(0);
  const [buyoutRetainage, setBuyoutRetainage] = useState(0);
  const [editAllocId, setEditAllocId] = useState<string | null>(null);
  const [editAllocAmount, setEditAllocAmount] = useState(0);
  const [editPayId, setEditPayId] = useState<string | null>(null);
  const [editPay, setEditPay] = useState<PaymentEdit>({
    amount: 0,
    retainageHeld: 0,
    paymentDate: today(),
    notes: "",
  });

  // CO/credit entry form
  const [coKind, setCoKind] = useState<"co" | "credit">("co");
  const [coAmount, setCoAmount] = useState(0);
  const [coDesc, setCoDesc] = useState("");
  const [coBucket, setCoBucket] = useState("");
  const [coDate, setCoDate] = useState(today);
  // Which payments show their per-cost-code split
  const [splitOpen, setSplitOpen] = useState<Record<string, boolean>>({});

  // Change orders live SEPARATE from the base contract; the revised numbers are
  // derived, never written back onto the buyout.
  const revised = reviseSubSummary(summary, sumChangeOrders(changeOrders));
  const hasChangeOrders = changeOrders.length > 0;

  const unallocated = summary.committed - allocatedTotal;
  const retainageHeld = Math.round(payAmount * defaultRetainagePct) / 100;
  // Active version first, then newest — the current contract sits on top, the
  // superseded ones stay below as the paper trail.
  const orderedDocs = [...documents].sort(
    (a, b) =>
      Number(b.is_active) - Number(a.is_active) || b.uploaded_at.localeCompare(a.uploaded_at),
  );

  const openBuyoutEditor = () => {
    setBuyoutValue(summary.committed);
    setBuyoutRetainage(defaultRetainagePct);
    setEditingBuyout(true);
  };
  const openAllocEditor = (a: CardAllocation) => {
    setEditAllocId(a.id);
    setEditAllocAmount(a.amount);
  };
  const openPayEditor = (p: CardPayment) => {
    setEditPayId(p.id);
    setEditPay({
      amount: p.amount,
      retainageHeld: p.retainage_held,
      paymentDate: p.payment_date || today(),
      notes: p.notes,
    });
  };

  return (
    <div className="rounded-lg border border-hairline bg-card p-5 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="font-serif text-lg text-foreground">{subLabel}</div>
        <button
          type="button"
          className="text-muted-foreground hover:text-danger"
          onClick={onRemoveSub}
          aria-label="Remove subcontract"
        >
          <Trash2 className="h-4 w-4" />
        </button>
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

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <div className="relative">
          <Stat
            label={hasChangeOrders ? "Base contract" : "Buyout"}
            value={fmtUSD(summary.committed)}
          />
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
        {hasChangeOrders ? (
          <>
            <Stat
              label="Change orders"
              value={`${revised.changeOrders < 0 ? "−" : "+"}${fmtUSD(Math.abs(revised.changeOrders))}`}
              tone={revised.changeOrders < 0 ? "warn" : undefined}
            />
            <Stat label="Revised contract" value={fmtUSD(revised.revised)} />
          </>
        ) : null}
        <Stat label="Paid to date" value={fmtUSD(summary.paid)} />
        <Stat label="Retainage held" value={fmtUSD(summary.retainageHeld)} tone="warn" />
        <Stat label="Net paid" value={fmtUSD(summary.netPaid)} />
        <Stat label="Remaining" value={fmtUSD(revised.remaining)} tone="good" />
        <Stat label="% paid" value={`${revised.paidPct.toFixed(1)}%`} />
      </div>

      {/* Change-the-commitment editor — a change order or credit moves the buyout */}
      {editingBuyout ? (
        <div className="mt-3 flex flex-col gap-2 rounded-md border border-accent/30 bg-accent/5 p-3 sm:flex-row sm:items-center">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            New commitment
          </span>
          <MoneyInput value={buyoutValue} onValueChange={setBuyoutValue} align="right" />
          <label className="flex items-center gap-1 text-xs text-muted-foreground">
            <Input
              type="number"
              value={buyoutRetainage}
              onChange={(e) => setBuyoutRetainage(Number(e.target.value) || 0)}
              className="w-16"
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
              disabled={buyoutValue <= 0}
              onClick={() => {
                onEditBuyout(buyoutValue, buyoutRetainage);
                setEditingBuyout(false);
              }}
            >
              <Check className="h-3.5 w-3.5" /> Save
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setEditingBuyout(false)}
              aria-label="Cancel"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
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
                    onClick={() => onRemoveChangeOrder(co.id)}
                    aria-label="Remove change order"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="mt-2 flex flex-col gap-2 lg:flex-row lg:items-center">
          <select
            value={coKind}
            onChange={(e) => setCoKind(e.target.value as "co" | "credit")}
            className="rounded-md border border-hairline bg-surface px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent/40"
            aria-label="Change order or credit"
          >
            <option value="co">Change order (adds)</option>
            <option value="credit">Credit (deducts)</option>
          </select>
          <Input
            value={coDesc}
            onChange={(e) => setCoDesc(e.target.value)}
            placeholder="What changed (e.g. Added 2 dock pits)"
            className="flex-1"
          />
          <select
            value={coBucket}
            onChange={(e) => setCoBucket(e.target.value)}
            className="rounded-md border border-hairline bg-surface px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent/40"
            aria-label="Cost code (optional)"
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
            className="w-40"
            aria-label="Change order date"
          />
          <MoneyInput value={coAmount} onValueChange={setCoAmount} align="right" />
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="gap-1.5"
            disabled={coAmount <= 0 || !coDate}
            onClick={() => {
              onRecordChangeOrder(
                coBucket || null,
                coDesc.trim(),
                coKind === "credit" ? -coAmount : coAmount,
                coDate,
              );
              setCoAmount(0);
              setCoDesc("");
              setCoBucket("");
            }}
          >
            <Plus className="h-3.5 w-3.5" /> Add
          </Button>
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">
          The base contract stays untouched — the revised total is shown above. A change order
          tagged to a cost code carries into that code&apos;s committed on the job budget and
          dashboard automatically; leave it untagged and it stays here on the card only.
        </p>
      </div>

      {/* Allocations */}
      <div className="mt-4">
        <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Cost codes (buyout = committed cost on these codes)
        </div>
        {allocations.length > 0 ? (
          <ul className="mt-2 divide-y divide-hairline text-sm">
            {allocations.map((a) => (
              <li key={a.id} className="py-1.5">
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
                      />
                      <Button
                        type="button"
                        size="sm"
                        className="gap-1"
                        disabled={editAllocAmount < 0}
                        onClick={() => {
                          onUpdateAllocation(a.id, editAllocAmount);
                          setEditAllocId(null);
                        }}
                      >
                        <Check className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => setEditAllocId(null)}
                        aria-label="Cancel"
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
                        onClick={() => onRemoveAllocation(a.id)}
                        aria-label="Remove allocation"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </span>
                  </div>
                )}
              </li>
            ))}
          </ul>
        ) : null}
        {unallocated > 0.005 ? (
          <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
            <select
              value={allocBucket}
              onChange={(e) => setAllocBucket(e.target.value)}
              className="min-w-[220px] rounded-md border border-hairline bg-surface px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent/40"
            >
              <option value="">Allocate to cost code…</option>
              {buckets.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.cost_code} · {b.bucket}
                </option>
              ))}
            </select>
            <MoneyInput value={allocAmount} onValueChange={setAllocAmount} align="right" />
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="gap-1.5"
              disabled={!allocBucket || allocAmount <= 0}
              onClick={() => {
                onAllocate(allocBucket, allocAmount);
                setAllocBucket("");
                setAllocAmount(0);
              }}
            >
              <Plus className="h-3.5 w-3.5" /> Allocate
            </Button>
            <span className="text-[11px] text-muted-foreground">
              {fmtUSD(unallocated)} left to allocate
            </span>
          </div>
        ) : null}
      </div>

      {/* Payments */}
      <div className="mt-4">
        <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Progress payments
        </div>
        {payments.length > 0 ? (
          <ul className="mt-2 divide-y divide-hairline text-sm">
            {payments.map((p) => (
              <li key={p.id} className="py-1.5">
                {editPayId === p.id ? (
                  <div className="flex flex-col gap-2">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <Input
                        type="date"
                        value={editPay.paymentDate}
                        onChange={(e) => setEditPay((s) => ({ ...s, paymentDate: e.target.value }))}
                        className="w-40"
                      />
                      <MoneyInput
                        value={editPay.amount}
                        onValueChange={(v) => setEditPay((s) => ({ ...s, amount: v }))}
                        align="right"
                      />
                      <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
                        ret.
                        <MoneyInput
                          value={editPay.retainageHeld}
                          onValueChange={(v) => setEditPay((s) => ({ ...s, retainageHeld: v }))}
                          align="right"
                        />
                      </label>
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <Input
                        value={editPay.notes}
                        onChange={(e) => setEditPay((s) => ({ ...s, notes: e.target.value }))}
                        placeholder="Description (e.g. Pay app #3, foundations)"
                        className="flex-1"
                      />
                      <div className="flex items-center gap-1">
                        <Button
                          type="button"
                          size="sm"
                          className="gap-1"
                          disabled={editPay.amount <= 0}
                          onClick={() => {
                            onUpdatePayment(p.id, editPay);
                            setEditPayId(null);
                          }}
                        >
                          <Check className="h-3.5 w-3.5" /> Save
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => setEditPayId(null)}
                          aria-label="Cancel"
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between">
                    <span className="flex min-w-0 flex-col">
                      <span className="text-muted-foreground">{p.payment_date}</span>
                      {p.notes ? (
                        <span className="truncate text-[11px] text-muted-foreground/80">
                          {p.notes}
                        </span>
                      ) : null}
                      {allocations.length > 0 ? (
                        <button
                          type="button"
                          className="w-fit text-[11px] font-medium text-accent-foreground hover:underline"
                          onClick={() => setSplitOpen((open) => ({ ...open, [p.id]: !open[p.id] }))}
                        >
                          {splitOpen[p.id] ? "Hide cost codes" : "Where this payment goes"}
                        </button>
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
                    </span>
                  </div>
                )}
                {editPayId !== p.id && splitOpen[p.id] ? (
                  // Derived pro-rata from the buyout's cost-code split — the
                  // same distribution the budget ledger uses for this payment.
                  <ul className="mb-1 ml-4 mt-1 space-y-0.5 border-l border-hairline pl-3 text-[12px]">
                    {allocatePaymentAcrossCodes(p.amount, allocations).map((split, index) => (
                      <li key={`${split.cost_code}-${index}`} className="flex justify-between">
                        <span className="text-muted-foreground">
                          <span className="font-medium text-foreground">
                            {split.cost_code || "No code"}
                          </span>
                          {split.description ? ` · ${split.description}` : ""}
                        </span>
                        <span className="tabular-nums text-foreground">{fmtUSD(split.amount)}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
        <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
          <ReceiptText className="hidden h-4 w-4 text-muted-foreground sm:block" />
          <Input
            type="date"
            value={payDate}
            onChange={(e) => setPayDate(e.target.value)}
            className="w-40"
            aria-label="Payment date"
          />
          <MoneyInput value={payAmount} onValueChange={setPayAmount} align="right" />
          <Input
            value={payNotes}
            onChange={(e) => setPayNotes(e.target.value)}
            placeholder="Description (optional)"
            className="flex-1"
          />
          <span className="text-[11px] text-muted-foreground">
            holds {fmtUSD(retainageHeld)} retainage ({defaultRetainagePct}%)
          </span>
          <Button
            type="button"
            size="sm"
            className="gap-1.5"
            disabled={payAmount <= 0 || !payDate}
            onClick={() => {
              onPay(payAmount, retainageHeld, payDate, payNotes.trim());
              setPayAmount(0);
              setPayNotes("");
              setPayDate(today());
            }}
          >
            <Plus className="h-3.5 w-3.5" /> Record payment
          </Button>
        </div>
      </div>

      {complianceSlot}
    </div>
  );
}
