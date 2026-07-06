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
// Throttle resilience. An under-funded Replicate balance (<$5) trips a punitive
// rate limit — 6 req/min, burst of 1 — which our EMBED_CONCURRENCY=6 concurrent
// embeds hit head-on with an HTTP 429. A funded account never sees this, so the
// backoff only engages when actually throttled; the concurrency stays high.
const EMBED_MAX_ATTEMPTS = 5; // 1 initial try + up to 4 retries
const EMBED_RETRY_BASE_MS = 1_000;
const EMBED_RETRY_MAX_MS = 20_000; // the throttle message resets in ~10s; leave headroom

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

/**
 * Parse an HTTP `Retry-After` header into milliseconds. Replicate sends the
 * delta-seconds form (e.g. "10"); the HTTP-date form is handled defensively too.
 * Returns null when absent or unparseable, so the caller falls back to its own
 * exponential schedule. Pure — the only tested path is the numeric one.
 */
export function parseRetryAfterMs(headerValue: string | null | undefined): number | null {
  if (!headerValue) return null;
  const trimmed = headerValue.trim();
  if (trimmed === "") return null;
  // delta-seconds form: any numeric value is this form. A negative/zero delta is
  // clamped to 0 (retry now) rather than falling through to the date branch,
  // where a lenient Date.parse would misread a bare number.
  const seconds = Number(trimmed);
  if (Number.isFinite(seconds)) return seconds > 0 ? Math.round(seconds * 1000) : 0;
  // HTTP-date form (only reached by genuinely non-numeric strings).
  const when = Date.parse(trimmed);
  if (Number.isFinite(when)) {
    const delta = when - Date.now();
    return delta > 0 ? delta : 0;
  }
  return null;
}

/**
 * Backoff delay before the next retry after a 429. Exponential in `retryIndex`
 * (1-based), capped at `maxMs`, but never shorter than the server's own
 * `Retry-After` when it gave one. `jitter` in [0,1) (Math.random in prod) adds
 * up to +100% so the EMBED_CONCURRENCY concurrent workers don't retry in
 * lockstep and re-trip a burst-of-1 limit. Pure so the smoke can pin it.
 */
export function computeBackoffMs(
  retryIndex: number,
  retryAfterMs: number | null,
  jitter: number,
  baseMs = EMBED_RETRY_BASE_MS,
  maxMs = EMBED_RETRY_MAX_MS,
): number {
  const exponential = Math.min(baseMs * 2 ** Math.max(0, retryIndex - 1), maxMs);
  const base =
    retryAfterMs != null && retryAfterMs > 0
      ? Math.min(Math.max(exponential, retryAfterMs), maxMs)
      : exponential;
  return Math.round(base + jitter * base);
}

/**
 * Whether an HTTP status is worth retrying: 429 (throttle) or any 5xx (transient
 * server error — Replicate 502/503/504 blips that resolve on their own). 4xx
 * other than 429 are the caller's fault and fail fast. Pure so the smoke pins it.
 */
export function isRetryableReplicateStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

/** A retryable Replicate error (throttle or transient 5xx), carrying any Retry-After hint. */
class RetryableReplicateError extends Error {
  readonly retryAfterMs: number | null;
  constructor(message: string, retryAfterMs: number | null) {
    super(message);
    this.name = "RetryableReplicateError";
    this.retryAfterMs = retryAfterMs;
  }
}

/** A 429 from Replicate — rate-limited, back off (honoring Retry-After). */
class ReplicateThrottleError extends RetryableReplicateError {
  constructor(retryAfterMs: number | null) {
    super("The embedding service is rate-limiting requests (HTTP 429).", retryAfterMs);
    this.name = "ReplicateThrottleError";
  }
}

/** A transient 5xx from Replicate (502/503/504) — retry with backoff. */
class ReplicateServerError extends RetryableReplicateError {
  constructor(status: number) {
    super(`The embedding service had a transient error (HTTP ${status}).`, null);
    this.name = "ReplicateServerError";
  }
}

/** Turn any non-2xx response into a retryable throw (429/5xx) or a clean fail-fast error. */
async function throwForBadStatus(response: Response): Promise<never> {
  if (response.status === 429) {
    throw new ReplicateThrottleError(parseRetryAfterMs(response.headers.get("retry-after")));
  }
  if (response.status >= 500) {
    throw new ReplicateServerError(response.status);
  }
  // 4xx: read the body defensively — Replicate usually sends JSON {detail}, but a
  // gateway may return HTML/text, which must not surface as a JSON parse error.
  const text = await response.text().catch(() => "");
  let detail = "";
  try {
    detail = (JSON.parse(text) as { detail?: string })?.detail ?? "";
  } catch {
    detail = text.slice(0, 200);
  }
  throw new Error(detail || `The embedding service returned ${response.status}.`);
}

/** One embed attempt. Throws ReplicateThrottleError on a 429 so the caller can back off. */
async function embedOneAttempt(
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
  if (!response.ok) await throwForBadStatus(response);
  let prediction = (await response.json()) as {
    status?: string;
    output?: unknown;
    error?: unknown;
    detail?: string;
    urls?: { get?: string };
  };
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
    if (!poll.ok) await throwForBadStatus(poll);
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

/**
 * Embed one crop, retrying transient failures with exponential backoff + jitter
 * (honoring Retry-After): 429 throttling and 5xx server blips (the 502s that
 * otherwise degrade a scan to the model engine). Everything else fails fast so a
 * scan never hangs. On a healthy funded account no retry is ever seen, so this is
 * a straight pass-through at full concurrency.
 */
async function embedOne(
  dataUri: string,
  token: string,
  version: string,
  inputField: string,
): Promise<number[]> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= EMBED_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await embedOneAttempt(dataUri, token, version, inputField);
    } catch (error) {
      lastError = error;
      if (error instanceof RetryableReplicateError && attempt < EMBED_MAX_ATTEMPTS) {
        await sleep(computeBackoffMs(attempt, error.retryAfterMs, Math.random()));
        continue;
      }
      throw error;
    }
  }
  // Unreachable: the loop returns or throws each iteration.
  throw lastError;
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
