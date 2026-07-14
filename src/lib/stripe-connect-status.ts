export type StripeConnectReadiness =
  "not_started" | "action_required" | "under_review" | "restricted" | "ready";

export type StripeConnectAccountSnapshot = {
  id?: string;
  email?: string | null;
  charges_enabled?: boolean;
  payouts_enabled?: boolean;
  details_submitted?: boolean;
  business_profile?: { name?: string | null } | null;
  settings?: { dashboard?: { display_name?: string | null } | null } | null;
  capabilities?: Record<string, string | null | undefined> | null;
  requirements?: {
    currently_due?: string[] | null;
    eventually_due?: string[] | null;
    past_due?: string[] | null;
    pending_verification?: string[] | null;
    disabled_reason?: string | null;
  } | null;
};

export type StripeConnectDetails = {
  accountId: string;
  businessName: string;
  readiness: StripeConnectReadiness;
  status: "not_connected" | "pending" | "restricted" | "active";
  ready: boolean;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  currentlyDueCount: number;
  eventuallyDueCount: number;
  pastDueCount: number;
  pendingVerificationCount: number;
  disabledReason: string;
  cardPaymentsStatus: string;
  transfersStatus: string;
  achPaymentsStatus: string;
};

const compactCount = (values: string[] | null | undefined) => values?.filter(Boolean).length ?? 0;

export function stripeConnectDetails(account: StripeConnectAccountSnapshot): StripeConnectDetails {
  const requirements = account.requirements;
  const currentlyDueCount = compactCount(requirements?.currently_due);
  const eventuallyDueCount = compactCount(requirements?.eventually_due);
  const pastDueCount = compactCount(requirements?.past_due);
  const pendingVerificationCount = compactCount(requirements?.pending_verification);
  const disabledReason = requirements?.disabled_reason?.trim() ?? "";
  const chargesEnabled = Boolean(account.charges_enabled);
  const payoutsEnabled = Boolean(account.payouts_enabled);
  const detailsSubmitted = Boolean(account.details_submitted);
  const ready = chargesEnabled && payoutsEnabled && detailsSubmitted;

  let readiness: StripeConnectReadiness;
  if (ready) readiness = "ready";
  else if (disabledReason || pastDueCount > 0) readiness = "restricted";
  else if (currentlyDueCount > 0 || !detailsSubmitted) readiness = "action_required";
  else if (pendingVerificationCount > 0 || detailsSubmitted) readiness = "under_review";
  else readiness = "not_started";

  const status = ready
    ? "active"
    : readiness === "restricted"
      ? "restricted"
      : account.id
        ? "pending"
        : "not_connected";

  return {
    accountId: account.id ?? "",
    businessName:
      account.settings?.dashboard?.display_name?.trim() ||
      account.business_profile?.name?.trim() ||
      account.email?.trim() ||
      "Stripe connected account",
    readiness,
    status,
    ready,
    chargesEnabled,
    payoutsEnabled,
    detailsSubmitted,
    currentlyDueCount,
    eventuallyDueCount,
    pastDueCount,
    pendingVerificationCount,
    disabledReason,
    cardPaymentsStatus: account.capabilities?.card_payments ?? "inactive",
    transfersStatus: account.capabilities?.transfers ?? "inactive",
    achPaymentsStatus: account.capabilities?.us_bank_account_ach_payments ?? "inactive",
  };
}
