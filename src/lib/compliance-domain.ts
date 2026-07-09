// COMPLIANCE GATING domain (docs/compliance arc, module 2). Pure, deterministic
// helpers for the subcontractor payment gate: a sub can't be paid until a valid
// Certificate of Insurance is on file AND a lien waiver for the payment is
// collected — unless the project has the requirement toggled off. All dates are
// YYYY-MM-DD strings; the caller supplies "as of" so nothing reads the clock
// here (testable + no drift).

export type InsuranceStatus = "valid" | "expiring_soon" | "expired" | "unverified" | "missing";

export interface InsuranceCertLike {
  verified: boolean;
  effective_date: string | null;
  expiry_date: string | null;
}

// Whole days from `from` to `to` (both YYYY-MM-DD). Negative if `to` is earlier.
// UTC-noon anchor avoids DST edge cases; string parse avoids new Date() drift.
function daysBetween(from: string, to: string): number {
  const parse = (d: string) => {
    const [y, m, day] = d.split("-").map(Number);
    return Date.UTC(y, (m || 1) - 1, day || 1, 12);
  };
  return Math.round((parse(to) - parse(from)) / 86_400_000);
}

// One certificate's status as of a date. Not-yet-effective and past-expiry both
// read as not-in-force; a cert that's present but never marked valid is
// "unverified" (on file, not checked — does NOT clear the gate).
export function insuranceStatus(
  cert: InsuranceCertLike | null | undefined,
  asOf: string,
  soonDays = 30,
): InsuranceStatus {
  if (!cert) return "missing";
  if (!cert.verified) return "unverified";
  if (cert.effective_date && cert.effective_date > asOf) return "expired";
  if (cert.expiry_date && cert.expiry_date < asOf) return "expired";
  if (cert.expiry_date && daysBetween(asOf, cert.expiry_date) <= soonDays) {
    return "expiring_soon";
  }
  return "valid";
}

const STATUS_RANK: Record<InsuranceStatus, number> = {
  valid: 4,
  expiring_soon: 3,
  expired: 2,
  unverified: 1,
  missing: 0,
};

// A sub can carry several certs over the job (renewals) — its standing is the
// BEST one as of the date.
export function subcontractInsuranceStatus(
  certs: readonly InsuranceCertLike[],
  asOf: string,
  soonDays = 30,
): InsuranceStatus {
  let best: InsuranceStatus = "missing";
  for (const cert of certs) {
    const s = insuranceStatus(cert, asOf, soonDays);
    if (STATUS_RANK[s] > STATUS_RANK[best]) best = s;
  }
  return best;
}

// Insurance clears the gate only when actually in force. "Expiring soon" still
// clears — it's a heads-up, not a block.
export function insuranceClears(status: InsuranceStatus): boolean {
  return status === "valid" || status === "expiring_soon";
}

export function insuranceBlockerMessage(status: InsuranceStatus): string {
  switch (status) {
    case "missing":
      return "No certificate of insurance on file.";
    case "unverified":
      return "The certificate of insurance is on file but hasn't been verified.";
    case "expired":
      return "The certificate of insurance is expired (or not yet in effect).";
    default:
      return "";
  }
}

export interface PaymentGateInput {
  // The project's require_compliance_gating toggle (default true).
  gatingEnabled: boolean;
  // The sub's best insurance status as of the payment date.
  insuranceStatus: InsuranceStatus;
  // Whether a signed lien waiver covering this payment is on file.
  hasCoveringWaiver: boolean;
}

export interface PaymentGateResult {
  allowed: boolean;
  blockers: string[];
}

// Can this subcontractor payment be recorded? Gating off → always allowed. On →
// blocked unless insurance is in force AND a covering lien waiver is on file.
// Returns every blocker so the UI/server can show the full reason.
export function canPaySubcontract(input: PaymentGateInput): PaymentGateResult {
  if (!input.gatingEnabled) return { allowed: true, blockers: [] };
  const blockers: string[] = [];
  if (!insuranceClears(input.insuranceStatus)) {
    blockers.push(insuranceBlockerMessage(input.insuranceStatus));
  }
  if (!input.hasCoveringWaiver) {
    blockers.push("A signed lien waiver for this payment is required.");
  }
  return { allowed: blockers.length === 0, blockers };
}
