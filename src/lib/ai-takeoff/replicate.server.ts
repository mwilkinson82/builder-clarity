// Server-only Replicate access for CLIP image embeddings (AI-takeoff server engine).
// Raw fetch, no SDK — same house pattern as anthropic.server.ts. Load via dynamic
// import inside server-function handlers only.
//
// The exemplar and each candidate crop are embedded into a vector; cosine of those
// vectors is the match score. CLIP is the ready-made model on Replicate; the slug
// and input/output handling are env-tunable so a swap to a DINOv2 endpoint later is
// config, not code. The embedding runs on Replicate's GPUs, so every user gets the
// same speed regardless of their device — the whole point of the server engine.

// Default: a fast CLIP embedding model. Override with REPLICATE_EMBED_MODEL.
const DEFAULT_MODEL = "krthr/clip-embeddings";
const DEFAULT_INPUT_FIELD = "image";
const REPLICATE_API = "https://api.replicate.com/v1";
// One embed call must never hang a scan: fail fast per crop.
const CALL_TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 800;
const MAX_POLLS = 60;
// Replicate accounts have a concurrency ceiling; stay conservative.
const EMBED_CONCURRENCY = 6;

export function isReplicateConfigured(): boolean {
  return Boolean(process.env.REPLICATE_API_TOKEN?.trim());
}

function requireToken(): string {
  const token = process.env.REPLICATE_API_TOKEN?.trim();
  if (!token) {
    throw new Error(
      "The embedding engine is not configured. Add REPLICATE_API_TOKEN to the server environment (create one at replicate.com/account/api-tokens).",
    );
  }
  return token;
}

const resolveModel = () => process.env.REPLICATE_EMBED_MODEL?.trim() || DEFAULT_MODEL;
const resolveInputField = () =>
  process.env.REPLICATE_EMBED_INPUT_FIELD?.trim() || DEFAULT_INPUT_FIELD;

/**
 * Resolve the version hash to run. Community models (like krthr/clip-embeddings)
 * MUST be run through POST /v1/predictions with a version — the
 * /v1/models/{owner}/{name}/predictions endpoint is official-models-only and 404s
 * ("The requested resource could not be found") for a community model. We look up
 * the model's latest version once per batch; REPLICATE_EMBED_VERSION pins it
 * explicitly (also lets an official/deployment swap skip the lookup).
 */
async function resolveVersion(model: string, token: string): Promise<string> {
  const pinned = process.env.REPLICATE_EMBED_VERSION?.trim();
  if (pinned) return pinned;
  const response = await fetch(`${REPLICATE_API}/models/${model}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { detail?: string } | null;
    throw new Error(
      body?.detail ||
        `Could not resolve the embedding model "${model}" (${response.status}). Check REPLICATE_EMBED_MODEL, or pin REPLICATE_EMBED_VERSION.`,
    );
  }
  const body = (await response.json()) as { latest_version?: { id?: string } };
  const id = body?.latest_version?.id;
  if (!id) {
    throw new Error(
      `The embedding model "${model}" has no runnable version. Pin one with REPLICATE_EMBED_VERSION.`,
    );
  }
  return id;
}

const isNumberArray = (v: unknown): v is number[] =>
  Array.isArray(v) && v.length > 0 && v.every((n) => typeof n === "number" && Number.isFinite(n));

/**
 * Pull a flat float vector out of whatever shape the model returns — different
 * embedding models wrap it differently ([...], {embedding:[...]}, [[...]],
 * [{embedding:[...]}]). Kept defensive on purpose: the exact shape is confirmed
 * on the first live call, and this survives common variations without a code change.
 */
export function extractEmbedding(output: unknown): number[] | null {
  if (isNumberArray(output)) return output;
  if (Array.isArray(output) && output.length > 0) {
    if (isNumberArray(output[0])) return output[0];
    if (output[0] && typeof output[0] === "object") {
      const first = output[0] as Record<string, unknown>;
      for (const key of ["embedding", "embeddings", "features", "vector"]) {
        if (isNumberArray(first[key])) return first[key] as number[];
      }
    }
  }
  if (output && typeof output === "object") {
    const obj = output as Record<string, unknown>;
    for (const key of ["embedding", "embeddings", "features", "vector"]) {
      const value = obj[key];
      if (isNumberArray(value)) return value;
      if (Array.isArray(value) && value.length > 0 && isNumberArray(value[0])) return value[0];
    }
  }
  return null;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Embed one data-URI image, waiting on the prediction (sync-preferred, poll fallback). */
async function embedOne(
  dataUri: string,
  token: string,
  version: string,
  inputField: string,
): Promise<number[]> {
  const response = await fetch(`${REPLICATE_API}/predictions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      // Ask Replicate to hold the request open until the prediction finishes.
      Prefer: "wait",
    },
    body: JSON.stringify({ version, input: { [inputField]: dataUri } }),
    signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
  });
  let prediction = (await response.json()) as {
    status?: string;
    output?: unknown;
    error?: unknown;
    detail?: string;
    urls?: { get?: string };
  };
  if (!response.ok) {
    throw new Error(prediction?.detail || `The embedding service returned ${response.status}.`);
  }
  let polls = 0;
  while (
    prediction.status &&
    prediction.status !== "succeeded" &&
    prediction.status !== "failed" &&
    prediction.status !== "canceled" &&
    prediction.urls?.get &&
    polls < MAX_POLLS
  ) {
    await sleep(POLL_INTERVAL_MS);
    const poll = await fetch(prediction.urls.get, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    });
    prediction = await poll.json();
    polls += 1;
  }
  if (prediction.status === "failed" || prediction.status === "canceled") {
    throw new Error(
      typeof prediction.error === "string"
        ? prediction.error
        : "The embedding service failed on a crop.",
    );
  }
  const embedding = extractEmbedding(prediction.output);
  if (!embedding) throw new Error("The embedding service returned no vector for a crop.");
  return embedding;
}

export interface EmbedImageInput {
  base64: string;
  mediaType: string;
}

/**
 * Embed a list of images, bounded-concurrency so we respect Replicate's account
 * limit. Order is preserved so index 0 stays the exemplar.
 */
export async function embedImagesWithClip(images: EmbedImageInput[]): Promise<number[][]> {
  const token = requireToken();
  const model = resolveModel();
  const inputField = resolveInputField();
  // Resolve the runnable version once, then reuse it for every crop in the batch.
  const version = await resolveVersion(model, token);
  const out = new Array<number[]>(images.length);
  let cursor = 0;
  const runWorker = async () => {
    while (cursor < images.length) {
      const index = cursor;
      cursor += 1;
      const image = images[index];
      out[index] = await embedOne(
        `data:${image.mediaType};base64,${image.base64}`,
        token,
        version,
        inputField,
      );
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(EMBED_CONCURRENCY, images.length) }, () => runWorker()),
  );
  return out;
}
