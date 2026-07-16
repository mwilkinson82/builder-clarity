import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, Circle, ClipboardCheck } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  createCrmOnboardingPlan,
  updateCrmOnboardingTask,
  type CrmOnboardingPlan,
} from "@/lib/crm-actions.functions";
import type { PipelineMember, PipelineOpportunityRow } from "@/lib/pipeline.functions";
import { cn } from "@/lib/utils";
import { EmptyPanel, Field, SectionLead, SurfaceMessage } from "./FollowUpStudioParts";
import { isDemoOpportunityId, shortDate } from "./pipeline-ui";
import { crmActionError, useCrmActionSuite } from "./useCrmActionSuite";

type OnboardingPanelProps = {
  opportunities: PipelineOpportunityRow[];
  members: PipelineMember[];
  onOpenOpportunity: (id: string) => void;
};

export function OnboardingPanel({
  opportunities,
  members,
  onOpenOpportunity,
}: OnboardingPanelProps) {
  const queryClient = useQueryClient();
  const suiteQuery = useCrmActionSuite();
  const createPlanFn = useServerFn(createCrmOnboardingPlan);
  const updateTaskFn = useServerFn(updateCrmOnboardingTask);
  const [opportunityId, setOpportunityId] = useState("");
  const [ownerId, setOwnerId] = useState("current-user");
  const [kickoffDate, setKickoffDate] = useState("");
  const [handoffSummary, setHandoffSummary] = useState("");
  const plans = suiteQuery.data?.onboardingPlans ?? [];
  const activeOpportunityIds = new Set(
    plans.filter((plan) => plan.status === "active").map((plan) => plan.opportunity_id),
  );
  const won = opportunities.filter(
    (opportunity) =>
      opportunity.stage === "won" &&
      !opportunity.archived &&
      !isDemoOpportunityId(opportunity.id) &&
      !activeOpportunityIds.has(opportunity.id),
  );

  const createMutation = useMutation({
    mutationFn: () =>
      createPlanFn({
        data: {
          opportunity_id: opportunityId,
          owner_user_id: ownerId === "current-user" ? null : ownerId,
          kickoff_date: kickoffDate || null,
          handoff_summary: handoffSummary.trim(),
        },
      }),
    onSuccess: async (result) => {
      setOpportunityId("");
      setHandoffSummary("");
      await queryClient.invalidateQueries({ queryKey: ["crm-action-suite"] });
      toast.success("Onboarding plan started", {
        description: `${result.taskCount} contract-to-kickoff steps are ready.`,
      });
    },
    onError: (error) =>
      toast.error("Onboarding did not start", { description: crmActionError(error) }),
  });
  const taskMutation = useMutation({
    mutationFn: (input: { taskId: string; status: "todo" | "done" | "skipped" }) =>
      updateTaskFn({ data: { task_id: input.taskId, status: input.status } }),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["crm-action-suite"] });
      if (result.planCompleted) toast.success("Onboarding plan completed");
    },
    onError: (error) => toast.error("Step did not update", { description: crmActionError(error) }),
  });

  if (suiteQuery.isLoading) return <SurfaceMessage>Loading onboarding plans…</SurfaceMessage>;
  if (suiteQuery.isError) {
    return <SurfaceMessage tone="danger">{crmActionError(suiteQuery.error)}</SurfaceMessage>;
  }
  return (
    <div className="space-y-5">
      <SectionLead
        eyebrow="Contract-to-kickoff"
        title="Do not let a won job fall into an operational gap"
        description="OverWatch creates the handoff, scope, schedule, billing, risk, and client-kickoff work the moment the contract is won."
      />
      {!suiteQuery.data?.enabled && (
        <SurfaceMessage>
          Onboarding plans will activate with the CRM action-suite migration.
        </SurfaceMessage>
      )}
      <div className="rounded-xl border border-hairline bg-surface p-5 shadow-card">
        <div className="grid gap-3 xl:grid-cols-[1fr_0.8fr_0.65fr_1.3fr_auto] xl:items-end">
          <Field label="Won opportunity">
            <Select value={opportunityId} onValueChange={setOpportunityId}>
              <SelectTrigger>
                <SelectValue placeholder="Choose a signed job" />
              </SelectTrigger>
              <SelectContent>
                {won.map((opportunity) => (
                  <SelectItem key={opportunity.id} value={opportunity.id}>
                    {opportunity.name} · {opportunity.client}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Onboarding owner">
            <Select value={ownerId} onValueChange={setOwnerId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="current-user">Me</SelectItem>
                {members.map((member) => (
                  <SelectItem key={member.user_id} value={member.user_id}>
                    {member.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Kickoff date">
            <Input
              type="date"
              value={kickoffDate}
              onChange={(event) => setKickoffDate(event.target.value)}
            />
          </Field>
          <Field label="Critical handoff note">
            <Input
              value={handoffSummary}
              onChange={(event) => setHandoffSummary(event.target.value)}
              placeholder="Promises, exclusions, open risks…"
            />
          </Field>
          <Button
            type="button"
            variant="signal"
            className="gap-1.5"
            disabled={!suiteQuery.data?.enabled || !opportunityId || createMutation.isPending}
            onClick={() => createMutation.mutate()}
          >
            <ClipboardCheck className="h-4 w-4" />
            {createMutation.isPending ? "Starting…" : "Start onboarding"}
          </Button>
        </div>
      </div>
      {plans.length === 0 ? (
        <EmptyPanel
          title="No onboarding plans yet"
          description="Mark an opportunity Won, then start the prepared contract-to-kickoff checklist here."
        />
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {plans.map((plan) => (
            <OnboardingPlanCard
              key={plan.id}
              plan={plan}
              onOpenOpportunity={() => onOpenOpportunity(plan.opportunity_id)}
              onUpdate={(taskId, status) => taskMutation.mutate({ taskId, status })}
              pendingTaskId={taskMutation.isPending ? taskMutation.variables?.taskId : undefined}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function OnboardingPlanCard({
  plan,
  onOpenOpportunity,
  onUpdate,
  pendingTaskId,
}: {
  plan: CrmOnboardingPlan;
  onOpenOpportunity: () => void;
  onUpdate: (taskId: string, status: "todo" | "done") => void;
  pendingTaskId?: string;
}) {
  const done = plan.tasks.filter((task) => task.status !== "todo").length;
  return (
    <div className="rounded-xl border border-hairline bg-surface p-5 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="eyebrow">
            {plan.status} · {done}/{plan.tasks.length} steps
          </div>
          <h3 className="mt-1 font-serif text-xl text-foreground">{plan.title}</h3>
          {plan.handoff_summary && (
            <p className="mt-1 text-xs leading-5 text-muted-foreground">{plan.handoff_summary}</p>
          )}
        </div>
        <Button type="button" variant="outline" size="sm" onClick={onOpenOpportunity}>
          Opportunity
        </Button>
      </div>
      <div className="mt-4 divide-y divide-hairline border-t border-hairline">
        {plan.tasks.map((task) => {
          const complete = task.status !== "todo";
          return (
            <button
              key={task.id}
              type="button"
              className="flex w-full items-start gap-3 py-3 text-left disabled:opacity-60"
              disabled={pendingTaskId === task.id || plan.status !== "active"}
              onClick={() => onUpdate(task.id, complete ? "todo" : "done")}
            >
              {complete ? (
                <Check className="mt-0.5 h-4 w-4 text-success" />
              ) : (
                <Circle className="mt-0.5 h-4 w-4 text-muted-foreground" />
              )}
              <div className="min-w-0 flex-1">
                <div
                  className={cn(
                    "text-sm font-semibold text-foreground",
                    complete && "line-through opacity-70",
                  )}
                >
                  {task.title}
                </div>
                <div className="mt-1 text-xs leading-5 text-muted-foreground">
                  {task.description}
                </div>
              </div>
              <div className="shrink-0 text-[10px] text-muted-foreground">
                {shortDate(task.due_date)}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
