import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listCrmActionSuite, type CrmActionSuiteSnapshot } from "@/lib/crm-actions.functions";

export function useCrmActionSuite() {
  const listFn = useServerFn(listCrmActionSuite);
  return useQuery<CrmActionSuiteSnapshot>({
    queryKey: ["crm-action-suite"],
    queryFn: async () => (await listFn()) as CrmActionSuiteSnapshot,
  });
}

export function crmActionError(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error";
}
