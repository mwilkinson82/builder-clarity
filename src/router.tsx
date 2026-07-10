import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { toast } from "sonner";
import { routeTree } from "./routeTree.gen";
import { reloadOnStaleDeploy } from "./lib/reload-on-stale-deploy";
import { watchForNewDeploy } from "./lib/new-version-toast";

// Client only — getRouter also runs per-request on the server, where there is
// no window and no chunk preloading.
if (typeof window !== "undefined") {
  reloadOnStaleDeploy();
  // The broken-old-tab case reloads itself above; the WORKING-old-tab case
  // gets a persistent nudge instead — never a surprise reload under the
  // user's feet while they might be mid-form.
  watchForNewDeploy(() => {
    toast("A new version of Overwatch is ready", {
      id: "new-version-available",
      description: "Refresh to pick it up — you'll land right where you are.",
      duration: Infinity,
      action: { label: "Refresh", onClick: () => window.location.reload() },
    });
  });
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
