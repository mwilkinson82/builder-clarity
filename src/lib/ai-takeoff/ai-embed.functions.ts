// Server embedding engine — the AITAKEOFF12 server path (find-more-like-this).
// The client proposes candidate crops (cheap ink-density peaks) and sends them
// here with the tagged exemplar; this embeds all of them on Replicate's GPUs and
// returns each candidate's cosine similarity to the exemplar. Selection (threshold
// + NMS) runs client-side with the sheet geometry, reusing embedding-match-domain.
// Runs the same for every user regardless of device — the reason we went server.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { cosineSimilarity } from "@/lib/ai-takeoff/embedding-match/embedding-match-domain";

const cropInput = z.object({
  // Normalized [0,1] sheet-space center (client normalizes before sending).
  x: z.number(),
  y: z.number(),
  scale: z.number().default(1),
  base64: z.string().min(1),
  mediaType: z.string().default("image/png"),
});

const embedCropsInput = z.object({
  exemplar: z.object({ base64: z.string().min(1), mediaType: z.string().default("image/png") }),
  // Bounded so one scan can never fan out into an unbounded pile of embed calls.
  candidates: z.array(cropInput).max(96),
});

export const embedCropsForAiCounts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof embedCropsInput>) => embedCropsInput.parse(input))
  .handler(async ({ data }) => {
    const { embedImagesWithClip, isReplicateConfigured } =
      await import("@/lib/ai-takeoff/replicate.server");
    if (!isReplicateConfigured()) {
      throw new Error(
        "The embedding engine is not configured. Add REPLICATE_API_TOKEN to the server environment.",
      );
    }
    if (data.candidates.length === 0) {
      return {
        scored: [] as Array<{ x: number; y: number; scale: number; score: number }>,
        embeddingDim: 0,
      };
    }

    const startedAt = Date.now();
    // Index 0 is the exemplar; the rest are candidates, order preserved.
    const embeddings = await embedImagesWithClip([
      { base64: data.exemplar.base64, mediaType: data.exemplar.mediaType },
      ...data.candidates.map((candidate) => ({
        base64: candidate.base64,
        mediaType: candidate.mediaType,
      })),
    ]);
    const exemplar = embeddings[0];
    const scored = data.candidates.map((candidate, index) => ({
      x: candidate.x,
      y: candidate.y,
      scale: candidate.scale,
      score: cosineSimilarity(exemplar, embeddings[index + 1]),
    }));
    return { scored, embeddingDim: exemplar.length, elapsedMs: Date.now() - startedAt };
  });
