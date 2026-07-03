import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Banknote, CheckCircle2, CreditCard, Eye, Landmark, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  getCompanyPaymentProfile,
  revealCompanyPaymentProfile,
  saveCompanyPaymentProfile,
  type CompanyPaymentProfileView,
} from "@/lib/payments.functions";
import {
  centsToDollars,
  dollarsToCents,
  renderRemittanceMemo,
  stripeConnectReady,
} from "@/lib/payments-domain";

// Founder's expectation-setting copy for the Stripe status card. Do not
// paraphrase: it sets the "direct wire for big money, Stripe for small" frame.
const STRIPE_EXPECTATION_COPY =
  "Stripe verifies new businesses — card and bank-debit payments suit smaller amounts while your account builds history. For large requisitions, your invoices already carry your direct wire instructions.";

export interface GettingPaidStripeState {
  accountId: string;
  connectStatus: string;
  processorReady: boolean;
}

interface GettingPaidSectionProps {
  canManage: boolean;
  stripe: GettingPaidStripeState;
  onConnectStripe: () => void;
  stripeConnectPending: boolean;
}

interface ProfileFormState {
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

function formFromProfile(profile: CompanyPaymentProfileView): ProfileFormState {
  return {
    bankName: profile.bankName,
    routingNumber: "",
    accountNumber: "",
    wireInstructions: profile.wireInstructions,
    remittanceMemoTemplate: profile.remittanceMemoTemplate,
    directBank: profile.defaultPaymentMethods.direct_bank,
    card: profile.defaultPaymentMethods.card,
    achDebit: profile.defaultPaymentMethods.ach_debit,
    cardFeePassThrough: profile.cardFeePassThrough,
    stripeThresholdDollars: String(centsToDollars(profile.stripeAmountThresholdCents)),
  };
}

function StatusRow({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      {icon}
      <span className="text-muted-foreground">{label}</span>
      <span className="ml-auto font-medium">{value}</span>
    </div>
  );
}

export function GettingPaidSection({
  canManage,
  stripe,
  onConnectStripe,
  stripeConnectPending,
}: GettingPaidSectionProps) {
  const queryClient = useQueryClient();
  const fetchProfile = useServerFn(getCompanyPaymentProfile);
  const saveProfile = useServerFn(saveCompanyPaymentProfile);
  const revealProfile = useServerFn(revealCompanyPaymentProfile);

  const profileQuery = useQuery({
    queryKey: ["company-payment-profile"],
    queryFn: () => fetchProfile(),
    enabled: canManage,
  });
  const profile = profileQuery.data;

  const [form, setForm] = useState<ProfileFormState | null>(null);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    if (profile && form === null) setForm(formFromProfile(profile));
  }, [profile, form]);

  const saveMutation = useMutation({
    mutationFn: async (state: ProfileFormState) => {
      const thresholdDollars = Number(state.stripeThresholdDollars);
      return saveProfile({
        data: {
          bankName: state.bankName,
          routingNumber: state.routingNumber.trim(),
          accountNumber: state.accountNumber.trim(),
          wireInstructions: state.wireInstructions,
          remittanceMemoTemplate: state.remittanceMemoTemplate,
          defaultPaymentMethods: {
            direct_bank: state.directBank,
            card: state.card,
            ach_debit: state.achDebit,
          },
          cardFeePassThrough: state.cardFeePassThrough,
          stripeAmountThresholdCents:
            Number.isFinite(thresholdDollars) && thresholdDollars > 0
              ? dollarsToCents(thresholdDollars)
              : undefined,
        },
      });
    },
    onSuccess: (saved) => {
      queryClient.setQueryData(["company-payment-profile"], saved);
      setForm(formFromProfile(saved));
      setRevealed(false);
      toast.success("Getting paid details saved");
    },
    onError: (error) => {
      toast.error("Getting paid details did not save", {
        description: error instanceof Error ? error.message : "Try again.",
      });
    },
  });

  const revealMutation = useMutation({
    mutationFn: async () => revealProfile(),
    onSuccess: (numbers) => {
      setForm((current) =>
        current
          ? {
              ...current,
              routingNumber: numbers.routingNumber,
              accountNumber: numbers.accountNumber,
            }
          : current,
      );
      setRevealed(true);
    },
    onError: (error) => {
      toast.error("Could not reveal bank details", {
        description: error instanceof Error ? error.message : "Try again.",
      });
    },
  });

  if (!canManage) return null;

  const stripeReady = stripeConnectReady(stripe);
  const stripeStateLabel = stripeReady
    ? "Ready for card & bank-debit payments"
    : stripe.accountId
      ? "Verification in progress"
      : "Not connected";
  const memoPreview = renderRemittanceMemo(
    form?.remittanceMemoTemplate ?? "Reference: Invoice {number}",
    "1042",
  );

  return (
    <section
      data-testid="getting-paid-section"
      className="rounded-lg border border-hairline bg-card p-5 shadow-card"
    >
      <div>
        <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          <Banknote className="h-4 w-4" />
          Getting paid
        </div>
        <h2 className="mt-1 font-serif text-2xl text-foreground">How clients pay this company</h2>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Your direct bank details print on invoices. Stripe adds card and bank-debit options for
          smaller payments when you turn them on.
        </p>
      </div>

      {profile?.schemaMissing && (
        <div className="mt-4 rounded-md border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
          The payments database migration has not been applied yet. Bank details can be entered
          after the Payments Phase 1 migrations run.
        </div>
      )}

      <div className="mt-5 grid gap-6 lg:grid-cols-2">
        {/* Tier 0: direct remittance details — the rail that never depends on Stripe. */}
        <div className="space-y-4 rounded-md border border-hairline bg-surface p-4">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Landmark className="h-4 w-4" />
            Direct bank transfer details
          </div>
          <p className="text-sm text-muted-foreground">
            These wire/ACH details print on invoices that have Direct bank transfer turned on. This
            is how requisition-sized payments reach you — no processor in the middle.
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="getting-paid-bank-name">Bank name</Label>
            <Input
              id="getting-paid-bank-name"
              value={form?.bankName ?? ""}
              placeholder="First National Bank"
              disabled={!form || saveMutation.isPending}
              onChange={(event) => setForm((c) => (c ? { ...c, bankName: event.target.value } : c))}
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
                disabled={!form || saveMutation.isPending}
                onChange={(event) =>
                  setForm((c) => (c ? { ...c, routingNumber: event.target.value } : c))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="getting-paid-account">Account number</Label>
              <Input
                id="getting-paid-account"
                value={form?.accountNumber ?? ""}
                placeholder={
                  profile?.exists
                    ? profile.accountMasked || "Enter account number"
                    : "Account number"
                }
                inputMode="numeric"
                disabled={!form || saveMutation.isPending}
                onChange={(event) =>
                  setForm((c) => (c ? { ...c, accountNumber: event.target.value } : c))
                }
              />
            </div>
          </div>
          {profile?.exists && !revealed && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={revealMutation.isPending}
              onClick={() => revealMutation.mutate()}
            >
              <Eye className="mr-1.5 h-3.5 w-3.5" />
              {revealMutation.isPending ? "Revealing…" : "Reveal saved numbers"}
            </Button>
          )}
          {profile?.exists && (
            <p className="text-xs text-muted-foreground">
              Saved numbers stay masked ({profile.routingMasked || "none"} /{" "}
              {profile.accountMasked || "none"}). Leave the fields blank to keep them; type new
              numbers to replace them.
            </p>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="getting-paid-wire">Wire instructions (optional)</Label>
            <Textarea
              id="getting-paid-wire"
              value={form?.wireInstructions ?? ""}
              placeholder="SWIFT code, bank address, or anything else your bank asks payers to include."
              rows={3}
              disabled={!form || saveMutation.isPending}
              onChange={(event) =>
                setForm((c) => (c ? { ...c, wireInstructions: event.target.value } : c))
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="getting-paid-memo">Payment reference memo</Label>
            <Input
              id="getting-paid-memo"
              value={form?.remittanceMemoTemplate ?? ""}
              placeholder="Reference: Invoice {number}"
              disabled={!form || saveMutation.isPending}
              onChange={(event) =>
                setForm((c) => (c ? { ...c, remittanceMemoTemplate: event.target.value } : c))
              }
            />
            <p className="text-xs text-muted-foreground">
              {"{number}"} becomes the invoice number. Preview: {memoPreview}
            </p>
          </div>
        </div>

        {/* Tier 1: Stripe Connect status + company-level payment defaults. */}
        <div className="space-y-4 rounded-md border border-hairline bg-surface p-4">
          <div className="flex items-center gap-2 text-sm font-medium">
            <CreditCard className="h-4 w-4" />
            Online payments (Stripe)
          </div>
          <div className="rounded-md border border-hairline bg-card p-4">
            <div className="flex items-center gap-2">
              {stripeReady ? (
                <CheckCircle2 className="h-4 w-4 text-success" />
              ) : (
                <ShieldCheck className="h-4 w-4 text-muted-foreground" />
              )}
              <span className="text-sm font-medium">{stripeStateLabel}</span>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">{STRIPE_EXPECTATION_COPY}</p>
            {!stripeReady && (
              <Button
                type="button"
                size="sm"
                className="mt-3"
                disabled={stripeConnectPending}
                onClick={onConnectStripe}
              >
                {stripeConnectPending
                  ? "Opening Stripe…"
                  : stripe.accountId
                    ? "Resume Stripe verification"
                    : "Connect Stripe"}
              </Button>
            )}
          </div>

          <div className="space-y-3">
            <p className="text-sm font-medium">
              Which payment options do new invoices offer clients?
            </p>
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="getting-paid-default-direct" className="font-normal">
                Direct bank transfer (wire/ACH to your account)
              </Label>
              <Switch
                id="getting-paid-default-direct"
                checked={form?.directBank ?? true}
                disabled={!form || saveMutation.isPending}
                onCheckedChange={(checked) =>
                  setForm((c) => (c ? { ...c, directBank: checked } : c))
                }
              />
            </div>
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="getting-paid-default-card" className="font-normal">
                Card (needs Stripe)
              </Label>
              <Switch
                id="getting-paid-default-card"
                checked={form?.card ?? true}
                disabled={!form || saveMutation.isPending}
                onCheckedChange={(checked) => setForm((c) => (c ? { ...c, card: checked } : c))}
              />
            </div>
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="getting-paid-default-ach" className="font-normal">
                Bank debit / ACH (needs Stripe)
              </Label>
              <Switch
                id="getting-paid-default-ach"
                checked={form?.achDebit ?? true}
                disabled={!form || saveMutation.isPending}
                onCheckedChange={(checked) => setForm((c) => (c ? { ...c, achDebit: checked } : c))}
              />
            </div>
            <div className="flex items-center justify-between gap-3">
              <div>
                <Label htmlFor="getting-paid-fee-passthrough" className="font-normal">
                  Add estimated card fee to card payments
                </Label>
                <p className="text-xs text-muted-foreground">
                  Adds a processing-fee line when a client pays by card. Check that surcharging is
                  allowed in your state — that responsibility is yours.
                </p>
              </div>
              <Switch
                id="getting-paid-fee-passthrough"
                checked={form?.cardFeePassThrough ?? false}
                disabled={!form || saveMutation.isPending}
                onCheckedChange={(checked) =>
                  setForm((c) => (c ? { ...c, cardFeePassThrough: checked } : c))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="getting-paid-threshold">Hide card & bank debit above ($)</Label>
              <Input
                id="getting-paid-threshold"
                value={form?.stripeThresholdDollars ?? ""}
                inputMode="decimal"
                disabled={!form || saveMutation.isPending}
                onChange={(event) =>
                  setForm((c) => (c ? { ...c, stripeThresholdDollars: event.target.value } : c))
                }
              />
              <p className="text-xs text-muted-foreground">
                Invoices above this amount show only your direct bank details, so requisition-sized
                money skips processor fees. You can override this on any single invoice.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-5 flex justify-end">
        <Button
          type="button"
          disabled={!form || saveMutation.isPending || profile?.schemaMissing}
          onClick={() => form && saveMutation.mutate(form)}
        >
          {saveMutation.isPending ? "Saving…" : "Save getting paid details"}
        </Button>
      </div>
    </section>
  );
}
