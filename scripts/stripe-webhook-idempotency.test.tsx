// STRIPEIDEMPOTENCY1 Task 3 — a failed webhook must never look like a delivered
// one. These tests drive the REAL webhook route (handleStripeWebhook) against a
// fake Supabase and a stubbed signature verifier, asserting the load-bearing
// invariant: a stripe_webhook_events row is `processed` ONLY if its handler ran
// to completion. No failure path, and no lost DELETE, may produce a `processed`
// row.

import { describe, expect, it, vi } from "vitest";
import { classifyExistingClaim, type ExistingClaim } from "@/lib/stripe-webhook-idempotency";

// Shared, mutable handles the hoisted mock reads. Each test resets them.
const h = vi.hoisted(() => ({ event: null as unknown, db: null as unknown }));

vi.mock("@/lib/stripe.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/stripe.server")>();
  return {
    ...actual,
    // The route builds its store + handlers off the admin client; hand it the fake.
    createSupabaseAdminClient: () => h.db,
    // Signature verification is out of scope here; return the event under test.
    verifyStripeWebhookPayload: async () => h.event,
  };
});

// Imported after the mock is registered (vi.mock is hoisted above imports).
const { handleStripeWebhook } = await import("@/routes/api/stripe/webhook");

// --- Fake Supabase ---------------------------------------------------------
// Just enough of the supabase-js query builder for the webhook_events store
// and the credit_ledger handler: upsert (ON CONFLICT DO NOTHING / DO UPDATE),
// select/eq/maybeSingle/single, insert, update, delete.

type Row = Record<string, unknown>;

class FakeSupabase {
  tables: Record<string, Row[]> = {};
  missing = new Set<string>();
  failDelete = new Set<string>();
  fromCalls: Record<string, number> = {};

  from(name: string) {
    this.fromCalls[name] = (this.fromCalls[name] ?? 0) + 1;
    return new FakeQuery(this, name);
  }

  rows(name: string) {
    return (this.tables[name] ??= []);
  }
}

class FakeQuery {
  private kind: "select" | "insert" | "update" | "upsert" | "delete" = "select";
  private values: Row | Row[] = {};
  private upsertOpts: { onConflict?: string; ignoreDuplicates?: boolean } = {};
  private filters: Array<[string, unknown]> = [];
  private inFilters: Array<[string, unknown[]]> = [];
  private cardinality: "many" | "maybe" | "one" = "many";
  private returning = false;

  constructor(
    private db: FakeSupabase,
    private table: string,
  ) {}

  select(_columns?: string) {
    this.returning = true;
    return this;
  }
  insert(values: Row | Row[]) {
    this.kind = "insert";
    this.values = values;
    return this;
  }
  update(values: Row) {
    this.kind = "update";
    this.values = values;
    return this;
  }
  upsert(values: Row | Row[], options?: { onConflict?: string; ignoreDuplicates?: boolean }) {
    this.kind = "upsert";
    this.values = values;
    this.upsertOpts = options ?? {};
    return this;
  }
  delete() {
    this.kind = "delete";
    return this;
  }
  eq(column: string, value: unknown) {
    this.filters.push([column, value]);
    return this;
  }
  in(column: string, values: unknown[]) {
    this.inFilters.push([column, values]);
    return this;
  }
  maybeSingle() {
    this.cardinality = "maybe";
    return this;
  }
  single() {
    this.cardinality = "one";
    return this;
  }
  then<T>(resolve: (r: { data: unknown; error: unknown }) => T, reject?: (e: unknown) => T) {
    return this.exec().then(resolve, reject);
  }

  private matches(row: Row) {
    return (
      this.filters.every(([c, v]) => row[c] === v) &&
      this.inFilters.every(([c, values]) => values.includes(row[c]))
    );
  }

  private shape(found: Row[]) {
    if (this.cardinality === "maybe") return { data: found[0] ?? null, error: null };
    if (this.cardinality === "one")
      return found[0]
        ? { data: found[0], error: null }
        : { data: null, error: { code: "PGRST116", message: "no rows" } };
    return { data: found, error: null };
  }

  private async exec(): Promise<{ data: unknown; error: unknown }> {
    if (this.db.missing.has(this.table)) {
      return {
        data: null,
        error: { code: "42P01", message: `relation "${this.table}" does not exist` },
      };
    }
    const rows = this.db.rows(this.table);

    if (this.kind === "select") return this.shape(rows.filter((r) => this.matches(r)));

    if (this.kind === "insert") {
      const arr = Array.isArray(this.values) ? this.values : [this.values];
      for (const v of arr) rows.push({ ...v });
      return { data: this.returning ? arr.map((v) => ({ ...v })) : null, error: null };
    }

    if (this.kind === "update") {
      const found = rows.filter((r) => this.matches(r));
      for (const r of found) Object.assign(r, this.values);
      return { data: this.returning ? found.map((r) => ({ ...r })) : null, error: null };
    }

    if (this.kind === "delete") {
      if (this.db.failDelete.has(this.table))
        return { data: null, error: { code: "XX000", message: "delete failed" } };
      this.db.tables[this.table] = rows.filter((r) => !this.matches(r));
      return { data: null, error: null };
    }

    // upsert
    const valueRows = Array.isArray(this.values) ? this.values : [this.values];
    const keys = (this.upsertOpts.onConflict ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const returned: Row[] = [];
    for (const values of valueRows) {
      const existing = rows.find((r) => keys.every((k) => r[k] === values[k]));
      if (existing) {
        if (!this.upsertOpts.ignoreDuplicates) Object.assign(existing, values);
        if (!this.upsertOpts.ignoreDuplicates) returned.push({ ...existing });
        continue;
      }
      const row = { ...values };
      rows.push(row);
      returned.push({ ...row });
    }
    return { data: this.returning ? returned : null, error: null };
  }
}

// --- Helpers ---------------------------------------------------------------

function creditPackEvent(eventId: string, sessionId = "cs_test_credit", livemode = false) {
  return {
    id: eventId,
    type: "checkout.session.completed",
    livemode,
    data: {
      object: {
        id: sessionId,
        payment_status: "paid",
        metadata: {
          kind: "credit_pack",
          organization_id: "org_1",
          credits: "100",
          user_id: "user_1",
        },
      },
    },
  };
}

function invoicePaidEvent(eventId: string, sessionId = "cs_live_invoice") {
  return {
    id: eventId,
    type: "checkout.session.completed",
    livemode: true,
    data: {
      object: {
        id: sessionId,
        payment_status: "paid",
        payment_intent: "pi_live_invoice",
        amount_total: 100,
        metadata: {
          kind: "client_invoice",
          invoice_id: "invoice_1",
          project_id: "project_1",
          organization_id: "org_1",
          surcharge_cents: "0",
          overwatch_fee_amount_cents: "0",
          stripe_mode: "live",
        },
      },
    },
  };
}

function seedInvoicePaymentContext(db: FakeSupabase) {
  db.rows("billing_invoices").push({
    id: "invoice_1",
    project_id: "project_1",
    billing_application_id: null,
    invoice_number: "INV-1",
    title: "Canary",
    total_due: 1,
    paid_amount: 0,
    status: "sent",
  });
  db.rows("projects").push({
    id: "project_1",
    name: "Canary project",
    job_number: "001",
    organization_id: "org_1",
    owner_id: "user_1",
  });
  db.rows("organization_memberships").push({
    organization_id: "org_1",
    user_id: "user_1",
    role: "owner",
    status: "active",
    capabilities: {},
  });
  db.rows("profiles").push({ id: "user_1", notification_prefs: {} });
}

function post() {
  const req = new Request("https://x/api/stripe/webhook", {
    method: "POST",
    body: "{}",
    headers: { "stripe-signature": "sig_test" },
  });
  return handleStripeWebhook(req);
}

function webhookRow(db: FakeSupabase, eventId: string) {
  return db.rows("stripe_webhook_events").find((r) => r.event_id === eventId);
}

function purchaseRows(db: FakeSupabase, sessionId = "cs_test_credit") {
  return db
    .rows("credit_ledger")
    .filter((r) => r.reason === "purchase" && r.reference === sessionId);
}

function ageWebhookClaim(db: FakeSupabase, eventId: string, secondsAgo: number) {
  const row = webhookRow(db, eventId);
  if (row) row.claimed_at = new Date(Date.now() - secondsAgo * 1000).toISOString();
}

// --- Pure state machine ----------------------------------------------------

describe("classifyExistingClaim", () => {
  const opts = { nowMs: 1_000_000, staleSeconds: 300 };

  it("re-takes when the row vanished", () => {
    expect(classifyExistingClaim(null, opts)).toBe("retry_stale");
  });

  it("treats a processed row as a duplicate", () => {
    const existing: ExistingClaim = { status: "processed", claimedAtIso: "" };
    expect(classifyExistingClaim(existing, opts)).toBe("already_processed");
  });

  it("is in_flight while a fresh processing claim is held", () => {
    const claimedAtIso = new Date(opts.nowMs - 10_000).toISOString(); // 10s old, < 300
    expect(classifyExistingClaim({ status: "processing", claimedAtIso }, opts)).toBe("in_flight");
  });

  it("re-takes a stale processing claim (>= window)", () => {
    const claimedAtIso = new Date(opts.nowMs - 300_000).toISOString(); // exactly 300s
    expect(classifyExistingClaim({ status: "processing", claimedAtIso }, opts)).toBe("retry_stale");
  });

  it("re-takes rather than wedging on an unparseable timestamp", () => {
    expect(classifyExistingClaim({ status: "processing", claimedAtIso: "not-a-date" }, opts)).toBe(
      "retry_stale",
    );
  });
});

// --- Route-level invariant -------------------------------------------------

describe("handleStripeWebhook idempotency", () => {
  it("success marks the row processed; a duplicate 200s without re-invoking the handler", async () => {
    const db = new FakeSupabase();
    h.db = db;
    h.event = creditPackEvent("evt_dup");

    const first = await post();
    expect(first.status).toBe(200);
    expect(webhookRow(db, "evt_dup")?.status).toBe("processed");
    expect(webhookRow(db, "evt_dup")?.livemode).toBe(false);
    expect(purchaseRows(db)).toHaveLength(1);

    const callsAfterFirst = db.fromCalls["credit_ledger"] ?? 0;
    const second = await post();
    const body = await second.json();
    expect(second.status).toBe(200);
    expect(body.duplicate).toBe(true);
    // Handler never ran again: no new credit_ledger access, still one purchase.
    expect(db.fromCalls["credit_ledger"] ?? 0).toBe(callsAfterFirst);
    expect(purchaseRows(db)).toHaveLength(1);
  });

  it("stamps live deliveries with event.livemode", async () => {
    const db = new FakeSupabase();
    h.db = db;
    h.event = creditPackEvent("evt_live", "cs_live_credit", true);

    const response = await post();
    expect(response.status).toBe(200);
    expect(webhookRow(db, "evt_live")?.livemode).toBe(true);
  });

  it("a fresh concurrent claim returns non-2xx and does not double-invoke", async () => {
    const db = new FakeSupabase();
    h.db = db;
    h.event = creditPackEvent("evt_concurrent");
    // Another delivery is mid-flight: a fresh `processing` row already exists.
    db.rows("stripe_webhook_events").push({
      event_id: "evt_concurrent",
      event_type: "checkout.session.completed",
      status: "processing",
      claimed_at: new Date().toISOString(),
    });

    const res = await post();
    expect(res.status).toBe(409);
    // The other delivery still owns it — we neither processed nor touched it.
    expect(webhookRow(db, "evt_concurrent")?.status).toBe("processing");
    expect(purchaseRows(db)).toHaveLength(0);
  });

  it("re-processes a stale processing row", async () => {
    const db = new FakeSupabase();
    h.db = db;
    h.event = creditPackEvent("evt_stale");
    // A stale claim left behind by a dead delivery (older than the 300s window).
    db.rows("stripe_webhook_events").push({
      event_id: "evt_stale",
      event_type: "checkout.session.completed",
      status: "processing",
      claimed_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    });

    const res = await post();
    expect(res.status).toBe(200);
    expect(webhookRow(db, "evt_stale")?.status).toBe("processed");
    expect(purchaseRows(db)).toHaveLength(1);
  });

  it("a handler throw leaves the row un-processed and returns non-2xx; the retry completes it", async () => {
    const db = new FakeSupabase();
    h.db = db;
    h.event = creditPackEvent("evt_retry");
    db.missing.add("credit_ledger"); // handler throws credits_schema_not_ready (409)

    const first = await post();
    const firstBody = await first.json();
    expect(first.status).toBe(409);
    expect(firstBody.code).toBe("credits_schema_not_ready");
    // Invariant: nothing is `processed` after a failure.
    expect(db.rows("stripe_webhook_events").some((r) => r.status === "processed")).toBe(false);

    // Retry after the migration lands.
    db.missing.delete("credit_ledger");
    const second = await post();
    expect(second.status).toBe(200);
    expect(webhookRow(db, "evt_retry")?.status).toBe("processed");
    expect(purchaseRows(db)).toHaveLength(1);
  });

  it("THE PRODUCTION BUG: a lost DELETE leaves the row processing, and the retry still re-processes (never a swallowed 200)", async () => {
    const db = new FakeSupabase();
    h.db = db;
    h.event = creditPackEvent("evt_prodbug");
    db.missing.add("credit_ledger"); // first delivery's handler throws
    db.failDelete.add("stripe_webhook_events"); // the release DELETE silently fails

    const first = await post();
    expect(first.status).toBe(409);
    // The claim survives the failed release, still `processing` — exactly the
    // production state that used to be swallowed as a duplicate.
    expect(webhookRow(db, "evt_prodbug")?.status).toBe("processing");

    // Time passes past the stale window; Stripe retries.
    db.failDelete.delete("stripe_webhook_events");
    db.missing.delete("credit_ledger");
    ageWebhookClaim(db, "evt_prodbug", 10 * 60);

    const second = await post();
    const body = await second.json();
    expect(second.status).toBe(200);
    // Crucially NOT a swallowed duplicate — the work actually ran.
    expect(body.duplicate).toBeUndefined();
    expect(webhookRow(db, "evt_prodbug")?.status).toBe("processed");
    expect(purchaseRows(db)).toHaveLength(1);
  });

  it("credit-pack regression: missing ledger 409s, then grants exactly once across retries and duplicates", async () => {
    const db = new FakeSupabase();
    h.db = db;
    h.event = creditPackEvent("evt_credit_once");
    db.missing.add("credit_ledger");

    expect((await post()).status).toBe(409);

    db.missing.delete("credit_ledger");
    expect((await post()).status).toBe(200);
    expect(purchaseRows(db)).toHaveLength(1);

    // A later duplicate delivery must not grant a second pack.
    const dup = await post();
    expect((await dup.json()).duplicate).toBe(true);
    expect(purchaseRows(db)).toHaveLength(1);
  });

  it("books a paid invoice once and retries its in-app notification without double-booking money", async () => {
    const db = new FakeSupabase();
    seedInvoicePaymentContext(db);
    h.db = db;
    h.event = invoicePaidEvent("evt_invoice_paid");
    db.missing.add("notifications");

    const first = await post();
    expect(first.status).toBe(500);
    expect(db.rows("payment_ledger")).toHaveLength(1);
    expect(db.rows("billing_invoices")[0]).toMatchObject({
      paid_amount: 1,
      status: "paid",
      online_payment_status: "paid",
    });
    expect(webhookRow(db, "evt_invoice_paid")).toBeUndefined();

    db.missing.delete("notifications");
    const retry = await post();
    expect(retry.status).toBe(200);
    expect(db.rows("payment_ledger")).toHaveLength(1);
    expect(db.rows("notifications")).toHaveLength(1);
    expect(db.rows("notifications")[0]).toMatchObject({
      recipient_id: "user_1",
      type: "billing.paid",
      title: "$1.00 payment received",
      dedupe_key: "billing.paid:cs_live_invoice",
    });

    h.event = invoicePaidEvent("evt_invoice_paid_second_delivery");
    const secondDelivery = await post();
    expect(secondDelivery.status).toBe(200);
    expect(db.rows("payment_ledger")).toHaveLength(1);
    expect(db.rows("notifications")).toHaveLength(1);
  });

  it("well-formed unhandled events complete and mark processed (never 400)", async () => {
    const db = new FakeSupabase();
    h.db = db;
    h.event = { id: "evt_payout", type: "payout.paid", data: { object: { id: "po_1" } } };

    const res = await post();
    expect(res.status).toBe(200);
    expect(webhookRow(db, "evt_payout")?.status).toBe("processed");
  });
});
