// AI-assisted count scan server functions (AITAKEOFF1 Tasks 0/1).
// The model only finds symbol locations; nothing here ever creates takeoff
// records from model output — proposals go back to the client for human
// review. Credits are charged up front and refunded automatically when an
// operation fails (compensating credit_ledger entry).
// Shared Supabase/storage plumbing lives in ai-takeoff-server-shared.ts;
// the diagnostics reader lives in ai-scan-diagnostics.functions.ts.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  computeApiCostCents,
  creditBalance,
  DEFAULT_MAX_SHEETS_PER_SCAN,
  quoteScanCredits,
  refundEntryForFailedScan,
} from "@/lib/credits/credits-domain";
import {
  buildScanInstruction,
  buildVerifyInstruction,
  COARSE_CANDIDATE_CONFIDENCE,
  DEDUPE_RADIUS_NORMALIZED,
  dedupeCandidates,
  DEFAULT_MAX_PROPOSALS_PER_SHEET,
  DEFAULT_MIN_PROPOSAL_CONFIDENCE,
  excludeNearExistingPoints,
  imageTokenEstimate,
  inkMaskFromBase64,
  parseScanResponse,
  parseVerifyResponse,
  REFERENCE_MAX_NEGATIVES,
  REFERENCE_MAX_POSITIVES,
  snapToInkCentroid,
  tileTokenCheck,
  VERIFIED_PROPOSAL_CONFIDENCE,
  type AiCountCandidate,
} from "@/lib/ai-takeoff/ai-takeoff-domain";
import {
  describeCandidateOrigin,
  resolveProposalSource,
  resolveTemplateMatchThreshold,
} from "@/lib/ai-takeoff/template-match/template-match-domain";
import { tileLocalToSheetPoint, type DetectionTileFrame } from "@/lib/ai-takeoff/coord-transforms";
import {
  base64ToBytes,
  CREDITS_SCHEMA_PENDING_MESSAGE,
  diagnosticsFolder,
  dynamicTable,
  isMissingCreditsSchema,
  normalizeOperation,
  pruneOldDiagnostics,
  str,
  uploadDiagnostic,
  type AiOperationRow,
  type DynamicSupabaseError,
  type DynamicSupabaseResult,
} from "@/lib/ai-takeoff/ai-takeoff-server-shared";

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
      // Proposal engines (AITAKEOFF6 Task 1): which engine(s) feed stage B
      // and the template matcher's recall-biased NCC floor — env-tunable
      // server-side so the client never reads env directly.
      proposalSource: resolveProposalSource(process.env.AI_PROPOSAL_SOURCE),
      templateMatchThreshold: resolveTemplateMatchThreshold(
        process.env.AI_TEMPLATE_MATCH_THRESHOLD,
      ),
    };
  });

// Reference set (AITAKEOFF5 Task 1): positives teach what the symbol IS
// (picked exemplar first), negatives what it is NOT (crops of rejected
// candidates). Both stages receive the same references.
const referenceImageSchema = z.object({
  media_type: z.enum(["image/png", "image/webp", "image/jpeg"]),
  base64: z.string().min(1).max(2_500_000),
  width_px: z.number().int().min(1).max(4000),
  height_px: z.number().int().min(1).max(4000),
});
const referencesSchema = z.object({
  label: z.string().max(240).default(""),
  positives: z.array(referenceImageSchema).min(1).max(REFERENCE_MAX_POSITIVES),
  negatives: z.array(referenceImageSchema).max(REFERENCE_MAX_NEGATIVES).default([]),
});
type ReferenceImages = z.output<typeof referencesSchema>;

const referenceImagesFor = (references: ReferenceImages) =>
  [...references.positives, ...references.negatives].map((image) => ({
    mediaType: image.media_type,
    base64: image.base64,
  }));

const referenceTokensFor = (references: ReferenceImages) =>
  [...references.positives, ...references.negatives].reduce(
    (sum, image) => sum + imageTokenEstimate(image.width_px, image.height_px),
    0,
  );

/** Per-call composition record for tile/verify diagnostics JSON. */
const referenceComposition = (references: ReferenceImages) => ({
  positives: references.positives.map((image) => ({
    widthPx: image.width_px,
    heightPx: image.height_px,
    estTokens: imageTokenEstimate(image.width_px, image.height_px),
  })),
  negatives: references.negatives.map((image) => ({
    widthPx: image.width_px,
    heightPx: image.height_px,
    estTokens: imageTokenEstimate(image.width_px, image.height_px),
  })),
});

const tileScanInput = z.object({
  operation_id: z.string().uuid(),
  sheet_id: z.string().uuid(),
  // Detection raster dimensions of the whole sheet, in pixels.
  sheet_width_px: z.number().int().min(1).max(20000),
  sheet_height_px: z.number().int().min(1).max(20000),
  references: referencesSchema,
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
  // Footprint-derived dedupe/exclusion radius (AITAKEOFF5 Task 0): the
  // client measures the exemplar's ink footprint and scales the radius so
  // same-symbol duplicates and already-marked symbols collapse at symbol
  // scale. Defaults to the fixed floor for older clients.
  dedupe_radius_normalized: z.number().min(0.001).max(0.1).default(DEDUPE_RADIUS_NORMALIZED),
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
    let suppressedNearExisting: AiCountCandidate[] = [];
    let usage = { inputTokens: 0, outputTokens: 0 };
    let exemplarDescription = "";
    let rawResponseText = "";
    try {
      const result = await callAnthropicVision({
        model: operation.model_used,
        instruction: buildScanInstruction({
          label: data.references.label,
          positiveCount: data.references.positives.length,
          negativeCount: data.references.negatives.length,
        }),
        images: [
          ...referenceImagesFor(data.references),
          { mediaType: data.tile.media_type, base64: data.tile.base64 },
        ],
      });
      usage = { inputTokens: result.inputTokens, outputTokens: result.outputTokens };
      rawResponseText = result.text;
      const parsed = parseScanResponse(result.text, data.tile.width, data.tile.height);
      exemplarDescription = parsed.exemplarDescription;
      // One mapping path: candidate center (tile pixels) → sheet space
      // through the tile's frame. Recall-biased stage A (AITAKEOFF3 Task 1):
      // no confidence floor here — stage B is the filter now, so every
      // candidate carries the coarse placeholder confidence until verified.
      const frame = data.tile.frame as DetectionTileFrame;
      const mapped = parsed.candidates.map((center) => ({
        ...tileLocalToSheetPoint(frame, center.x, center.y),
        confidence: COARSE_CANDIDATE_CONFIDENCE,
      }));
      const deduped = dedupeCandidates(mapped, data.dedupe_radius_normalized);
      candidates = excludeNearExistingPoints(
        deduped,
        data.existing_points,
        data.dedupe_radius_normalized,
      );
      // Candidates sitting on already-counted symbols are suppressed, not
      // lost: diagnostics labels them so "8 found" plus 4 hand-marked brushes
      // reads as intended behavior, not missed symbols (AITAKEOFF4 Task 2).
      const kept = new Set(candidates);
      suppressedNearExisting = deduped.filter((candidate) => !kept.has(candidate));
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
        base64ToBytes(data.references.positives[0].base64),
        data.references.positives[0].media_type,
      );
    }
    // The full reference set can differ per sheet (negatives are per-sheet
    // crops); keep one copy of each per sheet for manual inspection.
    if (data.tile.index === 0) {
      for (const [index, image] of data.references.positives.slice(1).entries()) {
        await uploadDiagnostic(
          supabaseAdmin,
          `${folder}/refpos-${data.sheet_id}-${index + 1}.png`,
          base64ToBytes(image.base64),
          image.media_type,
        );
      }
      for (const [index, image] of data.references.negatives.entries()) {
        await uploadDiagnostic(
          supabaseAdmin,
          `${folder}/refneg-${data.sheet_id}-${index}.png`,
          base64ToBytes(image.base64),
          image.media_type,
        );
      }
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
          suppressedNearExisting,
          usage,
          // Per-call composition (AITAKEOFF5 Task 1): what reference images
          // rode along, with their token estimates.
          references: referenceComposition(data.references),
          // Token-implied perceived megapixels (AITAKEOFF3 Task 3, isolated
          // from references + prompt): a future silent resize shows up here
          // as suspectedResize at a glance.
          tokenCheck: tileTokenCheck(
            usage.inputTokens,
            data.tile.width,
            data.tile.height,
            referenceTokensFor(data.references),
          ),
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

const verifyCandidateInput = z.object({
  operation_id: z.string().uuid(),
  sheet_id: z.string().uuid(),
  // Position of this candidate in the sheet's verification batch — names the
  // diagnostic artifacts (verify-{sheetId}-{n}.png/.json).
  candidate_index: z.number().int().min(0).max(1000),
  // The stage-A candidate in normalized sheet space: the fallback point when
  // the verdict confirms a match without a usable center, and the diagnostic
  // record of what stage B was asked about.
  candidate: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }),
  // Which proposal engine produced this candidate (AITAKEOFF6 Task 1), with
  // the template sweep's metadata when it was the matcher — the two engines
  // stay comparable on real sheets through the verify diagnostics.
  candidate_origin: z
    .object({
      source: z.enum(["template", "model"]),
      score: z.number().min(0).max(1).nullable().default(null),
      rotation_deg: z.number().min(0).lt(360).nullable().default(null),
      scale: z.number().gt(0).max(10).nullable().default(null),
    })
    .optional(),
  references: referencesSchema,
  // The verification window: a small crop of the detection raster around the
  // candidate, upscaled client-side. The frame carries the WINDOW's
  // sheet-space origin/scale — the normalized verdict center maps through it
  // exactly like a tile response, just with a smaller denominator.
  window: z.object({
    left: z.number().int().min(0).max(20000),
    top: z.number().int().min(0).max(20000),
    width: z.number().int().min(1).max(2000),
    height: z.number().int().min(1).max(2000),
    frame: z.object({
      originSheetX: z.number().min(0).max(1),
      originSheetY: z.number().min(0).max(1),
      sheetPerPxX: z.number().gt(0).max(1),
      sheetPerPxY: z.number().gt(0).max(1),
    }),
    media_type: z.enum(["image/png", "image/webp", "image/jpeg"]),
    base64: z.string().min(1).max(4_000_000),
    // Bit-packed dark-pixel mask at window resolution (AITAKEOFF4 Task 1):
    // lets the server snap the verdict center onto the symbol's ink centroid
    // without decoding the PNG. A 256x256 window packs to ~11KB of base64.
    ink_mask_base64: z.string().min(1).max(700_000),
  }),
});

/**
 * Stage B (AITAKEOFF3 Task 2): verify ONE stage-A candidate on a zoomed
 * crop. Accept only a literal `match: true`; the final sheet point
 * re-derives from the stage-B center through the window's frame. The verdict
 * is the real confidence — verified proposals carry the stage-derived
 * baseline, never the model's self-reported numbers.
 */
export const verifyAiCountCandidate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof verifyCandidateInput>) =>
    verifyCandidateInput.parse(input),
  )
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

    let match = false;
    let observed = "";
    let point: { x: number; y: number } | null = null;
    let centerRefined = false;
    // Window-local centers (AITAKEOFF4 Task 1): the raw stage-B center and
    // the ink-centroid snap, both persisted so diagnostics can show the
    // correction vector.
    let rawCenterPx: { x: number; y: number } | null = null;
    let snappedCenterPx: { x: number; y: number } | null = null;
    let usage = { inputTokens: 0, outputTokens: 0 };
    let rawResponseText = "";
    try {
      const result = await callAnthropicVision({
        model: operation.model_used,
        instruction: buildVerifyInstruction({
          label: data.references.label,
          positiveCount: data.references.positives.length,
          negativeCount: data.references.negatives.length,
        }),
        images: [
          ...referenceImagesFor(data.references),
          { mediaType: data.window.media_type, base64: data.window.base64 },
        ],
        maxTokens: 300,
      });
      usage = { inputTokens: result.inputTokens, outputTokens: result.outputTokens };
      rawResponseText = result.text;
      const verdict = parseVerifyResponse(result.text, data.window.width, data.window.height);
      observed = verdict.observed;
      // The stage-derived confidence is what the floor gates on now.
      match = verdict.match && VERIFIED_PROPOSAL_CONFIDENCE >= minProposalConfidence();
      if (match) {
        centerRefined = verdict.center !== null;
        const frame = data.window.frame as DetectionTileFrame;
        // Without a usable verdict center, snap around where the stage-A
        // candidate sits inside the window instead.
        rawCenterPx = verdict.center ?? {
          x: (data.candidate.x - frame.originSheetX) / frame.sheetPerPxX,
          y: (data.candidate.y - frame.originSheetY) / frame.sheetPerPxY,
        };
        // Deterministic precision polish (AITAKEOFF4 Task 1): snap the
        // verified center onto the symbol's ink centroid; fall back to the
        // stage-B center when nothing nearby looks like a symbol.
        const inkMask = inkMaskFromBase64(
          data.window.ink_mask_base64,
          data.window.width,
          data.window.height,
        );
        snappedCenterPx = inkMask ? snapToInkCentroid(inkMask, rawCenterPx) : null;
        const finalCenterPx = snappedCenterPx ?? rawCenterPx;
        point =
          verdict.center || snappedCenterPx
            ? tileLocalToSheetPoint(frame, finalCenterPx.x, finalCenterPx.y)
            : { x: data.candidate.x, y: data.candidate.y };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "The AI model call failed.";
      await markOperationFailed(supabaseAdmin, operation, message);
      throw new Error(`${message} Unused credits were refunded — the scan can be started again.`);
    }

    // Per-candidate stage-B artifacts (AITAKEOFF3 Task 3): the crop actually
    // judged, the raw verdict, and the final mapped point. Best-effort only.
    const origin = data.candidate_origin ?? {
      source: "model" as const,
      score: null,
      rotation_deg: null,
      scale: null,
    };
    const folder = diagnosticsFolder(operation.organization_id, operation.id);
    const artifactName = `verify-${data.sheet_id}-${data.candidate_index}`;
    await uploadDiagnostic(
      supabaseAdmin,
      `${folder}/${artifactName}.png`,
      base64ToBytes(data.window.base64),
      data.window.media_type,
    );
    await uploadDiagnostic(
      supabaseAdmin,
      `${folder}/${artifactName}.json`,
      new TextEncoder().encode(
        JSON.stringify({
          sheetId: data.sheet_id,
          candidateIndex: data.candidate_index,
          candidate: data.candidate,
          // The exemplar label keys "same sheet + exemplar" lookups for
          // negative harvesting on later scans (AITAKEOFF5 Task 1).
          exemplarLabel: data.references.label,
          // Which engine proposed this candidate (AITAKEOFF6 Task 1):
          // "template 0.78 @ 30°" vs "model" — comparable on real sheets.
          candidateOrigin: origin,
          originLabel: describeCandidateOrigin({
            source: origin.source,
            score: origin.score,
            rotationDeg: origin.rotation_deg,
            scale: origin.scale,
          }),
          references: referenceComposition(data.references),
          window: {
            left: data.window.left,
            top: data.window.top,
            width: data.window.width,
            height: data.window.height,
          },
          frame: data.window.frame,
          match,
          // Describe-then-decide (AITAKEOFF5 Task 2): the model's own account
          // of what the crop shows — read this when a false positive slips.
          observed,
          centerRefined,
          rawCenterPx,
          snappedCenterPx,
          mappedPoint: point,
          rawResponse: rawResponseText.slice(0, 4000),
          usage,
          createdAt: new Date().toISOString(),
        }),
      ),
      "application/json",
    );

    const inputTokens = operation.input_tokens + usage.inputTokens;
    const outputTokens = operation.output_tokens + usage.outputTokens;
    const { error: updateError } = await dynamicTable(supabaseAdmin, "ai_operations")
      .update({
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        api_cost_cents: computeApiCostCents(operation.model_used, inputTokens, outputTokens),
        updated_at: new Date().toISOString(),
      })
      .eq("id", operation.id);
    if (updateError) throw new Error(updateError.message);

    return {
      match,
      point,
      confidence: VERIFIED_PROPOSAL_CONFIDENCE,
      usage,
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
