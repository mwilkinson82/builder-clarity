// Scan diagnostics server function (AITAKEOFF2 Task 4, extended in
// AITAKEOFF3 Task 3) — the founder's microscope, split out of
// ai-takeoff.functions.ts. Super admin only: the exemplar crop actually sent
// to the model, every stage-A tile with its sheet-space origin and
// token-implied perceived megapixels, and every stage-B verification crop
// with its verdict. Orphan images without a JSON sidecar still get a row —
// a storage failure must read as "metadata missing", never as "Tiles (0)".

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  isNegativeEligibleRejection,
  type AiCountCandidate,
  type TileTokenCheck,
} from "@/lib/ai-takeoff/ai-takeoff-domain";
import type { DetectionTileFrame } from "@/lib/ai-takeoff/coord-transforms";
import {
  AI_DIAGNOSTICS_BUCKET,
  CREDITS_SCHEMA_PENDING_MESSAGE,
  diagnosticsFolder,
  dynamicTable,
  isMissingCreditsSchema,
  normalizeOperation,
  num,
  str,
  type DynamicSupabaseResult,
  type StorageClient,
} from "@/lib/ai-takeoff/ai-takeoff-server-shared";

const diagnosticsInput = z.object({
  operation_id: z.string().uuid(),
});

const priorRejectionsInput = z.object({
  estimate_id: z.string().uuid(),
  sheet_id: z.string().uuid(),
  exemplar_label: z.string().max(240).default(""),
});

/**
 * EXPLICIT user "wrong symbol" rejections from the most recent succeeded
 * scan of this sheet with the same exemplar label — the negative-reference
 * source when the session has no fresh rejections yet. Rewritten in
 * AITAKEOFF10 Task 0: this used to harvest stage-B MODEL rejections
 * (match:false verify artifacts) as if a human had rejected them — the
 * write path that poisoned A-100's teach loop with crops of real brushes.
 * It now reads ONLY user-reject-*.json records carrying
 * reason:"wrong_symbol"; every legacy record (all verify-derived) is
 * excluded at read time, permanently. Strictly best-effort: any miss
 * returns an empty list, never an error. Diagnostics are ~24h transient,
 * so this naturally only reaches recent scans.
 */
export const listPriorSheetRejections = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof priorRejectionsInput>) =>
    priorRejectionsInput.parse(input),
  )
  .handler(async ({ data, context }): Promise<{ points: Array<{ x: number; y: number }> }> => {
    const label = data.exemplar_label.trim();
    if (!label) return { points: [] };
    try {
      // The user-scoped client proves estimate access through RLS.
      const { data: estimate, error } = await dynamicTable(context.supabase, "estimates")
        .select("id,organization_id")
        .eq("id", data.estimate_id)
        .maybeSingle();
      if (error || !estimate) return { points: [] };
      const organizationId = str((estimate as Record<string, unknown>).organization_id);

      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: operations } = (await dynamicTable(supabaseAdmin, "ai_operations")
        .select("id,sheet_ids,created_at")
        .eq("estimate_id", data.estimate_id)
        .eq("status", "succeeded")
        .order("created_at", { ascending: false })
        .limit(10)) as DynamicSupabaseResult<
        Array<{ id: string; sheet_ids: string[]; created_at: string }>
      >;
      const previous = (operations ?? []).find(
        (operation) =>
          Array.isArray(operation.sheet_ids) && operation.sheet_ids.includes(data.sheet_id),
      );
      if (!previous) return { points: [] };

      const storage = (supabaseAdmin as unknown as StorageClient).storage.from(
        AI_DIAGNOSTICS_BUCKET,
      );
      const folder = diagnosticsFolder(organizationId, previous.id);
      const { data: files } = await storage.list(folder, { limit: 1000 });
      const rejectionFiles = (files ?? [])
        .map((file) => file.name)
        .filter(
          (name) => name.startsWith(`user-reject-${data.sheet_id}-`) && name.endsWith(".json"),
        )
        .slice(0, 30);
      const points: Array<{ x: number; y: number }> = [];
      for (const name of rejectionFiles) {
        if (points.length >= 8) break;
        try {
          const { data: blob } = await storage.download(`${folder}/${name}`);
          if (!blob) continue;
          const meta = JSON.parse(await blob.text()) as Record<string, unknown>;
          // The absolute rule's READ side: only an explicit "wrong symbol"
          // verdict is identity evidence. Placement rejections and every
          // legacy record fail this check forever.
          if (!isNegativeEligibleRejection(meta)) continue;
          if (str(meta.exemplarLabel).trim().toLowerCase() !== label.toLowerCase()) continue;
          const point = meta.point as Record<string, unknown> | null;
          const x = Number(point?.x);
          const y = Number(point?.y);
          if (Number.isFinite(x) && Number.isFinite(y)) points.push({ x, y });
        } catch {
          // Skip unreadable artifacts.
        }
      }
      return { points };
    } catch {
      return { points: [] };
    }
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
  /** Candidates dropped because the estimator already marked that symbol. */
  suppressedNearExisting: AiCountCandidate[];
  usage: { inputTokens: number; outputTokens: number } | null;
  /** Token-implied perceived megapixels — a resize regression flags here. */
  tokenCheck: TileTokenCheck | null;
  /** The PNG exists but its JSON sidecar is gone (e.g. a MIME rejection). */
  metadataMissing: boolean;
}

/** One stage-B verification: the crop judged, the verdict, the final point. */
export interface AiScanVerification {
  sheetId: string;
  candidateIndex: number;
  imageUrl: string | null;
  candidate: { x: number; y: number } | null;
  window: { left: number; top: number; width: number; height: number } | null;
  frame: DetectionTileFrame | null;
  match: boolean;
  /** The model's describe-then-decide sentence (AITAKEOFF5 Task 2). */
  observed: string;
  /** Which engine proposed it: "template 0.78 @ 30°" or "model" (AITAKEOFF7). */
  originLabel: string;
  centerRefined: boolean;
  /** Stage-B center in window pixels, before the ink-centroid snap. */
  rawCenterPx: { x: number; y: number } | null;
  /** Ink-centroid snap result in window pixels (null = fallback used). */
  snappedCenterPx: { x: number; y: number } | null;
  mappedPoint: { x: number; y: number } | null;
  rawResponse: string;
  usage: { inputTokens: number; outputTokens: number } | null;
  metadataMissing: boolean;
}

/**
 * The per-sheet proposal funnel (AITAKEOFF7 Task 4): what each engine
 * proposed and how many candidates survived each collapse step — the one
 * line that makes a radius/units bug visible on the first screenshot.
 */
export interface AiScanSheetSummary {
  sheetId: string;
  proposedTemplate: number;
  proposedModel: number;
  afterUnionDedupe: number;
  afterSuppression: number;
  sentToVerify: number;
  verified: number;
  /** Verified ghosts rejected by the center sanity band (AITAKEOFF9). */
  centerMismatchRejected: number;
  stageATiles: number;
  footprintRasterPx: number | null;
  radius: { x: number; y: number } | null;
  templateEngine: string;
  templateError: string;
  templateElapsedMs: number | null;
  /** The score floor the sweep applied (AITAKEOFF8 Task 1). */
  templateThreshold: number | null;
  /** matchTemplate invocations, coarse+fine (AITAKEOFF10 Task 3). */
  templateSweeps: number | null;
  templateCount: number | null;
  /** Masked metric ran; false = degenerate-mask fallback (AITAKEOFF8). */
  templateMasked: boolean | null;
  templateMaskCoverage: number | null;
  /** Best sweep scores regardless of the threshold (AITAKEOFF8 Task 1). */
  templateTopScores: Array<{
    x: number;
    y: number;
    score: number;
    rotationDeg: number;
    scale: number;
  }>;
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
  sheetSummaries: AiScanSheetSummary[];
  tiles: AiScanDiagnosticsTile[];
  verifications: AiScanVerification[];
  diagnosticsAvailable: boolean;
}

const ARTIFACT_NAME = /^(tile|verify)-([0-9a-f-]{36})-(\d+)\.(png|json)$/;
const SUMMARY_NAME = /^summary-([0-9a-f-]{36})\.json$/;

function parseUsage(raw: unknown): { inputTokens: number; outputTokens: number } | null {
  if (!raw || typeof raw !== "object") return null;
  const usage = raw as Record<string, unknown>;
  return {
    inputTokens: Math.max(0, Math.round(num(usage.inputTokens))),
    outputTokens: Math.max(0, Math.round(num(usage.outputTokens))),
  };
}

function parsePoint(raw: unknown): { x: number; y: number } | null {
  if (!raw || typeof raw !== "object") return null;
  const point = raw as Record<string, unknown>;
  const x = Number(point.x);
  const y = Number(point.y);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

/**
 * Scan diagnostics — super admin only. Shows what the model actually saw and
 * answered at both stages, with the mapped positions. Images are transient
 * (24h prune on the next scan).
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
    // Stage B doubles the artifact count (a PNG + JSON per candidate), so
    // the listing limit is generous.
    const { data: files } = await storage.list(folder, { limit: 1000 });
    if (!files || files.length === 0) {
      return {
        operation: summary,
        exemplarUrl: null,
        sheetSummaries: [],
        tiles: [],
        verifications: [],
        diagnosticsAvailable: false,
      };
    }

    const signedUrlFor = async (name: string) => {
      const { data: signed } = await storage.createSignedUrl(`${folder}/${name}`, 3600);
      return signed?.signedUrl ?? null;
    };

    const fileNames = new Set(files.map((file) => file.name));
    const exemplarUrl = fileNames.has("exemplar.png") ? await signedUrlFor("exemplar.png") : null;

    // Group artifacts by kind + sheet + index so an orphan PNG (its JSON
    // sidecar rejected or lost) still surfaces as a row.
    const artifactKeys = new Map<string, { kind: string; sheetId: string; index: number }>();
    for (const file of files) {
      const parsed = ARTIFACT_NAME.exec(file.name);
      if (!parsed) continue;
      const [, kind, sheetId, index] = parsed;
      artifactKeys.set(`${kind}-${sheetId}-${index}`, {
        kind,
        sheetId,
        index: Number(index),
      });
    }

    const downloadMeta = async (name: string): Promise<Record<string, unknown> | null> => {
      if (!fileNames.has(name)) return null;
      try {
        const { data: blob } = await storage.download(`${folder}/${name}`);
        if (!blob) return null;
        return JSON.parse(await blob.text()) as Record<string, unknown>;
      } catch {
        // A corrupt sidecar reads the same as a missing one: flagged row.
        return null;
      }
    };

    const tiles: AiScanDiagnosticsTile[] = [];
    const verifications: AiScanVerification[] = [];
    for (const { kind, sheetId, index } of artifactKeys.values()) {
      const baseName = `${kind}-${sheetId}-${index}`;
      const meta = await downloadMeta(`${baseName}.json`);
      const imageUrl = fileNames.has(`${baseName}.png`)
        ? await signedUrlFor(`${baseName}.png`)
        : null;
      if (kind === "tile") {
        tiles.push({
          sheetId,
          tileIndex: index,
          imageUrl,
          rect: (meta?.rect ?? null) as AiScanDiagnosticsTile["rect"],
          frame: (meta?.frame ?? null) as DetectionTileFrame | null,
          exemplarDescription: str(meta?.exemplarDescription),
          rawResponse: str(meta?.rawResponse),
          mappedCandidates: Array.isArray(meta?.mappedCandidates)
            ? (meta.mappedCandidates as AiCountCandidate[])
            : [],
          suppressedNearExisting: Array.isArray(meta?.suppressedNearExisting)
            ? (meta.suppressedNearExisting as AiCountCandidate[])
            : [],
          usage: parseUsage(meta?.usage),
          tokenCheck: (meta?.tokenCheck ?? null) as TileTokenCheck | null,
          metadataMissing: meta === null,
        });
      } else {
        verifications.push({
          sheetId,
          candidateIndex: index,
          imageUrl,
          candidate: parsePoint(meta?.candidate),
          window: (meta?.window ?? null) as AiScanVerification["window"],
          frame: (meta?.frame ?? null) as DetectionTileFrame | null,
          match: meta?.match === true,
          observed: str(meta?.observed),
          originLabel: str(meta?.originLabel),
          centerRefined: meta?.centerRefined === true,
          rawCenterPx: parsePoint(meta?.rawCenterPx),
          snappedCenterPx: parsePoint(meta?.snappedCenterPx),
          mappedPoint: parsePoint(meta?.mappedPoint),
          rawResponse: str(meta?.rawResponse),
          usage: parseUsage(meta?.usage),
          metadataMissing: meta === null,
        });
      }
    }

    // Per-sheet funnel summaries (AITAKEOFF7 Task 4).
    const sheetSummaries: AiScanSheetSummary[] = [];
    for (const file of files) {
      const parsed = SUMMARY_NAME.exec(file.name);
      if (!parsed) continue;
      const meta = await downloadMeta(file.name);
      if (!meta) continue;
      const radiusPoint = parsePoint(meta.radius);
      sheetSummaries.push({
        sheetId: parsed[1],
        proposedTemplate: Math.max(0, Math.round(num(meta.proposed_template))),
        proposedModel: Math.max(0, Math.round(num(meta.proposed_model))),
        afterUnionDedupe: Math.max(0, Math.round(num(meta.after_union_dedupe))),
        afterSuppression: Math.max(0, Math.round(num(meta.after_suppression))),
        sentToVerify: Math.max(0, Math.round(num(meta.sent_to_verify))),
        verified: Math.max(0, Math.round(num(meta.verified))),
        centerMismatchRejected: Math.max(0, Math.round(num(meta.center_mismatch_rejected))),
        stageATiles: Math.max(0, Math.round(num(meta.stage_a_tiles))),
        footprintRasterPx: Number.isFinite(Number(meta.footprint_raster_px))
          ? Number(meta.footprint_raster_px)
          : null,
        radius: radiusPoint,
        templateEngine: str(meta.template_engine),
        templateError: str(meta.template_error),
        templateElapsedMs: Number.isFinite(Number(meta.template_elapsed_ms))
          ? Number(meta.template_elapsed_ms)
          : null,
        templateThreshold: Number.isFinite(Number(meta.template_threshold))
          ? Number(meta.template_threshold)
          : null,
        templateSweeps: Number.isFinite(Number(meta.template_sweeps))
          ? Number(meta.template_sweeps)
          : null,
        templateCount: Number.isFinite(Number(meta.template_count))
          ? Number(meta.template_count)
          : null,
        templateMasked: typeof meta.template_masked === "boolean" ? meta.template_masked : null,
        templateMaskCoverage: Number.isFinite(Number(meta.template_mask_coverage))
          ? Number(meta.template_mask_coverage)
          : null,
        templateTopScores: Array.isArray(meta.template_top_scores)
          ? (meta.template_top_scores as Array<Record<string, unknown>>)
              .slice(0, 5)
              .map((entry) => ({
                x: num(entry?.x),
                y: num(entry?.y),
                score: num(entry?.score),
                rotationDeg: num(entry?.rotation_deg),
                scale: num(entry?.scale),
              }))
              .filter((entry) => Number.isFinite(entry.score))
          : [],
      });
    }

    const sheetOrder = new Map(operation.sheet_ids.map((id, index) => [id, index]));
    const bySheetThenIndex = (
      a: { sheetId: string },
      b: { sheetId: string },
      aIndex: number,
      bIndex: number,
    ) => {
      const sheetSort = (sheetOrder.get(a.sheetId) ?? 999) - (sheetOrder.get(b.sheetId) ?? 999);
      if (sheetSort !== 0) return sheetSort;
      return aIndex - bIndex;
    };
    tiles.sort((a, b) => bySheetThenIndex(a, b, a.tileIndex, b.tileIndex));
    verifications.sort((a, b) => bySheetThenIndex(a, b, a.candidateIndex, b.candidateIndex));
    sheetSummaries.sort(
      (a, b) => (sheetOrder.get(a.sheetId) ?? 999) - (sheetOrder.get(b.sheetId) ?? 999),
    );

    return {
      operation: summary,
      exemplarUrl,
      sheetSummaries,
      tiles,
      verifications,
      diagnosticsAvailable: true,
    };
  });
