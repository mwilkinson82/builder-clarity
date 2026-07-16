// Server-only OpenAI vision access for AI-assisted counts — the failover
// provider for the AITAKEOFF VLM steps so one vendor's latency can't stall a
// scan. Raw fetch, no SDK — same house pattern as anthropic.server.ts. Load via
// dynamic import inside server-function handlers (or vision.server.ts) only.

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_RESPONSES_API_URL = "https://api.openai.com/v1/responses";
// Default vision model — gpt-4o, OpenAI's fast (non-reasoning) multimodal model.
// A live A-100 test showed gpt-5.5 (a reasoning model) spends 2-3 min PER tile
// call; a scan is ~20 tile calls + verify, i.e. 30-60 min — unusable. gpt-4o
// finishes in Claude's ~2 min/scan ballpark. Override with OPENAI_MODEL; the
// reasoning-model handling below still kicks in if you point it at a gpt-5.x.
const DEFAULT_OPENAI_MODEL = "gpt-4o";
// gpt-5.x / o-series spend completion budget on hidden reasoning tokens.
const isReasoningModel = (model: string): boolean => /^(gpt-5|o\d)/i.test(model);
// One call must never hang a scan. Enforced with a hard timeout (below) that
// rejects even if the runtime doesn't honor fetch's AbortSignal — the live test
// showed a call running >170s past this cap.
const OPENAI_CALL_TIMEOUT_MS = 75_000;

/**
 * Fetch with a hard timeout that the caller can rely on. Aborts the request
 * (best effort) AND races a rejecting guard, so even in a runtime that ignores
 * fetch's abort signal the promise still settles by `ms` — the caller (auto
 * mode) then fails over instead of hanging. A leaked request is harmless.
 */
async function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const controller = new AbortController();
  const abortTimer = setTimeout(() => controller.abort(), ms);
  let guardTimer: ReturnType<typeof setTimeout> | undefined;
  const guard = new Promise<never>((_, reject) => {
    guardTimer = setTimeout(
      () => reject(new Error(`The OpenAI model call exceeded ${Math.round(ms / 1000)}s.`)),
      ms,
    );
  });
  try {
    return await Promise.race([fetch(url, { ...init, signal: controller.signal }), guard]);
  } finally {
    clearTimeout(abortTimer);
    if (guardTimer) clearTimeout(guardTimer);
  }
}

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

export type OpenAiImageDetail = "low" | "high" | "original" | "auto";
export type OpenAiReasoningEffort = "none" | "low" | "medium" | "high" | "xhigh" | "max";

export interface OpenAiJsonSchemaFormat {
  name: string;
  schema: Record<string, unknown>;
}

function responsesText(payload: {
  output?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string; refusal?: string }>;
  }>;
}) {
  const outputText = (payload.output ?? [])
    .filter((item) => item.type === "message")
    .flatMap((item) => item.content ?? [])
    .filter((item) => item.type === "output_text" && typeof item.text === "string")
    .map((item) => item.text as string)
    .join("\n")
    .trim();
  if (outputText) return outputText;
  const refusal = (payload.output ?? [])
    .flatMap((item) => item.content ?? [])
    .find((item) => item.type === "refusal" && typeof item.refusal === "string")?.refusal;
  if (refusal) throw new Error(`The OpenAI model refused the drawing review: ${refusal}`);
  throw new Error("The OpenAI model returned no drawing-review output.");
}

async function callOpenAiResponsesVision({
  apiKey,
  model,
  instruction,
  images,
  maxTokens,
  imageDetail,
  reasoningEffort,
  responseJsonSchema,
  timeoutMs,
}: {
  apiKey: string;
  model: string;
  instruction: string;
  images: OpenAiImageInput[];
  maxTokens: number;
  imageDetail: OpenAiImageDetail;
  reasoningEffort: OpenAiReasoningEffort;
  responseJsonSchema?: OpenAiJsonSchemaFormat;
  timeoutMs: number;
}): Promise<OpenAiVisionResult> {
  const content: Array<Record<string, unknown>> = [
    { type: "input_text", text: instruction },
    ...images.map((image) => ({
      type: "input_image",
      image_url: `data:${image.mediaType};base64,${image.base64}`,
      detail: imageDetail,
    })),
  ];
  const requestBody: Record<string, unknown> = {
    model,
    input: [{ role: "user", content }],
    max_output_tokens: maxTokens,
    reasoning: { effort: reasoningEffort },
    store: false,
  };
  if (responseJsonSchema) {
    requestBody.text = {
      format: {
        type: "json_schema",
        name: responseJsonSchema.name,
        strict: true,
        schema: responseJsonSchema.schema,
      },
    };
  }

  const response = await fetchWithTimeout(
    OPENAI_RESPONSES_API_URL,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(requestBody),
    },
    timeoutMs,
  );
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: { message?: string };
    } | null;
    const detail = body?.error?.message || `HTTP ${response.status}`;
    throw new Error(`The OpenAI model call failed: ${detail}`);
  }

  const payload = (await response.json()) as {
    model?: string;
    output?: Array<{
      type?: string;
      content?: Array<{ type?: string; text?: string; refusal?: string }>;
    }>;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  return {
    text: responsesText(payload),
    inputTokens: Math.max(0, Math.round(Number(payload.usage?.input_tokens ?? 0))),
    outputTokens: Math.max(0, Math.round(Number(payload.usage?.output_tokens ?? 0))),
    model: payload.model?.trim() || model,
  };
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
  api?: "chat_completions" | "responses";
  imageDetail?: OpenAiImageDetail;
  reasoningEffort?: OpenAiReasoningEffort;
  responseJsonSchema?: OpenAiJsonSchemaFormat;
  timeoutMs?: number;
}): Promise<OpenAiVisionResult> {
  const apiKey = requireOpenAiApiKey();
  const model = input.model?.trim() || resolveOpenAiModel();
  const reasoning = isReasoningModel(model);
  if (input.api === "responses") {
    return callOpenAiResponsesVision({
      apiKey,
      model,
      instruction: input.instruction,
      images: input.images,
      maxTokens: Math.max(input.maxTokens ?? 4000, reasoning ? 3000 : 1),
      imageDetail: input.imageDetail ?? "auto",
      reasoningEffort: input.reasoningEffort ?? "low",
      responseJsonSchema: input.responseJsonSchema,
      timeoutMs: input.timeoutMs ?? OPENAI_CALL_TIMEOUT_MS,
    });
  }
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

  const response = await fetchWithTimeout(
    OPENAI_API_URL,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(requestBody),
    },
    OPENAI_CALL_TIMEOUT_MS,
  );

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
