// Server-only OpenAI vision access for AI-assisted counts — the failover
// provider for the AITAKEOFF VLM steps so one vendor's latency can't stall a
// scan. Raw fetch, no SDK — same house pattern as anthropic.server.ts. Load via
// dynamic import inside server-function handlers (or vision.server.ts) only.

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
// Default vision model; override with OPENAI_MODEL (e.g. a newer GPT). Kept in
// env so swapping the exact model is config, not code.
const DEFAULT_OPENAI_MODEL = "gpt-4o";
// One call must never hang a scan: fail fast so the caller can fail over.
const OPENAI_CALL_TIMEOUT_MS = 45_000;

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
  // OpenAI takes images as data URLs in the same message as the instruction.
  const content: Array<Record<string, unknown>> = input.images.map((image) => ({
    type: "image_url",
    image_url: { url: `data:${image.mediaType};base64,${image.base64}` },
  }));
  content.push({ type: "text", text: input.instruction });

  const response = await fetch(OPENAI_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    // max_completion_tokens is the current canonical field (older models also
    // accept it); kept generous by default like the Anthropic path.
    body: JSON.stringify({
      model,
      max_completion_tokens: input.maxTokens ?? 2000,
      messages: [{ role: "user", content }],
    }),
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
