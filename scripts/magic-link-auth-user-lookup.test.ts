import { describe, expect, it, vi } from "vitest";

vi.mock("@lovable.dev/email-js", () => ({
  sendLovableEmail: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => () => ({}),
}));

import { lookupExistingAuthUserByEmail } from "../src/routes/api/auth/magic-link";

describe("magic-link exact Auth user lookup adapter", () => {
  it("normalizes the email and maps the exact service-only RPC row", async () => {
    const exactLookup = vi.fn(async (email: string) => ({
      data: [{ user_id: "target-user", email_confirmed: true }],
      error: null,
    }));

    await expect(
      lookupExistingAuthUserByEmail(" Existing.User@Example.com ", exactLookup),
    ).resolves.toEqual({ id: "target-user", emailConfirmed: true });
    expect(exactLookup).toHaveBeenCalledTimes(1);
    expect(exactLookup).toHaveBeenCalledWith("existing.user@example.com");
  });

  it("treats an existing unconfirmed Auth identity as existing", async () => {
    const exactLookup = vi.fn(async () => ({
      data: [{ user_id: "unconfirmed-user", email_confirmed: false }],
      error: null,
    }));

    await expect(
      lookupExistingAuthUserByEmail("waiting@example.com", exactLookup),
    ).resolves.toEqual({
      id: "unconfirmed-user",
      emailConfirmed: false,
    });
  });

  it("returns null only when the exact lookup returns no row", async () => {
    const exactLookup = vi.fn(async () => ({
      data: [],
      error: null,
    }));

    await expect(
      lookupExistingAuthUserByEmail("unknown@example.com", exactLookup),
    ).resolves.toBeNull();
    expect(exactLookup).toHaveBeenCalledTimes(1);
  });

  it("fails closed without exposing an RPC diagnostic", async () => {
    const providerDiagnostic = "service-role-token=super-secret";
    const exactLookup = vi.fn(async () => ({
      data: [],
      error: { message: providerDiagnostic },
    }));

    let failure: unknown;
    try {
      await lookupExistingAuthUserByEmail("known@example.com", exactLookup);
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe("Unable to verify the sign-in account.");
    expect((failure as Error).message).not.toContain(providerDiagnostic);
    expect(exactLookup).toHaveBeenCalledTimes(1);
  });

  it("redacts diagnostics thrown by the RPC client", async () => {
    const providerDiagnostic = "Authorization: Bearer provider-secret";
    const exactLookup = vi.fn(async () => {
      throw new Error(providerDiagnostic);
    });

    await expect(lookupExistingAuthUserByEmail("known@example.com", exactLookup)).rejects.toThrow(
      "Unable to verify the sign-in account.",
    );

    try {
      await lookupExistingAuthUserByEmail("known@example.com", exactLookup);
    } catch (error) {
      expect((error as Error).message).not.toContain(providerDiagnostic);
    }
  });
});
