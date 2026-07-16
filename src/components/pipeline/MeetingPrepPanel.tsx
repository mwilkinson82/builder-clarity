import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import { generateCrmMeetingBrief } from "@/lib/crm-actions-ai.functions";
import type { CrmMeetingBrief } from "@/lib/crm-actions.functions";
import type { PipelineMember, PipelineOpportunityRow } from "@/lib/pipeline.functions";
import { EmptyPanel, Field, SectionLead, SurfaceMessage } from "./FollowUpStudioParts";
import { isDemoOpportunityId } from "./pipeline-ui";
import { crmActionError, useCrmActionSuite } from "./useCrmActionSuite";

type MeetingPrepPanelProps = {
  opportunities: PipelineOpportunityRow[];
  members: PipelineMember[];
  onOpenOpportunity: (id: string) => void;
};

export function MeetingPrepPanel({ opportunities, onOpenOpportunity }: MeetingPrepPanelProps) {
  const queryClient = useQueryClient();
  const suiteQuery = useCrmActionSuite();
  const generateFn = useServerFn(generateCrmMeetingBrief);
  const eligible = useMemo(
    () =>
      opportunities.filter(
        (opportunity) => !opportunity.archived && !isDemoOpportunityId(opportunity.id),
      ),
    [opportunities],
  );
  const [opportunityId, setOpportunityId] = useState("");
  const [meetingType, setMeetingType] = useState<
    "sales" | "handoff" | "kickoff" | "client_onboarding"
  >("sales");
  const [meetingAt, setMeetingAt] = useState("");
  const [attendees, setAttendees] = useState("");
  const [goal, setGoal] = useState("");
  const [latestBriefId, setLatestBriefId] = useState("");

  const mutation = useMutation({
    mutationFn: () =>
      generateFn({
        data: {
          opportunity_id: opportunityId,
          meeting_type: meetingType,
          meeting_at: meetingAt ? new Date(meetingAt).toISOString() : null,
          attendee_names: attendees
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean),
          meeting_goal: goal.trim(),
        },
      }),
    onSuccess: async (result) => {
      setLatestBriefId(result.id);
      await queryClient.invalidateQueries({ queryKey: ["crm-action-suite"] });
      toast.success("Meeting brief prepared", {
        description: `${result.credits_charged} AI credit${result.credits_charged === 1 ? "" : "s"} used.`,
      });
    },
    onError: (error) =>
      toast.error("Brief was not prepared", { description: crmActionError(error) }),
  });

  if (suiteQuery.isLoading) return <SurfaceMessage>Loading meeting preparation…</SurfaceMessage>;
  if (suiteQuery.isError) {
    return <SurfaceMessage tone="danger">{crmActionError(suiteQuery.error)}</SurfaceMessage>;
  }
  const briefs = suiteQuery.data?.meetingBriefs ?? [];
  const current = briefs.find((brief) => brief.id === latestBriefId) ?? briefs[0] ?? null;
  return (
    <div className="space-y-5">
      <SectionLead
        eyebrow="Prepared conversations"
        title="Walk into the meeting with a point of view"
        description="OverWatch turns the opportunity history, open actions, pricing state, and stated goal into a practical brief. The salesperson still reviews every recommendation."
      />
      {!suiteQuery.data?.enabled && (
        <SurfaceMessage>
          AI meeting briefs will activate with the CRM action-suite migration.
        </SurfaceMessage>
      )}
      <div className="grid items-start gap-4 xl:grid-cols-[0.8fr_1.2fr]">
        <div className="rounded-xl border border-hairline bg-surface p-5 shadow-card">
          <div className="eyebrow">Prepare a meeting</div>
          <div className="mt-4 space-y-4">
            <Field label="Opportunity">
              <Select value={opportunityId} onValueChange={setOpportunityId}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose an opportunity" />
                </SelectTrigger>
                <SelectContent>
                  {eligible.map((opportunity) => (
                    <SelectItem key={opportunity.id} value={opportunity.id}>
                      {opportunity.name} · {opportunity.client || "No client"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Meeting type">
              <Select
                value={meetingType}
                onValueChange={(value) => setMeetingType(value as typeof meetingType)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sales">Sales / pursuit</SelectItem>
                  <SelectItem value="handoff">Sales-to-operations handoff</SelectItem>
                  <SelectItem value="kickoff">Project kickoff</SelectItem>
                  <SelectItem value="client_onboarding">Client onboarding</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Meeting date and time">
              <Input
                type="datetime-local"
                value={meetingAt}
                onChange={(event) => setMeetingAt(event.target.value)}
              />
            </Field>
            <Field label="Attendees">
              <Input
                value={attendees}
                onChange={(event) => setAttendees(event.target.value)}
                placeholder="Names, separated by commas"
              />
            </Field>
            <Field label="What must this meeting accomplish?">
              <Textarea
                value={goal}
                onChange={(event) => setGoal(event.target.value)}
                rows={4}
                placeholder="Clarify the decision, resolve scope, agree on next steps…"
              />
            </Field>
            <Button
              type="button"
              variant="signal"
              className="w-full gap-1.5"
              disabled={!suiteQuery.data?.enabled || !opportunityId || mutation.isPending}
              onClick={() => mutation.mutate()}
            >
              <Sparkles className="h-4 w-4" />
              {mutation.isPending ? "Preparing brief…" : "Generate meeting brief · 1 credit"}
            </Button>
          </div>
        </div>
        {current ? (
          <MeetingBriefCard
            brief={current}
            onOpenOpportunity={() => onOpenOpportunity(current.opportunity_id)}
          />
        ) : (
          <EmptyPanel
            title="No meeting brief yet"
            description="Choose a real opportunity and a meeting goal. OverWatch will surface the context, questions, risks, value to bring, and useful next-step options."
          />
        )}
      </div>
    </div>
  );
}

function MeetingBriefCard({
  brief,
  onOpenOpportunity,
}: {
  brief: CrmMeetingBrief;
  onOpenOpportunity: () => void;
}) {
  const data = brief.brief_data;
  const sections: Array<[string, unknown]> = [
    ["Desired outcomes", data.desired_outcomes],
    ["Questions to ask", data.questions_to_ask],
    ["Risks to surface", data.risks_to_surface],
    ["Value to bring", data.value_to_bring],
    ["Next-step options", data.next_step_options],
  ];
  return (
    <div className="rounded-xl border border-hairline bg-surface p-5 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="eyebrow">AI meeting brief · human reviewed</div>
          <h3 className="mt-1 font-serif text-2xl text-foreground">{brief.title}</h3>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {textValue(data.executive_summary)}
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={onOpenOpportunity}>
          Opportunity
        </Button>
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {sections.map(([label, value]) => (
          <div key={label} className="border-t border-hairline pt-3">
            <div className="font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-clay">
              {label}
            </div>
            <ul className="mt-2 space-y-2 text-xs leading-5 text-foreground">
              {listValue(value).map((item) => (
                <li key={item} className="border-l border-hairline pl-2">
                  {item}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

function listValue(value: unknown) {
  return Array.isArray(value) ? value.map((item) => textValue(item)).filter(Boolean) : [];
}

function textValue(value: unknown) {
  return typeof value === "string" ? value : "";
}
