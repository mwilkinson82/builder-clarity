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

const cropInput = z.object({
  // Normalized [0,1] sheet-space center (client normalizes before sending).
  x: z.number(),
  y: z.number(),
  base64: z.string().min(1),
  mediaType: z.string().default("image/png"),
});

const discoverInput = z.object({
  // Bounded so one discovery can never fan out into an unbounded embed pile.
  candidates: z.array(cropInput).min(1).max(96),
});

/** Env-tunable cluster threshold — Stage 0's calibration knob. */
function resolveClusterThreshold(): number {
  const raw = Number(process.env.DISCOVERY_CLUSTER_THRESHOLD);
  if (Number.isFinite(raw) && raw > 0 && raw < 1) return raw;
  return DEFAULT_CLUSTER_SIMILARITY_THRESHOLD;
}

export const discoverSheetSymbols = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof discoverInput>) => discoverInput.parse(input))
  .handler(async ({ data }) => {
    const { embedImagesWithClip, isReplicateConfigured } =
      await import("@/lib/ai-takeoff/replicate.server");
    if (!isReplicateConfigured()) {
      throw new Error(
        "The discovery engine is not configured. Add REPLICATE_API_TOKEN to the server environment.",
      );
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

    return {
      clusters,
      candidateCount: data.candidates.length,
      embeddingDim: embeddings[0]?.length ?? 0,
      similarityThreshold: threshold,
      elapsedMs: Date.now() - startedAt,
    };
  });
