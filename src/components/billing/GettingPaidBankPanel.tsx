import type { ReactNode } from "react";
import { Eye, Landmark } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { CompanyPaymentProfileView } from "@/lib/payments.functions";

export interface GettingPaidProfileFormState {
  bankName: string;
  routingNumber: string;
  accountNumber: string;
  wireInstructions: string;
  remittanceMemoTemplate: string;
  directBank: boolean;
  card: boolean;
  achDebit: boolean;
  cardFeePassThrough: boolean;
  stripeThresholdDollars: string;
}

interface GettingPaidBankPanelProps {
  form: GettingPaidProfileFormState | null;
  profile?: CompanyPaymentProfileView;
  saving: boolean;
  revealed: boolean;
  revealPending: boolean;
  memoPreview: string;
  saveButton: ReactNode;
  onReveal: () => void;
  onChange: (patch: Partial<GettingPaidProfileFormState>) => void;
}

export function GettingPaidBankPanel({
  form,
  profile,
  saving,
  revealed,
  revealPending,
  memoPreview,
  saveButton,
  onReveal,
  onChange,
}: GettingPaidBankPanelProps) {
  return (
    <div className="mx-auto max-w-3xl space-y-4 rounded-lg border border-hairline bg-surface p-5">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Landmark className="h-4 w-4" /> Direct bank transfer details
      </div>
      <p className="text-sm text-muted-foreground">
        These details print on invoices and send requisition-sized payments directly to the
        contractor's bank—no processor in the middle.
      </p>
      <div className="space-y-1.5">
        <Label htmlFor="getting-paid-bank-name">Bank name</Label>
        <Input
          id="getting-paid-bank-name"
          value={form?.bankName ?? ""}
          placeholder="First National Bank"
          disabled={!form || saving}
          onChange={(event) => onChange({ bankName: event.target.value })}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="getting-paid-routing">Routing number</Label>
          <Input
            id="getting-paid-routing"
            value={form?.routingNumber ?? ""}
            placeholder={
              profile?.exists ? profile.routingMasked || "Enter routing number" : "021000021"
            }
            inputMode="numeric"
            disabled={!form || saving}
            onChange={(event) => onChange({ routingNumber: event.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="getting-paid-account">Account number</Label>
          <Input
            id="getting-paid-account"
            value={form?.accountNumber ?? ""}
            placeholder={
              profile?.exists ? profile.accountMasked || "Enter account number" : "Account number"
            }
            inputMode="numeric"
            disabled={!form || saving}
            onChange={(event) => onChange({ accountNumber: event.target.value })}
          />
        </div>
      </div>
      {profile?.exists && !revealed ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={revealPending}
          onClick={onReveal}
        >
          <Eye className="mr-1.5 h-3.5 w-3.5" />
          {revealPending ? "Revealing…" : "Reveal saved numbers"}
        </Button>
      ) : null}
      {profile?.exists ? (
        <p className="text-xs text-muted-foreground">
          Saved numbers stay masked ({profile.routingMasked || "none"} /{" "}
          {profile.accountMasked || "none"}). Leave blank to keep them, or type replacements.
        </p>
      ) : null}
      <div className="space-y-1.5">
        <Label htmlFor="getting-paid-wire">Wire instructions (optional)</Label>
        <Textarea
          id="getting-paid-wire"
          value={form?.wireInstructions ?? ""}
          rows={3}
          disabled={!form || saving}
          onChange={(event) => onChange({ wireInstructions: event.target.value })}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="getting-paid-memo">Payment reference memo</Label>
        <Input
          id="getting-paid-memo"
          value={form?.remittanceMemoTemplate ?? ""}
          placeholder="Reference: Invoice {number}"
          disabled={!form || saving}
          onChange={(event) => onChange({ remittanceMemoTemplate: event.target.value })}
        />
        <p className="text-xs text-muted-foreground">
          {"{number}"} becomes the invoice number. Preview: {memoPreview}
        </p>
      </div>
      <div className="flex justify-end">{saveButton}</div>
    </div>
  );
}
