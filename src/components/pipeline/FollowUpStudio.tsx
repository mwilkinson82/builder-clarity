import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CalendarClock, Handshake, Library, ListChecks, PlayCircle, Upload } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  completePreparedFollowup,
  createCrmValueAsset,
  enrollOpportunityInFollowupPlaybook,
  ensureCrmFollowupDefaults,
  listCrmFollowupStudio,
  updatePreparedFollowup,
  type CreateCrmValueAssetInput,
} from "@/lib/crm-followup.functions";
import { followupTiming } from "@/lib/crm-followup-domain";
import { supabase } from "@/integrations/supabase/client";
import type { PipelineMember, PipelineOpportunityRow } from "@/lib/pipeline.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { isDemoOpportunityId } from "./pipeline-ui";
import { DeliveryHistoryPanel } from "./DeliveryHistoryPanel";
import { MeetingPrepPanel } from "./MeetingPrepPanel";
import { OnboardingPanel } from "./OnboardingPanel";
import {
  EmptyPanel,
  PreparedFollowupCard,
  type FollowupOutcome,
  Field,
  PlaybookCard,
  QueueHeading,
  SectionLead,
  StudioMetric,
  SurfaceMessage,
  ValueAssetRow,
} from "./FollowUpStudioParts";

type FollowUpStudioProps = {
  opportunities: PipelineOpportunityRow[];
  members: PipelineMember[];
  onOpenOpportunity: (id: string) => void;
};

type AssetForm = {
  title: string;
  description: string;
  audience: string;
  tags: string;
  sourceType: "upload" | "link" | "google_drive";
  externalUrl: string;
};

const EMPTY_ASSET_FORM: AssetForm = {
  title: "",
  description: "",
  audience: "",
  tags: "",
  sourceType: "upload",
  externalUrl: "",
};

export function FollowUpStudio({ opportunities, members, onOpenOpportunity }: FollowUpStudioProps) {
  const queryClient = useQueryClient();
  const listFn = useServerFn(listCrmFollowupStudio);
  const ensureDefaultsFn = useServerFn(ensureCrmFollowupDefaults);
  const createAssetFn = useServerFn(createCrmValueAsset);
  const enrollFn = useServerFn(enrollOpportunityInFollowupPlaybook);
  const updateDraftFn = useServerFn(updatePreparedFollowup);
  const completeFn = useServerFn(completePreparedFollowup);
  const [defaultsChecked, setDefaultsChecked] = useState(false);
  const [selectedOpportunityId, setSelectedOpportunityId] = useState("");
  const [selectedPlaybookId, setSelectedPlaybookId] = useState("");
  const [selectedOwnerId, setSelectedOwnerId] = useState("current-user");
  const [assetForm, setAssetForm] = useState<AssetForm>(EMPTY_ASSET_FORM);
  const [assetFile, setAssetFile] = useState<File | null>(null);

  const studioQuery = useQuery({
    queryKey: ["crm-followup-studio"],
    queryFn: () => listFn(),
  });
  const snapshot = studioQuery.data;

  const invalidateStudio = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["crm-followup-studio"] }),
      queryClient.invalidateQueries({ queryKey: ["pipeline-crm-snapshot"] }),
      queryClient.invalidateQueries({ queryKey: ["pipeline-opportunities"] }),
    ]);
  };

  const ensureDefaultsMutation = useMutation({
    mutationFn: () => ensureDefaultsFn(),
    onSuccess: async (result) => {
      if (result.enabled) await invalidateStudio();
    },
    onError: (error) =>
      toast.error("Default follow-up playbook did not load", { description: message(error) }),
  });

  useEffect(() => {
    if (defaultsChecked || studioQuery.isLoading || studioQuery.isError) return;
    setDefaultsChecked(true);
    ensureDefaultsMutation.mutate();
  }, [defaultsChecked, ensureDefaultsMutation, studioQuery.isError, studioQuery.isLoading]);

  const enrollMutation = useMutation({
    mutationFn: () =>
      enrollFn({
        data: {
          opportunity_id: selectedOpportunityId,
          playbook_id: selectedPlaybookId,
          owner_user_id: selectedOwnerId === "current-user" ? null : selectedOwnerId,
        },
      }),
    onSuccess: async (result) => {
      await invalidateStudio();
      setSelectedOpportunityId("");
      toast.success("Follow-up playbook started", {
        description: `${result.actionCount} value-first follow-ups are prepared.`,
      });
    },
    onError: (error) => toast.error("Playbook did not start", { description: message(error) }),
  });

  const createAssetMutation = useMutation({
    mutationFn: async () => {
      if (!snapshot?.enabled) throw new Error("The Follow-Up Studio migration is not active yet.");
      if (!assetForm.title.trim()) throw new Error("Give this resource a clear title.");

      let storagePath = "";
      let upload: { path: string } | null = null;
      if (assetForm.sourceType === "upload") {
        if (!assetFile) throw new Error("Choose a file to add to the Value Library.");
        const safeName = sanitizeFileName(assetFile.name) || "resource";
        storagePath = `${snapshot.organizationId}/${crypto.randomUUID()}/${safeName}`;
        const { error } = await supabase.storage.from("crm-assets").upload(storagePath, assetFile, {
          contentType: assetFile.type || "application/octet-stream",
          upsert: false,
        });
        if (error) throw new Error(error.message);
        upload = { path: storagePath };
      }

      const input: CreateCrmValueAssetInput = {
        title: assetForm.title.trim(),
        description: assetForm.description.trim(),
        source_type: assetForm.sourceType,
        storage_path: storagePath,
        external_url: assetForm.sourceType === "upload" ? "" : assetForm.externalUrl.trim(),
        original_file_name: assetFile?.name ?? "",
        content_type: assetFile?.type ?? "",
        size_bytes: assetFile?.size ?? 0,
        tags: assetForm.tags
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
        audience: assetForm.audience.trim(),
        pipeline_stage: "",
      };
      try {
        return await createAssetFn({ data: input });
      } catch (error) {
        if (upload) await supabase.storage.from("crm-assets").remove([upload.path]);
        throw error;
      }
    },
    onSuccess: async () => {
      await invalidateStudio();
      setAssetForm(EMPTY_ASSET_FORM);
      setAssetFile(null);
      toast.success("Value resource added");
    },
    onError: (error) => toast.error("Resource did not save", { description: message(error) }),
  });

  const updateDraftMutation = useMutation({
    mutationFn: (input: { id: string; subject: string; body: string; assetId: string | null }) =>
      updateDraftFn({
        data: {
          id: input.id,
          subject: input.subject,
          body: input.body,
          value_asset_id: input.assetId,
        },
      }),
    onSuccess: async () => {
      await invalidateStudio();
      toast.success("Follow-up draft saved");
    },
    onError: (error) => toast.error("Draft did not save", { description: message(error) }),
  });

  const completeMutation = useMutation({
    mutationFn: (input: { id: string; outcome: FollowupOutcome; notes: string }) =>
      completeFn({
        data: { id: input.id, outcome: input.outcome, outcome_notes: input.notes },
      }),
    onSuccess: async (result) => {
      await invalidateStudio();
      toast.success(result.playbookCompleted ? "Follow-up playbook completed" : "Follow-up logged");
    },
    onError: (error) => toast.error("Follow-up did not close", { description: message(error) }),
  });

  const activeEnrollmentOpportunityIds = new Set(
    (snapshot?.enrollments ?? [])
      .filter((enrollment) => enrollment.status === "active" || enrollment.status === "paused")
      .map((enrollment) => enrollment.opportunity_id),
  );
  const eligibleOpportunities = opportunities.filter(
    (opportunity) =>
      !opportunity.archived &&
      !isDemoOpportunityId(opportunity.id) &&
      !activeEnrollmentOpportunityIds.has(opportunity.id) &&
      !["won", "lost", "no_bid"].includes(opportunity.stage),
  );
  const prepared = snapshot?.prepared ?? [];
  const timingCounts = prepared.reduce(
    (counts, action) => {
      counts[followupTiming(action.due_date)] += 1;
      return counts;
    },
    { overdue: 0, today: 0, upcoming: 0, unscheduled: 0 },
  );

  if (studioQuery.isLoading) {
    return <SurfaceMessage>Preparing the Follow-Up Studio…</SurfaceMessage>;
  }
  if (studioQuery.isError) {
    return <SurfaceMessage tone="danger">{message(studioQuery.error)}</SurfaceMessage>;
  }

  return (
    <div className="space-y-5">
      {!snapshot?.enabled && (
        <div className="rounded-xl border border-warning/35 bg-warning/5 px-4 py-3 text-sm text-foreground">
          <div className="font-semibold">Follow-Up Studio migration is ready</div>
          <p className="mt-1 text-muted-foreground">
            The interface and default playbook are visible in preview. Lovable still needs to apply
            the CRM follow-up migration before resources and enrollments can be saved.
          </p>
        </div>
      )}

      <div className="grid gap-px overflow-hidden rounded-xl border border-hairline bg-hairline sm:grid-cols-2 xl:grid-cols-4">
        <StudioMetric label="Overdue" value={timingCounts.overdue} tone="danger" />
        <StudioMetric label="Ready today" value={timingCounts.today} tone="warning" />
        <StudioMetric label="Upcoming" value={timingCounts.upcoming} />
        <StudioMetric label="Value resources" value={snapshot?.assets.length ?? 0} />
      </div>

      <Tabs defaultValue="queue" className="space-y-4">
        <TabsList className="h-auto w-full justify-start overflow-x-auto rounded-xl border border-hairline bg-surface p-1">
          <TabsTrigger value="queue" className="gap-1.5">
            <CalendarClock className="h-3.5 w-3.5" /> Follow-up queue
          </TabsTrigger>
          <TabsTrigger value="playbooks" className="gap-1.5">
            <PlayCircle className="h-3.5 w-3.5" /> Playbooks
          </TabsTrigger>
          <TabsTrigger value="library" className="gap-1.5">
            <Library className="h-3.5 w-3.5" /> Value Library
          </TabsTrigger>
          <TabsTrigger value="meeting-prep" className="gap-1.5">
            <Handshake className="h-3.5 w-3.5" /> Meeting prep
          </TabsTrigger>
          <TabsTrigger value="onboarding" className="gap-1.5">
            <ListChecks className="h-3.5 w-3.5" /> Onboarding
          </TabsTrigger>
        </TabsList>

        <TabsContent value="queue" className="space-y-4">
          <SectionLead
            eyebrow="Today's work"
            title="Make every follow-up worth opening"
            description="Overwatch prepares the reason, message, and useful material. Review it, personalize it, and advance the relationship."
          />
          {prepared.length === 0 ? (
            <EmptyPanel
              title="No prepared follow-ups yet"
              description="Start a playbook on an opportunity. Overwatch will lay out the Day 1, 3, 5, and 8 value touches here."
            />
          ) : (
            (["overdue", "today", "upcoming", "unscheduled"] as const).map((timing) => {
              const actions = prepared.filter(
                (action) => followupTiming(action.due_date) === timing,
              );
              if (actions.length === 0) return null;
              return (
                <div key={timing} className="space-y-2">
                  <QueueHeading timing={timing} count={actions.length} />
                  {actions.map((action) => (
                    <PreparedFollowupCard
                      key={action.id}
                      action={action}
                      assets={snapshot?.assets ?? []}
                      isSaving={
                        updateDraftMutation.isPending &&
                        updateDraftMutation.variables?.id === action.id
                      }
                      isCompleting={
                        completeMutation.isPending && completeMutation.variables?.id === action.id
                      }
                      onSave={(draft) => updateDraftMutation.mutateAsync(draft)}
                      onComplete={(outcome, notes) =>
                        completeMutation.mutateAsync({ id: action.id, outcome, notes })
                      }
                      onOpenOpportunity={() => onOpenOpportunity(action.opportunity_id)}
                    />
                  ))}
                </div>
              );
            })
          )}
          <DeliveryHistoryPanel />
        </TabsContent>

        <TabsContent value="playbooks" className="space-y-5">
          <SectionLead
            eyebrow="Sales discipline"
            title="Put valuable follow-up on rails"
            description="Choose an opportunity once. The playbook prepares each touch, while the salesperson keeps judgment and control."
          />
          <div className="rounded-xl border border-hairline bg-surface p-4 shadow-card">
            <div className="grid gap-3 lg:grid-cols-[1fr_1fr_1fr_auto] lg:items-end">
              <Field label="Opportunity">
                <Select value={selectedOpportunityId} onValueChange={setSelectedOpportunityId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose an opportunity" />
                  </SelectTrigger>
                  <SelectContent>
                    {eligibleOpportunities.map((opportunity) => (
                      <SelectItem key={opportunity.id} value={opportunity.id}>
                        {opportunity.name} · {opportunity.client || "No client"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Playbook">
                <Select value={selectedPlaybookId} onValueChange={setSelectedPlaybookId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose a playbook" />
                  </SelectTrigger>
                  <SelectContent>
                    {(snapshot?.playbooks ?? []).map((playbook) => (
                      <SelectItem
                        key={playbook.id}
                        value={playbook.id}
                        disabled={!snapshot?.enabled}
                      >
                        {playbook.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Owner">
                <Select value={selectedOwnerId} onValueChange={setSelectedOwnerId}>
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
              <Button
                type="button"
                variant="signal"
                className="gap-1.5"
                disabled={
                  !snapshot?.enabled ||
                  !selectedOpportunityId ||
                  !selectedPlaybookId ||
                  enrollMutation.isPending
                }
                onClick={() => enrollMutation.mutate()}
              >
                <PlayCircle className="h-4 w-4" />
                {enrollMutation.isPending ? "Starting…" : "Start playbook"}
              </Button>
            </div>
            {eligibleOpportunities.length === 0 && (
              <p className="mt-3 text-xs text-muted-foreground">
                Every active opportunity already has a playbook, or only sample/closed opportunities
                are available.
              </p>
            )}
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            {(snapshot?.playbooks ?? []).map((playbook) => (
              <PlaybookCard key={playbook.id} playbook={playbook} />
            ))}
          </div>
        </TabsContent>

        <TabsContent value="library" className="space-y-5">
          <SectionLead
            eyebrow="Reusable value"
            title="Give the team something useful to send"
            description="Store approved guides, checklists, case studies, articles, and planning resources once, then use them across follow-up playbooks."
          />
          <div className="grid items-start gap-4 xl:grid-cols-[0.9fr_1.1fr]">
            <div className="rounded-xl border border-hairline bg-surface p-5 shadow-card">
              <div className="eyebrow">Add a resource</div>
              <div className="mt-4 space-y-4">
                <Field label="Resource title">
                  <Input
                    value={assetForm.title}
                    onChange={(event) =>
                      setAssetForm((current) => ({ ...current, title: event.target.value }))
                    }
                    placeholder="Preconstruction decision checklist"
                  />
                </Field>
                <Field label="Why it is useful">
                  <Textarea
                    value={assetForm.description}
                    onChange={(event) =>
                      setAssetForm((current) => ({ ...current, description: event.target.value }))
                    }
                    placeholder="Helps owners settle scope, allowances, and decision responsibility early."
                    rows={3}
                  />
                </Field>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Source">
                    <Select
                      value={assetForm.sourceType}
                      onValueChange={(value) =>
                        setAssetForm((current) => ({
                          ...current,
                          sourceType: value as AssetForm["sourceType"],
                        }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="upload">Upload a file</SelectItem>
                        <SelectItem value="link">Article or web link</SelectItem>
                        <SelectItem value="google_drive">Google Drive link</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="Best audience">
                    <Input
                      value={assetForm.audience}
                      onChange={(event) =>
                        setAssetForm((current) => ({ ...current, audience: event.target.value }))
                      }
                      placeholder="Residential owners"
                    />
                  </Field>
                </div>
                {assetForm.sourceType === "upload" ? (
                  <Field label="PDF, document, or image">
                    <Input
                      type="file"
                      accept=".pdf,.doc,.docx,.ppt,.pptx,.txt,.md,.jpg,.jpeg,.png"
                      onChange={(event) => setAssetFile(event.target.files?.[0] ?? null)}
                    />
                    {assetFile && (
                      <div className="mt-1 text-xs text-muted-foreground">
                        {assetFile.name} · {formatBytes(assetFile.size)}
                      </div>
                    )}
                  </Field>
                ) : (
                  <Field
                    label={
                      assetForm.sourceType === "google_drive"
                        ? "Google Drive sharing URL"
                        : "Article or resource URL"
                    }
                  >
                    <Input
                      type="url"
                      value={assetForm.externalUrl}
                      onChange={(event) =>
                        setAssetForm((current) => ({
                          ...current,
                          externalUrl: event.target.value,
                        }))
                      }
                      placeholder={
                        assetForm.sourceType === "google_drive"
                          ? "https://drive.google.com/…"
                          : "https://…"
                      }
                    />
                  </Field>
                )}
                <Field label="Tags">
                  <Input
                    value={assetForm.tags}
                    onChange={(event) =>
                      setAssetForm((current) => ({ ...current, tags: event.target.value }))
                    }
                    placeholder="planning, budget, design decisions"
                  />
                </Field>
                <Button
                  type="button"
                  className="w-full gap-1.5"
                  disabled={!snapshot?.enabled || createAssetMutation.isPending}
                  onClick={() => createAssetMutation.mutate()}
                >
                  <Upload className="h-4 w-4" />
                  {createAssetMutation.isPending ? "Adding resource…" : "Add to Value Library"}
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              {(snapshot?.assets ?? []).length === 0 ? (
                <EmptyPanel
                  title="The Value Library is empty"
                  description="Add a useful PDF, guide, article, or checklist. These resources become the substance behind Day 3 and Day 5 follow-ups."
                />
              ) : (
                snapshot?.assets.map((asset) => <ValueAssetRow key={asset.id} asset={asset} />)
              )}
              <div className="rounded-xl border border-dashed border-hairline bg-background px-4 py-3 text-xs text-muted-foreground">
                Google Drive resources use the sharing link you provide. Keep the file permission
                set so the recipient can open it; OverWatch records the Drive source alongside
                uploads and articles.
              </div>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="meeting-prep">
          <MeetingPrepPanel
            opportunities={opportunities}
            members={members}
            onOpenOpportunity={onOpenOpportunity}
          />
        </TabsContent>

        <TabsContent value="onboarding">
          <OnboardingPanel
            opportunities={opportunities}
            members={members}
            onOpenOpportunity={onOpenOpportunity}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function sanitizeFileName(name: string) {
  return name
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 180);
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function message(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error";
}
