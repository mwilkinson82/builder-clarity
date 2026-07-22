type LovableErrorOptions = {
  mechanism?: "manual" | "onerror" | "unhandledrejection" | "react_error_boundary";
  handled?: boolean;
  severity?: "error" | "warning" | "info";
};

type LovableEvents = {
  captureException?: (
    error: unknown,
    context?: Record<string, unknown>,
    options?: LovableErrorOptions,
  ) => void;
};

declare global {
  interface Window {
    __lovableEvents?: LovableEvents;
  }
}

export function reportLovableError(error: unknown, context: Record<string, unknown> = {}) {
  if (typeof window === "undefined") return;
  window.__lovableEvents?.captureException?.(
    error,
    {
      source: "react_error_boundary",
      route: window.location.pathname,
      ...context,
    },
    {
      mechanism: "react_error_boundary",
      handled: false,
      severity: "error",
    },
  );
}

let globalHandlersInstalled = false;

/**
 * Forward uncaught errors and unhandled promise rejections to the monitoring
 * sink. React error boundaries only catch render-phase errors inside the tree;
 * this closes the gap for event handlers, async work, and anything thrown
 * outside React. Idempotent — safe to call on every mount.
 */
export function installGlobalErrorReporting() {
  if (typeof window === "undefined" || globalHandlersInstalled) return;
  globalHandlersInstalled = true;

  window.addEventListener("error", (event) => {
    const error = event.error ?? event.message;
    window.__lovableEvents?.captureException?.(
      error,
      { source: "window.onerror", route: window.location.pathname },
      { mechanism: "onerror", handled: false, severity: "error" },
    );
  });

  window.addEventListener("unhandledrejection", (event) => {
    window.__lovableEvents?.captureException?.(
      event.reason,
      { source: "unhandledrejection", route: window.location.pathname },
      { mechanism: "unhandledrejection", handled: false, severity: "error" },
    );
  });
}
