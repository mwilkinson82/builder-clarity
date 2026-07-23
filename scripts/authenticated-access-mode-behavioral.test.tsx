import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  resolveAccessModeMarker: "resolve-access-mode-marker",
  recordActivityMarker: "record-activity-marker",
  resolveMode: vi.fn(),
  recordActivity: vi.fn(),
  getSession: vi.fn(),
  getUser: vi.fn(),
  signOut: vi.fn(),
  onAuthStateChange: vi.fn(),
  unsubscribe: vi.fn(),
  navigate: vi.fn(),
  redirect: vi.fn((options: unknown) => ({ __redirect: true, options })),
  locationReplace: vi.fn(),
  routeHref: "/",
  routePathname: "/",
  authStateCallback: null as null | ((event: string) => void),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: (...args: unknown[]) => mocks.getSession(...args),
      getUser: (...args: unknown[]) => mocks.getUser(...args),
      signOut: (...args: unknown[]) => mocks.signOut(...args),
      onAuthStateChange: (...args: unknown[]) => mocks.onAuthStateChange(...args),
    },
  },
}));

vi.mock("@/lib/auth/access-mode", () => {
  const prefix = "/client/projects/";
  const projectIdFromPath = (pathname: string) => {
    if (!pathname.startsWith(prefix)) return null;
    const [pathOnly] = pathname.split(/[?#]/);
    const rest = pathOnly.slice(prefix.length).replace(/\/$/, "");
    return rest && !rest.includes("/") ? rest : null;
  };

  return {
    resolveAccessMode: mocks.resolveAccessModeMarker,
    clientProjectIdFromPath: projectIdFromPath,
    isClientPortalPath: (pathname: string) => projectIdFromPath(pathname) !== null,
    clientPortalPathForProject: (projectId: string) => `${prefix}${projectId}`,
  };
});

vi.mock("@/lib/team.functions", () => ({
  recordUserActivity: mocks.recordActivityMarker,
}));

vi.mock("@tanstack/react-start", () => ({
  useServerFn: (serverFn: unknown) =>
    serverFn === mocks.resolveAccessModeMarker ? mocks.resolveMode : mocks.recordActivity,
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (config: unknown) => config,
  Outlet: () => <div data-testid="authenticated-outlet" />,
  redirect: (options: unknown) => mocks.redirect(options),
  useNavigate: () => mocks.navigate,
  useRouterState: ({ select }: { select: (state: unknown) => unknown }) =>
    select({
      location: {
        href: mocks.routeHref,
        pathname: mocks.routePathname,
      },
    }),
}));

type RouteConfig = {
  beforeLoad: (args: { location: { href: string } }) => Promise<unknown>;
  component: () => JSX.Element;
};

async function loadRoute(): Promise<RouteConfig> {
  const module = await import("../src/routes/_authenticated/route");
  return module.Route as unknown as RouteConfig;
}

let container: HTMLDivElement | undefined;
let root: Root | undefined;

async function mount(Component: () => JSX.Element) {
  container = document.createElement("div");
  document.body.appendChild(container);
  await act(async () => {
    root = createRoot(container!);
    root.render(<Component />);
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  mocks.resolveMode.mockReset();
  mocks.recordActivity.mockReset();
  mocks.getSession.mockReset();
  mocks.getUser.mockReset();
  mocks.signOut.mockReset();
  mocks.onAuthStateChange.mockReset();
  mocks.unsubscribe.mockReset();
  mocks.navigate.mockReset();
  mocks.redirect.mockClear();
  mocks.locationReplace.mockReset();
  mocks.routeHref = "/";
  mocks.routePathname = "/";
  mocks.authStateCallback = null;

  mocks.getSession.mockResolvedValue({
    data: { session: { user: { id: "user-1" } } },
    error: null,
  });
  mocks.getUser.mockResolvedValue({
    data: { user: { id: "user-1" } },
    error: null,
  });
  mocks.signOut.mockResolvedValue({ error: null });
  mocks.recordActivity.mockResolvedValue(undefined);
  mocks.onAuthStateChange.mockImplementation((callback: (event: string) => void) => {
    mocks.authStateCallback = callback;
    return { data: { subscription: { unsubscribe: mocks.unsubscribe } } };
  });

  Object.defineProperty(window, "location", {
    configurable: true,
    writable: true,
    value: {
      href: "https://app.test/",
      pathname: "/",
      search: "",
      hash: "",
      replace: mocks.locationReplace,
    },
  });
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "visible",
  });
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  container?.remove();
  container = undefined;
  vi.restoreAllMocks();
});

describe("authenticated access-mode layout behavior", () => {
  it("renders internal Outlet and heartbeat only for an active company seat", async () => {
    const route = await loadRoute();
    mocks.resolveMode.mockResolvedValue({
      kind: "internal_active",
      organizationId: "org-1",
      clientProjectIds: [],
    });

    await mount(route.component);

    expect(container?.querySelector('[data-testid="authenticated-outlet"]')).not.toBeNull();
    expect(mocks.recordActivity).toHaveBeenCalledTimes(1);
    expect(container?.textContent).not.toContain("No active company access");
  });

  it("renders no-company recovery without Outlet or heartbeat and can check access again", async () => {
    const route = await loadRoute();
    mocks.resolveMode.mockResolvedValueOnce({ kind: "no_active_company" }).mockResolvedValueOnce({
      kind: "internal_active",
      organizationId: "org-restored",
      clientProjectIds: [],
    });

    await mount(route.component);

    expect(container?.querySelector('[data-testid="authenticated-outlet"]')).toBeNull();
    expect(mocks.recordActivity).not.toHaveBeenCalled();
    expect(
      container?.querySelector('a[href="mailto:support@alpcontractorcircle.com"]'),
    ).not.toBeNull();

    const checkAgain = [...(container?.querySelectorAll("button") ?? [])].find(
      (button) => button.textContent === "Check access again",
    );
    expect(checkAgain).toBeDefined();
    await act(async () => checkAgain?.click());
    await flush();

    expect(mocks.resolveMode).toHaveBeenCalledTimes(2);
    expect(container?.querySelector('[data-testid="authenticated-outlet"]')).not.toBeNull();
    expect(mocks.recordActivity).toHaveBeenCalledTimes(1);
  });

  it("renders lookup recovery with Retry, mail support, and local Sign out", async () => {
    const route = await loadRoute();
    mocks.resolveMode
      .mockResolvedValueOnce({
        kind: "lookup_error",
        message: "We couldn't verify your access.",
      })
      .mockResolvedValueOnce({ kind: "no_active_company" });

    await mount(route.component);

    expect(container?.querySelector('[data-testid="authenticated-outlet"]')).toBeNull();
    expect(mocks.recordActivity).not.toHaveBeenCalled();
    expect(
      container?.querySelector('a[href="mailto:support@alpcontractorcircle.com"]'),
    ).not.toBeNull();

    const buttons = [...(container?.querySelectorAll("button") ?? [])];
    const retry = buttons.find((button) => button.textContent === "Retry");
    const signOut = buttons.find((button) => button.textContent === "Sign out");
    expect(retry).toBeDefined();
    expect(signOut).toBeDefined();

    await act(async () => retry?.click());
    await flush();
    expect(mocks.resolveMode).toHaveBeenCalledTimes(2);

    await act(async () => signOut?.click());
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(mocks.locationReplace).toHaveBeenCalledWith("/auth");
  });

  it("renders the client portal only for an exact authorized project id", async () => {
    const route = await loadRoute();
    mocks.routePathname = "/client/projects/project-b";
    mocks.routeHref = mocks.routePathname;
    mocks.resolveMode.mockResolvedValue({
      kind: "client_only",
      clientProjectIds: ["project-a", "project-b"],
    });

    await mount(route.component);

    expect(container?.querySelector('[data-testid="authenticated-outlet"]')).not.toBeNull();
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(mocks.recordActivity).not.toHaveBeenCalled();
  });

  it("redirects a root client-only visit exactly once to its first deterministic project", async () => {
    const route = await loadRoute();
    mocks.resolveMode.mockResolvedValue({
      kind: "client_only",
      clientProjectIds: ["project-a", "project-b"],
    });

    await mount(route.component);

    expect(mocks.navigate).toHaveBeenCalledTimes(1);
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: "/client/projects/project-a",
      replace: true,
    });
    expect(mocks.recordActivity).not.toHaveBeenCalled();
  });

  it("redirects an unknown project path to the first deterministic authorized project", async () => {
    const route = await loadRoute();
    mocks.routePathname = "/client/projects/not-authorized";
    mocks.routeHref = mocks.routePathname;
    mocks.resolveMode.mockResolvedValue({
      kind: "client_only",
      clientProjectIds: ["project-a", "project-b"],
    });

    await mount(route.component);

    expect(container?.querySelector('[data-testid="authenticated-outlet"]')).toBeNull();
    expect(
      container?.querySelector('[data-testid="access-mode-client-redirecting"]'),
    ).not.toBeNull();
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: "/client/projects/project-a",
      replace: true,
    });
  });

  it("removes a revoked project mid-session and redirects to the remaining exact access", async () => {
    const route = await loadRoute();
    mocks.routePathname = "/client/projects/project-b";
    mocks.routeHref = mocks.routePathname;
    mocks.resolveMode
      .mockResolvedValueOnce({
        kind: "client_only",
        clientProjectIds: ["project-a", "project-b"],
      })
      .mockResolvedValueOnce({
        kind: "client_only",
        clientProjectIds: ["project-a"],
      });

    await mount(route.component);
    expect(container?.querySelector('[data-testid="authenticated-outlet"]')).not.toBeNull();

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await flush();

    expect(container?.querySelector('[data-testid="authenticated-outlet"]')).toBeNull();
    expect(mocks.navigate).toHaveBeenLastCalledWith({
      to: "/client/projects/project-a",
      replace: true,
    });
  });

  it("re-verifies access on focus, visible restoration, and auth state changes", async () => {
    const route = await loadRoute();
    mocks.routePathname = "/client/projects/project-a";
    mocks.routeHref = mocks.routePathname;
    mocks.resolveMode.mockResolvedValue({
      kind: "client_only",
      clientProjectIds: ["project-a"],
    });

    await mount(route.component);
    expect(mocks.resolveMode).toHaveBeenCalledTimes(1);

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await flush();
    expect(mocks.resolveMode).toHaveBeenCalledTimes(2);

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await flush();
    expect(mocks.resolveMode).toHaveBeenCalledTimes(2);

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await flush();
    expect(mocks.resolveMode).toHaveBeenCalledTimes(3);

    await act(async () => {
      mocks.authStateCallback?.("TOKEN_REFRESHED");
    });
    await flush();
    expect(mocks.resolveMode).toHaveBeenCalledTimes(4);
  });

  it("leaves internal chrome after an organization-sensitive heartbeat fails", async () => {
    const route = await loadRoute();
    mocks.resolveMode
      .mockResolvedValueOnce({
        kind: "internal_active",
        organizationId: "org-1",
        clientProjectIds: [],
      })
      .mockResolvedValueOnce({ kind: "no_active_company" });
    mocks.recordActivity.mockRejectedValueOnce(new Error("seat no longer active"));

    await mount(route.component);
    await flush();

    expect(mocks.resolveMode).toHaveBeenCalledTimes(2);
    expect(container?.querySelector('[data-testid="authenticated-outlet"]')).toBeNull();
    expect(
      container?.querySelector('[data-testid="access-mode-no-active-company"]'),
    ).not.toBeNull();
  });

  it("periodically re-resolves an active internal seat without clearing its Outlet first", async () => {
    const route = await loadRoute();
    let accessRecheck: (() => void) | undefined;
    const nativeSetInterval = window.setInterval.bind(window);
    const intervalSpy = vi.spyOn(window, "setInterval").mockImplementation((callback, ms) => {
      if (ms === 60_000) {
        accessRecheck = callback as () => void;
        return 60_000;
      }
      return nativeSetInterval(callback, ms);
    });
    mocks.resolveMode.mockResolvedValue({
      kind: "internal_active",
      organizationId: "org-1",
      clientProjectIds: [],
    });

    await mount(route.component);
    expect(accessRecheck).toBeTypeOf("function");
    expect(container?.querySelector('[data-testid="authenticated-outlet"]')).not.toBeNull();

    await act(async () => accessRecheck?.());
    await flush();

    expect(mocks.resolveMode).toHaveBeenCalledTimes(2);
    expect(container?.querySelector('[data-testid="authenticated-outlet"]')).not.toBeNull();
    intervalSpy.mockRestore();
  });

  it("periodically removes revoked client access while the browser remains focused", async () => {
    const route = await loadRoute();
    mocks.routePathname = "/client/projects/project-b";
    mocks.routeHref = mocks.routePathname;
    let accessRecheck: (() => void) | undefined;
    const nativeSetInterval = window.setInterval.bind(window);
    const intervalSpy = vi.spyOn(window, "setInterval").mockImplementation((callback, ms) => {
      if (ms === 60_000) {
        accessRecheck = callback as () => void;
        return 60_000;
      }
      return nativeSetInterval(callback, ms);
    });
    mocks.resolveMode
      .mockResolvedValueOnce({
        kind: "client_only",
        clientProjectIds: ["project-a", "project-b"],
      })
      .mockResolvedValueOnce({
        kind: "client_only",
        clientProjectIds: ["project-a"],
      });

    await mount(route.component);
    expect(accessRecheck).toBeTypeOf("function");
    expect(container?.querySelector('[data-testid="authenticated-outlet"]')).not.toBeNull();

    await act(async () => accessRecheck?.());
    await flush();

    expect(mocks.resolveMode).toHaveBeenCalledTimes(2);
    expect(container?.querySelector('[data-testid="authenticated-outlet"]')).toBeNull();
    expect(mocks.navigate).toHaveBeenLastCalledWith({
      to: "/client/projects/project-a",
      replace: true,
    });
    intervalSpy.mockRestore();
  });

  it.each([320, 390, 768, 1280])(
    "uses the shared fitted access surface without inline sizing at %ipx",
    async (width) => {
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: width,
      });
      const route = await loadRoute();
      mocks.resolveMode.mockResolvedValue({ kind: "no_active_company" });

      await mount(route.component);

      const main = container?.querySelector('[data-testid="access-mode-no-active-company"]');
      const section = main?.querySelector("section");
      expect(main?.getAttribute("style")).toBeNull();
      expect(section?.getAttribute("style")).toBeNull();
      expect(main?.className).toContain("overflow-x-hidden");
      expect(section?.className).toContain("min-w-0");
      expect(section?.className).toContain("w-full");
    },
  );

  it("fails closed and clears only the local session when user verification fails", async () => {
    const route = await loadRoute();
    mocks.getUser.mockResolvedValue({
      data: { user: null },
      error: new Error("provider diagnostic"),
    });
    mocks.resolveMode.mockResolvedValue({
      kind: "internal_active",
      organizationId: "org-1",
      clientProjectIds: [],
    });

    await mount(route.component);

    expect(mocks.resolveMode).not.toHaveBeenCalled();
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(mocks.locationReplace).toHaveBeenCalledWith("/auth");
  });

  it("fails closed in beforeLoad when a restored session cannot be verified", async () => {
    const route = await loadRoute();
    mocks.getUser.mockResolvedValue({
      data: { user: null },
      error: new Error("provider diagnostic"),
    });

    await expect(
      route.beforeLoad({ location: { href: "/projects?from=old-session" } }),
    ).rejects.toMatchObject({
      __redirect: true,
      options: {
        to: "/auth",
        search: { next: "/projects?from=old-session" },
        replace: true,
      },
    });
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: "local" });
  });
});
