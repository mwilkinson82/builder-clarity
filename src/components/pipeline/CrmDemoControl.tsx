import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, RotateCcw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  ensureHarborCrmDemo,
  getHarborCrmDemoStatus,
  resetHarborCrmDemo,
} from "@/lib/crm-demo.functions";

const LOCAL_DEMO_KEYS = [
  "overwatch.crm.demo-opportunity-overrides.v1",
  "overwatch.crm.demo-communications.v1",
  "overwatch.crm.demo-opportunity-removals.v1",
];

export function CrmDemoControl() {
  const queryClient = useQueryClient();
  const ensureFn = useServerFn(ensureHarborCrmDemo);
  const statusFn = useServerFn(getHarborCrmDemoStatus);
  const resetFn = useServerFn(resetHarborCrmDemo);
  const statusQuery = useQuery({
    queryKey: ["harbor-crm-demo-status"],
    queryFn: async () => {
      const current = await statusFn();
      if (
        current.available &&
        (current.status !== "ready" || current.appliedVersion < current.targetVersion)
      ) {
        await ensureFn();
        return statusFn();
      }
      return current;
    },
  });
  const resetMutation = useMutation({
    mutationFn: () => resetFn(),
    onSuccess: async (result) => {
      for (const key of LOCAL_DEMO_KEYS) window.localStorage.removeItem(key);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["harbor-crm-demo-status"] }),
        queryClient.invalidateQueries({ queryKey: ["pipeline-opportunities"] }),
        queryClient.invalidateQueries({ queryKey: ["pipeline-crm-snapshot"] }),
        queryClient.invalidateQueries({ queryKey: ["crm-followup-studio"] }),
        queryClient.invalidateQueries({ queryKey: ["crm-action-suite"] }),
      ]);
      toast.success("Harbor CRM walkthrough restored", {
        description: `${result.opportunityCount ?? 0} opportunities and the connected follow-up, meeting, and onboarding stories are back at their starting point.`,
      });
    },
    onError: (error) =>
      toast.error("Harbor CRM did not restore", {
        description: error instanceof Error ? error.message : "Unknown error",
      }),
  });

  const status = statusQuery.data;
  if (!status?.available) return null;
  const ready = status.status === "ready" && status.appliedVersion >= status.targetVersion;

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-clay/25 bg-clay/5 px-4 py-3 shadow-card">
      <div className="rounded-lg border border-clay/25 bg-surface p-2 text-clay">
        <ShieldCheck className="h-4 w-4" />
      </div>
      <div className="min-w-[240px] flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <div className="font-semibold text-foreground">Harbor Residence CRM walkthrough</div>
          <span className="inline-flex items-center gap-1 rounded-full border border-success/25 bg-success/5 px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-success">
            <CheckCircle2 className="h-3 w-3" />{" "}
            {ready ? `Version ${status.appliedVersion}` : "Setup needed"}
          </span>
        </div>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          Practice the full lead-to-kickoff workflow. Demo email is always simulated, and Restore
          returns this story to its certified starting point.
        </p>
      </div>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            type="button"
            variant="outline"
            className="gap-1.5"
            disabled={statusQuery.isFetching || resetMutation.isPending}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            {statusQuery.isFetching
              ? "Preparing…"
              : resetMutation.isPending
                ? "Restoring…"
                : "Restore walkthrough"}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore the Harbor CRM walkthrough?</AlertDialogTitle>
            <AlertDialogDescription>
              This replaces changes made to the six Harbor demo opportunities, their prepared
              follow-ups, meeting brief, and onboarding checklist. Your real CRM records are not
              touched.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep my changes</AlertDialogCancel>
            <AlertDialogAction onClick={() => resetMutation.mutate()}>
              Restore Harbor CRM
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
