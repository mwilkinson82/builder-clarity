// Pure provider-selection logic for the VLM failover (AITAKEOFF, 2026-07-06).
// No env / no network here so the node smoke can cover the decision table.
// Relative-import safe: keep this free of "@/" aliases.

export type VisionProvider = "anthropic" | "openai";

/**
 * Ordered list of providers to attempt, primary first.
 * - preference "anthropic"/"openai" pins a single provider (if configured).
 * - "auto"/unset returns every configured provider, primary first, so a
 *   timeout/error on the leader fails over to the next.
 * - primary "openai" makes OpenAI lead the auto order.
 * Only providers whose key is present are ever included.
 */
export function planVisionProviders(input: {
  anthropicConfigured: boolean;
  openAiConfigured: boolean;
  preference?: string | null;
  primary?: string | null;
}): VisionProvider[] {
  const available: VisionProvider[] = [];
  if (input.anthropicConfigured) available.push("anthropic");
  if (input.openAiConfigured) available.push("openai");

  const pref = input.preference?.trim().toLowerCase();
  if (pref === "anthropic") return available.filter((p) => p === "anthropic");
  if (pref === "openai") return available.filter((p) => p === "openai");

  // "auto" (default): all configured providers, primary first.
  if (input.primary?.trim().toLowerCase() === "openai") {
    return [...available].sort((a, b) => (a === "openai" ? -1 : b === "openai" ? 1 : 0));
  }
  return available; // Anthropic leads when present.
}
