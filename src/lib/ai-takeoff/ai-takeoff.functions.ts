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
  applyConfidenceFloor,
  buildScanInstruction,
  dedupeCandidates,
  DEFAULT_MAX_PROPOSALS_PER_SHEET,
  DEFAULT_MIN_PROPOSAL_CONFIDENCE,
  excludeNearExistingPoints,
  matchCenters,
  parseScanResponse,
  type AiCountCandidate,
} from "@/lib/ai-takeoff/ai-takeoff-domain";
import { tileLocalToSheetPoint, type DetectionTileFrame } from "@/lib/ai-takeoff/coord-transforms";

type DynamicSupabaseError = { code?: string; message: string };
type DynamicSupabaseResult<T = unknown> = { data: T | null; error: DynamicSupabaseError | null };
type DynamicSupabaseQuery = PromiseLike<DynamicSupabaseResult> & {
  select(columns?: string): DynamicSupabaseQuery;
  insert(values: unknown): DynamicSupabaseQuery;
  update(values: unknown): DynamicSupabaseQuery;
  eq(column: string, value: unknown): DynamicSupabaseQuery;
  is(column: string, value: null): DynamicSupabaseQuery;
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

// Guardrail config (AITAKEOFF2 Task 2): env-overridable, defaults from the
// domain module so client and server agree.
function minProposalConfidence(): number {
  const raw = Number(process.env.AI_MIN_CONFIDENCE);
  return Number.isFinite(raw) && raw >= 0 && raw <= 1 ? raw : DEFAULT_MIN_PROPOSAL_CONFIDENCE;
}

function maxProposalsPerSheet(): number {
  const raw = Number(process.env.AI_MAX_PROPOSALS_PER_SHEET);
  return Number.isInteger(raw) && raw > 0 ? raw : DEFAULT_MAX_PROPOSALS_PER_SHEET;
}

// --- Scan diagnostics (AITAKEOFF2 Task 4) ---
// Transient artifacts in the existing plan-room bucket, one folder per
// operation: the exemplar image actually sent, every tile with its
// sheet-space frame, the raw model response, and the mapped positions.
// Uploads are strictly best-effort — diagnostics must never fail a scan.

const AI_DIAGNOSTICS_BUCKET = "plan-room";
const AI_DIAGNOSTICS_PREFIX = "ai-diagnostics";
const AI_DIAGNOSTICS_RETENTION_MS = 24 * 60 * 60 * 1000;

type StorageClient = {
  storage: {
    from(bucket: string): {
      upload(
        path: string,
        body: Uint8Array,
        options?: { contentType?: string; upsert?: boolean },
      ): Promise<{ error: { message: string } | null }>;
      list(
        path: string,
        options?: { limit?: number },
      ): Promise<{
        data: Array<{ name: string; created_at?: string }> | null;
        error: { message: string } | null;
      }>;
      remove(paths: string[]): Promise<{ error: { message: string } | null }>;
      download(path: string): Promise<{ data: Blob | null; error: { message: string } | null }>;
      createSignedUrl(
        path: string,
        expiresIn: number,
      ): Promise<{ data: { signedUrl: string } | null; error: { message: string } | null }>;
    };
  };
};

function diagnosticsFolder(organizationId: string, operationId: string) {
  return `${AI_DIAGNOSTICS_PREFIX}/${organizationId}/${operationId}`;
}

// atob/TextEncoder are Node globals too; keeps this file off Buffer typings.
function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function uploadDiagnostic(
  admin: unknown,
  path: string,
  body: Uint8Array,
  contentType: string,
) {
  try {
    await (admin as StorageClient).storage
      .from(AI_DIAGNOSTICS_BUCKET)
      .upload(path, body, { contentType, upsert: true });
  } catch {
    // Best-effort only.
  }
}

/** 24h cleanup: drop whole diagnostic folders whose files are all stale. */
async function pruneOldDiagnostics(admin: unknown, organizationId: string) {
  try {
    const storage = (admin as StorageClient).storage.from(AI_DIAGNOSTICS_BUCKET);
    const orgPrefix = `${AI_DIAGNOSTICS_PREFIX}/${organizationId}`;
    const { data: folders } = await storage.list(orgPrefix, { limit: 12 });
    if (!folders) return;
    const cutoff = Date.now() - AI_DIAGNOSTICS_RETENTION_MS;
    for (const folder of folders) {
      if (!folder.name) continue;
      const folderPath = `${orgPrefix}/${folder.name}`;
      const { data: files } = await storage.list(folderPath, { limit: 100 });
      if (!files || files.length === 0) continue;
      const allStale = files.every((file) => {
        const created = Date.parse(file.created_at ?? "");
        return Number.isFinite(created) && created < cutoff;
      });
      if (!allStale) continue;
      await storage.remove(files.map((file) => `${folderPath}/${file.name}`));
    }
  } catch {
    // Best-effort only.
  }
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

    // Transient diagnostics from earlier scans age out here (24h retention).
    await pruneOldDiagnostics(supabaseAdmin, organizationId);

    return {
      operationId: operation.id,
      creditsCharged: quote,
      model,
      maxSheets: cap,
      minConfidence: minProposalConfidence(),
      maxProposalsPerSheet: maxProposalsPerSheet(),
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
    // Region-rendered crop (~640px long side) is bigger than Phase A's.
    base64: z.string().min(1).max(2_500_000),
  }),
  tile: z.object({
    index: z.number().int().min(0).max(500),
    left: z.number().int().min(0).max(20000),
    top: z.number().int().min(0).max(20000),
    width: z.number().int().min(1).max(4000),
    height: z.number().int().min(1).max(4000),
    // The tile's sheet-space origin and per-pixel scale (AITAKEOFF2 Task 1):
    // response mapping goes tile-local → sheet through this frame and the
    // one tested transform path, never ad-hoc math.
    frame: z.object({
      originSheetX: z.number().min(0).max(1),
      originSheetY: z.number().min(0).max(1),
      sheetPerPxX: z.number().gt(0).max(1),
      sheetPerPxY: z.number().gt(0).max(1),
    }),
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

function isMissingExemplarDescriptionColumn(error: DynamicSupabaseError | null | undefined) {
  const message = error?.message ?? "";
  return Boolean(
    error &&
    (error.code === "PGRST204" || error.code === "42703") &&
    /exemplar_description/i.test(message),
  );
}

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
    let exemplarDescription = "";
    let rawResponseText = "";
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
      rawResponseText = result.text;
      const parsed = parseScanResponse(result.text, data.tile.width, data.tile.height);
      exemplarDescription = parsed.exemplarDescription;
      // One mapping path: bbox → center (tile pixels) → sheet space through
      // the tile's frame. The confidence floor runs before dedupe so a weak
      // duplicate can never displace a strong sibling.
      const frame = data.tile.frame as DetectionTileFrame;
      const mapped = applyConfidenceFloor(
        matchCenters(parsed.matches),
        minProposalConfidence(),
      ).map((center) => ({
        ...tileLocalToSheetPoint(frame, center.x, center.y),
        confidence: center.confidence,
      }));
      candidates = excludeNearExistingPoints(dedupeCandidates(mapped), data.existing_points);
    } catch (error) {
      const message = error instanceof Error ? error.message : "The AI model call failed.";
      await markOperationFailed(supabaseAdmin, operation, message);
      throw new Error(`${message} Unused credits were refunded — the scan can be started again.`);
    }

    // Echo check (AITAKEOFF2 Task 0): the first tile's description of the
    // exemplar persists on the operation — corruption stays visible forever.
    if (exemplarDescription) {
      // First tile wins; later tiles never overwrite the stored echo.
      const { error: echoError } = await dynamicTable(supabaseAdmin, "ai_operations")
        .update({ exemplar_description: exemplarDescription })
        .eq("id", operation.id)
        .is("exemplar_description", null);
      if (echoError && !isMissingExemplarDescriptionColumn(echoError)) {
        // Non-fatal: the echo still reaches the panel through the response.
      }
    }

    // Diagnostics (best-effort, never blocks the scan): the exemplar image
    // actually sent (once), each tile image, and its raw/mapped results.
    const folder = diagnosticsFolder(operation.organization_id, operation.id);
    if (data.sheet_id === operation.sheet_ids[0] && data.tile.index === 0) {
      await uploadDiagnostic(
        supabaseAdmin,
        `${folder}/exemplar.png`,
        base64ToBytes(data.exemplar.base64),
        data.exemplar.media_type,
      );
    }
    await uploadDiagnostic(
      supabaseAdmin,
      `${folder}/tile-${data.sheet_id}-${data.tile.index}.png`,
      base64ToBytes(data.tile.base64),
      data.tile.media_type,
    );
    await uploadDiagnostic(
      supabaseAdmin,
      `${folder}/tile-${data.sheet_id}-${data.tile.index}.json`,
      new TextEncoder().encode(
        JSON.stringify({
          sheetId: data.sheet_id,
          tileIndex: data.tile.index,
          rect: {
            left: data.tile.left,
            top: data.tile.top,
            width: data.tile.width,
            height: data.tile.height,
          },
          frame: data.tile.frame,
          sheetWidthPx: data.sheet_width_px,
          sheetHeightPx: data.sheet_height_px,
          exemplarDescription,
          rawResponse: rawResponseText.slice(0, 20000),
          mappedCandidates: candidates,
          usage,
          createdAt: new Date().toISOString(),
        }),
      ),
      "application/json",
    );

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
      exemplarDescription,
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

const diagnosticsInput = z.object({
  operation_id: z.string().uuid(),
});

export interface AiScanDiagnosticsTile {
  sheetId: string;
  tileIndex: number;
  imageUrl: string | null;
  rect: { left: number; top: number; width: number; height: number } | null;
  frame: DetectionTileFrame | null;
  exemplarDescription: string;
  rawResponse: string;
  mappedCandidates: AiCountCandidate[];
  usage: { inputTokens: number; outputTokens: number } | null;
}

export interface AiScanDiagnostics {
  operation: {
    id: string;
    status: string;
    modelUsed: string;
    exemplarDescription: string;
    sheetIds: string[];
    sheetsCompleted: number;
    creditsCharged: number;
    apiCostCents: number;
    inputTokens: number;
    outputTokens: number;
    createdAt: string;
    error: string;
  };
  exemplarUrl: string | null;
  tiles: AiScanDiagnosticsTile[];
  diagnosticsAvailable: boolean;
}

/**
 * Scan diagnostics (AITAKEOFF2 Task 4) — the founder's microscope. Super
 * admin only: shows the exemplar crop actually sent to the model, every tile
 * with its sheet-space origin, the raw model responses, and the mapped
 * positions. Images are transient (24h prune on the next scan).
 */
export const getAiScanDiagnostics = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof diagnosticsInput>) => diagnosticsInput.parse(input))
  .handler(async ({ data, context }): Promise<AiScanDiagnostics> => {
    const { data: isSuper, error: superError } = await (
      context.supabase as unknown as { rpc(fn: string): Promise<DynamicSupabaseResult<boolean>> }
    ).rpc("is_super_admin");
    if (superError) throw new Error(superError.message);
    if (!isSuper) {
      throw new Error("Scan diagnostics are only available to the platform super admin.");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: operationRow, error: operationError } = await dynamicTable(
      supabaseAdmin,
      "ai_operations",
    )
      .select("*")
      .eq("id", data.operation_id)
      .maybeSingle();
    if (operationError) {
      if (isMissingCreditsSchema(operationError)) throw new Error(CREDITS_SCHEMA_PENDING_MESSAGE);
      throw new Error(operationError.message);
    }
    if (!operationRow) throw new Error("That AI operation was not found.");
    const operation = normalizeOperation(operationRow as Record<string, unknown>);
    const exemplarDescription = str((operationRow as Record<string, unknown>).exemplar_description);

    const summary: AiScanDiagnostics["operation"] = {
      id: operation.id,
      status: operation.status,
      modelUsed: operation.model_used,
      exemplarDescription,
      sheetIds: operation.sheet_ids,
      sheetsCompleted: operation.sheets_completed,
      creditsCharged: operation.credits_charged,
      apiCostCents: operation.api_cost_cents,
      inputTokens: operation.input_tokens,
      outputTokens: operation.output_tokens,
      createdAt: operation.created_at,
      error: operation.error,
    };

    const storage = (supabaseAdmin as unknown as StorageClient).storage.from(AI_DIAGNOSTICS_BUCKET);
    const folder = diagnosticsFolder(operation.organization_id, operation.id);
    const { data: files } = await storage.list(folder, { limit: 200 });
    if (!files || files.length === 0) {
      return { operation: summary, exemplarUrl: null, tiles: [], diagnosticsAvailable: false };
    }

    const signedUrlFor = async (name: string) => {
      const { data: signed } = await storage.createSignedUrl(`${folder}/${name}`, 3600);
      return signed?.signedUrl ?? null;
    };

    const fileNames = new Set(files.map((file) => file.name));
    const exemplarUrl = fileNames.has("exemplar.png") ? await signedUrlFor("exemplar.png") : null;

    const tiles: AiScanDiagnosticsTile[] = [];
    for (const file of files) {
      if (!file.name.endsWith(".json")) continue;
      let meta: Record<string, unknown> = {};
      try {
        const { data: blob } = await storage.download(`${folder}/${file.name}`);
        if (blob) meta = JSON.parse(await blob.text()) as Record<string, unknown>;
      } catch {
        // A corrupt diagnostic file still gets a row so the gap is visible.
      }
      const imageName = file.name.replace(/\.json$/, ".png");
      const rect = (meta.rect ?? null) as AiScanDiagnosticsTile["rect"];
      const frame = (meta.frame ?? null) as DetectionTileFrame | null;
      const mapped = Array.isArray(meta.mappedCandidates)
        ? (meta.mappedCandidates as AiCountCandidate[])
        : [];
      tiles.push({
        sheetId: str(meta.sheetId),
        tileIndex: Math.max(0, Math.round(num(meta.tileIndex))),
        imageUrl: fileNames.has(imageName) ? await signedUrlFor(imageName) : null,
        rect,
        frame,
        exemplarDescription: str(meta.exemplarDescription),
        rawResponse: str(meta.rawResponse),
        mappedCandidates: mapped,
        usage:
          meta.usage && typeof meta.usage === "object"
            ? {
                inputTokens: Math.max(
                  0,
                  Math.round(num((meta.usage as Record<string, unknown>).inputTokens)),
                ),
                outputTokens: Math.max(
                  0,
                  Math.round(num((meta.usage as Record<string, unknown>).outputTokens)),
                ),
              }
            : null,
      });
    }

    const sheetOrder = new Map(operation.sheet_ids.map((id, index) => [id, index]));
    tiles.sort((a, b) => {
      const sheetSort = (sheetOrder.get(a.sheetId) ?? 999) - (sheetOrder.get(b.sheetId) ?? 999);
      if (sheetSort !== 0) return sheetSort;
      return a.tileIndex - b.tileIndex;
    });

    return { operation: summary, exemplarUrl, tiles, diagnosticsAvailable: true };
  });
