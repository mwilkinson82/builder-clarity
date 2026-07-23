// Exact allowlist for magic-link redirect origins.
//
// SECURITY: Any origin not in this list — including *.lovable.app suffixes
// controlled by third parties — must be rejected. Never derive the canonical
// redirect origin from a caller-supplied `Origin` header or arbitrary
// `redirectTo` domain. Missing entry = untrusted.
//
// Localhost is only accepted when the runtime is explicitly non-production
// (isProd = false). In production, localhost is treated like any other
// unknown origin.

import { safeInternalPath } from "@/lib/safe-internal-path";

export const PRODUCTION_ORIGIN = "https://overwatch.alpcontractorcircle.com";

// Exact published production origins. No suffix matching, protocol downgrades,
// preview hosts, or ports.
export const ALLOWED_ORIGINS: readonly string[] = Object.freeze([
  PRODUCTION_ORIGIN,
  "https://builder-clarity.lovable.app",
]);

export const NON_PRODUCTION_ORIGINS: readonly string[] = Object.freeze([
  "https://id-preview--30e58105-16bb-4ec6-b870-93190cb1542c.lovable.app",
]);

const DEV_HOSTS = new Set(["localhost", "127.0.0.1"]);

export function isAllowedOrigin(origin: string, opts: { isProd: boolean }): boolean {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  // Exact match on scheme + host + port only. `url.origin` normalizes this.
  if (ALLOWED_ORIGINS.includes(url.origin)) return true;
  if (!opts.isProd && NON_PRODUCTION_ORIGINS.includes(url.origin)) return true;
  if (
    !opts.isProd &&
    (url.protocol === "http:" || url.protocol === "https:") &&
    DEV_HOSTS.has(url.hostname)
  ) {
    return true;
  }
  return false;
}

export function normalizeNext(next: string | undefined): string {
  return safeInternalPath(next ?? "/");
}

export type ResolveRedirectResult =
  | { ok: true; redirectTo: string }
  | { ok: false; reason: string };

/**
 * Resolve the redirect URL that will be baked into the magic link.
 *
 * Rules:
 *  - If `redirectTo` is provided, only its exact-allowlisted ORIGIN is used.
 *    Its pathname/query/hash are discarded so callers cannot bypass the
 *    app-owned callback, inject provisioning ids, or strand a token on a
 *    route that does not scrub credentials.
 *  - If `redirectTo` is absent, derive the origin from the actual request URL
 *    only when that origin is exact-allowlisted; otherwise fall back to the
 *    production origin.
 *  - The path is always `/auth/callback?next=<normalized-internal-next>`.
 */
export function resolveMagicLinkRedirect(input: {
  requestUrl: string;
  redirectTo?: string;
  next?: string;
  isProd: boolean;
}): ResolveRedirectResult {
  const nextPath = normalizeNext(input.next);

  if (input.redirectTo !== undefined && input.redirectTo !== "") {
    let target: URL;
    try {
      target = new URL(input.redirectTo);
    } catch {
      return { ok: false, reason: "Invalid redirect URL." };
    }
    if (!isAllowedOrigin(target.origin, { isProd: input.isProd })) {
      return { ok: false, reason: "Redirect origin is not allowed." };
    }
    return {
      ok: true,
      redirectTo: new URL(
        `/auth/callback?next=${encodeURIComponent(nextPath)}`,
        target.origin,
      ).toString(),
    };
  }

  let baseOrigin = PRODUCTION_ORIGIN;
  try {
    const reqOrigin = new URL(input.requestUrl).origin;
    if (isAllowedOrigin(reqOrigin, { isProd: input.isProd })) {
      baseOrigin = reqOrigin;
    }
  } catch {
    // fall back to production
  }

  return {
    ok: true,
    redirectTo: new URL(
      `/auth/callback?next=${encodeURIComponent(nextPath)}`,
      baseOrigin,
    ).toString(),
  };
}
