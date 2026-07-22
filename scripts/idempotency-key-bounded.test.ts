import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

// The billing/invoice/change-order commands cap operation_key at 200 chars
// (billing.functions.ts: `z.string().trim().min(8).max(200)`). The client retry
// keys are built from an `intent` that can embed a full JSON.stringify of the
// draft — so the intent must key ONLY the client-side retry Map and must NEVER
// be spliced into the idempotency key itself, or a real-sized invoice blows past
// 200 and the command rejects it ("String must contain at most 200 characters").
// This regressed and broke invoice creation in prod (2026-07-22).

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("command idempotency keys stay bounded (<=200 chars)", () => {
  it("no client retry-key builder splices the (possibly-JSON) intent into the key value", () => {
    const src = read("src/routes/_authenticated/projects.$projectId.tsx");
    // Forbidden shape: `const key = \`<prefix>:${intent}:${nonce}\``
    const offenders = src.match(/const key = `[a-z-]+:\$\{intent\}:/g) ?? [];
    expect(
      offenders,
      "idempotency key must be `${prefix}:${nonce}`, never embed ${intent}",
    ).toEqual([]);
  });

  it("the three command-key builders produce bounded ${prefix}:${nonce} keys", () => {
    const src = read("src/routes/_authenticated/projects.$projectId.tsx");
    for (const prefix of ["billing-application", "invoice", "change-order"]) {
      expect(src, `${prefix} key builder`).toContain(`const key = \`${prefix}:\${nonce}\`;`);
    }
  });
});
