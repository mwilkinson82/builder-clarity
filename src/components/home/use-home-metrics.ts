// Fetches the same portfolio + CRM data the existing portfolio page uses (shared
// query keys → shared cache) and derives the 6a home view-model.
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { listProjects } from "@/lib/projects.functions";
import { listCrmSnapshot, listOpportunities } from "@/lib/pipeline.functions";
import { buildHomeMetrics, type HomeMetrics } from "./portfolio-home-metrics";

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
  // home renders a retry card instead. The CRM snapshot is a secondary rail —
  // only the two portfolio/pipeline reads gate the whole view.
  // Gate the error card on the two PRIMARY reads only: a secondary CRM-snapshot
  // failure must not hide an otherwise-working portfolio behind a full-page error.
  const firstError = projectsQuery.error ?? opportunitiesQuery.error;
  return {
    metrics,
    loading: projectsQuery.isLoading || opportunitiesQuery.isLoading || snapshotQuery.isLoading,
    isError: projectsQuery.isError || opportunitiesQuery.isError,
    errorMessage:
      firstError instanceof Error ? firstError.message : firstError ? String(firstError) : null,
    refetch: () => {
      void projectsQuery.refetch();
      void opportunitiesQuery.refetch();
      void snapshotQuery.refetch();
    },
  };
}
