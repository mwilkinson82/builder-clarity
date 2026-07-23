// P0 sign-in containment: exact case-insensitive existing-user lookup.
//
// The pinned @supabase/auth-js (2.108.2) `listUsers` API takes ONLY
// `{ page, perPage }` — no `email` filter and no `getUserByEmail`
// helper exists. Any extra field is silently discarded. The prior
// implementation passed `{ page:1, perPage:1, email }` and only ever
// inspected the first user in the whole system, so legitimate
// accounts past position 1 were treated as unknown and login fell
// through to fail-closed "generic OK" with no email sent → real
// users locked out.
//
// This helper exhaustively paginates admin.listUsers with the
// documented maximum per-page size, exact-case-insensitive-matches
// the email, breaks on the first match, and returns null when the
// email is genuinely absent. It is defensive against a runaway
// dataset (`MAX_PAGES` cap) — hitting the cap returns null and the
// caller falls back to the fail-closed generic response.

export type ListUsersFn = (args: { page: number; perPage: number }) => Promise<{
  data: { users: Array<{ id: string; email?: string | null }> } | null;
  error: { message: string } | null;
}>;

export const LOOKUP_PER_PAGE = 200;
export const LOOKUP_MAX_PAGES = 100;

export async function findExistingAuthUserByEmail(
  listUsers: ListUsersFn,
  email: string,
): Promise<{ id: string } | null> {
  const target = email.trim().toLowerCase();
  if (!target) return null;

  for (let page = 1; page <= LOOKUP_MAX_PAGES; page += 1) {
    const { data, error } = await listUsers({ page, perPage: LOOKUP_PER_PAGE });
    if (error) throw new Error(error.message);
    const users = data?.users ?? [];
    const found = users.find((u) => (u.email ?? "").trim().toLowerCase() === target);
    if (found) return { id: found.id };
    // Short-circuit: a partial page means we've reached the end.
    if (users.length < LOOKUP_PER_PAGE) return null;
  }
  return null;
}
