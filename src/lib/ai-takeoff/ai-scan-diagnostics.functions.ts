// Scan diagnostics server function (AITAKEOFF2 Task 4) — mechanically split
// out of ai-takeoff.functions.ts (zero behavior change) so the scan pipeline
// file stays under the repo size limit. Super admin only: shows the exemplar
// crop actually sent to the model, every tile with its sheet-space origin,
// the raw model responses, and the mapped positions.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { AiCountCandidate } from "@/lib/ai-takeoff/ai-takeoff-domain";
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
