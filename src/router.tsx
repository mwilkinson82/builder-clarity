import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { reloadOnStaleDeploy } from "./lib/reload-on-stale-deploy";

// Client only — getRouter also runs per-request on the server, where there is
// no window and no chunk preloading.
if (typeof window !== "undefined") {
  reloadOnStaleDeploy();
}

export const getRouter = () => {
  const queryClient = new QueryClient();

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
