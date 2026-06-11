import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  beforeLoad: () => {
    throw redirect({ to: "/" as never, replace: true, search: {} });
  },
  // Redirect target is the authenticated portfolio at "/", but TanStack
  // resolves "/" to this very route. We instead push users into the gated
  // subtree by reloading the path under the _authenticated layout below.
  component: () => null,
});
