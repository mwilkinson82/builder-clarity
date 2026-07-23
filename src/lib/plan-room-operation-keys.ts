// Caller-retained operation-key helper for Plan Room takeoff gestures.
//
// Every atomic Plan Room RPC (create/update/delete/recalculate/group-link/
// line-create) is idempotent on its `p_operation_key` argument: the server
// dedupes retries against the same key. To honor that guarantee end-to-end,
// the *client* must retain a stable key per user intent and release it only
// after definitive success — otherwise a retry over the wire mints a new key
// and the server treats it as a fresh mutation.
//
// This module owns that retention. It is a small, framework-agnostic map
// keyed by a stable "intent fingerprint" the caller composes. Callers do NOT
// mint keys inline; they always route through `retainOperationKey(intent)`
// and then `releaseOperationKey(intent)` on success, so a mid-flight failure
// keeps the same key for the retry.
//
// Fingerprint composition rules (kept in one place so tests can enumerate):
//   create   → `create:${gestureId}` (gestureId minted at gesture start;
//              e.g. the first click of a new marker, or the AI-accept batch)
//   update   → `update:${measurementId}:${patchFingerprint}`
//   delete   → `delete:${measurementId}`
//   recalc   → `recalc:${planSheetId}:${expectedScaleRevision}`
//   linkLine → `link:${gestureId}` (build/group-into-line gesture)
//   buildLine→ `build:${gestureId}` (line-create half of build-line)
//
// The map is process-local (per browser tab). It survives React re-renders
// via the module-scoped `store`, so callers do not need to hoist refs.

export type OperationIntent = string;

type OperationKeyStore = Map<OperationIntent, string>;

const store: OperationKeyStore = new Map();

// A caller-visible mint hook — overridable in tests without patching global
// `crypto`. Production path uses `crypto.randomUUID()`.
let mintKey: () => string = () =>
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `op-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export function __setOperationKeyMinter(fn: () => string): void {
  mintKey = fn;
}

export function __resetOperationKeyStore(): void {
  store.clear();
}

// Return the retained key for `intent`, minting one on first call. Subsequent
// calls with the same intent return the same key until `releaseOperationKey`.
// A retry after a network/server failure MUST reuse the same intent so the
// server dedupes the mutation.
export function retainOperationKey(intent: OperationIntent): string {
  let key = store.get(intent);
  if (!key) {
    key = mintKey();
    store.set(intent, key);
  }
  return key;
}

// Drop the retained key. Only call after the server confirms success (or a
// definitive terminal failure the caller does not want to retry, e.g. a
// validation error). A conflict envelope from the RPC is NOT a release —
// the caller retries the same key with the appropriate force flag.
export function releaseOperationKey(intent: OperationIntent): void {
  store.delete(intent);
}

// Test/introspection helper: does the store currently hold this intent?
export function hasRetainedOperationKey(intent: OperationIntent): boolean {
  return store.has(intent);
}

// Fingerprint helpers keep intent-string composition in one place so the
// wiring tests can assert the exact shape the server ends up receiving.
export const operationIntent = {
  create: (gestureId: string) => `create:${gestureId}`,
  update: (measurementId: string, patchFingerprint: string) =>
    `update:${measurementId}:${patchFingerprint}`,
  delete: (measurementId: string) => `delete:${measurementId}`,
  recalculate: (planSheetId: string, expectedScaleRevision: number) =>
    `recalc:${planSheetId}:${expectedScaleRevision}`,
  buildLine: (gestureId: string) => `build:${gestureId}`,
  linkLine: (gestureId: string) => `link:${gestureId}`,
} as const;

// Deterministic patch fingerprint: stable ordering, primitive-only, so the
// same patch shape produces the same key across retries. Nested arrays and
// objects are JSON-stringified after their keys are sorted.
export function patchFingerprint(patch: Record<string, unknown>): string {
  const sortedKeys = Object.keys(patch).sort();
  const canonical: Record<string, unknown> = {};
  for (const key of sortedKeys) {
    canonical[key] = normalizeForFingerprint(patch[key]);
  }
  return hashString(JSON.stringify(canonical));
}

function normalizeForFingerprint(value: unknown): unknown {
  if (value == null) return null;
  if (Array.isArray(value)) return value.map(normalizeForFingerprint);
  if (typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = normalizeForFingerprint((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

// Small non-cryptographic hash — the fingerprint is scoped to a single
// measurement id and only used to keep two concurrent patches on the same
// measurement from colliding on the same operation key.
function hashString(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0xc2b2ae35;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x85ebca77) >>> 0;
  }
  return `${h1.toString(36)}${h2.toString(36)}`;
}
