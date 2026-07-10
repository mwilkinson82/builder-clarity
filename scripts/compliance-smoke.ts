// Compliance gating smoke (docs/compliance arc, module 2). Node-runnable via
// `node --experimental-strip-types`. Proves the payment gate: no pay without a
// valid COI + a lien waiver, unless the project toggles the requirement off.
import assert from "node:assert/strict";
import {
  canApproveSubPayment,
  canPaySubcontract,
  insuranceStatus,
  subcontractInsuranceStatus,
} from "../src/lib/compliance-domain.ts";

const AS_OF = "2026-07-09";

// ── insuranceStatus: date-derived, so a lapse re-blocks automatically ──
assert.equal(insuranceStatus(null, AS_OF), "missing", "no cert → missing");
assert.equal(
  insuranceStatus(
    { verified: false, effective_date: "2026-01-01", expiry_date: "2027-01-01" },
    AS_OF,
  ),
  "unverified",
  "on file but not verified → unverified (does NOT clear)",
);
assert.equal(
  insuranceStatus(
    { verified: true, effective_date: "2026-01-01", expiry_date: "2026-06-30" },
    AS_OF,
  ),
  "expired",
  "verified but past expiry → expired",
);
assert.equal(
  insuranceStatus(
    { verified: true, effective_date: "2026-08-01", expiry_date: "2027-08-01" },
    AS_OF,
  ),
  "expired",
  "not yet in effect → treated as not in force",
);
assert.equal(
  insuranceStatus(
    { verified: true, effective_date: "2026-01-01", expiry_date: "2026-07-25" },
    AS_OF,
  ),
  "expiring_soon",
  "within 30 days of expiry → expiring_soon (still clears)",
);
assert.equal(
  insuranceStatus(
    { verified: true, effective_date: "2026-01-01", expiry_date: "2027-01-01" },
    AS_OF,
  ),
  "valid",
  "verified + in force + not near expiry → valid",
);

// Best of several renewals wins.
assert.equal(
  subcontractInsuranceStatus(
    [
      { verified: true, effective_date: "2025-01-01", expiry_date: "2026-01-01" }, // expired
      { verified: true, effective_date: "2026-01-01", expiry_date: "2027-01-01" }, // valid
    ],
    AS_OF,
  ),
  "valid",
  "the current renewal governs, not the lapsed one",
);

// ── canPaySubcontract: the gate ──
// Gating OFF → always allowed, no matter what.
assert.deepEqual(
  canPaySubcontract({ gatingEnabled: false, insuranceStatus: "missing", hasCoveringWaiver: false }),
  { allowed: true, blockers: [] },
  "toggle off → the project self-manages; never blocked",
);

// Gating ON, everything satisfied → allowed.
assert.deepEqual(
  canPaySubcontract({ gatingEnabled: true, insuranceStatus: "valid", hasCoveringWaiver: true }),
  { allowed: true, blockers: [] },
  "valid COI + waiver → paid",
);

// Gating ON, missing waiver → blocked with that reason.
{
  const r = canPaySubcontract({
    gatingEnabled: true,
    insuranceStatus: "valid",
    hasCoveringWaiver: false,
  });
  assert.equal(r.allowed, false, "no waiver → blocked");
  assert.equal(r.blockers.length, 1, "one blocker");
  assert.match(r.blockers[0], /lien waiver/i, "blocker names the waiver");
}

// Gating ON, expired insurance + no waiver → blocked with BOTH reasons.
{
  const r = canPaySubcontract({
    gatingEnabled: true,
    insuranceStatus: "expired",
    hasCoveringWaiver: false,
  });
  assert.equal(r.allowed, false, "expired + no waiver → blocked");
  assert.equal(r.blockers.length, 2, "both blockers surfaced");
  assert.match(r.blockers.join(" "), /expired/i, "insurance blocker present");
  assert.match(r.blockers.join(" "), /lien waiver/i, "waiver blocker present");
}

// Expiring-soon insurance still clears (warning, not block).
assert.equal(
  canPaySubcontract({
    gatingEnabled: true,
    insuranceStatus: "expiring_soon",
    hasCoveringWaiver: true,
  }).allowed,
  true,
  "expiring-soon is a heads-up, not a block",
);

// ── Per-payment APPROVAL gate (field request 2026-07-10): a pay app can't be
//    approved for payment until a lien waiver is attached to that payment
//    record and insurance is verified. Same toggle-off escape hatch. ──
assert.deepEqual(
  canApproveSubPayment({
    gatingEnabled: false,
    insuranceStatus: "missing",
    hasAttachedWaiver: false,
  }),
  { allowed: true, blockers: [] },
  "toggle off → approval never blocked",
);
assert.deepEqual(
  canApproveSubPayment({ gatingEnabled: true, insuranceStatus: "valid", hasAttachedWaiver: true }),
  { allowed: true, blockers: [] },
  "valid COI + attached waiver → approvable",
);
{
  const r = canApproveSubPayment({
    gatingEnabled: true,
    insuranceStatus: "valid",
    hasAttachedWaiver: false,
  });
  assert.equal(r.allowed, false, "no waiver attached to the pay app → approval blocked");
  assert.equal(r.blockers.length, 1, "one blocker");
  assert.match(
    r.blockers[0],
    /attached to this pay app/i,
    "blocker says the waiver isn't attached",
  );
}
{
  const r = canApproveSubPayment({
    gatingEnabled: true,
    insuranceStatus: "unverified",
    hasAttachedWaiver: true,
  });
  assert.equal(r.allowed, false, "unverified COI → approval blocked even with a waiver");
  assert.match(r.blockers.join(" "), /hasn't been verified/i, "blocker names verification");
}
{
  const r = canApproveSubPayment({
    gatingEnabled: true,
    insuranceStatus: "missing",
    hasAttachedWaiver: false,
  });
  assert.equal(r.blockers.length, 2, "both approval blockers surfaced together");
}
assert.equal(
  canApproveSubPayment({
    gatingEnabled: true,
    insuranceStatus: "expiring_soon",
    hasAttachedWaiver: true,
  }).allowed,
  true,
  "expiring-soon still clears approval — heads-up, not a block",
);

console.log("compliance smoke: all assertions passed");
