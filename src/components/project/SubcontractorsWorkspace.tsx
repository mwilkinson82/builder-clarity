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
import { HardHat, Plus, ShieldAlert, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DialogHeaderV2 } from "@/components/ui/dialog-header-v2";
import { Input } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/money-input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  SubcontractCard,
  type CardPayment,
  type PaymentEdit,
} from "@/components/project/SubcontractCard";
import {
  SubcontractCompliance,
  uploadComplianceFile,
  viewComplianceFile,
} from "@/components/project/SubcontractCompliance";
import {
  deleteInsuranceCertificate,
  deleteLienWaiver,
  listProjectCompliance,
  recordLienWaiver,
  saveInsuranceCertificate,
  setProjectComplianceGating,
} from "@/lib/compliance.functions";
import {
  deleteSubcontractor,
  listSubcontractors,
  saveSubcontractor,
} from "@/lib/subcontractors.functions";
import {
  addSubcontractDocument,
  allocateSubcontract,
  attachLienWaiverToPayment,
  deleteSubcontract,
  deleteSubcontractAllocation,
  deleteSubcontractChangeOrder,
  deleteSubcontractDocument,
  deleteSubcontractPayment,
  detachLienWaiverFromPayment,
  listProjectSubcontracts,
  recordSubcontractChangeOrder,
  recordSubcontractPayment,
  saveSubcontract,
  setActiveSubcontractDocument,
  setSubcontractPaymentSplit,
  setSubcontractChangeOrderExposure,
  setSubcontractPaymentExposure,
  setSubcontractPaymentStatus,
  updateSubcontractAllocation,
  updateSubcontractPayment,
} from "@/lib/subcontracts.functions";
import { sumChangeOrders, summarizeSubPayments } from "@/lib/subcontract-budget";
import { canApproveSubPayment, subcontractInsuranceStatus } from "@/lib/compliance-domain";
import { fmtUSDCents as fmtUSD } from "@/lib/billing-format";
import { supabase } from "@/integrations/supabase/client";

interface BucketOption {
  id: string;
  cost_code: string;
  bucket: string;
}
interface Props {
  projectId: string;
  buckets: BucketOption[];
  exposures: { id: string; title: string; status: string }[];
}

const today = () => new Date().toISOString().slice(0, 10);

// One posture tile in the KPI strip. Tone tints the box + figure per the
// schedule-health rule (good = on-goal, crit = off-goal); default is neutral.
function KpiTile({ label, value, tone }: { label: string; value: string; tone?: "good" | "crit" }) {
  const box =
    tone === "good"
      ? "border-success/30 bg-success/[0.05]"
      : tone === "crit"
        ? "border-destructive/30 bg-destructive/[0.05]"
        : "border-hairline bg-surface";
  const val =
    tone === "good" ? "text-success" : tone === "crit" ? "text-danger" : "text-foreground";
  return (
    <div className={`rounded-[11px] border px-3.5 py-3 ${box}`}>
      <div className="font-mono text-[8.5px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </div>
      <div className={`mt-1.5 font-serif text-[22px] tabular-nums ${val}`}>{value}</div>
    </div>
  );
}

export function SubcontractorsWorkspace({ projectId, buckets, exposures }: Props) {
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
  const recordCoFn = useServerFn(recordSubcontractChangeOrder);
  const setCoExposureFn = useServerFn(setSubcontractChangeOrderExposure);
  const deleteCoFn = useServerFn(deleteSubcontractChangeOrder);
  const payFn = useServerFn(recordSubcontractPayment);
  const setPaymentExposureFn = useServerFn(setSubcontractPaymentExposure);
  const updatePayFn = useServerFn(updateSubcontractPayment);
  const setPayStatusFn = useServerFn(setSubcontractPaymentStatus);
  const deletePayFn = useServerFn(deleteSubcontractPayment);
  const setSplitFn = useServerFn(setSubcontractPaymentSplit);
  const addDocFn = useServerFn(addSubcontractDocument);
  const setActiveDocFn = useServerFn(setActiveSubcontractDocument);
  const deleteDocFn = useServerFn(deleteSubcontractDocument);
  const listComplianceFn = useServerFn(listProjectCompliance);
  const saveCertFn = useServerFn(saveInsuranceCertificate);
  const deleteCertFn = useServerFn(deleteInsuranceCertificate);
  const recordWaiverFn = useServerFn(recordLienWaiver);
  const deleteWaiverFn = useServerFn(deleteLienWaiver);
  const setGatingFn = useServerFn(setProjectComplianceGating);

  const directoryQuery = useQuery({
    queryKey: ["subcontractors-directory"],
    queryFn: () => listDirFn(),
    staleTime: 30_000,
  });
  const projectQuery = useQuery({
    queryKey: ["subcontracts", projectId],
    queryFn: () => listProjFn({ data: { projectId } }),
  });
  const complianceQuery = useQuery({
    queryKey: ["compliance", projectId],
    queryFn: () => listComplianceFn({ data: { projectId } }),
  });

  const directory = useMemo(() => directoryQuery.data ?? [], [directoryQuery.data]);
  const project = useMemo(
    () =>
      projectQuery.data ?? {
        subcontracts: [],
        allocations: [],
        payments: [],
        documents: [],
        change_orders: [],
        payment_allocations: [],
      },
    [projectQuery.data],
  );
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["subcontracts", projectId] });
    qc.invalidateQueries({ queryKey: ["subcontractors-directory"] });
    qc.invalidateQueries({ queryKey: ["compliance", projectId] });
    // The buyout/payment moves the budget ledger — refresh the Budget/Job-cost
    // views too so Actual-to-date / Forecast-to-complete reflect it.
    qc.invalidateQueries({ queryKey: ["project", projectId] });
  };
  const onError = (verb: string) => (err: unknown) =>
    toast.error(`Could not ${verb}`, {
      description: err instanceof Error ? err.message : "Try again.",
    });

  // ── Compliance (module 2): insurance + lien waivers, and the gating toggle ──
  const compliance = useMemo(
    () =>
      complianceQuery.data ?? {
        certificates: [],
        waivers: [],
        gatingEnabled: true,
      },
    [complianceQuery.data],
  );
  const saveCert = useMutation({
    mutationFn: (input: { subcontractId: string } & Record<string, unknown>) =>
      saveCertFn({ data: { projectId, ...input } as never }),
    onSuccess: invalidate,
    onError: onError("save the certificate"),
  });
  const deleteCert = useMutation({
    mutationFn: (id: string) => deleteCertFn({ data: { id } }),
    onSuccess: invalidate,
    onError: onError("delete the certificate"),
  });
  const recordWaiver = useMutation({
    mutationFn: (input: { subcontractId: string } & Record<string, unknown>) =>
      recordWaiverFn({ data: { projectId, ...input } as never }),
    onSuccess: invalidate,
    onError: onError("record the lien waiver"),
  });
  const removeWaiver = useMutation({
    mutationFn: (id: string) => deleteWaiverFn({ data: { id } }),
    onSuccess: invalidate,
    onError: onError("delete the lien waiver"),
  });
  const setGating = useMutation({
    mutationFn: (enabled: boolean) => setGatingFn({ data: { projectId, enabled } }),
    onSuccess: invalidate,
    onError: onError("update the compliance setting"),
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

  // ── New subcontract (buyout) form — expands from the header CTA ──
  const [buyoutOpen, setBuyoutOpen] = useState(false);
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
      setBuyoutOpen(false);
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
  const recordCo = useMutation({
    mutationFn: (input: {
      subcontractId: string;
      costBucketId: string | null;
      description: string;
      amount: number;
      coDate: string;
      exposureId: string | null;
    }) =>
      recordCoFn({
        data: {
          projectId,
          subcontractId: input.subcontractId,
          costBucketId: input.costBucketId,
          description: input.description,
          amount: input.amount,
          co_date: input.coDate,
          exposureId: input.exposureId,
        },
      }),
    onSuccess: (row) => {
      invalidate();
      toast.success(row.amount < 0 ? "Credit recorded" : "Change order recorded", {
        description: "Kept separate from the contracted amount — the revised total updates above.",
      });
    },
    onError: onError("record the change order"),
  });
  const removeCo = useMutation({
    mutationFn: (id: string) => deleteCoFn({ data: { id } }),
    onSuccess: () => invalidate(),
    onError: onError("remove the change order"),
  });
  const setCoExposure = useMutation({
    mutationFn: (input: { id: string; exposureId: string | null }) =>
      setCoExposureFn({ data: input }),
    onSuccess: () => {
      invalidate();
      toast.success("Change order Risk Tally link updated");
    },
    onError: onError("update the change order risk link"),
  });
  const recordPayment = useMutation({
    mutationFn: (input: {
      subcontractId: string;
      amount: number;
      retainage_held: number;
      payment_date: string;
      notes: string;
      status: "draft" | "approved" | "paid";
      exposureId: string | null;
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
          status: input.status,
          exposureId: input.exposureId,
        },
      }),
    onSuccess: (row) => {
      invalidate();
      if (row.status === "draft") {
        toast.success("Pay app logged as a draft", {
          description: "It won't touch the budget until it's approved and marked paid.",
        });
      } else if (row.status === "approved") {
        toast.success("Pay app approved for payment", {
          description: "Mark it paid when the money goes out — that's when it becomes job cost.",
        });
      } else {
        toast.success("Payment recorded", {
          description: "Actual-to-date rose and forecast-to-complete dropped on the code(s).",
        });
      }
    },
    onError: onError("record the payment"),
  });
  const setPaymentExposure = useMutation({
    mutationFn: (input: { id: string; exposureId: string | null }) =>
      setPaymentExposureFn({ data: input }),
    onSuccess: () => {
      invalidate();
      toast.success("Pay app Risk Tally link updated");
    },
    onError: onError("update the pay app risk link"),
  });
  const saveSplit = useMutation({
    // The server reads the owning sub off the payment row itself — sending it
    // from the client would just be an unvalidated foot-gun.
    mutationFn: (input: {
      paymentId: string;
      rows: {
        cost_bucket_id: string | null;
        cost_code: string;
        description: string;
        amount: number;
      }[];
    }) =>
      setSplitFn({
        data: {
          projectId,
          paymentId: input.paymentId,
          rows: input.rows,
        },
      }),
    onSuccess: (result) => {
      invalidate();
      toast.success(
        result.rowCount > 0 ? "Payment split saved" : "Payment back on the automatic split",
        {
          description:
            result.rowCount > 0
              ? "The budget's paid-per-code now follows your coding for this payment."
              : "This payment distributes pro-rata across the buyout's cost codes again.",
        },
      );
    },
    onError: onError("save the payment split"),
  });
  // Walk a pay app forward: approve it for payment, or mark it paid (the paid
  // step runs the same lien-waiver/insurance gate as recording a paid payment).
  // Compliance override (field request 2026-07-10, Marshall-approved): when the
  // gate blocks a mark-paid/approve, prompt for a reason and retry with it — a
  // deliberate, audited escape hatch rather than a hard wall.
  const [overridePrompt, setOverridePrompt] = useState<{
    id: string;
    status: "approved" | "paid";
    blockers: string;
  } | null>(null);
  const [overrideReason, setOverrideReason] = useState("");
  const closeOverride = () => {
    setOverridePrompt(null);
    setOverrideReason("");
  };
  // "How paid" capture (field request 2026-07-10, mirrors cost #273): marking a
  // pay app paid opens this dialog for method/check#/date. The details persist
  // through an override retry (the override dialog reuses payDraft), so paying
  // past the gate still records how it was paid.
  const [payDialog, setPayDialog] = useState<CardPayment | null>(null);
  const [payDraft, setPayDraft] = useState<{
    payment_method: string;
    payment_reference: string;
    paid_date: string;
  }>({ payment_method: "check", payment_reference: "", paid_date: today() });
  const openPayDialog = (payment: CardPayment) => {
    setPayDraft({
      payment_method: "check",
      payment_reference: "",
      paid_date: payment.payment_date || today(),
    });
    setPayDialog(payment);
  };
  const setPayStage = useMutation({
    mutationFn: (input: {
      id: string;
      status: "approved" | "paid";
      override_reason?: string;
      payment_method?: string;
      payment_reference?: string;
      paid_date?: string;
    }) => setPayStatusFn({ data: input }),
    onSuccess: (row) => {
      invalidate();
      closeOverride();
      setPayDialog(null);
      if (row.compliance_override_reason) {
        toast.success(
          row.status === "paid"
            ? "Marked paid — compliance overridden"
            : "Approved — compliance overridden",
          { description: "The override reason is recorded on the payment." },
        );
      } else if (row.status === "paid") {
        toast.success("Marked paid", {
          description: "Actual-to-date rose and forecast-to-complete dropped on the code(s).",
        });
      } else {
        toast.success("Approved for payment");
      }
    },
    onError: (err, variables) => {
      const msg = err instanceof Error ? err.message : "";
      // A compliance block (and not already an override attempt) → offer to
      // override instead of just failing. Pull the blocker sentences to show.
      if (/compliance not met/i.test(msg) && !variables.override_reason) {
        const blockers =
          msg
            .split(/compliance not met\.?\s*/i)[1]
            ?.split(/\s*(?:Attach|Add) the missing item/i)[0] ?? msg;
        setOverridePrompt({
          id: variables.id,
          status: variables.status,
          // Strip the sentence's trailing period so it reads cleanly before the
          // template's own "." (avoids "...this pay app.. You can override").
          blockers: blockers.trim().replace(/\.\s*$/, ""),
        });
        return;
      }
      onError("update the pay app")(err);
    },
  });
  // Tie an on-file waiver to one pay app / undo a mistaken attach. The approve
  // gate reads this link, so attach is what unblocks "Approve for payment".
  const attachWaiverFn = useServerFn(attachLienWaiverToPayment);
  const detachWaiverFn = useServerFn(detachLienWaiverFromPayment);
  const attachWaiver = useMutation({
    mutationFn: (input: { paymentId: string; waiverId: string }) => attachWaiverFn({ data: input }),
    onSuccess: () => {
      invalidate();
      toast.success("Lien waiver attached to the pay app");
    },
    onError: onError("attach the lien waiver"),
  });
  const detachWaiver = useMutation({
    mutationFn: (input: { paymentId: string; waiverId: string }) => detachWaiverFn({ data: input }),
    onSuccess: () => {
      invalidate();
      toast.success("Lien waiver detached — back in the on-file pool");
    },
    onError: onError("detach the lien waiver"),
  });
  // Upload a signed waiver straight onto a pay app: file the doc, record the
  // waiver already bound to the payment (type defaults to conditional/progress;
  // amount + through-date default from the pay app itself).
  const uploadWaiverForPayment = async (
    subcontractId: string,
    payment: CardPayment,
    file: File,
  ) => {
    const up = await uploadComplianceFile(projectId, file);
    if (!up) return;
    await recordWaiver.mutateAsync({
      subcontractId,
      payment_id: payment.id,
      waiver_type: "conditional_progress",
      through_date: payment.payment_date || null,
      amount: payment.amount,
      signed_date: today(),
      storage_path: up.path,
      file_name: up.name,
    });
    toast.success("Signed waiver attached to the pay app");
  };
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
  const subTrade = useMemo(() => {
    const map = new Map(directory.map((d) => [d.id, d.trade]));
    return (id: string) => map.get(id) ?? "";
  }, [directory]);

  // Live posture for the verdict + KPI tiles. Committed / paid / retainage come
  // straight from the payment summaries; revised folds in each sub's change
  // orders (committed + COs), and "open to pay" = committed + COs − paid.
  const totals = useMemo(() => {
    let committed = 0;
    let paid = 0;
    let retainage = 0;
    let revised = 0;
    for (const sub of project.subcontracts) {
      const pays = project.payments.filter((p) => p.subcontract_id === sub.id);
      const s = summarizeSubPayments(sub, pays);
      const cos = project.change_orders.filter((co) => co.subcontract_id === sub.id);
      committed += s.committed;
      paid += s.paid;
      retainage += s.retainageHeld;
      revised += s.committed + sumChangeOrders(cos);
    }
    return { committed, paid, retainage, openToPay: Math.max(0, revised - paid) };
  }, [project]);

  // Best insurance standing per sub, as of today — reused by the KPI/verdict
  // blocked count AND handed to each card's COI chip (same compliance query).
  const coiStatusBySub = useMemo(() => {
    const map = new Map<string, ReturnType<typeof subcontractInsuranceStatus>>();
    for (const sub of project.subcontracts) {
      const certs = compliance.certificates.filter((c) => c.subcontract_id === sub.id);
      map.set(sub.id, subcontractInsuranceStatus(certs, today()));
    }
    return map;
  }, [project.subcontracts, compliance.certificates]);

  // Pay apps blocked on compliance: a draft/approved app that can't be approved
  // while gating is enforced. Reuses the exact gate the server/panel run
  // (canApproveSubPayment): insurance in force AND a waiver attached to THIS app.
  const blockedCount = useMemo(() => {
    if (!compliance.gatingEnabled) return 0;
    let n = 0;
    for (const sub of project.subcontracts) {
      const insStatus = coiStatusBySub.get(sub.id) ?? "missing";
      const subWaivers = compliance.waivers.filter((w) => w.subcontract_id === sub.id);
      for (const p of project.payments) {
        if (p.subcontract_id !== sub.id) continue;
        // Only draft/approved apps can be blocked — a paid (or pre-lifecycle) row
        // is already money out, not on the desk.
        if (!p.status || p.status === "paid") continue;
        const hasAttachedWaiver = subWaivers.some((w) => w.payment_id === p.id);
        if (
          !canApproveSubPayment({
            gatingEnabled: true,
            insuranceStatus: insStatus,
            hasAttachedWaiver,
          }).allowed
        ) {
          n += 1;
        }
      }
    }
    return n;
  }, [compliance, project, coiStatusBySub]);

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
      {/* Verdict-led header: mono clay chip, one ink CTA that expands the buyout
          form, and a serif statement of live posture. */}
      <div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">
            Parties / Subcontractors · Financial IOR
          </span>
          <span className="eyebrow rounded-md border border-hairline px-1.5 py-0.5 text-[8.5px]">
            Buyouts &amp; Payments
          </span>
          <Button
            type="button"
            size="sm"
            className="ml-auto gap-1.5"
            onClick={() => setBuyoutOpen((v) => !v)}
            aria-expanded={buyoutOpen}
          >
            <Plus className="h-3.5 w-3.5" /> Buy out a scope
          </Button>
        </div>
        <h1 className="mt-5 max-w-[42ch] font-serif text-[30px] font-normal leading-[1.16] text-foreground">
          {fmtUSD(totals.committed)} bought out — {fmtUSD(totals.paid)} paid,{" "}
          {fmtUSD(totals.retainage)} held in retainage.
          {blockedCount > 0 ? (
            <span className="text-warning">
              {" "}
              {blockedCount} pay app{blockedCount === 1 ? "" : "s"}{" "}
              {blockedCount === 1 ? "is" : "are"} blocked on compliance.
            </span>
          ) : null}
        </h1>
        <p className="mt-2 max-w-[72ch] text-sm leading-relaxed text-muted-foreground">
          A buyout is committed cost; a paid application becomes actual cost on its cost codes.
        </p>
      </div>

      {/* New buyout — expands from the header CTA. Form fields unchanged. */}
      {buyoutOpen ? (
        <div className="rounded-xl border border-hairline bg-card p-5 shadow-card">
          <div className="eyebrow">Buy out a scope</div>
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
      ) : null}

      {/* Posture at a glance. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <KpiTile label="Committed (buyouts)" value={fmtUSD(totals.committed)} />
        <KpiTile label="Paid to date" value={fmtUSD(totals.paid)} tone="good" />
        <KpiTile label="Retainage held" value={fmtUSD(totals.retainage)} />
        <KpiTile label="Open to pay" value={fmtUSD(totals.openToPay)} />
        <KpiTile
          label="Compliance"
          value={blockedCount > 0 ? `${blockedCount} blocked` : "Clear"}
          tone={blockedCount > 0 ? "crit" : "good"}
        />
      </div>

      {/* Compliance gating toggle — default ON: no pay without a valid COI + a
          lien waiver. Off = the GC self-manages compliance (never blocks). */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-hairline bg-card px-4 py-3.5 shadow-card">
        <div className="flex-1 text-sm">
          <div className="font-medium text-foreground">
            Require lien waivers + insurance to pay subs
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {compliance.gatingEnabled
              ? "On — a sub can't be paid without a valid COI and a lien waiver on file."
              : "Off — you're managing compliance yourself; payments are never blocked."}
          </div>
        </div>
        <Switch
          checked={compliance.gatingEnabled}
          disabled={setGating.isPending}
          onCheckedChange={(checked) => setGating.mutate(checked)}
          aria-label="Require lien waivers + insurance to pay subs"
          className="data-[state=checked]:bg-success"
        />
        <span
          className={`text-xs font-semibold ${
            compliance.gatingEnabled ? "text-success" : "text-muted-foreground"
          }`}
        >
          {compliance.gatingEnabled ? "Enforced" : "Not enforced"}
        </span>
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
          const subChangeOrders = project.change_orders.filter(
            (co) => co.subcontract_id === sub.id,
          );
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
              trade={subTrade(sub.subcontractor_id)}
              subStatus={sub.status}
              coiStatus={coiStatusBySub.get(sub.id)}
              onEditBuyout={(contractValue, retainagePct) =>
                editBuyout.mutate({ sub, contractValue, retainagePct })
              }
              onAllocate={(costBucketId, amount) =>
                allocate.mutate({ subcontractId: sub.id, costBucketId, amount })
              }
              onUpdateAllocation={(id, amount) => updateAlloc.mutate({ id, amount })}
              onRemoveAllocation={(id) => removeAlloc.mutate(id)}
              changeOrders={subChangeOrders}
              exposures={exposures}
              onRecordChangeOrder={(costBucketId, description, amount, coDate, exposureId) =>
                recordCo.mutate({
                  subcontractId: sub.id,
                  costBucketId,
                  description,
                  amount,
                  coDate,
                  exposureId,
                })
              }
              onSetChangeOrderExposure={(id, exposureId) =>
                setCoExposure.mutate({ id, exposureId })
              }
              onRemoveChangeOrder={(id) => removeCo.mutate(id)}
              onPay={(amount, retainage_held, payment_date, notes, stage, exposureId) =>
                recordPayment.mutate({
                  subcontractId: sub.id,
                  amount,
                  retainage_held,
                  payment_date,
                  notes,
                  status: stage,
                  exposureId,
                })
              }
              onSetPaymentExposure={(id, exposureId) =>
                setPaymentExposure.mutate({ id, exposureId })
              }
              onUpdatePayment={(id, edit) => updatePayment.mutate({ id, edit })}
              onSetPaymentStage={(id, stage) => setPayStage.mutate({ id, status: stage })}
              onMarkPaid={(payment) => openPayDialog(payment)}
              onRemovePayment={(id) => removePayment.mutate(id)}
              paymentSplits={project.payment_allocations.filter(
                (split) => split.subcontract_id === sub.id,
              )}
              onSaveSplit={(paymentId, rows) =>
                saveSplit.mutate({
                  paymentId,
                  // Stamp cost_code/description off the bucket so the rows read
                  // on their own in reports (mirrors allocateSubcontract).
                  rows: rows.map((row) => {
                    const bucket = buckets.find((b) => b.id === row.cost_bucket_id);
                    return {
                      cost_bucket_id: row.cost_bucket_id,
                      cost_code: bucket?.cost_code ?? "",
                      description: bucket?.bucket ?? "",
                      amount: row.amount,
                    };
                  }),
                })
              }
              savingSplit={saveSplit.isPending}
              waivers={compliance.waivers
                .filter((w) => w.subcontract_id === sub.id)
                .map((w) => ({
                  id: w.id,
                  payment_id: w.payment_id,
                  waiver_type: w.waiver_type,
                  through_date: w.through_date,
                  amount: w.amount,
                  storage_path: w.storage_path,
                  file_name: w.file_name,
                }))}
              gatingEnabled={compliance.gatingEnabled}
              onAttachWaiver={(paymentId, waiverId) => attachWaiver.mutate({ paymentId, waiverId })}
              onDetachWaiver={(paymentId, waiverId) => detachWaiver.mutate({ paymentId, waiverId })}
              onUploadWaiverForPayment={(payment, file) =>
                uploadWaiverForPayment(sub.id, payment, file)
              }
              onViewWaiverDoc={(path) => viewComplianceFile(path)}
              onRemoveSub={() => removeSub.mutate(sub.id)}
              documents={project.documents.filter((d) => d.subcontract_id === sub.id)}
              onUploadDoc={(file) => uploadDoc(sub.id, file)}
              onViewDoc={(path) => viewDoc(path)}
              onSetActiveDoc={(docId) => setActiveDoc(docId, sub.id)}
              onRemoveDoc={(docId, path) => removeDoc(docId, path)}
              complianceSlot={
                <SubcontractCompliance
                  projectId={projectId}
                  gatingEnabled={compliance.gatingEnabled}
                  certificates={compliance.certificates.filter((c) => c.subcontract_id === sub.id)}
                  waivers={compliance.waivers.filter((w) => w.subcontract_id === sub.id)}
                  payments={pays.map((p) => ({
                    id: p.id,
                    payment_date: p.payment_date,
                    amount: p.amount,
                  }))}
                  onSaveCertificate={(input) =>
                    saveCert.mutateAsync({ subcontractId: sub.id, ...input })
                  }
                  onDeleteCertificate={(id) => deleteCert.mutate(id)}
                  onRecordWaiver={(input) =>
                    recordWaiver.mutateAsync({ subcontractId: sub.id, ...input })
                  }
                  onDeleteWaiver={(id) => removeWaiver.mutate(id)}
                />
              }
            />
          );
        })
      )}

      {/* Subcontractor directory — the add form + roster, tucked below the cards
          (it's setup, not the daily view). */}
      <details className="group rounded-xl border border-hairline bg-card shadow-card">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-4">
          <HardHat className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="eyebrow">Subcontractor directory</span>
          <span className="text-xs text-muted-foreground">{directory.length} on file</span>
          <span className="ml-auto text-xs text-muted-foreground transition-transform group-open:rotate-180">
            ▾
          </span>
        </summary>
        <div className="border-t border-hairline p-5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
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
                    {d.trade ? (
                      <span className="ml-2 text-muted-foreground">· {d.trade}</span>
                    ) : null}
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
              No subs yet. Add one here, then buy out their scope from the header.
            </p>
          )}
        </div>
      </details>

      {/* Compliance override prompt (field request 2026-07-10, Marshall-approved) */}
      <Dialog open={overridePrompt !== null} onOpenChange={(open) => !open && closeOverride()}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <div className="flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-destructive/10 text-danger">
                <ShieldAlert className="h-5 w-5" />
              </span>
              <div className="space-y-2">
                <div className="eyebrow">Compliance</div>
                <DialogTitle className="font-serif text-2xl font-normal">
                  Override the compliance gate?
                </DialogTitle>
                <DialogDescription>
                  This pay app can&apos;t{" "}
                  {overridePrompt?.status === "paid" ? "be paid" : "be approved"} yet —{" "}
                  {overridePrompt?.blockers || "compliance is not met"}. You can override and
                  proceed, but the reason is recorded on the payment.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <div className="space-y-1.5 py-1">
            <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Reason for overriding
            </label>
            <Textarea
              rows={3}
              value={overrideReason}
              placeholder="e.g. Waiver signed on paper, scanning tomorrow — releasing payment to hold the schedule."
              onChange={(e) => setOverrideReason(e.target.value)}
            />
          </div>
          <DialogFooter className="items-center sm:justify-between">
            <span className="text-[11px] text-muted-foreground">
              Recorded on the payment &amp; the audit trail.
            </span>
            <div className="flex items-center gap-2">
              <Button variant="ghost" onClick={closeOverride}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                disabled={!overrideReason.trim() || setPayStage.isPending}
                onClick={() =>
                  overridePrompt &&
                  setPayStage.mutate({
                    id: overridePrompt.id,
                    status: overridePrompt.status,
                    override_reason: overrideReason.trim(),
                    // Carry the how-paid details captured before the block so the
                    // overridden payment still records method/check#/date.
                    ...(overridePrompt.status === "paid" ? payDraft : {}),
                  })
                }
              >
                Override &amp; {overridePrompt?.status === "paid" ? "mark paid" : "approve"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* How paid (field request 2026-07-10, mirrors cost #273) */}
      <Dialog open={payDialog !== null} onOpenChange={(open) => !open && setPayDialog(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeaderV2
            eyebrow="Payment"
            title="Mark pay app paid"
            description={payDialog ? `${fmtUSD(payDialog.amount)} — record how it was paid.` : ""}
          />
          <div className="grid gap-3 py-2 sm:grid-cols-3">
            <label className="space-y-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Date paid
              <Input
                type="date"
                value={payDraft.paid_date}
                onChange={(e) => setPayDraft({ ...payDraft, paid_date: e.target.value || today() })}
              />
            </label>
            <label className="space-y-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              How paid
              <select
                value={payDraft.payment_method}
                onChange={(e) => setPayDraft({ ...payDraft, payment_method: e.target.value })}
                className="h-9 w-full rounded-md border border-hairline bg-surface px-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent/40"
              >
                <option value="wire">Wire</option>
                <option value="check">Check</option>
                <option value="card">Card</option>
                <option value="ach">ACH</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label className="space-y-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Check # / reference
              <Input
                value={payDraft.payment_reference}
                placeholder="Check #, wire confirmation, ACH trace"
                onChange={(e) => setPayDraft({ ...payDraft, payment_reference: e.target.value })}
              />
            </label>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPayDialog(null)}>
              Cancel
            </Button>
            <Button
              disabled={setPayStage.isPending}
              onClick={() =>
                payDialog && setPayStage.mutate({ id: payDialog.id, status: "paid", ...payDraft })
              }
            >
              Mark paid
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
