/**
 * P0 auth callback secret scrubbing.
 *
 * Callback credentials (token_hash / type / confirm / code / access_token /
 * refresh_token / auth errors / hash) MUST be removed from the visible URL
 * and browser history immediately, before the confirmation screen or the
 * network exchange runs. The Continue button must still consume the
 * in-memory secret exactly once.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { StrictMode, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  callbackUrlHasSecrets,
  safeAuthNext,
  scrubbedCallbackUrl,
} from "@/lib/auth/magic-link-url";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

vi.mock("@/lib/email/send", () => ({
  sendTransactionalEmail: vi.fn(() => Promise.resolve()),
}));

async function loadComponent() {
  const mod = await import("../src/routes/auth.callback");
  const routeConfig = mod.Route as unknown as { component: () => JSX.Element };
  return routeConfig.component;
}

function setHref(href: string) {
  const url = new URL(href);
  Object.defineProperty(window, "location", {
    writable: true,
    configurable: true,
    value: {
      ...url,
      href: url.href,
      origin: url.origin,
      pathname: url.pathname,
      search: url.search,
      hash: url.hash,
      host: url.host,
      hostname: url.hostname,
      protocol: url.protocol,
      port: url.port,
    },
  });
  // Keep history state consistent with the URL.
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  // Wire replaceState so it updates our fake window.location too.
  const originalReplace = window.history.replaceState.bind(window.history);
  window.history.replaceState = ((state: unknown, unused: string, path?: string) => {
    if (typeof path === "string") {
      const nu = new URL(path, url.origin);
      Object.defineProperty(window, "location", {
        writable: true,
        configurable: true,
        value: {
          ...nu,
          href: nu.href,
          origin: nu.origin,
          pathname: nu.pathname,
          search: nu.search,
          hash: nu.hash,
          host: nu.host,
          hostname: nu.hostname,
          protocol: nu.protocol,
          port: nu.port,
        },
      });
    }
    return originalReplace(state as never, unused, path);
  }) as typeof window.history.replaceState;
}

let container: HTMLDivElement;
let root: Root;

async function mount(Component: () => JSX.Element, opts: { strict?: boolean } = {}) {
  container = document.createElement("div");
  document.body.appendChild(container);
  await act(async () => {
    root = createRoot(container);
    root.render(
      opts.strict ? (
        <StrictMode>
          <Component />
        </StrictMode>
      ) : (
        <Component />
      ),
    );
  });
  // Let queued microtasks (finishSignIn) run.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

beforeEach(() => {
  verifyOtp.mockReset();
  exchangeCodeForSession.mockReset();
  setSession.mockReset();
  getSession.mockReset();
  getSession.mockResolvedValue({ data: { session: null }, error: null });
  navigate.mockReset();
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
});

describe("scrubbedCallbackUrl helper", () => {
  it("drops token_hash / type / confirm, preserves safe next", () => {
    const scrubbed = scrubbedCallbackUrl(
      "https://app.test/auth/callback?token_hash=abc&type=email&confirm=1&next=%2Fteam",
    );
    expect(scrubbed).toBe("/auth/callback?next=%2Fteam");
    expect(callbackUrlHasSecrets(new URL(scrubbed, "https://app.test"))).toBe(false);
  });

  it("drops legacy code param", () => {
    expect(scrubbedCallbackUrl("https://app.test/auth/callback?code=xyz&next=%2F")).toBe(
      "/auth/callback",
    );
  });

  it("drops the entire hash (access_token / refresh_token)", () => {
    const scrubbed = scrubbedCallbackUrl(
      "https://app.test/auth/callback#access_token=aa&refresh_token=rr&expires_in=3600",
    );
    expect(scrubbed).toBe("/auth/callback");
    expect(scrubbed).not.toContain("access_token");
    expect(scrubbed).not.toContain("#");
  });

  it("drops auth error params from the query", () => {
    expect(
      scrubbedCallbackUrl(
        "https://app.test/auth/callback?error=access_denied&error_description=bad",
      ),
    ).toBe("/auth/callback");
  });

  it("collapses unsafe / external / protocol-relative next to '/'", () => {
    expect(scrubbedCallbackUrl("https://app.test/auth/callback?next=https://evil.test")).toBe(
      "/auth/callback",
    );
    expect(scrubbedCallbackUrl("https://app.test/auth/callback?next=//evil.test")).toBe(
      "/auth/callback",
    );
    expect(safeAuthNext(new URL("https://app.test/auth/callback?next=//evil.test"))).toBe("/");
  });
});

describe("AuthCallbackPage secret scrubbing (mounted)", () => {
  it("token_hash flow: URL scrubbed before exchange; Continue consumes token from memory exactly once", async () => {
    setHref(
      "https://app.test/auth/callback?token_hash=SECRET_HASH&type=email&confirm=1&next=%2Fteam",
    );
    const Component = await loadComponent();
    verifyOtp.mockResolvedValue({
      data: { session: { user: { id: "u1", email: "a@b.co" } } },
      error: null,
    });

    await mount(Component);

    // Scrubbed synchronously on mount, before any Supabase call.
    expect(window.location.search).toBe("?next=%2Fteam");
    expect(window.location.hash).toBe("");
    expect(window.location.search).not.toContain("SECRET_HASH");
    expect(verifyOtp).not.toHaveBeenCalled();

    const button = container.querySelector("button");
    expect(button?.textContent).toMatch(/continue to overwatch/i);

    await act(async () => {
      button!.click();
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(verifyOtp).toHaveBeenCalledTimes(1);
    expect(verifyOtp).toHaveBeenCalledWith({ token_hash: "SECRET_HASH", type: "email" });
    expect(navigate).toHaveBeenCalledWith({ to: "/team", replace: true });

    // Second click cannot re-consume: in-memory secret cleared post-success.
    await act(async () => {
      button!.click();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(verifyOtp).toHaveBeenCalledTimes(1);

    // Address bar still scrubbed.
    expect(window.location.search).toBe("?next=%2Fteam");
  });

  it("legacy code flow: URL scrubbed before exchange; code consumed from memory", async () => {
    setHref("https://app.test/auth/callback?code=SECRET_CODE&next=%2F");
    const Component = await loadComponent();
    exchangeCodeForSession.mockResolvedValue({
      data: { session: { user: { id: "u1", email: "a@b.co" } } },
      error: null,
    });

    await mount(Component);

    expect(exchangeCodeForSession).toHaveBeenCalledWith("SECRET_CODE");
    expect(window.location.search).toBe("");
    expect(window.location.search).not.toContain("SECRET_CODE");
    expect(navigate).toHaveBeenCalledWith({ to: "/", replace: true });
  });

  it("hash access/refresh flow: hash scrubbed before setSession runs", async () => {
    setHref("https://app.test/auth/callback#access_token=AT&refresh_token=RT&expires_in=3600");
    const Component = await loadComponent();
    setSession.mockResolvedValue({
      data: { session: { user: { id: "u1", email: "a@b.co" } } },
      error: null,
    });

    await mount(Component);

    expect(setSession).toHaveBeenCalledTimes(1);
    expect(setSession).toHaveBeenCalledWith({ access_token: "AT", refresh_token: "RT" });
    expect(window.location.hash).toBe("");
    expect(window.location.search).toBe("");
  });

  it("malicious external next collapses to '/'; no secret survives in the address bar", async () => {
    setHref(
      "https://app.test/auth/callback?token_hash=X&type=email&confirm=1&next=https%3A%2F%2Fevil.test",
    );
    const Component = await loadComponent();
    verifyOtp.mockResolvedValue({
      data: { session: { user: { id: "u1", email: "a@b.co" } } },
      error: null,
    });

    await mount(Component);

    expect(window.location.search).toBe("");
    expect(window.location.search).not.toContain("evil.test");
    expect(window.location.search).not.toContain("token_hash");

    const button = container.querySelector("button");
    await act(async () => {
      button!.click();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(navigate).toHaveBeenCalledWith({ to: "/", replace: true });
  });

  it("protocol-relative next also collapses to '/'", async () => {
    setHref("https://app.test/auth/callback?code=C&next=%2F%2Fevil.test");
    const Component = await loadComponent();
    exchangeCodeForSession.mockResolvedValue({
      data: { session: { user: { id: "u1", email: "a@b.co" } } },
      error: null,
    });

    await mount(Component);

    expect(navigate).toHaveBeenCalledWith({ to: "/", replace: true });
    expect(window.location.search).toBe("");
  });
});

describe("source wiring: recovery link never reconstructs the secret", () => {
  const source = readFileSync(resolve(process.cwd(), "src/routes/auth.callback.tsx"), "utf8");

  it("no callback retry link that would leak the original URL", () => {
    expect(source).not.toMatch(/href=\{callbackHref\(/);
    expect(source).not.toContain("token_hash=${");
    expect(source).not.toContain("?code=${");
  });

  it("scrub runs via history.replaceState before any exchange", () => {
    expect(source).toContain("scrubbedCallbackUrl");
    expect(source).toContain("window.history.replaceState");
  });

  it("original URL is retained in a ref, not re-read from window.location", () => {
    expect(source).toContain("originalUrlRef");
    // finishSignIn reads the URL from the ref, not window.location.
    expect(source).toMatch(/originalUrlRef\.current/);
  });
});

describe("AuthCallbackPage single-flight (StrictMode + rapid clicks)", () => {
  it("StrictMode double-invoke: code flow exchanges exactly once", async () => {
    setHref("https://app.test/auth/callback?code=SECRET_CODE&next=%2F");
    const Component = await loadComponent();
    exchangeCodeForSession.mockResolvedValue({
      data: { session: { user: { id: "u1", email: "a@b.co" } } },
      error: null,
    });

    await mount(Component, { strict: true });

    expect(exchangeCodeForSession).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith({ to: "/", replace: true });
  });

  it("StrictMode double-invoke: hash flow setSession exactly once", async () => {
    setHref("https://app.test/auth/callback#access_token=AT&refresh_token=RT&expires_in=3600");
    const Component = await loadComponent();
    setSession.mockResolvedValue({
      data: { session: { user: { id: "u1", email: "a@b.co" } } },
      error: null,
    });

    await mount(Component, { strict: true });

    expect(setSession).toHaveBeenCalledTimes(1);
    expect(setSession).toHaveBeenCalledWith({ access_token: "AT", refresh_token: "RT" });
    expect(window.location.hash).toBe("");
  });

  it("StrictMode auto code failure exits the spinner and shows recovery", async () => {
    setHref("https://app.test/auth/callback?code=BAD_CODE&next=%2Fteam");
    const Component = await loadComponent();
    exchangeCodeForSession.mockResolvedValue({
      data: { session: null },
      error: new Error("Code verifier expired"),
    });
    getSession.mockResolvedValue({ data: { session: null }, error: null });

    await mount(Component, { strict: true });

    expect(exchangeCodeForSession).toHaveBeenCalledTimes(1);
    expect(navigate).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("Completing sign-in...");
    expect(container.querySelector('a[href^="/auth"]')).not.toBeNull();
    expect(container.querySelector("button")).toBeNull();
  });

  it("StrictMode auto hash failure exits the spinner and shows recovery", async () => {
    setHref("https://app.test/auth/callback#access_token=BAD_AT&refresh_token=BAD_RT");
    const Component = await loadComponent();
    setSession.mockResolvedValue({
      data: { session: null },
      error: new Error("Refresh token is invalid"),
    });
    getSession.mockResolvedValue({ data: { session: null }, error: null });

    await mount(Component, { strict: true });

    expect(setSession).toHaveBeenCalledTimes(1);
    expect(navigate).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("Completing sign-in...");
    expect(container.querySelector('a[href^="/auth"]')).not.toBeNull();
    expect(container.querySelector("button")).toBeNull();
    expect(window.location.hash).toBe("");
  });

  it("token_hash confirmation: two rapid Continue clicks before verifyOtp resolves = one verifyOtp call", async () => {
    setHref(
      "https://app.test/auth/callback?token_hash=SECRET_HASH&type=email&confirm=1&next=%2Fteam",
    );
    const Component = await loadComponent();

    // Unresolved promise so both clicks happen while consumption is in flight.
    let resolveOtp: (v: unknown) => void = () => {};
    verifyOtp.mockImplementation(
      () =>
        new Promise((res) => {
          resolveOtp = res;
        }),
    );

    await mount(Component);
    expect(verifyOtp).not.toHaveBeenCalled();

    const button = container.querySelector("button")!;

    // Two clicks fired synchronously — second must be a no-op.
    await act(async () => {
      button.click();
      button.click();
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(verifyOtp).toHaveBeenCalledTimes(1);
    // Button disabled while in flight (re-query to observe committed state).
    expect((container.querySelector("button") as HTMLButtonElement).disabled).toBe(true);

    // Now resolve; still exactly one call, navigation happens.
    await act(async () => {
      resolveOtp({
        data: { session: { user: { id: "u1", email: "a@b.co" } } },
        error: null,
      });
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(verifyOtp).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it("failed exchange: one verifyOtp call, recovery UI shown, no automatic retry loop", async () => {
    setHref("https://app.test/auth/callback?token_hash=BAD_HASH&type=email&confirm=1&next=%2F");
    const Component = await loadComponent();
    verifyOtp.mockResolvedValue({
      data: { session: null },
      error: new Error("Token has expired or is invalid"),
    });
    getSession.mockResolvedValue({ data: { session: null }, error: null });

    await mount(Component);

    const button = container.querySelector("button")!;
    await act(async () => {
      button.click();
      await new Promise((r) => setTimeout(r, 0));
    });

    // Give any potential (bug: automatic) retry a window to occur.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(verifyOtp).toHaveBeenCalledTimes(1);
    expect(navigate).not.toHaveBeenCalled();

    // Recovery UI: fresh-magic-link anchor rendered; confirm button gone.
    const recoveryLink = container.querySelector('a[href^="/auth"]');
    expect(recoveryLink).not.toBeNull();
    expect(recoveryLink?.textContent).toMatch(/fresh magic link/i);
    expect(container.querySelector("button")).toBeNull();

    // Address bar still scrubbed — no reconstruction of a URL carrying secrets.
    expect(window.location.search).toBe("");
    expect(window.location.hash).toBe("");
  });

  it("StrictMode + failed exchange: still exactly one verifyOtp call", async () => {
    setHref("https://app.test/auth/callback?token_hash=BAD&type=email&confirm=1&next=%2F");
    const Component = await loadComponent();
    verifyOtp.mockResolvedValue({
      data: { session: null },
      error: new Error("Token has expired or is invalid"),
    });

    await mount(Component, { strict: true });

    const button = container.querySelector("button");
    if (button) {
      await act(async () => {
        button.click();
        await new Promise((r) => setTimeout(r, 0));
      });
    }

    expect(verifyOtp).toHaveBeenCalledTimes(1);
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe("source wiring: synchronous single-flight guard", () => {
  const source = readFileSync(resolve(process.cwd(), "src/routes/auth.callback.tsx"), "utf8");

  it("uses a ref-based in-flight guard set before any await", () => {
    expect(source).toMatch(/consumptionInFlightRef/);
    expect(source).toMatch(/consumedRef/);
    // Guard checked before establishSessionFromUrl.
    expect(source).toMatch(/consumptionInFlightRef\.current[\s\S]*establishSessionFromUrl/);
  });

  it("Continue button disabled while exchange is in flight", () => {
    expect(source).toMatch(/disabled=\{exchangeInFlight\}/);
    expect(source).toMatch(/aria-busy=\{exchangeInFlight\}/);
  });

  it("status paragraph keeps accessible live region", () => {
    expect(source).toMatch(/role="status"/);
    expect(source).toMatch(/aria-live="polite"/);
  });
});
