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
import type { AiCountCandidate, TileTokenCheck } from "@/lib/ai-takeoff/ai-takeoff-domain";
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
  centerRefined: boolean;
  mappedPoint: { x: number; y: number } | null;
  rawResponse: string;
  usage: { inputTokens: number; outputTokens: number } | null;
  metadataMissing: boolean;
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
  verifications: AiScanVerification[];
  diagnosticsAvailable: boolean;
}

const ARTIFACT_NAME = /^(tile|verify)-([0-9a-f-]{36})-(\d+)\.(png|json)$/;

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
          centerRefined: meta?.centerRefined === true,
          mappedPoint: parsePoint(meta?.mappedPoint),
          rawResponse: str(meta?.rawResponse),
          usage: parseUsage(meta?.usage),
          metadataMissing: meta === null,
        });
      }
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

    return { operation: summary, exemplarUrl, tiles, verifications, diagnosticsAvailable: true };
  });
