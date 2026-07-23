// P0 behavioral tests for the paginated existing-user lookup.
// Exercises the real installed @supabase/auth-js semantics:
//   * `listUsers` accepts only { page, perPage }
//   * a legitimate target user may sit ANY page (page 3, page 12, ...)
//   * a partial page indicates end-of-list (no wasted paging)
//   * a listUsers error MUST propagate (fail closed, do not proceed
//     as if the email is unknown)
//   * an empty first page returns null in one call
//   * the search is case- and whitespace-insensitive

import { describe, expect, it, vi } from "vitest";
import {
  findExistingAuthUserByEmail,
  LOOKUP_MAX_PAGES,
  LOOKUP_PER_PAGE,
} from "@/lib/auth/find-existing-auth-user";

function buildPage(
  page: number,
  count: number,
  targetOnPage?: { page: number; email: string; id: string },
) {
  const users: Array<{ id: string; email: string }> = [];
  for (let i = 0; i < count; i += 1) {
    users.push({ id: `p${page}-u${i}`, email: `filler-${page}-${i}@example.com` });
  }
  if (targetOnPage && targetOnPage.page === page) {
    // Place the target somewhere in the middle of the page so
    // "first result" heuristics can't fluke it.
    users.splice(Math.floor(count / 2), 0, {
      id: targetOnPage.id,
      email: targetOnPage.email,
    });
  }
  return users;
}

describe("findExistingAuthUserByEmail — real listUsers semantics", () => {
  it("finds a legitimate user on page 3 (the prior bug returned null here)", async () => {
    const target = { page: 3, email: "wilkinson.marshall@example.com", id: "target-uid" };
    const listUsers = vi.fn(async ({ page }: { page: number; perPage: number }) => ({
      data: { users: buildPage(page, LOOKUP_PER_PAGE, target) },
      error: null,
    }));

    const found = await findExistingAuthUserByEmail(listUsers, target.email);

    expect(found).toEqual({ id: "target-uid" });
    // Must have paged pages 1, 2, 3 in order — not stopped at page 1.
    expect(listUsers).toHaveBeenNthCalledWith(1, { page: 1, perPage: LOOKUP_PER_PAGE });
    expect(listUsers).toHaveBeenNthCalledWith(2, { page: 2, perPage: LOOKUP_PER_PAGE });
    expect(listUsers).toHaveBeenNthCalledWith(3, { page: 3, perPage: LOOKUP_PER_PAGE });
    // And stopped as soon as the match landed — no over-paging.
    expect(listUsers).toHaveBeenCalledTimes(3);
  });

  it("returns null for a genuinely absent email after walking a partial page", async () => {
    // One partial page → definitely no more results after it.
    const listUsers = vi.fn(async ({ page }: { page: number }) => ({
      data: {
        users:
          page === 1
            ? buildPage(1, 5) // partial page (< perPage)
            : [],
      },
      error: null,
    }));

    const found = await findExistingAuthUserByEmail(listUsers, "stranger@example.com");

    expect(found).toBeNull();
    // Partial page means end-of-list — must not paginate further.
    expect(listUsers).toHaveBeenCalledTimes(1);
  });

  it("returns null on an empty first page in a single call", async () => {
    const listUsers = vi.fn(async () => ({ data: { users: [] }, error: null }));
    const found = await findExistingAuthUserByEmail(listUsers, "nobody@example.com");
    expect(found).toBeNull();
    expect(listUsers).toHaveBeenCalledTimes(1);
  });

  it("propagates a listUsers error — never silently treats the email as unknown", async () => {
    // Fail-closed: an offline admin lookup MUST NOT allow the caller
    // to trigger provisioning (or hide behind generic-OK) by silently
    // treating an outage as "no user".
    const listUsers = vi.fn(async () => ({
      data: null,
      error: { message: "auth admin unavailable" },
    }));
    await expect(findExistingAuthUserByEmail(listUsers, "user@example.com")).rejects.toThrow(
      /auth admin unavailable/,
    );
  });

  it("matches case- and whitespace-insensitively", async () => {
    const listUsers = vi.fn(async () => ({
      data: {
        users: [
          { id: "wrong", email: "someoneelse@example.com" },
          { id: "right", email: "  Mixed.CASE@Example.COM " },
        ],
      },
      error: null,
    }));
    const found = await findExistingAuthUserByEmail(listUsers, "mixed.case@example.com");
    expect(found).toEqual({ id: "right" });
  });

  it("caps pagination at LOOKUP_MAX_PAGES full pages and returns null (no infinite loop)", async () => {
    // Every page is full → in real life we'd keep paging. The cap
    // guarantees a bounded worst case (LOOKUP_MAX_PAGES * LOOKUP_PER_PAGE).
    const listUsers = vi.fn(async ({ page }: { page: number }) => ({
      data: { users: buildPage(page, LOOKUP_PER_PAGE) },
      error: null,
    }));
    const found = await findExistingAuthUserByEmail(listUsers, "not-here@example.com");
    expect(found).toBeNull();
    expect(listUsers).toHaveBeenCalledTimes(LOOKUP_MAX_PAGES);
  });

  it("rejects empty/whitespace-only email up front (never pages)", async () => {
    const listUsers = vi.fn();
    expect(await findExistingAuthUserByEmail(listUsers, "")).toBeNull();
    expect(await findExistingAuthUserByEmail(listUsers, "   ")).toBeNull();
    expect(listUsers).not.toHaveBeenCalled();
  });
});
