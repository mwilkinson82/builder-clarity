// COMPLIANCE panel for one subcontract (docs/compliance arc, module 2). Insurance
// (COI upload + verify + effective/expiry + GL/WC/auto/umbrella limits) and lien
// waivers. Status is date-derived, so a lapse re-blocks on its own. When the
// project enforces gating, a sub without a valid COI + a lien waiver can't be
// paid (the server gate blocks it); this panel is where you clear it.
import { useState } from "react";
import { toast } from "sonner";
import { ShieldCheck, ShieldAlert, ShieldX, Trash2, Upload, FileText } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/money-input";
import { supabase } from "@/integrations/supabase/client";
import { fmtUSD } from "@/lib/format";
import {
  insuranceClears,
  subcontractInsuranceStatus,
  type InsuranceStatus,
} from "@/lib/compliance-domain";
import type { InsuranceCertificateRow, LienWaiverRow } from "@/lib/compliance.functions";

export interface SaveCertInput {
  id?: string;
  carrier: string;
  effective_date: string | null;
  expiry_date: string | null;
  verified: boolean;
  gl_limit: number;
  wc_limit: number;
  auto_limit: number;
  umbrella_limit: number;
  storage_path: string;
  file_name: string;
}

export interface RecordWaiverInput {
  waiver_type: LienWaiverRow["waiver_type"];
  through_date: string | null;
  amount: number;
  signed_date: string | null;
  storage_path: string;
  file_name: string;
}

const STATUS_UI: Record<
  InsuranceStatus,
  { label: string; tone: string; Icon: typeof ShieldCheck }
> = {
  valid: { label: "Insurance valid", tone: "text-success", Icon: ShieldCheck },
  expiring_soon: { label: "Insurance expiring soon", tone: "text-warning", Icon: ShieldAlert },
  unverified: {
    label: "Insurance on file — needs verification",
    tone: "text-warning",
    Icon: ShieldAlert,
  },
  expired: {
    label: "Insurance expired — not cleared to mobilize",
    tone: "text-danger",
    Icon: ShieldX,
  },
  missing: { label: "No insurance — not cleared to mobilize", tone: "text-danger", Icon: ShieldX },
};

const WAIVER_LABEL: Record<LienWaiverRow["waiver_type"], string> = {
  conditional_progress: "Conditional / progress",
  unconditional_progress: "Unconditional / progress",
  conditional_final: "Conditional / final",
  unconditional_final: "Unconditional / final",
};

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Upload a compliance doc to the shared private project-docs bucket; returns the
// stored path + original name (or null on failure, already toasted). Exported
// so the pay-app rows on SubcontractCard can take a waiver upload in place.
export async function uploadComplianceFile(
  projectId: string,
  file: File,
): Promise<{ path: string; name: string } | null> {
  const safe = file.name.replace(/[^a-zA-Z0-9._-]+/g, "-");
  const path = `${projectId}/compliance/${crypto.randomUUID()}-${safe}`;
  const { error } = await supabase.storage
    .from("project-docs")
    .upload(path, file, { contentType: file.type || "application/octet-stream", upsert: false });
  if (error) {
    toast.error("Upload failed", { description: error.message });
    return null;
  }
  return { path, name: file.name };
}

export async function viewComplianceFile(path: string) {
  return viewFile(path);
}

async function viewFile(path: string) {
  if (!path) return;
  const { data, error } = await supabase.storage.from("project-docs").createSignedUrl(path, 600);
  if (error || !data?.signedUrl) {
    toast.error("Could not open the document");
    return;
  }
  window.open(data.signedUrl, "_blank", "noopener,noreferrer");
}

export function SubcontractCompliance({
  projectId,
  gatingEnabled,
  certificates,
  waivers,
  payments = [],
  onSaveCertificate,
  onDeleteCertificate,
  onRecordWaiver,
  onDeleteWaiver,
}: {
  projectId: string;
  gatingEnabled: boolean;
  certificates: InsuranceCertificateRow[];
  waivers: LienWaiverRow[];
  // This sub's pay apps, so an attached waiver can say WHICH payment it covers.
  payments?: { id: string; payment_date: string; amount: number }[];
  onSaveCertificate: (input: SaveCertInput) => Promise<unknown> | void;
  onDeleteCertificate: (id: string) => void;
  onRecordWaiver: (input: RecordWaiverInput) => Promise<unknown> | void;
  onDeleteWaiver: (id: string) => void;
}) {
  const status = subcontractInsuranceStatus(certificates, today());
  const ui = STATUS_UI[status];
  const cleared = insuranceClears(status);
  const openWaivers = waivers.filter((w) => !w.payment_id);
  const paymentById = new Map(payments.map((p) => [p.id, p]));

  // Insurance capture form — a clean ADD each time (renewals stack in the list
  // above; corrections use the list's remove button). Starts empty.
  const [carrier, setCarrier] = useState("");
  const [effective, setEffective] = useState("");
  const [expiry, setExpiry] = useState("");
  const [verified, setVerified] = useState(false);
  const [gl, setGl] = useState(0);
  const [wc, setWc] = useState(0);
  const [auto, setAuto] = useState(0);
  const [umbrella, setUmbrella] = useState(0);
  const [certFile, setCertFile] = useState<{ path: string; name: string } | null>(null);
  const [savingCert, setSavingCert] = useState(false);

  const saveCert = async () => {
    setSavingCert(true);
    try {
      await onSaveCertificate({
        carrier: carrier.trim(),
        effective_date: effective || null,
        expiry_date: expiry || null,
        verified,
        gl_limit: gl,
        wc_limit: wc,
        auto_limit: auto,
        umbrella_limit: umbrella,
        storage_path: certFile?.path ?? "",
        file_name: certFile?.name ?? "",
      });
      // Reset for the next entry.
      setCarrier("");
      setEffective("");
      setExpiry("");
      setVerified(false);
      setGl(0);
      setWc(0);
      setAuto(0);
      setUmbrella(0);
      setCertFile(null);
      toast.success("Certificate saved");
    } finally {
      setSavingCert(false);
    }
  };

  // One-click COI filing (field request 2026-07-10: "upload the contract AND
  // their insurance certs"): the file goes on record immediately as an
  // UNVERIFIED certificate — it doesn't clear the gate until someone fills the
  // dates and checks "verified", but the paper is captured and in the File Room.
  const [quickFiling, setQuickFiling] = useState(false);
  const quickFileCoi = async (file: File) => {
    setQuickFiling(true);
    try {
      const up = await uploadComplianceFile(projectId, file);
      if (!up) return;
      await onSaveCertificate({
        carrier: "",
        effective_date: null,
        expiry_date: null,
        verified: false,
        gl_limit: 0,
        wc_limit: 0,
        auto_limit: 0,
        umbrella_limit: 0,
        storage_path: up.path,
        file_name: up.name,
      });
      toast.success("COI filed", {
        description:
          "On record and in the File Room. Add the dates and verify it to clear the gate.",
      });
    } finally {
      setQuickFiling(false);
    }
  };

  // Lien waiver add form.
  const [wType, setWType] = useState<LienWaiverRow["waiver_type"]>("conditional_progress");
  const [wThrough, setWThrough] = useState("");
  const [wAmount, setWAmount] = useState(0);
  const [wSigned, setWSigned] = useState(today());
  const [wFile, setWFile] = useState<{ path: string; name: string } | null>(null);
  const [savingWaiver, setSavingWaiver] = useState(false);

  const recordWaiver = async () => {
    setSavingWaiver(true);
    try {
      await onRecordWaiver({
        waiver_type: wType,
        through_date: wThrough || null,
        amount: wAmount,
        signed_date: wSigned || null,
        storage_path: wFile?.path ?? "",
        file_name: wFile?.name ?? "",
      });
      setWThrough("");
      setWAmount(0);
      setWFile(null);
      toast.success("Lien waiver recorded");
    } finally {
      setSavingWaiver(false);
    }
  };

  const StatusIcon = ui.Icon;
  return (
    <div className="mt-4 border-t border-hairline pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          Compliance
        </div>
        <div className="flex items-center gap-3">
          <label className="inline-flex cursor-pointer items-center gap-1 text-xs text-accent hover:underline">
            <Upload className="h-3.5 w-3.5" />
            {quickFiling ? "Filing…" : "Upload COI"}
            <input
              type="file"
              accept="application/pdf,image/*"
              className="hidden"
              disabled={quickFiling}
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) await quickFileCoi(f);
                e.target.value = "";
              }}
            />
          </label>
          <div className={`inline-flex items-center gap-1.5 text-xs font-medium ${ui.tone}`}>
            <StatusIcon className="h-4 w-4" />
            {ui.label}
          </div>
        </div>
      </div>
      {!gatingEnabled ? (
        <p className="mt-1 text-[11px] text-muted-foreground">
          Gating is off for this project — compliance is tracked here but never blocks a payment.
        </p>
      ) : !cleared || openWaivers.length === 0 ? (
        <p className="mt-1 text-[11px] text-danger">
          Pay apps can&apos;t be approved for payment until{" "}
          {[
            !cleared ? "a valid COI is on file" : null,
            openWaivers.length === 0 ? "a lien waiver is collected" : null,
          ]
            .filter(Boolean)
            .join(" and ")}
          .
        </p>
      ) : null}

      {/* Certificates on file — each removable (renewals stack up over the job) */}
      {certificates.length > 0 ? (
        <ul className="mt-3 divide-y divide-hairline text-xs">
          {certificates.map((c) => (
            <li key={c.id} className="flex items-center justify-between py-1.5">
              <span className="text-foreground">
                {c.carrier || "Certificate"}
                {c.effective_date || c.expiry_date ? (
                  <span className="ml-2 text-muted-foreground">
                    {c.effective_date || "—"} → {c.expiry_date || "—"}
                  </span>
                ) : null}
                {c.verified ? (
                  <span className="ml-2 text-success">· verified</span>
                ) : (
                  <span className="ml-2 text-warning">· unverified</span>
                )}
              </span>
              <span className="flex items-center gap-2">
                {c.storage_path ? (
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground"
                    onClick={() => viewFile(c.storage_path)}
                    aria-label="View certificate"
                  >
                    <FileText className="h-3.5 w-3.5" />
                  </button>
                ) : null}
                <button
                  type="button"
                  className="text-muted-foreground hover:text-danger"
                  onClick={() => {
                    if (confirm(`Remove the ${c.carrier || "insurance"} certificate?`)) {
                      onDeleteCertificate(c.id);
                    }
                  }}
                  aria-label="Remove certificate"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {/* Insurance */}
      <div className="mt-3 grid gap-2 rounded-md border border-hairline bg-surface/50 p-3 md:grid-cols-2">
        <label className="text-[11px] text-muted-foreground">
          Carrier
          <Input
            value={carrier}
            onChange={(e) => setCarrier(e.target.value)}
            placeholder="e.g. The Hartford"
            className="h-8"
          />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-[11px] text-muted-foreground">
            Effective
            <Input
              type="date"
              value={effective}
              onChange={(e) => setEffective(e.target.value)}
              className="h-8"
            />
          </label>
          <label className="text-[11px] text-muted-foreground">
            Expiry
            <Input
              type="date"
              value={expiry}
              onChange={(e) => setExpiry(e.target.value)}
              className="h-8"
            />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-2 md:col-span-2 md:grid-cols-4">
          <label className="text-[11px] text-muted-foreground">
            GL limit
            <MoneyInput value={gl} onValueChange={setGl} className="h-8" />
          </label>
          <label className="text-[11px] text-muted-foreground">
            Workers' comp
            <MoneyInput value={wc} onValueChange={setWc} className="h-8" />
          </label>
          <label className="text-[11px] text-muted-foreground">
            Auto
            <MoneyInput value={auto} onValueChange={setAuto} className="h-8" />
          </label>
          <label className="text-[11px] text-muted-foreground">
            Umbrella
            <MoneyInput value={umbrella} onValueChange={setUmbrella} className="h-8" />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-3 md:col-span-2">
          <label className="flex items-center gap-1.5 text-xs text-foreground">
            <input
              type="checkbox"
              checked={verified}
              onChange={(e) => setVerified(e.target.checked)}
              className="h-3.5 w-3.5"
            />
            I've verified this certificate is valid
          </label>
          <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-accent">
            <Upload className="h-3.5 w-3.5" />
            {certFile ? certFile.name : "Attach COI"}
            <input
              type="file"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) {
                  const up = await uploadComplianceFile(projectId, f);
                  if (up) setCertFile(up);
                }
              }}
            />
          </label>
          <Button
            type="button"
            size="sm"
            className="ml-auto"
            disabled={savingCert}
            onClick={saveCert}
          >
            Save certificate
          </Button>
        </div>
      </div>

      {/* Lien waivers */}
      <div className="mt-3">
        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          Lien waivers
        </div>
        {waivers.length > 0 ? (
          <ul className="mt-2 divide-y divide-hairline text-xs">
            {waivers.map((w) => (
              <li key={w.id} className="flex items-center justify-between py-1.5">
                <span className="text-foreground">
                  {WAIVER_LABEL[w.waiver_type]}
                  {w.amount > 0 ? (
                    <span className="ml-2 tabular text-muted-foreground">{fmtUSD(w.amount)}</span>
                  ) : null}
                  {w.through_date ? (
                    <span className="ml-2 text-muted-foreground">through {w.through_date}</span>
                  ) : null}
                  {w.payment_id ? (
                    <span className="ml-2 text-success">
                      {(() => {
                        const p = paymentById.get(w.payment_id);
                        return p
                          ? `· attached to pay app ${p.payment_date} (${fmtUSD(p.amount)})`
                          : "· attached to a pay app";
                      })()}
                    </span>
                  ) : (
                    <span className="ml-2 text-accent">· on file — not attached yet</span>
                  )}
                </span>
                <span className="flex items-center gap-2">
                  {w.storage_path ? (
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-foreground"
                      onClick={() => viewFile(w.storage_path)}
                      aria-label="View waiver"
                    >
                      <FileText className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-danger"
                    onClick={() => onDeleteWaiver(w.id)}
                    aria-label="Delete waiver"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-[11px] text-muted-foreground">No lien waivers on file.</p>
        )}
        <div className="mt-2 grid gap-2 rounded-md border border-hairline bg-surface/50 p-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
          <select
            value={wType}
            onChange={(e) => setWType(e.target.value as LienWaiverRow["waiver_type"])}
            className="rounded-md border border-hairline bg-surface px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-accent/40"
          >
            {(Object.keys(WAIVER_LABEL) as LienWaiverRow["waiver_type"][]).map((k) => (
              <option key={k} value={k}>
                {WAIVER_LABEL[k]}
              </option>
            ))}
          </select>
          <label className="text-[11px] text-muted-foreground">
            Through
            <Input
              type="date"
              value={wThrough}
              onChange={(e) => setWThrough(e.target.value)}
              className="h-8"
            />
          </label>
          <label className="text-[11px] text-muted-foreground">
            Amount
            <MoneyInput value={wAmount} onValueChange={setWAmount} className="h-8" />
          </label>
          <div className="flex items-end gap-2">
            <label className="inline-flex cursor-pointer items-center gap-1 text-xs text-accent">
              <Upload className="h-3.5 w-3.5" />
              {wFile ? "Attached" : "Doc"}
              <input
                type="file"
                className="hidden"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (f) {
                    const up = await uploadComplianceFile(projectId, f);
                    if (up) setWFile(up);
                  }
                }}
              />
            </label>
            <Button type="button" size="sm" disabled={savingWaiver} onClick={recordWaiver}>
              Add
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
