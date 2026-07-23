/**
 * P0 auth callback secret scrubbing.
 *
 * Requirement: token_hash / type / confirm / code / access_token / refresh_token
 * / auth error params / hash must NEVER be present in the visible URL or
 * browser history while the confirmation screen or exchange is displayed.
 * The Continue button must still be able to consume the original in-memory
 * token exactly once.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen, waitFor, act, fireEvent, cleanup } from "@testing-library/react";
import {
  scrubbedCallbackUrl,
  callbackUrlHasSecrets,
  safeAuthNext,
} from "@/lib/auth/magic-link-url";

const verifyOtp = vi.fn();
const exchangeCodeForSession = vi.fn();
const setSession = vi.fn();
const getSession = vi.fn(() => Promise.resolve({ data: { session: null }, error: null }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      verifyOtp: (...a: unknown[]) => verifyOtp(...a),
      exchangeCodeForSession: (...a: unknown[]) => exchangeCodeForSession(...a),
      setSession: (...a: unknown[]) => setSession(...a),
      getSession: (...a: unknown[]) => getSession(...a),
    },
  },
}));

const navigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (config: unknown) => config,
  useNavigate: () => navigate,
}));

vi.mock("@/lib/email/send", () => ({ sendTransactionalEmail: vi.fn(() => Promise.resolve()) }));

async function loadComponent() {
  const mod = await import("../src/routes/auth.callback");
  // The route file `export const Route = createFileRoute(...)({ component })`.
  // Our mock returns the config object, so read the component from it.
  const RouteConfig = mod.Route as unknown as { component: () => JSX.Element };
  return RouteConfig.component;
}

function setHref(href: string) {
  // happy-dom lets us reassign location.href.
  window.history.replaceState(null, "", href.replace(/^https?:\/\/[^/]+/, ""));
  // Force full URL for reads via window.location.href:
  Object.defineProperty(window, "location", {
    writable: true,
    value: new URL(href),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  verifyOtp.mockReset();
  exchangeCodeForSession.mockReset();
  setSession.mockReset();
  getSession.mockReset();
  getSession.mockResolvedValue({ data: { session: null }, error: null });
});

afterEach(() => cleanup());

describe("scrubbedCallbackUrl helper", () => {
  it("drops token_hash, type, confirm from the URL and preserves safe next", () => {
    const scrubbed = scrubbedCallbackUrl(
      "https://app.test/auth/callback?token_hash=abc&type=email&confirm=1&next=%2Fteam",
    );
    expect(scrubbed).toBe("/auth/callback?next=%2Fteam");
    expect(callbackUrlHasSecrets(new URL(scrubbed, "https://app.test"))).toBe(false);
  });

  it("drops legacy code param", () => {
    const scrubbed = scrubbedCallbackUrl("https://app.test/auth/callback?code=xyz&next=%2F");
    expect(scrubbed).toBe("/auth/callback");
  });

  it("drops the entire hash (access_token / refresh_token)", () => {
    const scrubbed = scrubbedCallbackUrl(
      "https://app.test/auth/callback#access_token=aa&refresh_token=rr&expires_in=3600",
    );
    expect(scrubbed).toBe("/auth/callback");
    expect(scrubbed).not.toContain("access_token");
    expect(scrubbed).not.toContain("refresh_token");
    expect(scrubbed).not.toContain("#");
  });

  it("drops error params from the hash and query", () => {
    const scrubbed = scrubbedCallbackUrl(
      "https://app.test/auth/callback?error=access_denied&error_description=bad#error=x",
    );
    expect(scrubbed).toBe("/auth/callback");
  });

  it("normalizes an unsafe next to root", () => {
    expect(scrubbedCallbackUrl("https://app.test/auth/callback?next=https://evil.test")).toBe(
      "/auth/callback",
    );
    expect(scrubbedCallbackUrl("https://app.test/auth/callback?next=//evil.test")).toBe(
      "/auth/callback",
    );
    expect(safeAuthNext(new URL("https://app.test/auth/callback?next=//evil.test"))).toBe("/");
  });
});

describe("AuthCallbackPage secret scrubbing", () => {
  it("token_hash flow: scrubs URL before exchange and consumes token from memory on explicit confirm", async () => {
    setHref(
      "https://app.test/auth/callback?token_hash=SECRET_HASH&type=email&confirm=1&next=%2Fteam",
    );
    const Component = await loadComponent();

    verifyOtp.mockResolvedValue({
      data: { session: { user: { id: "u1", email: "a@b.co" } } },
      error: null,
    });

    render(<Component />);

    // URL is scrubbed synchronously on mount, BEFORE any network call.
    await waitFor(() => {
      expect(window.location.search).toBe("?next=%2Fteam");
    });
    expect(window.location.search).not.toContain("SECRET_HASH");
    expect(window.location.hash).toBe("");
    expect(verifyOtp).not.toHaveBeenCalled();

    // Confirmation button rendered — click consumes the in-memory token exactly once.
    const button = await screen.findByRole("button", { name: /continue to overwatch/i });
    await act(async () => {
      fireEvent.click(button);
    });

    await waitFor(() => expect(verifyOtp).toHaveBeenCalledTimes(1));
    expect(verifyOtp).toHaveBeenCalledWith({ token_hash: "SECRET_HASH", type: "email" });
    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: "/team", replace: true }));

    // Address bar still scrubbed after success.
    expect(window.location.search).toBe("?next=%2Fteam");
  });

  it("legacy code flow: scrubs URL before exchange and consumes code from memory", async () => {
    setHref("https://app.test/auth/callback?code=SECRET_CODE&next=%2F");
    const Component = await loadComponent();

    exchangeCodeForSession.mockResolvedValue({
      data: { session: { user: { id: "u1", email: "a@b.co" } } },
      error: null,
    });

    render(<Component />);

    await waitFor(() => expect(exchangeCodeForSession).toHaveBeenCalledWith("SECRET_CODE"));
    // Scrub happened before network call — search now has no `code`.
    expect(window.location.search).toBe("");
    expect(window.location.search).not.toContain("SECRET_CODE");
    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: "/", replace: true }));
  });

  it("hash access/refresh flow: scrubs hash before setSession runs", async () => {
    setHref(
      "https://app.test/auth/callback#access_token=AT&refresh_token=RT&expires_in=3600",
    );
    const Component = await loadComponent();

    setSession.mockResolvedValue({
      data: { session: { user: { id: "u1", email: "a@b.co" } } },
      error: null,
    });

    render(<Component />);

    await waitFor(() => expect(setSession).toHaveBeenCalledTimes(1));
    expect(setSession).toHaveBeenCalledWith({ access_token: "AT", refresh_token: "RT" });
    expect(window.location.hash).toBe("");
    expect(window.location.search).toBe("");
  });

  it("malicious external / protocol-relative next collapses to '/' and no secret survives", async () => {
    setHref(
      "https://app.test/auth/callback?token_hash=X&type=email&confirm=1&next=https%3A%2F%2Fevil.test",
    );
    const Component = await loadComponent();
    verifyOtp.mockResolvedValue({
      data: { session: { user: { id: "u1", email: "a@b.co" } } },
      error: null,
    });

    render(<Component />);

    await waitFor(() => {
      // next scrubbed to nothing (root default); token_hash removed.
      expect(window.location.search).toBe("");
    });
    expect(window.location.search).not.toContain("evil.test");
    expect(window.location.search).not.toContain("token_hash");

    const button = await screen.findByRole("button", { name: /continue to overwatch/i });
    await act(async () => fireEvent.click(button));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: "/", replace: true }));

    // Second click must NOT re-verify — the in-memory secret was cleared.
    await act(async () => fireEvent.click(button));
    expect(verifyOtp).toHaveBeenCalledTimes(1);
  });

  it("protocol-relative next also collapses to '/'", async () => {
    setHref("https://app.test/auth/callback?code=C&next=%2F%2Fevil.test");
    const Component = await loadComponent();
    exchangeCodeForSession.mockResolvedValue({
      data: { session: { user: { id: "u1", email: "a@b.co" } } },
      error: null,
    });
    render(<Component />);
    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: "/", replace: true }));
    expect(window.location.search).toBe("");
  });
});

describe("source wiring: recovery link never reconstructs the secret", () => {
  it("recovery UI links only to /auth?next=..., never to /auth/callback with credentials", () => {
    const source = readFileSync(resolve(process.cwd(), "src/routes/auth.callback.tsx"), "utf8");
    // No callback-retry link that could leak the original URL.
    expect(source).not.toMatch(/href=\{callbackHref\(/);
    expect(source).not.toContain("token_hash=${");
    expect(source).not.toContain("?code=${");
    // Scrub must call replaceState with the scrubbed URL before any exchange.
    expect(source).toContain("scrubbedCallbackUrl");
    expect(source).toContain("window.history.replaceState");
    // Original URL retained in a ref, not re-read from window.location during exchange.
    expect(source).toContain("originalUrlRef");
  });
});
