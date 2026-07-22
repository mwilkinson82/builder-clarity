// Fetches the same portfolio + CRM data the existing portfolio page uses (shared
// query keys → shared cache) and derives the 6a home view-model.
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { listProjects } from "@/lib/projects.functions";
import { listCrmSnapshot, listOpportunities } from "@/lib/pipeline.functions";
import { buildHomeMetrics, type HomeMetrics } from "./portfolio-home-metrics";
import { friendlyErrorMessage, GENERIC_LOAD_FALLBACK } from "@/lib/friendly-error";

export function useHomeMetrics(): {
  metrics: HomeMetrics;
  loading: boolean;
  isError: boolean;
  errorMessage: string | null;
  refetch: () => void;
} {
  const loadProjects = useServerFn(listProjects);
  const loadOpportunities = useServerFn(listOpportunities);
  const loadSnapshot = useServerFn(listCrmSnapshot);

  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: () => loadProjects(),
  });
  const opportunitiesQuery = useQuery({
    queryKey: ["pipeline-opportunities", false],
    queryFn: () => loadOpportunities({ data: { includeArchived: false } }),
  });
  const snapshotQuery = useQuery({
    queryKey: ["pipeline-crm-snapshot"],
    queryFn: () => loadSnapshot(),
  });

  const projects = projectsQuery.data;
  const opportunities = opportunitiesQuery.data;
  const snapshot = snapshotQuery.data;

  const metrics = useMemo(
    () => buildHomeMetrics(projects ?? [], opportunities ?? [], snapshot ?? null),
    [projects, opportunities, snapshot],
  );

  // A failed portfolio read must NOT fall through to metrics built from empty
  // arrays (which paint a false "$0 / all caught up"). Surface the error so the
  // home renders a retry card instead. Gate ONLY on the primary projects read:
  // opportunities (the pipeline rail) and the CRM snapshot are secondary rails —
  // a failure of either degrades that section and must never hide an otherwise-
  // working project portfolio behind a full-page "did not load" error.
  const firstError = projectsQuery.error;
  return {
    metrics,
    loading: projectsQuery.isLoading || opportunitiesQuery.isLoading || snapshotQuery.isLoading,
    isError: projectsQuery.isError,
    errorMessage: firstError ? friendlyErrorMessage(firstError, GENERIC_LOAD_FALLBACK) : null,
    refetch: () => {
      void projectsQuery.refetch();
      void opportunitiesQuery.refetch();
      void snapshotQuery.refetch();
    },
  };
}
