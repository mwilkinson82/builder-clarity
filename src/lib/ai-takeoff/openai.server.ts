// Server-only OpenAI vision access for AI-assisted counts — the failover
// provider for the AITAKEOFF VLM steps so one vendor's latency can't stall a
// scan. Raw fetch, no SDK — same house pattern as anthropic.server.ts. Load via
// dynamic import inside server-function handlers (or vision.server.ts) only.

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
// Default vision model — GPT-5.5, OpenAI's frontier multimodal model (accuracy
// over cost per founder call; cost passes through to the user). Override with
// OPENAI_MODEL so swapping the exact model is config, not code.
const DEFAULT_OPENAI_MODEL = "gpt-5.5";
// gpt-5.x / o-series spend completion budget on hidden reasoning tokens.
const isReasoningModel = (model: string): boolean => /^(gpt-5|o\d)/i.test(model);
// One call must never hang a scan, but a frontier reasoning model needs a little
// room: cap at 75s, then the caller fails over (auto mode) or errors cleanly.
const OPENAI_CALL_TIMEOUT_MS = 75_000;

export function isOpenAiConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

export function resolveOpenAiModel(): string {
  return process.env.OPENAI_MODEL?.trim() || DEFAULT_OPENAI_MODEL;
}

function requireOpenAiApiKey(): string {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) {
    throw new Error(
      "OpenAI vision is not configured. Add OPENAI_API_KEY to the server environment (create a key at platform.openai.com/api-keys).",
    );
  }
  return key;
}

export interface OpenAiImageInput {
  mediaType: string;
  base64: string;
}

export interface OpenAiVisionResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
}

/**
 * Send images + a text instruction to the configured OpenAI vision model and
 * return the text plus token usage. Mirrors callAnthropicVision so the two are
 * interchangeable behind vision.server.ts.
 */
export async function callOpenAiVision(input: {
  model?: string;
  instruction: string;
  images: OpenAiImageInput[];
  maxTokens?: number;
}): Promise<OpenAiVisionResult> {
  const apiKey = requireOpenAiApiKey();
  const model = input.model?.trim() || resolveOpenAiModel();
  const reasoning = isReasoningModel(model);
  // OpenAI takes images as data URLs in the same message as the instruction.
  const content: Array<Record<string, unknown>> = input.images.map((image) => ({
    type: "image_url",
    image_url: { url: `data:${image.mediaType};base64,${image.base64}` },
  }));
  content.push({ type: "text", text: input.instruction });

  // max_completion_tokens is the canonical field. For reasoning models, floor it
  // so hidden reasoning tokens don't starve the answer (a tight verify cap would
  // otherwise return empty); keep effort low — these are structured extraction
  // calls, not open-ended reasoning — so it stays fast.
  const requestBody: Record<string, unknown> = {
    model,
    messages: [{ role: "user", content }],
    max_completion_tokens: reasoning
      ? Math.max(input.maxTokens ?? 2000, 1500)
      : (input.maxTokens ?? 2000),
  };
  if (reasoning) {
    requestBody.reasoning_effort = process.env.OPENAI_REASONING_EFFORT?.trim() || "low";
  }

  const response = await fetch(OPENAI_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(requestBody),
    signal: AbortSignal.timeout(OPENAI_CALL_TIMEOUT_MS),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: { message?: string };
    } | null;
    const detail = body?.error?.message || `HTTP ${response.status}`;
    throw new Error(`The OpenAI model call failed: ${detail}`);
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string | null } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };

  const text = (payload.choices ?? [])
    .map((choice) => choice?.message?.content)
    .filter((value): value is string => typeof value === "string")
    .join("\n");

  return {
    text,
    inputTokens: Math.max(0, Math.round(Number(payload.usage?.prompt_tokens ?? 0))),
    outputTokens: Math.max(0, Math.round(Number(payload.usage?.completion_tokens ?? 0))),
    model,
  };
}
