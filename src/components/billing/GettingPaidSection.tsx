import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Banknote,
  CheckCircle2,
  ChevronDown,
  CreditCard,
  ExternalLink,
  Gauge,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { fmtUSDCents } from "@/lib/billing-format";
import {
  getCompanyPaymentProfile,
  revealCompanyPaymentProfile,
  saveCompanyPaymentProfile,
  type CompanyPaymentProfileView,
} from "@/lib/payments.functions";
import { centsToDollars, dollarsToCents, renderRemittanceMemo } from "@/lib/payments-domain";
import {
  getStripePaymentLimitContext,
  requestStripePaymentLimit,
} from "@/lib/stripe-limit.functions";
import type { StripeMode } from "@/lib/stripe-mode";
import type { StripeConnectDetails, StripeConnectReadiness } from "@/lib/stripe-connect-status";
import {
  cappedApplicationFeeFromDollars,
  formatBasisPoints,
  STRIPE_STANDARD_US_FEES,
} from "@/lib/stripe-fee-config";
import { StripeReconciliationPanel } from "@/components/billing/StripeReconciliationPanel";
import {
  GettingPaidBankPanel,
  type GettingPaidProfileFormState,
} from "@/components/billing/GettingPaidBankPanel";

// Founder's expectation-setting copy for the Stripe status card. Do not
// paraphrase: it sets the "direct wire for big money, Stripe for small" frame.
const STRIPE_EXPECTATION_COPY =
  "Stripe verifies new businesses — card and bank-debit payments suit smaller amounts while your account builds history. For large requisitions, your invoices already carry your direct wire instructions.";

export interface GettingPaidStripeState {
  mode: StripeMode;
  accountId: string;
  connectStatus: string;
  processorReady: boolean;
  testAccountId: string;
  testConnectStatus: string;
  liveAccountId: string;
  liveConnectStatus: string;
}

interface GettingPaidSectionProps {
  canManage: boolean;
  stripe: GettingPaidStripeState;
  connectDetails?: StripeConnectDetails;
  onConnectStripe: (mode: StripeMode) => void;
  onActivateLiveStripe: () => void;
  onOpenStripeDashboard: (mode: StripeMode) => void;
  onRefreshStripeStatus: () => void;
  stripeConnectPending: boolean;
  stripeStatusPending: boolean;
  /** One quiet line about Overwatch subscription readiness — composed by the caller. */
  subscriptionNote: string;
  billingContactName: string;
  billingContactEmail: string;
  /** Billing contact writes through updateOrganization, which needs company.manage_settings. */
  canEditBillingContact: boolean;
  onSaveBillingContact: (next: { name: string; email: string }) => void;
  billingContactSaving: boolean;
}

function formFromProfile(profile: CompanyPaymentProfileView): GettingPaidProfileFormState {
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

function readinessPresentation(readiness: StripeConnectReadiness) {
  if (readiness === "ready") {
    return {
      title: "Stripe approved",
      detail: "Card payments and payouts are enabled for this connected account.",
      tone: "success",
    } as const;
  }
  if (readiness === "under_review") {
    return {
      title: "Stripe review in progress",
      detail:
        "Stripe has the submitted information and is reviewing one or more payment capabilities. OverWatch checks this automatically.",
      tone: "warning",
    } as const;
  }
  if (readiness === "restricted") {
    return {
      title: "Stripe action overdue",
      detail:
        "Payments or payouts are restricted until the connected account resolves Stripe's requirements.",
      tone: "danger",
    } as const;
  }
  if (readiness === "action_required") {
    return {
      title: "Stripe needs more information",
      detail:
        "Open Stripe verification and complete the remaining business or payout requirements.",
      tone: "warning",
    } as const;
  }
  return {
    title: "Live Stripe setup required",
    detail: "Connect the company's live Stripe business before accepting real online payments.",
    tone: "default",
  } as const;
}

export function GettingPaidSection({
  canManage,
  stripe,
  connectDetails,
  onConnectStripe,
  onActivateLiveStripe,
  onOpenStripeDashboard,
  onRefreshStripeStatus,
  stripeConnectPending,
  stripeStatusPending,
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
  const fetchPaymentLimit = useServerFn(getStripePaymentLimitContext);
  const submitPaymentLimitRequest = useServerFn(requestStripePaymentLimit);

  const profileQuery = useQuery({
    queryKey: ["company-payment-profile"],
    queryFn: () => fetchProfile(),
    enabled: canManage,
  });
  const profile = profileQuery.data;
  const paymentLimitQuery = useQuery({
    queryKey: ["stripe-payment-limit"],
    queryFn: () => fetchPaymentLimit(),
    enabled: canManage,
  });
  const paymentLimit = paymentLimitQuery.data;

  const [form, setForm] = useState<GettingPaidProfileFormState | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [requestedLimitDollars, setRequestedLimitDollars] = useState("");
  const [stripeRequestReference, setStripeRequestReference] = useState("");
  const [limitRequestReason, setLimitRequestReason] = useState("");
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
    mutationFn: async (state: GettingPaidProfileFormState) => {
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

  const paymentLimitMutation = useMutation({
    mutationFn: () => {
      const requested = Number(requestedLimitDollars.replaceAll(",", ""));
      if (!Number.isFinite(requested) || requested <= 0) {
        throw new Error("Enter the largest single payment Stripe approved or is reviewing.");
      }
      return submitPaymentLimitRequest({
        data: {
          requestedLimitDollars: requested,
          stripeRequestReference,
          reason: limitRequestReason,
        },
      });
    },
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["stripe-payment-limit"] });
      setRequestedLimitDollars("");
      setStripeRequestReference("");
      setLimitRequestReason("");
      toast.success("Payment-limit request recorded", {
        description:
          result.status === "stripe_pending"
            ? "Stripe approval is still required before OverWatch can raise the ceiling."
            : "OverWatch support can now verify the Stripe approval and review the request.",
      });
    },
    onError: (error) => {
      toast.error("Payment-limit request was not submitted", {
        description: error instanceof Error ? error.message : "Try again.",
      });
    },
  });

  if (!canManage) return null;

  const liveReady =
    connectDetails?.ready ??
    (Boolean(stripe.liveAccountId) && stripe.liveConnectStatus === "active");
  const readiness: StripeConnectReadiness =
    connectDetails?.readiness ??
    (liveReady ? "ready" : stripe.liveAccountId ? "under_review" : "not_started");
  const statusPresentation = readinessPresentation(readiness);
  const accountName = connectDetails?.businessName || "Connected Stripe business";
  const statusToneClass =
    statusPresentation.tone === "success"
      ? "border-success/30 bg-success/10 text-success"
      : statusPresentation.tone === "danger"
        ? "border-danger/30 bg-danger/10 text-danger"
        : statusPresentation.tone === "warning"
          ? "border-warning/30 bg-warning/10 text-warning"
          : "border-hairline bg-muted text-foreground";
  const memoPreview = renderRemittanceMemo(
    form?.remittanceMemoTemplate ?? "Reference: Invoice {number}",
    "1042",
  );
  const currentLimit = paymentLimit?.currentLimitCents ?? 2_500_000;
  const currentLimitDollars = currentLimit / 100;
  const applicationFeeBps = paymentLimit?.applicationFeeBps;
  const resolvedApplicationFeeBps = applicationFeeBps ?? 0;
  const applicationFeeCapCents = paymentLimit?.applicationFeeCapCents ?? 0;
  const exampleCardFee =
    (currentLimitDollars * STRIPE_STANDARD_US_FEES.cardPercent) / 100 +
    STRIPE_STANDARD_US_FEES.cardFixedCents / 100;
  const exampleAchFee = Math.min(
    (currentLimitDollars * STRIPE_STANDARD_US_FEES.achDebitPercent) / 100,
    STRIPE_STANDARD_US_FEES.achDebitCapCents / 100,
  );
  const exampleOverwatchFee = cappedApplicationFeeFromDollars(
    currentLimitDollars,
    resolvedApplicationFeeBps,
    applicationFeeCapCents,
  );
  const saveProfileButton = (label: string) => (
    <Button
      type="button"
      disabled={!form || saveMutation.isPending || profile?.schemaMissing}
      onClick={() => form && saveMutation.mutate(form)}
    >
      {saveMutation.isPending ? "Saving…" : label}
    </Button>
  );

  return (
    <section
      id="getting-paid"
      data-testid="getting-paid-section"
      className="scroll-mt-6 rounded-xl border border-hairline bg-card p-5 shadow-card"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
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
        <div className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${statusToneClass}`}>
          {statusPresentation.title}
        </div>
      </div>

      {profile?.schemaMissing && (
        <div className="mt-4 rounded-md border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
          The payments database migration has not been applied yet. Bank details can be entered
          after the Payments Phase 1 migrations run.
        </div>
      )}

      <Tabs defaultValue="overview" className="mt-5">
        <TabsList className="grid h-auto w-full grid-cols-2 gap-1 lg:grid-cols-4">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="online">Online payments</TabsTrigger>
          <TabsTrigger value="bank">Bank instructions</TabsTrigger>
          <TabsTrigger value="support">Support & history</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-5 space-y-4">
          <div className="grid gap-3 md:grid-cols-3">
            <div className={`rounded-lg border p-4 ${statusToneClass}`}>
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em]">
                Stripe account
              </p>
              <p className="mt-2 text-sm font-semibold">{statusPresentation.title}</p>
              <p className="mt-1 text-xs opacity-80">{accountName}</p>
            </div>
            <div className="rounded-lg border border-hairline bg-surface p-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Online limit
              </p>
              <p className="mt-2 font-mono text-lg font-semibold">
                {fmtUSDCents(currentLimit / 100)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">per card or ACH debit payment</p>
            </div>
            <div className="rounded-lg border border-hairline bg-surface p-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Large payments
              </p>
              <p className="mt-2 text-sm font-semibold">Direct to your bank</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Wire instructions stay available above the online limit.
              </p>
            </div>
          </div>

          <div className="rounded-lg border border-hairline bg-surface p-5">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <CreditCard className="h-4 w-4 text-clay" />
                  <h3 className="text-sm font-semibold">What online payments cost</h3>
                </div>
                <p className="mt-2 max-w-3xl text-xs leading-relaxed text-muted-foreground">
                  The connected company pays Stripe's processing fee. Any OverWatch application fee
                  is separate and is deducted from the same transaction. The invoice principal never
                  lands in an OverWatch bank account.
                </p>
              </div>
              <a
                href="https://stripe.com/pricing"
                target="_blank"
                rel="noreferrer"
                className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-clay hover:underline"
              >
                Stripe pricing <ExternalLink className="h-3 w-3" />
              </a>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <div className="rounded-md border border-hairline bg-card p-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  Card · Stripe
                </p>
                <p className="mt-1 font-mono text-sm font-semibold">
                  {STRIPE_STANDARD_US_FEES.cardPercent}% + {"$"}
                  {(STRIPE_STANDARD_US_FEES.cardFixedCents / 100).toFixed(2)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Standard U.S. online-card pricing
                </p>
              </div>
              <div className="rounded-md border border-hairline bg-card p-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  ACH debit · Stripe
                </p>
                <p className="mt-1 font-mono text-sm font-semibold">
                  {STRIPE_STANDARD_US_FEES.achDebitPercent}% · $
                  {(STRIPE_STANDARD_US_FEES.achDebitCapCents / 100).toFixed(0)} cap
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Standard settlement; account pricing can vary
                </p>
              </div>
              <div className="rounded-md border border-clay/25 bg-clay/5 p-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-clay">
                  OverWatch application fee
                </p>
                <p className="mt-1 font-mono text-sm font-semibold">
                  {paymentLimitQuery.isLoading
                    ? "Checking…"
                    : paymentLimitQuery.isError
                      ? "Unavailable"
                      : applicationFeeCapCents > 0
                        ? `${formatBasisPoints(resolvedApplicationFeeBps)} · $${(
                            applicationFeeCapCents / 100
                          ).toFixed(0)} cap`
                        : formatBasisPoints(resolvedApplicationFeeBps)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {paymentLimitQuery.isLoading
                    ? "Retrieving the fee used by invoice checkout."
                    : paymentLimitQuery.isError
                      ? "Refresh the page before activating online payments."
                      : resolvedApplicationFeeBps === 0
                        ? "No OverWatch transaction fee is currently configured."
                        : "Transferred to OverWatch; separate from Stripe processing."}
                </p>
              </div>
            </div>

            <div className="mt-4 rounded-md border border-hairline bg-card px-3 py-2.5 text-xs text-muted-foreground">
              At the current {fmtUSDCents(currentLimitDollars)} online limit, standard pricing is
              approximately{" "}
              <strong className="text-foreground">{fmtUSDCents(exampleAchFee)}</strong> for ACH or{" "}
              <strong className="text-foreground">{fmtUSDCents(exampleCardFee)}</strong> for a
              domestic card, plus an OverWatch fee of{" "}
              <strong className="text-foreground">
                {applicationFeeBps === undefined
                  ? "pending fee check"
                  : fmtUSDCents(exampleOverwatchFee)}
              </strong>
              . Final Stripe pricing and any dispute, failure, verification, or
              accelerated-settlement fees are controlled by Stripe.
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-[1.35fr_1fr]">
            <div className="rounded-lg border border-hairline bg-surface p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    {liveReady ? (
                      <CheckCircle2 className="h-4 w-4 text-success" />
                    ) : (
                      <ShieldCheck className="h-4 w-4 text-warning" />
                    )}
                    <h3 className="text-sm font-semibold">{statusPresentation.title}</h3>
                  </div>
                  <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
                    {statusPresentation.detail}
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={stripeStatusPending}
                  onClick={onRefreshStripeStatus}
                >
                  {stripeStatusPending ? "Checking…" : "Refresh status"}
                </Button>
              </div>

              {stripe.liveAccountId ? (
                <div className="mt-4 rounded-md border border-hairline bg-card p-3">
                  <p className="text-xs text-muted-foreground">
                    Connected business receiving client payments
                  </p>
                  <p className="mt-1 text-sm font-semibold">{accountName}</p>
                  <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                    {stripe.liveAccountId}
                  </p>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                    <div className="rounded border border-hairline bg-surface px-2.5 py-2">
                      <span className="text-muted-foreground">Card payments</span>
                      <span
                        className={`ml-2 font-semibold ${connectDetails?.chargesEnabled ? "text-success" : "text-warning"}`}
                      >
                        {connectDetails?.chargesEnabled ? "Enabled" : "Paused"}
                      </span>
                    </div>
                    <div className="rounded border border-hairline bg-surface px-2.5 py-2">
                      <span className="text-muted-foreground">Payouts</span>
                      <span
                        className={`ml-2 font-semibold ${connectDetails?.payoutsEnabled ? "text-success" : "text-warning"}`}
                      >
                        {connectDetails?.payoutsEnabled ? "Enabled" : "Paused"}
                      </span>
                    </div>
                  </div>
                  {connectDetails?.currentlyDueCount ? (
                    <p className="mt-2 text-xs font-medium text-warning">
                      {connectDetails.currentlyDueCount} Stripe requirement
                      {connectDetails.currentlyDueCount === 1 ? "" : "s"} still need information.
                    </p>
                  ) : connectDetails?.pendingVerificationCount ? (
                    <p className="mt-2 text-xs font-medium text-warning">
                      {connectDetails.pendingVerificationCount} submitted item
                      {connectDetails.pendingVerificationCount === 1 ? " is" : "s are"} under Stripe
                      review.
                    </p>
                  ) : null}
                  <p className="mt-2 text-xs text-muted-foreground">
                    If this is not the contractor business that should receive invoice money, do not
                    activate live payments.
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Clients pay this Stripe account directly. OverWatch never holds the invoice
                    principal; it receives only the configured application fee.
                  </p>
                </div>
              ) : null}

              <div className="mt-4 flex flex-wrap gap-2">
                {!liveReady ? (
                  <Button
                    type="button"
                    size="sm"
                    disabled={stripeConnectPending}
                    onClick={() => onConnectStripe("live")}
                  >
                    {stripeConnectPending
                      ? "Opening Stripe…"
                      : stripe.liveAccountId
                        ? "Continue in Stripe"
                        : "Set up live Stripe"}
                  </Button>
                ) : null}
                {liveReady && stripe.mode !== "live" ? (
                  <Button
                    type="button"
                    size="sm"
                    disabled={stripeConnectPending}
                    onClick={onActivateLiveStripe}
                  >
                    {stripeConnectPending ? "Activating…" : "Activate live payments"}
                  </Button>
                ) : null}
                {stripe.liveAccountId ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={stripeConnectPending}
                    onClick={() => onOpenStripeDashboard("live")}
                  >
                    Open Stripe in new tab <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
                  </Button>
                ) : null}
              </div>

              <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
                {STRIPE_EXPECTATION_COPY}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                Stripe may also email the connected account contact. OverWatch checks the account
                every 30 seconds while this page is open and whenever you return to it.
              </p>
            </div>

            <div className="rounded-lg border border-hairline bg-surface p-5">
              <div className="flex items-center gap-2">
                <Gauge className="h-4 w-4 text-clay" />
                <h3 className="text-sm font-semibold">Path to $100,000 payments</h3>
              </div>
              <ol className="mt-4 space-y-3 text-sm">
                <li className="flex gap-3">
                  <span className="font-mono text-xs text-clay">01</span>
                  <span>Get Stripe approval for the connected account's ACH limits.</span>
                </li>
                <li className="flex gap-3">
                  <span className="font-mono text-xs text-clay">02</span>
                  <span>Record the approved amount and Stripe case in OverWatch.</span>
                </li>
                <li className="flex gap-3">
                  <span className="font-mono text-xs text-clay">03</span>
                  <span>OverWatch verifies it, then raises this company's hard ceiling.</span>
                </li>
              </ol>
              <p className="mt-4 text-xs text-muted-foreground">
                Until both approvals are complete, larger invoices keep using direct wire
                instructions.
              </p>
            </div>
          </div>

          <p className="text-xs leading-relaxed text-muted-foreground">{subscriptionNote}</p>
        </TabsContent>

        <TabsContent value="online" className="mt-5 space-y-4">
          {stripe.mode !== "live" ? (
            <div className="flex gap-2 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              Sandbox accounts cannot receive real client payments. Live setup and activation are
              separate from the existing sandbox account.
            </div>
          ) : null}

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-lg border border-hairline bg-surface p-5">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <CreditCard className="h-4 w-4" />
                Invoice payment defaults
              </div>
              <div className="mt-4 space-y-4">
                {[
                  [
                    "getting-paid-default-direct",
                    "Direct bank transfer",
                    form?.directBank ?? true,
                    "directBank",
                  ],
                  ["getting-paid-default-card", "Card", form?.card ?? true, "card"],
                  [
                    "getting-paid-default-ach",
                    "Bank debit / ACH",
                    form?.achDebit ?? true,
                    "achDebit",
                  ],
                ].map(([id, label, checked, key]) => (
                  <div key={String(id)} className="flex items-center justify-between gap-3">
                    <Label htmlFor={String(id)} className="font-normal">
                      {String(label)}
                    </Label>
                    <Switch
                      id={String(id)}
                      checked={Boolean(checked)}
                      disabled={!form || saveMutation.isPending}
                      onCheckedChange={(next) =>
                        setForm((current) =>
                          current ? { ...current, [String(key)]: next } : current,
                        )
                      }
                    />
                  </div>
                ))}
                <div className="flex items-center justify-between gap-3 border-t border-hairline pt-4">
                  <div>
                    <Label htmlFor="getting-paid-fee-passthrough" className="font-normal">
                      Add estimated card fee
                    </Label>
                    <p className="mt-1 text-xs text-muted-foreground">
                      The contractor is responsible for confirming surcharges are permitted.
                    </p>
                  </div>
                  <Switch
                    id="getting-paid-fee-passthrough"
                    checked={form?.cardFeePassThrough ?? false}
                    disabled={!form || saveMutation.isPending}
                    onCheckedChange={(next) =>
                      setForm((current) =>
                        current ? { ...current, cardFeePassThrough: next } : current,
                      )
                    }
                  />
                </div>
                <div className="space-y-1.5 border-t border-hairline pt-4">
                  <Label htmlFor="getting-paid-threshold">Prefer direct bank above ($)</Label>
                  <Input
                    id="getting-paid-threshold"
                    value={form?.stripeThresholdDollars ?? ""}
                    inputMode="decimal"
                    disabled={!form || saveMutation.isPending}
                    onChange={(event) =>
                      setForm((current) =>
                        current
                          ? { ...current, stripeThresholdDollars: event.target.value }
                          : current,
                      )
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    This company preference can be changed per invoice, but no invoice can exceed
                    OverWatch's hard online limit.
                  </p>
                </div>
                <div className="flex justify-end">{saveProfileButton("Save payment defaults")}</div>
              </div>
            </div>

            <div className="rounded-lg border border-hairline bg-surface p-5">
              <div className="flex items-center gap-2">
                <Gauge className="h-4 w-4 text-clay" />
                <h3 className="text-sm font-semibold">Online-payment ceiling</h3>
                <span className="ml-auto font-mono text-sm font-semibold">
                  {fmtUSDCents(currentLimit / 100)}
                </span>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                This hard limit applies to one card or ACH debit payment. Stripe can enforce a lower
                account-specific limit.
              </p>
              {paymentLimit?.latestRequest &&
              ["submitted", "stripe_pending", "under_review"].includes(
                paymentLimit.latestRequest.status,
              ) ? (
                <div className="mt-4 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
                  Request for {fmtUSDCents(paymentLimit.latestRequest.requestedLimitCents / 100)} ·{" "}
                  {paymentLimit.latestRequest.status.replaceAll("_", " ")}
                </div>
              ) : (
                <Collapsible className="mt-4 rounded-md border border-hairline bg-card">
                  <CollapsibleTrigger asChild>
                    <Button type="button" variant="ghost" className="w-full justify-between px-4">
                      Request a higher payment limit <ChevronDown className="h-4 w-4" />
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="space-y-3 border-t border-hairline p-4">
                    <a
                      href="https://support.stripe.com/contact"
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs font-semibold text-clay hover:underline"
                    >
                      Start with Stripe's connected-account limit review{" "}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label htmlFor="stripe-limit-request-amount">
                          Requested single payment ($)
                        </Label>
                        <Input
                          id="stripe-limit-request-amount"
                          value={requestedLimitDollars}
                          inputMode="decimal"
                          placeholder="100000"
                          disabled={!stripe.liveAccountId || paymentLimitMutation.isPending}
                          onChange={(event) => setRequestedLimitDollars(event.target.value)}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="stripe-limit-request-reference">
                          Stripe case or approval reference
                        </Label>
                        <Input
                          id="stripe-limit-request-reference"
                          value={stripeRequestReference}
                          placeholder="Add after Stripe replies"
                          disabled={!stripe.liveAccountId || paymentLimitMutation.isPending}
                          onChange={(event) => setStripeRequestReference(event.target.value)}
                        />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="stripe-limit-request-reason">
                        Expected payment and context
                      </Label>
                      <Textarea
                        id="stripe-limit-request-reason"
                        value={limitRequestReason}
                        rows={3}
                        placeholder="Example: monthly commercial progress payments around $100,000."
                        disabled={!stripe.liveAccountId || paymentLimitMutation.isPending}
                        onChange={(event) => setLimitRequestReason(event.target.value)}
                      />
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      disabled={
                        !stripe.liveAccountId ||
                        !paymentLimit?.requestSchemaReady ||
                        paymentLimitMutation.isPending
                      }
                      onClick={() => paymentLimitMutation.mutate()}
                    >
                      {paymentLimitMutation.isPending
                        ? "Submitting…"
                        : "Submit for OverWatch review"}
                    </Button>
                  </CollapsibleContent>
                </Collapsible>
              )}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="bank" className="mt-5">
          <GettingPaidBankPanel
            form={form}
            profile={profile}
            saving={saveMutation.isPending}
            revealed={revealed}
            revealPending={revealMutation.isPending}
            memoPreview={memoPreview}
            saveButton={saveProfileButton("Save bank instructions")}
            onReveal={() => revealMutation.mutate()}
            onChange={(patch) =>
              setForm((current) => (current ? { ...current, ...patch } : current))
            }
          />
        </TabsContent>

        <TabsContent value="support" className="mt-5 space-y-4">
          <div className="rounded-lg border border-hairline bg-surface p-4">
            <div className="flex items-center gap-2 text-sm font-medium">
              <ShieldCheck className="h-4 w-4" />
              Billing contact
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Where subscription, payment, and Stripe readiness notices for this company go.
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
                  (contactForm.name === billingContactName &&
                    contactForm.email === billingContactEmail)
                }
                onClick={() => onSaveBillingContact(contactForm)}
              >
                {billingContactSaving ? "Saving…" : "Save contact"}
              </Button>
            </div>
          </div>
          <StripeReconciliationPanel />
        </TabsContent>
      </Tabs>
    </section>
  );
}
