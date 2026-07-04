// AI-assisted count scan server functions (AITAKEOFF1 Tasks 0/1).
// The model only finds symbol locations; nothing here ever creates takeoff
// records from model output — proposals go back to the client for human
// review. Credits are charged up front and refunded automatically when an
// operation fails (compensating credit_ledger entry).

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  AI_COUNT_SCAN_CREDITS_PER_SHEET,
  computeApiCostCents,
  creditBalance,
  DEFAULT_MAX_SHEETS_PER_SCAN,
  quoteScanCredits,
  refundEntryForFailedScan,
} from "@/lib/credits/credits-domain";
import {
  buildScanInstruction,
  dedupeCandidates,
  excludeNearExistingPoints,
  parseTileCandidates,
  tileCandidateToSheet,
  type AiCountCandidate,
} from "@/lib/ai-takeoff/ai-takeoff-domain";

type DynamicSupabaseError = { code?: string; message: string };
type DynamicSupabaseResult<T = unknown> = { data: T | null; error: DynamicSupabaseError | null };
type DynamicSupabaseQuery = PromiseLike<DynamicSupabaseResult> & {
  select(columns?: string): DynamicSupabaseQuery;
  insert(values: unknown): DynamicSupabaseQuery;
  update(values: unknown): DynamicSupabaseQuery;
  eq(column: string, value: unknown): DynamicSupabaseQuery;
  in(column: string, values: readonly string[]): DynamicSupabaseQuery;
  single(): Promise<DynamicSupabaseResult>;
  maybeSingle(): Promise<DynamicSupabaseResult>;
};

const dynamicTable = (supabase: unknown, relation: string) =>
  (supabase as { from(table: string): DynamicSupabaseQuery }).from(relation);

const str = (value: unknown, fallback = "") => (value == null ? fallback : String(value));
const num = (value: unknown, fallback = 0) => {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
};

function isMissingCreditsSchema(error: DynamicSupabaseError | null | undefined) {
  const message = error?.message?.toLowerCase() ?? "";
  return (
    error?.code === "42P01" ||
    error?.code === "PGRST205" ||
    ((message.includes("does not exist") || message.includes("schema cache")) &&
      (message.includes("credit_ledger") || message.includes("ai_operations")))
  );
}

const CREDITS_SCHEMA_PENDING_MESSAGE =
  "AI credits are still being set up for this workspace. Try again after the latest database migration is applied.";

export interface AiOperationRow {
  id: string;
  organization_id: string;
  created_by: string | null;
  operation_type: string;
  estimate_id: string | null;
  sheet_ids: string[];
  sheets_completed: number;
  model_used: string;
  input_tokens: number;
  output_tokens: number;
  api_cost_cents: number;
  credits_charged: number;
  status: "pending" | "succeeded" | "failed";
  error: string;
  created_at: string;
  updated_at: string;
}

const normalizeOperation = (row: Record<string, unknown>): AiOperationRow => ({
  id: str(row.id),
  organization_id: str(row.organization_id),
  created_by: (row.created_by as string | null) ?? null,
  operation_type: str(row.operation_type, "ai_count_scan"),
  estimate_id: (row.estimate_id as string | null) ?? null,
  sheet_ids: Array.isArray(row.sheet_ids) ? row.sheet_ids.map((id) => str(id)) : [],
  sheets_completed: Math.max(0, Math.round(num(row.sheets_completed))),
  model_used: str(row.model_used),
  input_tokens: Math.max(0, Math.round(num(row.input_tokens))),
  output_tokens: Math.max(0, Math.round(num(row.output_tokens))),
  api_cost_cents: Math.max(0, Math.round(num(row.api_cost_cents))),
  credits_charged: Math.max(0, Math.round(num(row.credits_charged))),
  status: (str(row.status, "pending") as AiOperationRow["status"]) || "pending",
  error: str(row.error),
  created_at: str(row.created_at),
  updated_at: str(row.updated_at),
});

function maxSheetsPerScan(): number {
  const raw = Number(process.env.AI_SCAN_MAX_SHEETS);
  return Number.isInteger(raw) && raw > 0 ? raw : DEFAULT_MAX_SHEETS_PER_SCAN;
}

async function loadOwnedPendingOperation(
  admin: unknown,
  operationId: string,
  userId: string,
): Promise<AiOperationRow> {
  const { data, error } = await dynamicTable(admin, "ai_operations")
    .select("*")
    .eq("id", operationId)
    .maybeSingle();
  if (error) {
    if (isMissingCreditsSchema(error)) throw new Error(CREDITS_SCHEMA_PENDING_MESSAGE);
    throw new Error(error.message);
  }
  if (!data) throw new Error("This AI scan was not found.");
  const operation = normalizeOperation(data as Record<string, unknown>);
  if (operation.created_by !== userId) {
    throw new Error("This AI scan belongs to another user.");
  }
  if (operation.status !== "pending") {
    throw new Error("This AI scan already finished.");
  }
  return operation;
}

/**
 * Refund the unconsumed part of a failed scan (compensating ledger entry).
 * Idempotent per operation: the caller only invokes it on the pending →
 * failed transition.
 */
async function refundFailedOperation(admin: unknown, operation: AiOperationRow) {
  const refund = refundEntryForFailedScan({
    operationId: operation.id,
    creditsCharged: operation.credits_charged,
    sheetsCompleted: operation.sheets_completed,
  });
  if (!refund) return;
  const { error } = await dynamicTable(admin, "credit_ledger").insert({
    organization_id: operation.organization_id,
    delta: refund.delta,
    reason: refund.reason,
    reference: refund.reference,
    created_by: operation.created_by,
  });
  if (error && !isMissingCreditsSchema(error)) throw new Error(error.message);
}

async function markOperationFailed(admin: unknown, operation: AiOperationRow, message: string) {
  // The refund only fires when THIS call performs the pending → failed
  // transition — a racing failure path that lost the update never
  // double-refunds.
  const { data: transitioned, error } = (await dynamicTable(admin, "ai_operations")
    .update({
      status: "failed",
      error: message.slice(0, 2000),
      updated_at: new Date().toISOString(),
    })
    .eq("id", operation.id)
    .eq("status", "pending")
    .select("id")) as DynamicSupabaseResult<Array<{ id: string }>>;
  if (error && !isMissingCreditsSchema(error)) throw new Error(error.message);
  if (!transitioned || transitioned.length === 0) return;
  await refundFailedOperation(admin, operation);
}

const beginScanInput = z.object({
  estimate_id: z.string().uuid(),
  sheet_ids: z.array(z.string().uuid()).min(1).max(200),
});

/**
 * Pre-checks the credit balance, charges 1 credit per sheet up front, and
 * opens the durable ai_operations record. Fails closed: no charge without an
 * operation row, no scan without a charge.
 */
export const beginAiCountScan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof beginScanInput>) => beginScanInput.parse(input))
  .handler(async ({ data, context }) => {
    const { isAiAssistConfigured, resolveConfiguredAiModel } =
      await import("@/lib/ai-takeoff/anthropic.server");
    if (!isAiAssistConfigured()) {
      throw new Error(
        "AI assist is not configured. Add ANTHROPIC_API_KEY to the server environment.",
      );
    }

    const cap = maxSheetsPerScan();
    const sheetIds = [...new Set(data.sheet_ids)];
    if (sheetIds.length > cap) {
      throw new Error(`AI scans are capped at ${cap} sheets at a time. Pick fewer sheets.`);
    }

    // The user-scoped client proves estimate access through RLS.
    const { data: estimate, error: estimateError } = await dynamicTable(
      context.supabase,
      "estimates",
    )
      .select("id,organization_id")
      .eq("id", data.estimate_id)
      .maybeSingle();
    if (estimateError) throw new Error(estimateError.message);
    if (!estimate) throw new Error("Estimate was not found.");
    const organizationId = str((estimate as Record<string, unknown>).organization_id);

    // Every requested sheet must belong to this estimate.
    const sheetsResult = (await dynamicTable(context.supabase, "estimate_plan_sheets")
      .select("id")
      .eq("estimate_id", data.estimate_id)
      .in("id", sheetIds)) as DynamicSupabaseResult<Array<{ id: string }>>;
    if (sheetsResult.error) throw new Error(sheetsResult.error.message);
    if ((sheetsResult.data?.length ?? 0) !== sheetIds.length) {
      throw new Error("One of the selected sheets does not belong to this estimate.");
    }

    const quote = quoteScanCredits(sheetIds.length);

    // Balance pre-check with the user's own read access (RLS members-read).
    const ledgerResult = (await dynamicTable(context.supabase, "credit_ledger")
      .select("delta")
      .eq("organization_id", organizationId)) as DynamicSupabaseResult<Array<{ delta: number }>>;
    if (ledgerResult.error) {
      if (isMissingCreditsSchema(ledgerResult.error)) {
        throw new Error(CREDITS_SCHEMA_PENDING_MESSAGE);
      }
      throw new Error(ledgerResult.error.message);
    }
    const balance = creditBalance(ledgerResult.data ?? []);
    if (balance < quote) {
      throw new Error(
        `This scan needs ${quote} credit${quote === 1 ? "" : "s"} and your company has ${balance}. Buy a credit pack to continue.`,
      );
    }

    const model = resolveConfiguredAiModel();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: operationRow, error: operationError } = await dynamicTable(
      supabaseAdmin,
      "ai_operations",
    )
      .insert({
        organization_id: organizationId,
        created_by: context.userId,
        operation_type: "ai_count_scan",
        estimate_id: data.estimate_id,
        sheet_ids: sheetIds,
        model_used: model,
        credits_charged: quote,
        status: "pending",
      })
      .select("*")
      .single();
    if (operationError || !operationRow) {
      if (isMissingCreditsSchema(operationError)) throw new Error(CREDITS_SCHEMA_PENDING_MESSAGE);
      throw new Error(operationError?.message ?? "The AI scan could not start.");
    }
    const operation = normalizeOperation(operationRow as Record<string, unknown>);

    const { error: spendError } = await dynamicTable(supabaseAdmin, "credit_ledger").insert({
      organization_id: organizationId,
      delta: -quote,
      reason: "ai_count_scan",
      reference: operation.id,
      created_by: context.userId,
    });
    if (spendError) {
      // No charge means no scan: close the operation instead of running free.
      await dynamicTable(supabaseAdmin, "ai_operations")
        .update({
          status: "failed",
          error: `Credit charge failed: ${spendError.message}`.slice(0, 2000),
          updated_at: new Date().toISOString(),
        })
        .eq("id", operation.id);
      throw new Error("Credits could not be charged for this scan. Nothing was scanned.");
    }

    return {
      operationId: operation.id,
      creditsCharged: quote,
      model,
      maxSheets: cap,
    };
  });

const tileScanInput = z.object({
  operation_id: z.string().uuid(),
  sheet_id: z.string().uuid(),
  // Detection raster dimensions of the whole sheet, in pixels.
  sheet_width_px: z.number().int().min(1).max(20000),
  sheet_height_px: z.number().int().min(1).max(20000),
  exemplar: z.object({
    label: z.string().max(240).default(""),
    media_type: z.enum(["image/png", "image/webp", "image/jpeg"]),
    base64: z.string().min(1).max(1_500_000),
  }),
  tile: z.object({
    index: z.number().int().min(0).max(500),
    left: z.number().int().min(0).max(20000),
    top: z.number().int().min(0).max(20000),
    width: z.number().int().min(1).max(4000),
    height: z.number().int().min(1).max(4000),
    media_type: z.enum(["image/png", "image/webp", "image/jpeg"]),
    base64: z.string().min(1).max(6_000_000),
  }),
  is_last_tile_of_sheet: z.boolean(),
  // Normalized sheet coordinates of already-counted points on this sheet, so
  // the exemplar's own symbols never come back as proposals.
  existing_points: z
    .array(z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }))
    .max(20000)
    .default([]),
});

/**
 * Scan one rendered tile of one sheet. The client iterates tiles and sheets
 * sequentially; token usage and API cost accumulate on the operation row.
 * A model failure marks the operation failed and refunds unscanned sheets.
 */
export const scanSheetTileForAiCounts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof tileScanInput>) => tileScanInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const operation = await loadOwnedPendingOperation(
      supabaseAdmin,
      data.operation_id,
      context.userId,
    );
    if (!operation.sheet_ids.includes(data.sheet_id)) {
      throw new Error("That sheet is not part of this AI scan.");
    }

    const { callAnthropicVision } = await import("@/lib/ai-takeoff/anthropic.server");

    let candidates: AiCountCandidate[] = [];
    let usage = { inputTokens: 0, outputTokens: 0 };
    try {
      const result = await callAnthropicVision({
        model: operation.model_used,
        instruction: buildScanInstruction({
          label: data.exemplar.label,
          tileWidthPx: data.tile.width,
          tileHeightPx: data.tile.height,
        }),
        images: [
          { mediaType: data.exemplar.media_type, base64: data.exemplar.base64 },
          { mediaType: data.tile.media_type, base64: data.tile.base64 },
        ],
      });
      usage = { inputTokens: result.inputTokens, outputTokens: result.outputTokens };
      const tileCandidates = parseTileCandidates(result.text, data.tile.width, data.tile.height);
      candidates = excludeNearExistingPoints(
        dedupeCandidates(
          tileCandidates.map((candidate) =>
            tileCandidateToSheet(candidate, data.tile, data.sheet_width_px, data.sheet_height_px),
          ),
        ),
        data.existing_points,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "The AI model call failed.";
      await markOperationFailed(supabaseAdmin, operation, message);
      throw new Error(`${message} Unused credits were refunded — the scan can be started again.`);
    }

    const inputTokens = operation.input_tokens + usage.inputTokens;
    const outputTokens = operation.output_tokens + usage.outputTokens;
    const sheetsCompleted = data.is_last_tile_of_sheet
      ? Math.min(operation.sheets_completed + 1, operation.sheet_ids.length)
      : operation.sheets_completed;
    const { error: updateError } = await dynamicTable(supabaseAdmin, "ai_operations")
      .update({
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        api_cost_cents: computeApiCostCents(operation.model_used, inputTokens, outputTokens),
        sheets_completed: sheetsCompleted,
        updated_at: new Date().toISOString(),
      })
      .eq("id", operation.id);
    if (updateError) throw new Error(updateError.message);

    return {
      candidates,
      usage,
      sheetsCompleted,
    };
  });

const finishScanInput = z.object({
  operation_id: z.string().uuid(),
});

/** Marks a fully scanned operation succeeded (the durable record). */
export const completeAiCountScan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof finishScanInput>) => finishScanInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const operation = await loadOwnedPendingOperation(
      supabaseAdmin,
      data.operation_id,
      context.userId,
    );
    const { error } = await dynamicTable(supabaseAdmin, "ai_operations")
      .update({ status: "succeeded", updated_at: new Date().toISOString() })
      .eq("id", operation.id)
      .eq("status", "pending");
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const failScanInput = z.object({
  operation_id: z.string().uuid(),
  reason: z.string().max(500).default(""),
});

/**
 * Cancels a pending scan (user closed the panel, browser-side render failed)
 * and refunds credits for every sheet that never scanned.
 */
export const failAiCountScan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof failScanInput>) => failScanInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const operation = await loadOwnedPendingOperation(
      supabaseAdmin,
      data.operation_id,
      context.userId,
    );
    await markOperationFailed(
      supabaseAdmin,
      operation,
      data.reason.trim() || "Scan cancelled before it finished.",
    );
    return { ok: true };
  });
