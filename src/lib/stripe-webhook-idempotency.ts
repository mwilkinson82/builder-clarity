// STRIPEIDEMPOTENCY1: webhook idempotency that records OUTCOME, not sighting.
//
// The whole point: a row in stripe_webhook_events may only be `processed` if
// its handler ran to completion. No failure path -- and no lost DELETE -- may
// ever produce a `processed` row. A row left `processing` after a failure is
// re-taken by the next Stripe retry instead of being swallowed as a duplicate.
//
// The DB-touching decisions live behind a small WebhookEventStore port so the
// state machine (classifyExistingClaim / claimWebhookEvent) is unit-testable
// with a stub store and a fixed clock.

export const DEFAULT_WEBHOOK_STALE_SECONDS = 300;

/** Outcome of trying to claim an event for processing. */
export type WebhookClaim =
  // Brand-new event id -- we own it, process it, then mark `processed`.
  | "fresh"
  // A `processing` row was stale (or vanished) -- we re-took it, process it.
  | "retry_stale"
  // Already `processed` -- a true duplicate delivery. Return 200 {duplicate}.
  | "already_processed"
  // Another delivery is processing this same id right now and its claim is
  // still fresh. It may yet fail, so we must NOT 200. Return non-2xx; Stripe
  // retries shortly.
  | "in_flight"
  // The table does not exist yet (pre-migration). Process without the guard,
  // exactly as the route behaved before this phase.
  | "no_store";

export type ExistingClaim = { status: string; claimedAtIso: string } | null;

/**
 * The persistence a claim needs. Every method maps to one SQL statement.
 * `insertClaim` is INSERT ... ON CONFLICT DO NOTHING RETURNING event_id, so it
 * can report whether we won the row ("inserted") or one already existed
 * ("conflict"), and surfaces the pre-migration table-missing case ("no_store").
 */
export interface WebhookEventStore {
  insertClaim(
    eventId: string,
    eventType: string,
    claimedAtIso: string,
  ): Promise<"inserted" | "conflict" | "no_store">;
  getExisting(eventId: string): Promise<ExistingClaim>;
  /** Re-establish a `processing` claim (stale re-take or vanished row). */
  retake(eventId: string, eventType: string, claimedAtIso: string): Promise<void>;
  /** The ONLY writer of `processed`. Called only after the handler succeeds. */
  markProcessed(eventId: string, processedAtIso: string): Promise<void>;
  /** Best-effort DELETE on failure. No longer load-bearing: if it fails, the
   * row stays `processing` and the next retry re-processes. */
  release(eventId: string): Promise<void>;
}

/**
 * Given the existing row for an id we failed to insert, decide what to do.
 * Pure -- the clock and stale window are injected.
 */
export function classifyExistingClaim(
  existing: ExistingClaim,
  opts: { nowMs: number; staleSeconds: number },
): "already_processed" | "retry_stale" | "in_flight" {
  // The row vanished between our conflicting insert and this read -- a
  // concurrent failure released it. Re-take rather than get stuck.
  if (!existing) return "retry_stale";
  if (existing.status === "processed") return "already_processed";

  // status === "processing": stale claims are re-taken, fresh ones are a
  // genuinely concurrent delivery still in flight.
  const claimedMs = Date.parse(existing.claimedAtIso);
  if (!Number.isFinite(claimedMs)) return "retry_stale";
  const ageSeconds = (opts.nowMs - claimedMs) / 1000;
  return ageSeconds >= opts.staleSeconds ? "retry_stale" : "in_flight";
}

/**
 * Claim an event for processing. Returns the WebhookClaim the route acts on.
 * `fresh`, `retry_stale`, and `no_store` mean "process it"; the caller marks
 * the row `processed` via the store only after the handler succeeds.
 */
export async function claimWebhookEvent(
  store: WebhookEventStore,
  eventId: string,
  eventType: string,
  opts: { nowMs: number; staleSeconds: number },
): Promise<WebhookClaim> {
  const nowIso = new Date(opts.nowMs).toISOString();
  const inserted = await store.insertClaim(eventId, eventType, nowIso);
  if (inserted === "no_store") return "no_store";
  if (inserted === "inserted") return "fresh";

  const decision = classifyExistingClaim(await store.getExisting(eventId), opts);
  if (decision === "retry_stale") {
    await store.retake(eventId, eventType, nowIso);
    return "retry_stale";
  }
  return decision;
}

// --- Supabase-backed store -------------------------------------------------

type StoreQueryError = { code?: string; details?: string; hint?: string; message: string };
type StoreQueryResult<T = Record<string, unknown>> = {
  data: T | null;
  error: StoreQueryError | null;
};
type StoreQuery = PromiseLike<StoreQueryResult> & {
  delete(): StoreQuery;
  eq(column: string, value: unknown): StoreQuery;
  maybeSingle(): StoreQuery;
  select(columns?: string): StoreQuery;
  update(values: unknown): StoreQuery;
  upsert(
    values: unknown,
    options?: { onConflict?: string; ignoreDuplicates?: boolean },
  ): StoreQuery;
};

/** Table-missing (pre-migration) so the route can process without the guard. */
function isMissingWebhookEventsRelation(error: StoreQueryError | null) {
  const message = (error?.message ?? "").toLowerCase();
  return (
    error?.code === "42P01" ||
    error?.code === "PGRST205" ||
    message.includes("does not exist") ||
    message.includes("could not find the table")
  );
}

/**
 * Deploy-ordering guard: Lovable ships code from `main` immediately, but the
 * status/claimed_at columns land later when the desk applies the migration. In
 * that window the table exists WITHOUT the new columns, so writing them errors
 * on the column, not the relation. Treat that exactly like a missing table --
 * fall back to processing without the guard (handlers stay individually
 * idempotent) rather than 500 on every event.
 */
function isMissingProcessingStateColumn(error: StoreQueryError | null) {
  const text = `${error?.message ?? ""} ${error?.details ?? ""} ${error?.hint ?? ""}`.toLowerCase();
  const looksLikeMissingColumn =
    error?.code === "PGRST204" ||
    error?.code === "42703" ||
    text.includes("does not exist") ||
    text.includes("could not find");
  return looksLikeMissingColumn && (text.includes("status") || text.includes("claimed_at"));
}

/** Builds the real store from a Supabase admin client. */
export function createSupabaseWebhookEventStore(admin: unknown): WebhookEventStore {
  const table = () =>
    (admin as { from(relation: string): StoreQuery }).from("stripe_webhook_events");
  return {
    async insertClaim(eventId, eventType, claimedAtIso) {
      // INSERT ... ON CONFLICT DO NOTHING RETURNING event_id. The .select()
      // returns the inserted row only when we actually won the insert; a
      // conflict yields zero rows and no error.
      const { data, error } = await table()
        .upsert(
          {
            event_id: eventId,
            event_type: eventType,
            status: "processing",
            claimed_at: claimedAtIso,
          },
          { onConflict: "event_id", ignoreDuplicates: true },
        )
        .select("event_id");
      if (error) {
        if (isMissingWebhookEventsRelation(error) || isMissingProcessingStateColumn(error)) {
          return "no_store";
        }
        throw new Error(error.message);
      }
      const rows = Array.isArray(data) ? data : data ? [data] : [];
      return rows.length > 0 ? "inserted" : "conflict";
    },
    async getExisting(eventId) {
      const { data, error } = await table()
        .select("status,claimed_at")
        .eq("event_id", eventId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return null;
      const row = data as { status?: string; claimed_at?: string };
      return { status: row.status ?? "processing", claimedAtIso: row.claimed_at ?? "" };
    },
    async retake(eventId, eventType, claimedAtIso) {
      // Upsert (DO UPDATE) so a row always exists for markProcessed to flip --
      // covers both the stale-row and vanished-row cases.
      const { error } = await table().upsert(
        {
          event_id: eventId,
          event_type: eventType,
          status: "processing",
          claimed_at: claimedAtIso,
        },
        { onConflict: "event_id" },
      );
      if (error && !isMissingWebhookEventsRelation(error)) throw new Error(error.message);
    },
    async markProcessed(eventId, processedAtIso) {
      // The one and only writer of `processed`.
      const { error } = await table()
        .update({ status: "processed", processed_at: processedAtIso })
        .eq("event_id", eventId);
      if (error && !isMissingWebhookEventsRelation(error)) throw new Error(error.message);
    },
    async release(eventId) {
      // Best-effort. A failed delete only means the row stays `processing`,
      // which the next retry re-takes -- that is the whole point of the design,
      // so a failure here is warned, never thrown.
      try {
        const { error } = await table().delete().eq("event_id", eventId);
        if (error) {
          console.warn("[Stripe webhook] release failed; row stays processing", error.message);
        }
      } catch (err) {
        console.warn("[Stripe webhook] release threw; row stays processing", err);
      }
    },
  };
}
