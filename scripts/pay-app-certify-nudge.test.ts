import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

// The billing rail's pay-app chip must not nag "ready to certify" on an
// application the builder has already billed. Live statuses are
// draft/submitted/partial/paid (not the code enum), and every one of DB3T's
// apps carried an active invoice yet still said "ready to certify" — because the
// nudge only looked at status. It must instead flag ONLY a draft with no active
// invoice, in plain English. (2026-07-22 user report.)

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(root, "src/components/project/billing/BillingWorkspace.tsx"), "utf8");

describe("pay-app rail nudge is billing-aware, not jargon", () => {
  it('no longer nags "ready to certify"', () => {
    expect(src).not.toContain("ready to certify");
  });

  it("the nudge is gated on an unbilled draft (checks for an active invoice)", () => {
    expect(src).toMatch(
      /currentApp\.status === "draft" && !getActiveInvoiceForPayApp\(currentApp\.id\)/,
    );
  });
});
