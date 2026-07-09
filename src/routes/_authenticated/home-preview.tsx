import { createFileRoute } from "@tanstack/react-router";

import { PortfolioHome } from "@/components/home/PortfolioHome";

// PHASE 1 preview of the redesigned Portfolio / Home screen (design option 6a).
// Lives at /home-preview so the live production portfolio (/) keeps working while
// this is reviewed; Phase 2 wires real data and promotes 6a onto /.
export const Route = createFileRoute("/_authenticated/home-preview")({
  ssr: false,
  head: () => ({ meta: [{ title: "Home — Overwatch" }] }),
  component: PortfolioHome,
});
