import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const getSession = vi.fn();
const getUser = vi.fn();
const signOut = vi.fn();
const navigate = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: (...args: unknown[]) => getSession(...args),
      getUser: (...args: unknown[]) => getUser(...args),
      signOut: (...args: unknown[]) => signOut(...args),
    },
  },
}));

vi.mock("@/lib/auth/magic-link", () => ({
  sendOverwatchMagicLink: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (config: unknown) => config,
  useNavigate: () => navigate,
  useLocation: () => ({ pathname: "/auth" }),
  Outlet: () => null,
  Link: ({
    children,
    to,
    ...props
  }: {
    children: React.ReactNode;
    to: string;
    [key: string]: unknown;
  }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/components/ui/button", () => ({
  Button: (props: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props} />,
}));

vi.mock("@/components/ui/input", () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));

vi.mock("@/components/ui/label", () => ({
  Label: (props: React.LabelHTMLAttributes<HTMLLabelElement>) => <label {...props} />,
}));

let container: HTMLDivElement;
let root: Root;

async function loadComponent() {
  const mod = await import("../src/routes/auth");
  const routeConfig = mod.Route as unknown as { component: () => JSX.Element };
  return routeConfig.component;
}

async function mount(Component: () => JSX.Element) {
  container = document.createElement("div");
  document.body.appendChild(container);
  await act(async () => {
    root = createRoot(container);
    root.render(<Component />);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  window.history.replaceState(null, "", "/auth?next=%2Fteam");
  getSession.mockReset();
  getUser.mockReset();
  signOut.mockReset();
  navigate.mockReset();
  signOut.mockResolvedValue({ error: null });
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
});

describe("saved browser session verification", () => {
  it("redirects only after getUser verifies the stored session", async () => {
    getSession.mockResolvedValue({
      data: { session: { user: { id: "u1" } } },
      error: null,
    });
    getUser.mockResolvedValue({
      data: { user: { id: "u1" } },
      error: null,
    });

    const Component = await loadComponent();
    await mount(Component);

    expect(getSession).toHaveBeenCalledTimes(1);
    expect(getUser).toHaveBeenCalledTimes(1);
    expect(signOut).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith({ to: "/team", replace: true });
  });

  it("clears an unverified stale session locally and never redirects", async () => {
    getSession.mockResolvedValue({
      data: { session: { user: { id: "stale-user" } } },
      error: null,
    });
    getUser.mockResolvedValue({
      data: { user: null },
      error: new Error("raw provider verification detail"),
    });

    const Component = await loadComponent();
    await mount(Component);

    expect(getUser).toHaveBeenCalledTimes(1);
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(navigate).not.toHaveBeenCalled();
    expect(container.textContent).toContain(
      "Your saved sign-in could not be verified. Request a fresh magic link to continue.",
    );
    expect(container.textContent).not.toContain("raw provider verification detail");
  });

  it("clears local auth state when reading the saved session fails", async () => {
    getSession.mockResolvedValue({
      data: { session: null },
      error: new Error("raw storage detail"),
    });

    const Component = await loadComponent();
    await mount(Component);

    expect(getUser).not.toHaveBeenCalled();
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(navigate).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("raw storage detail");
  });
});
