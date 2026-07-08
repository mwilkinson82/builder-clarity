// Subcontractors workspace (SUBCONTRACTORS Slice 1) — the tab where a GC loads
// subs, buys out scope, and pays against it. Buyouts are committed cost and
// payments are actual cost; both flow into the budget ledger additively
// (subcontract-budget.ts), so paying a sub raises Actual-to-date and drops
// Forecast-to-complete on the cost code. Self-contained (its own queries), like
// DailyWipWorkspace.
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { FileText, HardHat, Plus, ReceiptText, Trash2, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/money-input";
import { WorkspaceHeader } from "@/components/project/billing/billing-workspace-atoms";
import { fmtUSDCents as fmtUSD } from "@/lib/billing-format";
import {
  deleteSubcontractor,
  listSubcontractors,
  saveSubcontractor,
} from "@/lib/subcontractors.functions";
import {
  allocateSubcontract,
  attachSubcontractDocument,
  deleteSubcontract,
  deleteSubcontractAllocation,
  deleteSubcontractPayment,
  listProjectSubcontracts,
  recordSubcontractPayment,
  removeSubcontractDocument,
  saveSubcontract,
} from "@/lib/subcontracts.functions";
import { summarizeSubPayments } from "@/lib/subcontract-budget";
import { supabase } from "@/integrations/supabase/client";

interface BucketOption {
  id: string;
  cost_code: string;
  bucket: string;
}
interface Props {
  projectId: string;
  buckets: BucketOption[];
}

const today = () => new Date().toISOString().slice(0, 10);

export function SubcontractorsWorkspace({ projectId, buckets }: Props) {
  const qc = useQueryClient();
  const listDirFn = useServerFn(listSubcontractors);
  const saveDirFn = useServerFn(saveSubcontractor);
  const deleteDirFn = useServerFn(deleteSubcontractor);
  const listProjFn = useServerFn(listProjectSubcontracts);
  const saveSubFn = useServerFn(saveSubcontract);
  const deleteSubFn = useServerFn(deleteSubcontract);
  const allocateFn = useServerFn(allocateSubcontract);
  const deleteAllocFn = useServerFn(deleteSubcontractAllocation);
  const payFn = useServerFn(recordSubcontractPayment);
  const deletePayFn = useServerFn(deleteSubcontractPayment);
  const attachDocFn = useServerFn(attachSubcontractDocument);
  const removeDocFn = useServerFn(removeSubcontractDocument);

  const directoryQuery = useQuery({
    queryKey: ["subcontractors-directory"],
    queryFn: () => listDirFn(),
    staleTime: 30_000,
  });
  const projectQuery = useQuery({
    queryKey: ["subcontracts", projectId],
    queryFn: () => listProjFn({ data: { projectId } }),
  });

  const directory = useMemo(() => directoryQuery.data ?? [], [directoryQuery.data]);
  const project = projectQuery.data ?? { subcontracts: [], allocations: [], payments: [] };
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["subcontracts", projectId] });
    qc.invalidateQueries({ queryKey: ["subcontractors-directory"] });
    // The buyout/payment moves the budget ledger — refresh the Budget/Job-cost
    // views too so Actual-to-date / Forecast-to-complete reflect it.
    qc.invalidateQueries({ queryKey: ["project", projectId] });
  };
  const onError = (verb: string) => (err: unknown) =>
    toast.error(`Could not ${verb}`, {
      description: err instanceof Error ? err.message : "Try again.",
    });

  // ── Directory add form ──
  const [dirName, setDirName] = useState("");
  const [dirTrade, setDirTrade] = useState("");
  const [dirContact, setDirContact] = useState("");
  const saveDir = useMutation({
    mutationFn: (input: { name: string; trade: string; contact_name: string }) =>
      saveDirFn({ data: input }),
    onSuccess: () => {
      setDirName("");
      setDirTrade("");
      setDirContact("");
      invalidate();
      toast.success("Subcontractor added to your directory");
    },
    onError: onError("add subcontractor"),
  });
  const removeDir = useMutation({
    mutationFn: (id: string) => deleteDirFn({ data: { id } }),
    onSuccess: () => {
      invalidate();
      toast.success("Removed from directory");
    },
    onError: onError("remove subcontractor"),
  });

  // ── New subcontract (buyout) form ──
  const [buySubId, setBuySubId] = useState("");
  const [buyTitle, setBuyTitle] = useState("");
  const [buyValue, setBuyValue] = useState(0);
  const [buyRetainage, setBuyRetainage] = useState(10);
  const createBuyout = useMutation({
    mutationFn: () =>
      saveSubFn({
        data: {
          projectId,
          subcontractor_id: buySubId,
          title: buyTitle,
          scope: "",
          contract_value: buyValue,
          retainage_pct: buyRetainage,
          status: "executed",
          executed_at: today(),
        },
      }),
    onSuccess: () => {
      setBuySubId("");
      setBuyTitle("");
      setBuyValue(0);
      invalidate();
      toast.success("Buyout recorded", {
        description: "The committed cost now shows as forecast-to-complete on its code(s).",
      });
    },
    onError: onError("record the buyout"),
  });

  const removeSub = useMutation({
    mutationFn: (id: string) => deleteSubFn({ data: { id } }),
    onSuccess: () => {
      invalidate();
      toast.success("Subcontract removed");
    },
    onError: onError("remove subcontract"),
  });
  const allocate = useMutation({
    mutationFn: (input: { subcontractId: string; costBucketId: string; amount: number }) =>
      allocateFn({ data: { projectId, ...input } }),
    onSuccess: () => {
      invalidate();
      toast.success("Buyout allocated to the cost code");
    },
    onError: onError("allocate the buyout"),
  });
  const removeAlloc = useMutation({
    mutationFn: (id: string) => deleteAllocFn({ data: { id } }),
    onSuccess: () => invalidate(),
    onError: onError("remove allocation"),
  });
  const recordPayment = useMutation({
    mutationFn: (input: { subcontractId: string; amount: number; retainage_held: number }) =>
      payFn({
        data: {
          projectId,
          subcontractId: input.subcontractId,
          amount: input.amount,
          retainage_held: input.retainage_held,
          payment_date: today(),
          reference: "",
          notes: "",
        },
      }),
    onSuccess: () => {
      invalidate();
      toast.success("Payment recorded", {
        description: "Actual-to-date rose and forecast-to-complete dropped on the code(s).",
      });
    },
    onError: onError("record the payment"),
  });
  const removePayment = useMutation({
    mutationFn: (id: string) => deletePayFn({ data: { id } }),
    onSuccess: () => invalidate(),
    onError: onError("remove payment"),
  });

  const subName = useMemo(() => {
    const map = new Map(directory.map((d) => [d.id, d.name]));
    return (id: string) => map.get(id) ?? "Subcontractor";
  }, [directory]);

  // Executed-contract upload: the bytes go straight to the private
  // 'subcontract-docs' bucket (path = <projectId>/<subId>/<file>, so the
  // project-owner storage RLS applies); the row records the path + name.
  const uploadDoc = async (subId: string, file: File) => {
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, "-");
    const path = `${projectId}/${subId}/${crypto.randomUUID()}-${safeName}`;
    const { error } = await supabase.storage
      .from("subcontract-docs")
      .upload(path, file, { contentType: file.type || "application/pdf", upsert: false });
    if (error) {
      toast.error("Upload failed", { description: error.message });
      return;
    }
    try {
      await attachDocFn({ data: { id: subId, path, name: file.name } });
      invalidate();
      toast.success("Executed contract uploaded");
    } catch (err) {
      toast.error("Could not save the document", {
        description: err instanceof Error ? err.message : "Try again.",
      });
    }
  };
  const viewDoc = async (path: string) => {
    const { data, error } = await supabase.storage
      .from("subcontract-docs")
      .createSignedUrl(path, 600);
    if (error || !data?.signedUrl) {
      toast.error("Could not open the document");
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };
  const removeDoc = async (subId: string, path: string) => {
    if (path) await supabase.storage.from("subcontract-docs").remove([path]);
    try {
      await removeDocFn({ data: { id: subId } });
      invalidate();
      toast.success("Document removed");
    } catch (err) {
      toast.error("Could not remove the document", {
        description: err instanceof Error ? err.message : "Try again.",
      });
    }
  };

  return (
    <section className="space-y-5">
      <WorkspaceHeader
        title="Subcontractors"
        subtitle="Load your subs, buy out their scope, and pay against it. A buyout is committed cost; each progress payment moves it to actual — your Budget's Actual-to-date and Forecast-to-complete follow automatically."
      />

      {/* Directory */}
      <div className="rounded-lg border border-hairline bg-card p-5 shadow-card">
        <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          <HardHat className="h-3.5 w-3.5" /> Your subcontractor directory
        </div>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
          <label className="flex-1 text-xs text-muted-foreground">
            Name
            <Input
              value={dirName}
              onChange={(e) => setDirName(e.target.value)}
              placeholder="e.g. Ironclad Concrete Co."
            />
          </label>
          <label className="flex-1 text-xs text-muted-foreground">
            Trade
            <Input
              value={dirTrade}
              onChange={(e) => setDirTrade(e.target.value)}
              placeholder="Concrete"
            />
          </label>
          <label className="flex-1 text-xs text-muted-foreground">
            Contact
            <Input
              value={dirContact}
              onChange={(e) => setDirContact(e.target.value)}
              placeholder="Ray Delgado"
            />
          </label>
          <Button
            type="button"
            size="sm"
            className="gap-1.5"
            disabled={dirName.trim().length === 0 || saveDir.isPending}
            onClick={() =>
              saveDir.mutate({
                name: dirName.trim(),
                trade: dirTrade.trim(),
                contact_name: dirContact.trim(),
              })
            }
          >
            <Plus className="h-3.5 w-3.5" /> Add
          </Button>
        </div>
        {directory.length > 0 ? (
          <ul className="mt-3 divide-y divide-hairline text-sm">
            {directory.map((d) => (
              <li key={d.id} className="flex items-center justify-between py-2">
                <span>
                  <span className="font-medium text-foreground">{d.name}</span>
                  {d.trade ? <span className="ml-2 text-muted-foreground">· {d.trade}</span> : null}
                  {d.contact_name ? (
                    <span className="ml-2 text-xs text-muted-foreground">{d.contact_name}</span>
                  ) : null}
                </span>
                <button
                  type="button"
                  className="text-muted-foreground hover:text-danger"
                  onClick={() => removeDir.mutate(d.id)}
                  aria-label={`Remove ${d.name}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-xs text-muted-foreground">
            No subs yet. Add one above, then buy out their scope below.
          </p>
        )}
      </div>

      {/* New buyout */}
      <div className="rounded-lg border border-hairline bg-card p-5 shadow-card">
        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          Buy out a scope
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1.5fr)_minmax(0,1fr)_auto_auto]">
          <select
            value={buySubId}
            onChange={(e) => setBuySubId(e.target.value)}
            className="rounded-md border border-hairline bg-surface px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent/40"
          >
            <option value="">Pick a subcontractor…</option>
            {directory.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
                {d.trade ? ` — ${d.trade}` : ""}
              </option>
            ))}
          </select>
          <Input
            value={buyTitle}
            onChange={(e) => setBuyTitle(e.target.value)}
            placeholder="Scope title (e.g. Concrete — foundations)"
          />
          <MoneyInput value={buyValue} onValueChange={setBuyValue} align="right" />
          <label className="flex items-center gap-1 text-xs text-muted-foreground">
            <Input
              type="number"
              value={buyRetainage}
              onChange={(e) => setBuyRetainage(Number(e.target.value) || 0)}
              className="w-16"
            />
            % ret.
          </label>
          <Button
            type="button"
            size="sm"
            className="gap-1.5"
            disabled={!buySubId || buyValue <= 0 || createBuyout.isPending}
            onClick={() => createBuyout.mutate()}
          >
            <Plus className="h-3.5 w-3.5" /> Buy out
          </Button>
        </div>
      </div>

      {/* Subcontract cards */}
      {project.subcontracts.length === 0 ? (
        <div className="rounded-lg border border-hairline bg-surface py-9 text-center text-sm text-muted-foreground">
          No buyouts on this job yet. Pick a sub above and buy out their scope — then allocate it to
          a cost code and pay against it.
        </div>
      ) : (
        project.subcontracts.map((sub) => {
          const pays = project.payments.filter((p) => p.subcontract_id === sub.id);
          const allocs = project.allocations.filter((a) => a.subcontract_id === sub.id);
          const summary = summarizeSubPayments(sub, pays);
          const allocatedTotal = allocs.reduce((s, a) => s + a.amount, 0);
          return (
            <SubcontractCard
              key={sub.id}
              subLabel={`${subName(sub.subcontractor_id)}${sub.title ? ` — ${sub.title}` : ""}`}
              summary={summary}
              allocations={allocs}
              payments={pays}
              buckets={buckets}
              allocatedTotal={allocatedTotal}
              defaultRetainagePct={sub.retainage_pct}
              onAllocate={(costBucketId, amount) =>
                allocate.mutate({ subcontractId: sub.id, costBucketId, amount })
              }
              onRemoveAllocation={(id) => removeAlloc.mutate(id)}
              onPay={(amount, retainage_held) =>
                recordPayment.mutate({ subcontractId: sub.id, amount, retainage_held })
              }
              onRemovePayment={(id) => removePayment.mutate(id)}
              onRemoveSub={() => removeSub.mutate(sub.id)}
              docName={sub.executed_contract_name}
              docPath={sub.executed_contract_path}
              onUploadDoc={(file) => uploadDoc(sub.id, file)}
              onViewDoc={() => viewDoc(sub.executed_contract_path)}
              onRemoveDoc={() => removeDoc(sub.id, sub.executed_contract_path)}
            />
          );
        })
      )}
    </section>
  );
}

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
  allocations: { id: string; cost_code: string; description: string; amount: number }[];
  payments: { id: string; amount: number; retainage_held: number; payment_date: string }[];
  buckets: BucketOption[];
  allocatedTotal: number;
  defaultRetainagePct: number;
  onAllocate: (costBucketId: string, amount: number) => void;
  onRemoveAllocation: (id: string) => void;
  onPay: (amount: number, retainageHeld: number) => void;
  onRemovePayment: (id: string) => void;
  onRemoveSub: () => void;
  docName: string;
  docPath: string;
  onUploadDoc: (file: File) => void;
  onViewDoc: () => void;
  onRemoveDoc: () => void;
}

function SubcontractCard({
  subLabel,
  summary,
  allocations,
  payments,
  buckets,
  allocatedTotal,
  defaultRetainagePct,
  onAllocate,
  onRemoveAllocation,
  onPay,
  onRemovePayment,
  onRemoveSub,
  docName,
  docPath,
  onUploadDoc,
  onViewDoc,
  onRemoveDoc,
}: CardProps) {
  const [allocBucket, setAllocBucket] = useState("");
  const [allocAmount, setAllocAmount] = useState(0);
  const [payAmount, setPayAmount] = useState(0);
  const unallocated = summary.committed - allocatedTotal;
  const retainageHeld = Math.round(payAmount * defaultRetainagePct) / 100;

  return (
    <div className="rounded-lg border border-hairline bg-card p-5 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="font-serif text-lg text-foreground">{subLabel}</div>
        <div className="flex items-center gap-3">
          {docPath ? (
            <span className="inline-flex items-center gap-1 text-xs">
              <FileText className="h-3.5 w-3.5 text-accent-foreground" />
              <button
                type="button"
                className="max-w-[180px] truncate font-medium text-accent-foreground underline"
                onClick={onViewDoc}
                title={docName}
              >
                {docName || "Executed contract"}
              </button>
              <button
                type="button"
                className="text-muted-foreground hover:text-danger"
                onClick={onRemoveDoc}
                aria-label="Remove executed contract"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </span>
          ) : (
            <label className="inline-flex cursor-pointer items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
              <Upload className="h-3.5 w-3.5" /> Upload executed contract
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
          )}
          <button
            type="button"
            className="text-muted-foreground hover:text-danger"
            onClick={onRemoveSub}
            aria-label="Remove subcontract"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Buyout" value={fmtUSD(summary.committed)} />
        <Stat label="Paid to date" value={fmtUSD(summary.paid)} />
        <Stat label="Retainage held" value={fmtUSD(summary.retainageHeld)} tone="warn" />
        <Stat label="Net paid" value={fmtUSD(summary.netPaid)} />
        <Stat label="Remaining" value={fmtUSD(summary.remaining)} tone="good" />
        <Stat label="% paid" value={`${summary.paidPct.toFixed(1)}%`} />
      </div>

      {/* Allocations */}
      <div className="mt-4">
        <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Cost codes (buyout = committed cost on these codes)
        </div>
        {allocations.length > 0 ? (
          <ul className="mt-2 divide-y divide-hairline text-sm">
            {allocations.map((a) => (
              <li key={a.id} className="flex items-center justify-between py-1.5">
                <span className="text-foreground">
                  <span className="font-medium">{a.cost_code || "No code"}</span>
                  <span className="ml-2 text-muted-foreground">{a.description}</span>
                </span>
                <span className="flex items-center gap-3">
                  <span className="font-semibold tabular-nums">{fmtUSD(a.amount)}</span>
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-danger"
                    onClick={() => onRemoveAllocation(a.id)}
                    aria-label="Remove allocation"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </span>
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
              <li key={p.id} className="flex items-center justify-between py-1.5">
                <span className="text-muted-foreground">{p.payment_date}</span>
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
                    className="text-muted-foreground hover:text-danger"
                    onClick={() => onRemovePayment(p.id)}
                    aria-label="Remove payment"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
          <ReceiptText className="hidden h-4 w-4 text-muted-foreground sm:block" />
          <MoneyInput value={payAmount} onValueChange={setPayAmount} align="right" />
          <span className="text-[11px] text-muted-foreground">
            holds {fmtUSD(retainageHeld)} retainage ({defaultRetainagePct}%)
          </span>
          <Button
            type="button"
            size="sm"
            className="gap-1.5"
            disabled={payAmount <= 0}
            onClick={() => {
              onPay(payAmount, retainageHeld);
              setPayAmount(0);
            }}
          >
            <Plus className="h-3.5 w-3.5" /> Record payment
          </Button>
        </div>
      </div>
    </div>
  );
}
