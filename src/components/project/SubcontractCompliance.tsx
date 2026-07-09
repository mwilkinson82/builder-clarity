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
// stored path + original name (or null on failure, already toasted).
async function uploadComplianceFile(
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
  onSaveCertificate,
  onDeleteCertificate,
  onRecordWaiver,
  onDeleteWaiver,
}: {
  projectId: string;
  gatingEnabled: boolean;
  certificates: InsuranceCertificateRow[];
  waivers: LienWaiverRow[];
  onSaveCertificate: (input: SaveCertInput) => Promise<unknown> | void;
  onDeleteCertificate: (id: string) => void;
  onRecordWaiver: (input: RecordWaiverInput) => Promise<unknown> | void;
  onDeleteWaiver: (id: string) => void;
}) {
  const status = subcontractInsuranceStatus(certificates, today());
  const ui = STATUS_UI[status];
  const cleared = insuranceClears(status);
  const openWaivers = waivers.filter((w) => !w.payment_id);

  // Insurance capture form (the latest cert seeds it for editing/renewal).
  const latest = certificates[0];
  const [carrier, setCarrier] = useState(latest?.carrier ?? "");
  const [effective, setEffective] = useState(latest?.effective_date ?? "");
  const [expiry, setExpiry] = useState(latest?.expiry_date ?? "");
  const [verified, setVerified] = useState(latest?.verified ?? false);
  const [gl, setGl] = useState(latest?.gl_limit ?? 0);
  const [wc, setWc] = useState(latest?.wc_limit ?? 0);
  const [auto, setAuto] = useState(latest?.auto_limit ?? 0);
  const [umbrella, setUmbrella] = useState(latest?.umbrella_limit ?? 0);
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
        storage_path: certFile?.path ?? latest?.storage_path ?? "",
        file_name: certFile?.name ?? latest?.file_name ?? "",
      });
      setCertFile(null);
      toast.success("Insurance saved");
    } finally {
      setSavingCert(false);
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
        <div className={`inline-flex items-center gap-1.5 text-xs font-medium ${ui.tone}`}>
          <StatusIcon className="h-4 w-4" />
          {ui.label}
        </div>
      </div>
      {!gatingEnabled ? (
        <p className="mt-1 text-[11px] text-muted-foreground">
          Gating is off for this project — compliance is tracked here but never blocks a payment.
        </p>
      ) : !cleared || openWaivers.length === 0 ? (
        <p className="mt-1 text-[11px] text-danger">
          Payment is blocked until{" "}
          {[
            !cleared ? "a valid COI is on file" : null,
            openWaivers.length === 0 ? "a lien waiver is collected" : null,
          ]
            .filter(Boolean)
            .join(" and ")}
          .
        </p>
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
            {certFile ? certFile.name : latest?.file_name ? "Replace COI" : "Attach COI"}
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
          {latest?.storage_path ? (
            <button
              type="button"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => viewFile(latest.storage_path)}
            >
              <FileText className="h-3.5 w-3.5" /> View current COI
            </button>
          ) : null}
          <Button
            type="button"
            size="sm"
            className="ml-auto"
            disabled={savingCert}
            onClick={saveCert}
          >
            {latest ? "Update insurance" : "Save insurance"}
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
                    <span className="ml-2 text-success">· applied</span>
                  ) : (
                    <span className="ml-2 text-accent">· on file</span>
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
