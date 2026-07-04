import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Banknote,
  CheckCircle2,
  CreditCard,
  Eye,
  Landmark,
  SearchCheck,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { fmtUSDCents } from "@/lib/billing-format";
import {
  getCompanyPaymentProfile,
  listUnmatchedStripePayments,
  revealCompanyPaymentProfile,
  saveCompanyPaymentProfile,
  type CompanyPaymentProfileView,
  type ReconcileInvoiceOption,
  type UnmatchedStripePayment,
} from "@/lib/payments.functions";
import { recordInvoicePayment } from "@/lib/projects.functions";
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
  /** One quiet line about Overwatch subscription readiness — composed by the caller. */
  subscriptionNote: string;
  billingContactName: string;
  billingContactEmail: string;
  /** Billing contact writes through updateOrganization, which needs company.manage_settings. */
  canEditBillingContact: boolean;
  onSaveBillingContact: (next: { name: string; email: string }) => void;
  billingContactSaving: boolean;
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
  subscriptionNote,
  billingContactName,
  billingContactEmail,
  canEditBillingContact,
  onSaveBillingContact,
  billingContactSaving,
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
  const [contactForm, setContactForm] = useState({
    name: billingContactName,
    email: billingContactEmail,
  });

  useEffect(() => {
    if (profile && form === null) setForm(formFromProfile(profile));
  }, [profile, form]);

  // Re-sync after a save round-trips through the workspace refetch.
  useEffect(() => {
    setContactForm({ name: billingContactName, email: billingContactEmail });
  }, [billingContactName, billingContactEmail]);

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
      id="getting-paid"
      data-testid="getting-paid-section"
      className="scroll-mt-6 rounded-lg border border-hairline bg-card p-5 shadow-card"
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
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{subscriptionNote}</p>
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

      <StripeReconciliationPanel />

      <div className="mt-5 rounded-md border border-hairline bg-surface p-4">
        <div className="flex items-center gap-2 text-sm font-medium">
          <ShieldCheck className="h-4 w-4" />
          Billing contact
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          Where subscription and payment notices for this company go.
        </p>
        <div className="mt-3 grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
          <div className="space-y-1.5">
            <Label htmlFor="getting-paid-billing-contact">Billing contact</Label>
            <Input
              id="getting-paid-billing-contact"
              value={contactForm.name}
              placeholder="Owner or accounting contact"
              disabled={!canEditBillingContact || billingContactSaving}
              onChange={(event) =>
                setContactForm((current) => ({ ...current, name: event.target.value }))
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="getting-paid-billing-email">Billing email</Label>
            <Input
              id="getting-paid-billing-email"
              type="email"
              value={contactForm.email}
              placeholder="billing@company.com"
              disabled={!canEditBillingContact || billingContactSaving}
              onChange={(event) =>
                setContactForm((current) => ({ ...current, email: event.target.value }))
              }
            />
          </div>
          <Button
            type="button"
            variant="outline"
            disabled={
              !canEditBillingContact ||
              billingContactSaving ||
              (contactForm.name === billingContactName && contactForm.email === billingContactEmail)
            }
            onClick={() => onSaveBillingContact(contactForm)}
          >
            {billingContactSaving ? "Saving…" : "Save billing contact"}
          </Button>
        </div>
        {!canEditBillingContact && (
          <p className="mt-2 text-xs text-muted-foreground">
            Only people who can manage company settings can change the billing contact.
          </p>
        )}
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

function stripePaymentMethodLabel(type: string) {
  if (type === "us_bank_account") return "Bank debit (ACH)";
  if (type === "card") return "Card";
  return type ? type.replace(/_/g, " ") : "Stripe";
}

function reconciliationDateLabel(iso: string) {
  if (!iso) return "No date";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "No date";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

type SweepResult = Awaited<ReturnType<typeof listUnmatchedStripePayments>>;

/**
 * On-demand safety net (BILLINGBATCH2 Task 2): money that settled on Stripe
 * without a matching payment record — e.g. a payment from before webhooks
 * were wired up — is invisible to A/R until someone looks. This looks.
 */
function StripeReconciliationPanel() {
  const runSweep = useServerFn(listUnmatchedStripePayments);
  const recordPayment = useServerFn(recordInvoicePayment);
  const [sweep, setSweep] = useState<SweepResult | null>(null);
  const [invoiceByPayment, setInvoiceByPayment] = useState<Record<string, string>>({});
  const [bookedIds, setBookedIds] = useState<Set<string>>(new Set());

  const sweepMutation = useMutation({
    mutationFn: async () => runSweep(),
    onSuccess: (result) => {
      setSweep(result);
      setBookedIds(new Set());
      setInvoiceByPayment({});
    },
    onError: (error) => {
      toast.error("Stripe check did not run", {
        description: error instanceof Error ? error.message : "Try again.",
      });
    },
  });

  const recordMutation = useMutation({
    mutationFn: async (payment: UnmatchedStripePayment) => {
      const invoiceId = invoiceByPayment[payment.stripeChargeId];
      if (!invoiceId) throw new Error("Pick the invoice this payment belongs to first.");
      const stripeReference = payment.stripePaymentIntentId || payment.stripeChargeId;
      return recordPayment({
        data: {
          invoiceId,
          amount: payment.amount,
          payment_method:
            payment.paymentMethodType === "us_bank_account"
              ? "ach"
              : payment.paymentMethodType === "card"
                ? "card"
                : "other",
          processor: "stripe",
          processor_payment_id: stripeReference,
          reference: stripeReference,
          paid_at: payment.paidAtIso || undefined,
          notes: `Recorded from the Stripe unmatched-payments check (${payment.stripeChargeId}).`,
        },
      });
    },
    onSuccess: (_result, payment) => {
      setBookedIds((current) => new Set(current).add(payment.stripeChargeId));
      toast.success("Payment recorded to invoice", {
        description: "The invoice, ledger, and A/R now include this Stripe payment.",
      });
    },
    onError: (error) => {
      toast.error("Payment did not record", {
        description: error instanceof Error ? error.message : "Try again.",
      });
    },
  });

  const unmatched = sweep?.ready ? sweep.payments : [];
  const openInvoices: ReconcileInvoiceOption[] = sweep?.ready ? sweep.openInvoices : [];

  return (
    <div className="mt-5 rounded-md border border-hairline bg-surface p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium">
            <SearchCheck className="h-4 w-4" />
            Payment reconciliation
          </div>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Compares recent Stripe payments against your recorded payments and flags money that
            never reached an invoice — like a payment that settled before this company's account was
            fully wired up.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          disabled={sweepMutation.isPending}
          onClick={() => sweepMutation.mutate()}
        >
          {sweepMutation.isPending ? "Checking Stripe…" : "Check Stripe for unmatched payments"}
        </Button>
      </div>

      {sweep && !sweep.ready ? (
        <div className="mt-3 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
          {sweep.reason}
        </div>
      ) : null}

      {sweep?.ready ? (
        <div className="mt-3 space-y-3">
          <div className="text-xs text-muted-foreground">
            Checked {sweep.checkedCount} settled Stripe payment
            {sweep.checkedCount === 1 ? "" : "s"} ·{" "}
            {unmatched.length === 0
              ? "every one is recorded against an invoice."
              : `${unmatched.length} not recorded anywhere.`}
          </div>
          {unmatched.map((payment) => {
            const booked = bookedIds.has(payment.stripeChargeId);
            const recording =
              recordMutation.isPending &&
              recordMutation.variables?.stripeChargeId === payment.stripeChargeId;
            return (
              <div
                key={payment.stripeChargeId}
                className={`rounded-md border p-3 ${
                  booked ? "border-success/30 bg-success/5" : "border-warning/30 bg-warning/5"
                }`}
              >
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0">
                    <div className="text-sm font-medium tabular">
                      {fmtUSDCents(payment.amount)} ·{" "}
                      {stripePaymentMethodLabel(payment.paymentMethodType)} ·{" "}
                      {reconciliationDateLabel(payment.paidAtIso)}
                    </div>
                    <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
                      {payment.stripePaymentIntentId || payment.stripeChargeId}
                      {payment.description ? ` · ${payment.description}` : ""}
                    </div>
                  </div>
                  {booked ? (
                    <div className="flex items-center gap-1.5 text-sm font-medium text-success">
                      <CheckCircle2 className="h-4 w-4" /> Recorded
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <Select
                        value={invoiceByPayment[payment.stripeChargeId] ?? ""}
                        onValueChange={(invoiceId) =>
                          setInvoiceByPayment((current) => ({
                            ...current,
                            [payment.stripeChargeId]: invoiceId,
                          }))
                        }
                      >
                        <SelectTrigger className="h-9 sm:w-[320px]">
                          <SelectValue placeholder="Record to invoice…" />
                        </SelectTrigger>
                        <SelectContent>
                          {openInvoices.length === 0 ? (
                            <SelectItem value="none" disabled>
                              No open invoices found
                            </SelectItem>
                          ) : (
                            openInvoices.map((invoice) => (
                              <SelectItem key={invoice.id} value={invoice.id}>
                                {invoice.projectName} · {invoice.label} ·{" "}
                                {fmtUSDCents(invoice.openBalance)} open
                              </SelectItem>
                            ))
                          )}
                        </SelectContent>
                      </Select>
                      <Button
                        type="button"
                        size="sm"
                        disabled={recording || !invoiceByPayment[payment.stripeChargeId]}
                        onClick={() => recordMutation.mutate(payment)}
                      >
                        {recording ? "Recording…" : "Record payment"}
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
