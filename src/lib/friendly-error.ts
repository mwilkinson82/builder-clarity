// Maps a raw backend failure (PostgREST / Postgres / RLS strings, 42501
// permission denials, missing-relation "schema cache" errors) to plain English
// a contractor can act on. The raw string stays in console.error / monitoring
// and must never reach the visible UI.
//
// Scope: non-auth surfaces only. Auth/login/magic-link screens keep their own
// dedicated copy — do not route those through this helper.

export const GENERIC_LOAD_FALLBACK = "Something went wrong loading this — try again.";
const PERMISSION_MESSAGE = "You don't have permission to view this.";
const PROVISIONING_MESSAGE = "This workspace is still being set up. Check back in a few minutes.";

function errorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return "";
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "";
}

/**
 * Plain-English message for a failed read/write. Known cases (permission
 * denial, workspace not yet provisioned) map to fixed copy; everything else
 * returns `fallback`. Never returns a raw database/PostgREST string.
 */
export function friendlyErrorMessage(
  error: unknown,
  fallback: string = GENERIC_LOAD_FALLBACK,
): string {
  const code = errorCode(error);
  const text = errorText(error);

  // Permission / row-level-security denials. A live risk now that capabilities
  // are enforced in the database (42501), so a blocked read must read as
  // "not allowed", never as a broken page or a false empty.
  if (
    code === "42501" ||
    /permission denied/i.test(text) ||
    /row[- ]level security/i.test(text) ||
    /\b(not authorized|forbidden|do not have access|don't have (access|permission))\b/i.test(text)
  ) {
    return PERMISSION_MESSAGE;
  }

  // Table / function not present in this environment yet (a fresh workspace
  // whose backend is still being provisioned).
  if (
    code === "PGRST205" ||
    code === "PGRST202" ||
    code === "42P01" ||
    /schema cache/i.test(text) ||
    /could not find the (function|table|relation)/i.test(text) ||
    /relation .* does not exist/i.test(text) ||
    /(still being (enabled|applied|set up)|not available yet|being set up|not enabled)/i.test(text)
  ) {
    return PROVISIONING_MESSAGE;
  }

  return fallback;
}

/**
 * For action/toast feedback where the backend often throws its own plain-English
 * message (validation, business rules) worth showing. Raw database / permission
 * strings are still mapped to friendly copy; anything else falls through to the
 * app's own message, then to `fallback`. Never returns a raw PostgREST string.
 */
export function friendlyActionError(
  error: unknown,
  fallback: string = "Something went wrong. Try again.",
): string {
  // Empty sentinel: a match returns fixed copy, a non-match returns "".
  const mapped = friendlyErrorMessage(error, "");
  if (mapped) return mapped;
  const text = errorText(error);
  return text || fallback;
}
