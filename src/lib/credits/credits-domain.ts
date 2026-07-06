// Credits domain logic for AI-assisted features.
// Pure functions only: no Supabase, no Stripe, no fetch, no env reads.
// Server functions and UI call into this module so credit math, pricing,
// and refund compensation can be unit-tested without secrets.

export const SIGNUP_GRANT_CREDITS = 50;
export const AI_COUNT_SCAN_CREDITS_PER_SHEET = 1;
export const DEFAULT_MAX_SHEETS_PER_SCAN = 30;

export type CreditLedgerReason =
  "signup_grant" | "purchase" | "ai_count_scan" | "refund" | "admin_adjustment";

export interface CreditLedgerEntryInput {
  delta: number;
  reason: CreditLedgerReason;
  reference: string;
}

/** Balance is always SUM(delta) over the append-only ledger. */
export function creditBalance(entries: Array<{ delta: number }>): number {
  return entries.reduce((sum, entry) => sum + Math.trunc(entry.delta), 0);
}

/** Credits required to scan the given number of sheets. */
export function quoteScanCredits(sheetCount: number): number {
  if (!Number.isFinite(sheetCount) || sheetCount <= 0) return 0;
  return Math.trunc(sheetCount) * AI_COUNT_SCAN_CREDITS_PER_SHEET;
}

/**
 * Compensating ledger entry for a failed or partially completed scan.
 * The operation charged `creditsCharged` up front; `sheetsCompleted` sheets
 * delivered results before the failure. Refund the remainder. Returns null
 * when there is nothing to refund (fully consumed, or nothing charged).
 */
export function refundEntryForFailedScan(input: {
  operationId: string;
  creditsCharged: number;
  sheetsCompleted: number;
}): CreditLedgerEntryInput | null {
  const charged = Math.max(0, Math.trunc(input.creditsCharged));
  const consumed = Math.max(0, Math.trunc(input.sheetsCompleted)) * AI_COUNT_SCAN_CREDITS_PER_SHEET;
  const refund = charged - Math.min(consumed, charged);
  if (refund <= 0) return null;
  return {
    delta: refund,
    reason: "refund",
    reference: input.operationId,
  };
}

// --- Credit packs (config-driven; default 100 credits / $25) ---

export interface CreditPack {
  id: string;
  credits: number;
  amountCents: number;
  label: string;
}

export const DEFAULT_CREDIT_PACKS: CreditPack[] = [
  { id: "pack_100", credits: 100, amountCents: 2500, label: "100 credits" },
];

/**
 * Parse a JSON env override for credit packs (CREDIT_PACKS_JSON).
 * Any malformed input falls back to the defaults — pack config must never
 * take the purchase flow down.
 */
export function creditPacksFromEnv(raw: string | undefined | null): CreditPack[] {
  if (!raw || !raw.trim()) return DEFAULT_CREDIT_PACKS;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return DEFAULT_CREDIT_PACKS;
    const packs: CreditPack[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const candidate = item as Record<string, unknown>;
      const id = typeof candidate.id === "string" ? candidate.id.trim() : "";
      const credits = Number(candidate.credits);
      const amountCents = Number(candidate.amountCents);
      if (!id || !Number.isInteger(credits) || credits <= 0) continue;
      if (!Number.isInteger(amountCents) || amountCents <= 0) continue;
      const label =
        typeof candidate.label === "string" && candidate.label.trim()
          ? candidate.label.trim()
          : `${credits} credits`;
      packs.push({ id, credits, amountCents, label });
    }
    return packs.length > 0 ? packs : DEFAULT_CREDIT_PACKS;
  } catch {
    return DEFAULT_CREDIT_PACKS;
  }
}

export function findCreditPack(packs: CreditPack[], packId: string): CreditPack | null {
  return packs.find((pack) => pack.id === packId) ?? null;
}

// --- Model routing + pricing table ---
// Switching models must never require code changes: the model comes from
// ANTHROPIC_MODEL, and unknown models fall back to conservative pricing.

export const DEFAULT_AI_MODEL = "claude-sonnet-4-6";

export interface ModelPricePerMTok {
  /** Cents per million input tokens. */
  inputCents: number;
  /** Cents per million output tokens. */
  outputCents: number;
}

export const MODEL_PRICES_PER_MTOK: Record<string, ModelPricePerMTok> = {
  "claude-sonnet-4-6": { inputCents: 300, outputCents: 1500 },
  "claude-sonnet-5": { inputCents: 300, outputCents: 1500 },
  "claude-haiku-4-5": { inputCents: 100, outputCents: 500 },
  "claude-opus-4-6": { inputCents: 500, outputCents: 2500 },
  "claude-opus-4-7": { inputCents: 500, outputCents: 2500 },
  "claude-opus-4-8": { inputCents: 500, outputCents: 2500 },
  // OpenAI vision (failover provider): standard per-Mtok list prices.
  "gpt-5.5": { inputCents: 500, outputCents: 3000 },
  "gpt-4o": { inputCents: 250, outputCents: 1000 },
};

/** Conservative fallback for models not in the table (priced at Opus tier). */
export const UNKNOWN_MODEL_PRICE_PER_MTOK: ModelPricePerMTok = {
  inputCents: 500,
  outputCents: 2500,
};

export function priceForModel(
  model: string,
  prices: Record<string, ModelPricePerMTok> = MODEL_PRICES_PER_MTOK,
): ModelPricePerMTok {
  return prices[model] ?? UNKNOWN_MODEL_PRICE_PER_MTOK;
}

/**
 * API cost in integer cents for a call (or accumulated calls) on `model`.
 * Rounds up so the margin dashboard never understates cost.
 */
export function computeApiCostCents(
  model: string,
  inputTokens: number,
  outputTokens: number,
  prices: Record<string, ModelPricePerMTok> = MODEL_PRICES_PER_MTOK,
): number {
  const price = priceForModel(model, prices);
  const inTok = Math.max(0, inputTokens);
  const outTok = Math.max(0, outputTokens);
  const cents = (inTok * price.inputCents + outTok * price.outputCents) / 1_000_000;
  return Math.ceil(cents);
}

/** Model routing: env override wins, otherwise the default model. */
export function resolveAiModel(envValue: string | undefined | null): string {
  const trimmed = envValue?.trim();
  return trimmed ? trimmed : DEFAULT_AI_MODEL;
}
