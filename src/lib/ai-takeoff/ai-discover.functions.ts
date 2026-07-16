// Symbol discovery server path (SYMBOLDISCOVERY Stage 0).
// The identification-library front half: the client proposes candidate crops
// (ink-density peaks, same proposer as the embedding scan) and sends them
// here; this embeds ALL of them on Replicate's GPUs and clusters them
// server-side, returning only the small group structure — the estimator gets
// shown "the kinds of symbols on this sheet" without 768-float vectors ever
// riding to the browser.
//
// Credits: the CLIENT wraps discovery in the existing beginAiCountScan /
// completeAiCountScan / failAiCountScan flow (1 credit per sheet, failure
// refunds, operation diagnostics) — this function stays money-agnostic, the
// same division of labor as embedCropsForAiCounts inside a paid scan.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  clusterEmbeddings,
  DEFAULT_CLUSTER_SIMILARITY_THRESHOLD,
} from "@/lib/ai-takeoff/embedding-match/embedding-cluster-domain";
import {
  DEFAULT_SYMBOL_LIBRARY_MATCH_THRESHOLD,
  parseSymbolEmbedding,
  resolveSymbolLibrarySuggestions,
  type SymbolLibraryExample,
} from "@/lib/ai-takeoff/symbol-library-domain";
import {
  dynamicTable,
  normalizeOperation,
  str,
  type DynamicSupabaseError,
  type DynamicSupabaseResult,
} from "@/lib/ai-takeoff/ai-takeoff-server-shared";

const cropInput = z.object({
  // Normalized [0,1] sheet-space center (client normalizes before sending).
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  base64: z.string().min(1).max(1_500_000),
  mediaType: z.string().default("image/png"),
});

const discoverInput = z.object({
  estimate_id: z.string().uuid(),
  sheet_id: z.string().uuid(),
  operation_id: z.string().uuid(),
  // Bounded so one discovery can never fan out into an unbounded embed pile.
  candidates: z.array(cropInput).min(1).max(96),
});

/** Env-tunable cluster threshold — Stage 0's calibration knob. */
function resolveClusterThreshold(): number {
  const raw = Number(process.env.DISCOVERY_CLUSTER_THRESHOLD);
  if (Number.isFinite(raw) && raw > 0 && raw < 1) return raw;
  return DEFAULT_CLUSTER_SIMILARITY_THRESHOLD;
}

function resolveLibraryThreshold(): number {
  const raw = Number(process.env.AI_SYMBOL_LIBRARY_MATCH_THRESHOLD);
  if (Number.isFinite(raw) && raw > 0 && raw <= 1) return raw;
  return DEFAULT_SYMBOL_LIBRARY_MATCH_THRESHOLD;
}

function isMissingSymbolLibrarySchema(error: DynamicSupabaseError | null | undefined) {
  const message = error?.message?.toLowerCase() ?? "";
  return Boolean(
    error &&
    (error.code === "42P01" || error.code === "PGRST205" || message.includes("ai_symbol_library")),
  );
}

async function loadSymbolLibraryExamples(
  client: unknown,
  organizationId: string,
): Promise<SymbolLibraryExample[]> {
  const examplesResult = (await dynamicTable(client, "ai_symbol_library_examples")
    .select("library_item_id,embedding")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(500)) as DynamicSupabaseResult<Array<Record<string, unknown>>>;
  if (examplesResult.error) {
    if (isMissingSymbolLibrarySchema(examplesResult.error)) return [];
    throw new Error(examplesResult.error.message);
  }
  const exampleRows = examplesResult.data ?? [];
  const itemIds = [...new Set(exampleRows.map((row) => str(row.library_item_id)).filter(Boolean))];
  if (itemIds.length === 0) return [];
  const itemsResult = (await dynamicTable(client, "ai_symbol_library_items")
    .select("id,label,trade,unit,cost_library_item_id,active")
    .in("id", itemIds)) as DynamicSupabaseResult<Array<Record<string, unknown>>>;
  if (itemsResult.error) {
    if (isMissingSymbolLibrarySchema(itemsResult.error)) return [];
    throw new Error(itemsResult.error.message);
  }
  const itemsById = new Map(
    (itemsResult.data ?? [])
      .filter((row) => row.active !== false)
      .map((row) => [str(row.id), row] as const),
  );
  return exampleRows.flatMap((row): SymbolLibraryExample[] => {
    const item = itemsById.get(str(row.library_item_id));
    const embedding = parseSymbolEmbedding(row.embedding);
    if (!item || !embedding) return [];
    return [
      {
        itemId: str(item.id),
        label: str(item.label),
        trade: str(item.trade),
        unit: str(item.unit, "EA"),
        costLibraryItemId: item.cost_library_item_id ? str(item.cost_library_item_id) : null,
        embedding,
      },
    ];
  });
}

export const discoverSheetSymbols = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof discoverInput>) => discoverInput.parse(input))
  .handler(async ({ data, context }) => {
    const { embedImagesWithClip, isReplicateConfigured } =
      await import("@/lib/ai-takeoff/replicate.server");
    if (!isReplicateConfigured()) {
      throw new Error(
        "The discovery engine is not configured. Add REPLICATE_API_TOKEN to the server environment.",
      );
    }

    const estimateResult = await dynamicTable(context.supabase, "estimates")
      .select("id,organization_id")
      .eq("id", data.estimate_id)
      .maybeSingle();
    if (estimateResult.error || !estimateResult.data) {
      throw new Error(estimateResult.error?.message ?? "Estimate was not found.");
    }
    const organizationId = str((estimateResult.data as Record<string, unknown>).organization_id);
    const sheetResult = await dynamicTable(context.supabase, "estimate_plan_sheets")
      .select("id")
      .eq("id", data.sheet_id)
      .eq("estimate_id", data.estimate_id)
      .maybeSingle();
    if (sheetResult.error || !sheetResult.data) {
      throw new Error(sheetResult.error?.message ?? "The discovery sheet was not found.");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const operationResult = await dynamicTable(supabaseAdmin, "ai_operations")
      .select("*")
      .eq("id", data.operation_id)
      .maybeSingle();
    if (operationResult.error || !operationResult.data) {
      throw new Error(
        operationResult.error?.message ?? "The AI discovery operation was not found.",
      );
    }
    const operation = normalizeOperation(operationResult.data as Record<string, unknown>);
    if (
      operation.created_by !== context.userId ||
      operation.organization_id !== organizationId ||
      operation.estimate_id !== data.estimate_id ||
      operation.status !== "pending" ||
      !operation.sheet_ids.includes(data.sheet_id)
    ) {
      throw new Error("This AI discovery operation is not available to the current estimator.");
    }

    const startedAt = Date.now();
    const embeddings = await embedImagesWithClip(
      data.candidates.map((candidate) => ({
        base64: candidate.base64,
        mediaType: candidate.mediaType,
      })),
    );
    const threshold = resolveClusterThreshold();
    const clusters = clusterEmbeddings(embeddings, { similarityThreshold: threshold });
    const libraryExamples = await loadSymbolLibraryExamples(context.supabase, organizationId);
    const librarySuggestions = resolveSymbolLibrarySuggestions({
      clusters,
      embeddings,
      examples: libraryExamples,
      threshold: resolveLibraryThreshold(),
    });

    return {
      clusters,
      librarySuggestions,
      libraryExampleCount: libraryExamples.length,
      candidateCount: data.candidates.length,
      embeddingDim: embeddings[0]?.length ?? 0,
      similarityThreshold: threshold,
      elapsedMs: Date.now() - startedAt,
    };
  });
