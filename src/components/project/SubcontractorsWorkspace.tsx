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
import { HardHat, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/money-input";
import { WorkspaceHeader } from "@/components/project/billing/billing-workspace-atoms";
import { SubcontractCard, type PaymentEdit } from "@/components/project/SubcontractCard";
import {
  deleteSubcontractor,
  listSubcontractors,
  saveSubcontractor,
} from "@/lib/subcontractors.functions";
import {
  addSubcontractDocument,
  allocateSubcontract,
  deleteSubcontract,
  deleteSubcontractAllocation,
  deleteSubcontractDocument,
  deleteSubcontractPayment,
  listProjectSubcontracts,
  recordSubcontractPayment,
  saveSubcontract,
  setActiveSubcontractDocument,
  updateSubcontractAllocation,
  updateSubcontractPayment,
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
  const updateAllocFn = useServerFn(updateSubcontractAllocation);
  const deleteAllocFn = useServerFn(deleteSubcontractAllocation);
  const payFn = useServerFn(recordSubcontractPayment);
  const updatePayFn = useServerFn(updateSubcontractPayment);
  const deletePayFn = useServerFn(deleteSubcontractPayment);
  const addDocFn = useServerFn(addSubcontractDocument);
  const setActiveDocFn = useServerFn(setActiveSubcontractDocument);
  const deleteDocFn = useServerFn(deleteSubcontractDocument);

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
  const project = projectQuery.data ?? {
    subcontracts: [],
    allocations: [],
    payments: [],
    documents: [],
  };
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
  // Change the commitment — a change order (raise) or credit (lower). Reuses the
  // upsert-by-id save; the full sub is re-sent with the new value/retainage.
  const editBuyout = useMutation({
    mutationFn: (input: {
      sub: (typeof project.subcontracts)[number];
      contractValue: number;
      retainagePct: number;
    }) =>
      saveSubFn({
        data: {
          projectId,
          id: input.sub.id,
          subcontractor_id: input.sub.subcontractor_id,
          title: input.sub.title,
          scope: input.sub.scope,
          contract_value: input.contractValue,
          retainage_pct: input.retainagePct,
          status: input.sub.status === "draft" ? "draft" : "executed",
          executed_at: input.sub.executed_at,
        },
      }),
    onSuccess: () => {
      invalidate();
      toast.success("Commitment updated", {
        description: "Re-allocate to cost codes so the committed cost matches.",
      });
    },
    onError: onError("update the commitment"),
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
  const updateAlloc = useMutation({
    mutationFn: (input: { id: string; amount: number }) => updateAllocFn({ data: input }),
    onSuccess: () => {
      invalidate();
      toast.success("Allocation updated");
    },
    onError: onError("update the allocation"),
  });
  const removeAlloc = useMutation({
    mutationFn: (id: string) => deleteAllocFn({ data: { id } }),
    onSuccess: () => invalidate(),
    onError: onError("remove allocation"),
  });
  const recordPayment = useMutation({
    mutationFn: (input: {
      subcontractId: string;
      amount: number;
      retainage_held: number;
      payment_date: string;
      notes: string;
    }) =>
      payFn({
        data: {
          projectId,
          subcontractId: input.subcontractId,
          amount: input.amount,
          retainage_held: input.retainage_held,
          payment_date: input.payment_date,
          reference: "",
          notes: input.notes,
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
  const updatePayment = useMutation({
    mutationFn: (input: { id: string; edit: PaymentEdit }) =>
      updatePayFn({
        data: {
          id: input.id,
          amount: input.edit.amount,
          retainage_held: input.edit.retainageHeld,
          payment_date: input.edit.paymentDate,
          reference: "",
          notes: input.edit.notes,
        },
      }),
    onSuccess: () => {
      invalidate();
      toast.success("Payment updated");
    },
    onError: onError("update the payment"),
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

  // Contract upload: the bytes go straight to the private 'subcontract-docs'
  // bucket (path = <projectId>/<subId>/<file>, so the team storage RLS applies);
  // a new subcontract_documents row records the path + name and becomes the
  // active version. Prior versions are kept (flagged inactive) for the paper
  // trail — this never overwrites.
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
      await addDocFn({ data: { subcontractId: subId, projectId, path, name: file.name } });
      invalidate();
      toast.success("Contract uploaded");
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
  const setActiveDoc = async (docId: string, subId: string) => {
    try {
      await setActiveDocFn({ data: { id: docId, subcontractId: subId } });
      invalidate();
      toast.success("Active contract updated");
    } catch (err) {
      toast.error("Could not update the active contract", {
        description: err instanceof Error ? err.message : "Try again.",
      });
    }
  };
  const removeDoc = async (docId: string, path: string) => {
    if (path) await supabase.storage.from("subcontract-docs").remove([path]);
    try {
      await deleteDocFn({ data: { id: docId } });
      invalidate();
      toast.success("Contract removed");
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
              onEditBuyout={(contractValue, retainagePct) =>
                editBuyout.mutate({ sub, contractValue, retainagePct })
              }
              onAllocate={(costBucketId, amount) =>
                allocate.mutate({ subcontractId: sub.id, costBucketId, amount })
              }
              onUpdateAllocation={(id, amount) => updateAlloc.mutate({ id, amount })}
              onRemoveAllocation={(id) => removeAlloc.mutate(id)}
              onPay={(amount, retainage_held, payment_date, notes) =>
                recordPayment.mutate({
                  subcontractId: sub.id,
                  amount,
                  retainage_held,
                  payment_date,
                  notes,
                })
              }
              onUpdatePayment={(id, edit) => updatePayment.mutate({ id, edit })}
              onRemovePayment={(id) => removePayment.mutate(id)}
              onRemoveSub={() => removeSub.mutate(sub.id)}
              documents={project.documents.filter((d) => d.subcontract_id === sub.id)}
              onUploadDoc={(file) => uploadDoc(sub.id, file)}
              onViewDoc={(path) => viewDoc(path)}
              onSetActiveDoc={(docId) => setActiveDoc(docId, sub.id)}
              onRemoveDoc={(docId, path) => removeDoc(docId, path)}
            />
          );
        })
      )}
    </section>
  );
}
