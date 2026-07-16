import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listCrmActionSuite } from "@/lib/crm-actions.functions";

export function useCrmActionSuite() {
  const listFn = useServerFn(listCrmActionSuite);
  return useQuery({ queryKey: ["crm-action-suite"], queryFn: () => listFn() });
}

export function crmActionError(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error";
}
