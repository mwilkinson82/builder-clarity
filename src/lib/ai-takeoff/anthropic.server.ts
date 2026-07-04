// Server-only Anthropic Messages API access for AI-assisted counts.
// Raw fetch, no SDK dependency — same house pattern as stripe.server.ts.
// Load via dynamic import inside server-function handlers only.

import { resolveAiModel } from "@/lib/credits/credits-domain";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_API_VERSION = "2023-06-01";
// One tile call should never hang a scan: fail fast, refund per Task 0.
const ANTHROPIC_CALL_TIMEOUT_MS = 90_000;

export function isAiAssistConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

export function resolveConfiguredAiModel(): string {
  return resolveAiModel(process.env.ANTHROPIC_MODEL);
}

function requireAnthropicApiKey(): string {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) {
    throw new Error(
      "AI assist is not configured. Add ANTHROPIC_API_KEY to the server environment (create a key at console.anthropic.com).",
    );
  }
  return key;
}

export interface AnthropicImageInput {
  mediaType: string;
  base64: string;
}

export interface AnthropicVisionResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

/**
 * Send images + a text instruction to the configured model and return the
 * text response plus token usage for cost metering.
 */
export async function callAnthropicVision(input: {
  model: string;
  instruction: string;
  images: AnthropicImageInput[];
  maxTokens?: number;
}): Promise<AnthropicVisionResult> {
  const apiKey = requireAnthropicApiKey();
  const content: Array<Record<string, unknown>> = input.images.map((image) => ({
    type: "image",
    source: {
      type: "base64",
      media_type: image.mediaType,
      data: image.base64,
    },
  }));
  content.push({ type: "text", text: input.instruction });

  const response = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_API_VERSION,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: input.model,
      max_tokens: input.maxTokens ?? 2000,
      messages: [{ role: "user", content }],
    }),
    signal: AbortSignal.timeout(ANTHROPIC_CALL_TIMEOUT_MS),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: { type?: string; message?: string };
    } | null;
    const detail = body?.error?.message || `HTTP ${response.status}`;
    throw new Error(`The AI model call failed: ${detail}`);
  }

  const payload = (await response.json()) as {
    content?: Array<{ type?: string; text?: string }>;
    usage?: { input_tokens?: number; output_tokens?: number };
    stop_reason?: string;
  };

  const text = (payload.content ?? [])
    .filter((block) => block?.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n");

  return {
    text,
    inputTokens: Math.max(0, Math.round(Number(payload.usage?.input_tokens ?? 0))),
    outputTokens: Math.max(0, Math.round(Number(payload.usage?.output_tokens ?? 0))),
  };
}
