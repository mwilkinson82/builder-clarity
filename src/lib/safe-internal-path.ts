/**
 * Same-origin relative-path allowlist for navigation sinks that consume
 * free-form URLs (e.g. notification rows read from the database).
 *
 * Mirrors the validation semantics of `safeNextFromUrl` in
 * src/routes/auth.callback.tsx — a value is only trusted when it is a
 * single-leading-slash relative path — and hardens the edges that matter for
 * a stored (rather than query-param) source:
 *
 * - '' / non-string            → "/"
 * - '//host' (protocol-relative) → "/"
 * - any 'scheme:' prefix (https:, javascript:, data:, …) → "/"
 * - backslashes anywhere (browsers normalize '\' to '/' while parsing,
 *   so '/\\evil.com' would become '//evil.com') → "/"
 * - ASCII control characters (the URL parser strips tab/CR/LF, so
 *   '/\t/evil.com' would collapse to '//evil.com') → "/"
 * - query strings and hash fragments on a valid path are allowed.
 */
export function safeInternalPath(url: string): string {
  if (typeof url !== "string") return "/";
  const candidate = url.trim();
  if (!candidate) return "/";
  // Control characters can be silently stripped by the URL parser, turning a
  // "safe looking" string into a protocol-relative URL. Reject outright.
  for (let i = 0; i < candidate.length; i += 1) {
    if (candidate.charCodeAt(i) < 0x20 || candidate.charCodeAt(i) === 0x7f) return "/";
  }
  if (candidate.includes("\\")) return "/";
  // Any scheme prefix (https:, javascript:, data:, mailto:, …) is off-site.
  if (/^[a-z][a-z0-9+.-]*:/i.test(candidate)) return "/";
  // Must be exactly one leading slash: "/path" yes, "//host" never.
  if (!candidate.startsWith("/") || candidate.startsWith("//")) return "/";
  return candidate;
}
