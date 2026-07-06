// Provider-agnostic VLM access for AI-assisted counts, with automatic failover.
// A single vendor's latency must never stall a scan (founder directive
// 2026-07-06), so the AITAKEOFF vision steps route through here instead of
// calling one provider directly. Server-only; load via dynamic import inside
// server-function handlers.
//
// AI_VLM_PROVIDER selects behavior:
//   "anthropic"      → Anthropic only (prior behavior)
//   "openai"         → OpenAI only
//   "auto" (default) → try providers in order, fall back on timeout/error
// AI_VLM_PRIMARY ("anthropic" | "openai") flips which provider leads in "auto".
// Only providers whose API key is present are ever attempted.

import { resolveAiModel } from "@/lib/credits/credits-domain";
import { planVisionProviders, type VisionProvider } from "@/lib/ai-takeoff/vision-domain";

export type { VisionProvider };

// Kept in sync with openai.server.ts DEFAULT_OPENAI_MODEL.
const DEFAULT_OPENAI_MODEL = "gpt-5.5";

/** Ordered list of providers to attempt, primary first, per env config. */
export function resolveProviderPlan(): VisionProvider[] {
  return planVisionProviders({
    anthropicConfigured: Boolean(process.env.ANTHROPIC_API_KEY?.trim()),
    openAiConfigured: Boolean(process.env.OPENAI_API_KEY?.trim()),
    preference: process.env.AI_VLM_PROVIDER,
    primary: process.env.AI_VLM_PRIMARY,
  });
}

export function isVisionConfigured(): boolean {
  return resolveProviderPlan().length > 0;
}

/** Model label for the leading provider — used for operation.model_used + readiness. */
export function resolveVisionModel(): string {
  const [first] = resolveProviderPlan();
  if (first === "openai") return process.env.OPENAI_MODEL?.trim() || DEFAULT_OPENAI_MODEL;
  return resolveAiModel(process.env.ANTHROPIC_MODEL);
}

/** The leading provider label (diagnostics/readiness). */
export function resolveVisionProvider(): VisionProvider | "none" {
  return resolveProviderPlan()[0] ?? "none";
}

export interface VisionImageInput {
  mediaType: string;
  base64: string;
}

export interface VisionResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  /** The model that actually produced the response (for cost metering). */
  model: string;
  provider: VisionProvider;
}

/**
 * Run a vision request through the configured provider(s). In "auto" mode a
 * timeout or error on the primary transparently fails over to the next
 * provider, so a slow vendor degrades to a backup instead of stalling the scan.
 * `input.model` is an optional Anthropic-model hint (from operation.model_used);
 * it is ignored by the OpenAI path, which uses OPENAI_MODEL.
 */
export async function callVision(input: {
  instruction: string;
  images: VisionImageInput[];
  maxTokens?: number;
  model?: string;
}): Promise<VisionResult> {
  const plan = resolveProviderPlan();
  if (plan.length === 0) {
    throw new Error(
      "AI assist is not configured. Add ANTHROPIC_API_KEY or OPENAI_API_KEY to the server environment.",
    );
  }

  let lastError: unknown = null;
  for (const provider of plan) {
    try {
      if (provider === "anthropic") {
        const { callAnthropicVision, resolveConfiguredAiModel } =
          await import("@/lib/ai-takeoff/anthropic.server");
        const model = input.model?.trim() || resolveConfiguredAiModel();
        const result = await callAnthropicVision({
          model,
          instruction: input.instruction,
          images: input.images,
          maxTokens: input.maxTokens,
        });
        return { ...result, model, provider };
      }
      const { callOpenAiVision } = await import("@/lib/ai-takeoff/openai.server");
      const result = await callOpenAiVision({
        instruction: input.instruction,
        images: input.images,
        maxTokens: input.maxTokens,
      });
      return {
        text: result.text,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        model: result.model,
        provider,
      };
    } catch (error) {
      // Auto-failover: remember the error and try the next configured provider.
      lastError = error;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("All configured vision providers failed.");
}
