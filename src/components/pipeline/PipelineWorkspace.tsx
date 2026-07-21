import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  CalendarClock,
  KanbanSquare,
  List,
  Plus,
  RotateCcw,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { createEstimate } from "@/lib/estimates.functions";
import { friendlyActionError } from "@/lib/friendly-error";
import {
  addOpportunityNote,
  archiveOpportunity,
  completeNextAction,
  convertToProject,
  createNextAction,
  createOpportunity,
  getOpportunity,
  listCrmSnapshot,
  listOpportunities,
  listPipelineMembers,
  updateOpportunity,
  type CreateNextActionInput,
  type CreateOpportunityInput,
  type PipelineActivityRow,
  type PipelineOpportunityRow,
  type PipelineStage,
} from "@/lib/pipeline.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PipelineKanban } from "./PipelineKanban";
import { PipelineList } from "./PipelineList";
import { PipelineGlanceCard } from "./PipelineMetrics";
import { PipelineRailLists } from "./PipelineRailLists";
import { PipelineCrmOverview } from "./PipelineCrmOverview";
import { FollowUpStudio } from "./FollowUpStudio";
import { CrmDemoControl } from "./CrmDemoControl";
import { OpportunityCreateDialog, QuickAddOpportunity } from "./OpportunityCreateDialog";
import { OpportunityDetail } from "./OpportunityDetail";
import {
  computePipelineMetrics,
  DEMO_REMOVED_STORAGE_KEY,
  isDemoOpportunityId,
  pruneRemovedDemoCrm,
  readDemoOpportunityRemovals,
  STAGE_LABELS,
  STAGE_ORDER,
  type PipelineSortMode,
  type PipelineViewMode,
} from "./pipeline-ui";

type PipelineWorkspaceProps = {
  initialOpportunityId?: string | null;
  // Lifts the two headline metrics (active count + weighted value) so the page
  // shell can render them in the house footer without recomputing.
  onSummary?: (summary: { activeCount: number; weighted: number }) => void;
};

const EMPTY_OPPORTUNITIES: PipelineOpportunityRow[] = [];
const DEMO_OPPORTUNITY_STORAGE_KEY = "overwatch.crm.demo-opportunity-overrides.v1";
const DEMO_ACTIVITY_STORAGE_KEY = "overwatch.crm.demo-communications.v1";

type DemoOpportunityOverride = Partial<
  Pick<
    PipelineOpportunityRow,
    | "name"
    | "client"
    | "client_contact_name"
    | "client_contact_email"
    | "client_contact_phone"
    | "stage"
    | "estimated_contract"
    | "estimated_cost"
    | "estimated_gp_pct"
    | "bid_due_date"
    | "decision_date"
    | "probability"
    | "source"
    | "project_type"
    | "scope_summary"
    | "bid_decision"
    | "bid_decision_reason"
    | "bid_decision_date"
    | "assigned_to"
    | "notes"
    | "last_activity_at"
    | "updated_at"
  >
>;

export function PipelineWorkspace({ initialOpportunityId, onSummary }: PipelineWorkspaceProps) {
  const queryClient = useQueryClient();
  const listFn = useServerFn(listOpportunities);
  const membersFn = useServerFn(listPipelineMembers);
  const crmSnapshotFn = useServerFn(listCrmSnapshot);
  const getFn = useServerFn(getOpportunity);
  const createFn = useServerFn(createOpportunity);
  const createEstimateFn = useServerFn(createEstimate);
  const createActionFn = useServerFn(createNextAction);
  const updateFn = useServerFn(updateOpportunity);
  const noteFn = useServerFn(addOpportunityNote);
  const convertFn = useServerFn(convertToProject);
  const archiveFn = useServerFn(archiveOpportunity);
  const completeActionFn = useServerFn(completeNextAction);

  // The Kanban board changes stage only via HTML5 drag, which is unusable on a
  // touchscreen. On phones we open to the List view instead — its per-row stage
  // <Select> works with a tap. Desktop is unchanged (opens to the board); either
  // view stays reachable from the toggle. (This route is ssr:false, so `window`
  // is always available here; the guard is belt-and-suspenders.)
  const [viewMode, setViewMode] = useState<PipelineViewMode>(() =>
    typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches
      ? "list"
      : "kanban",
  );
  const [workspaceMode, setWorkspaceMode] = useState<"pipeline" | "followup">("pipeline");
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState<PipelineStage | "all">("all");
  const [assignedFilter, setAssignedFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [sortMode, setSortMode] = useState<PipelineSortMode>("last_activity_at");
  const [showArchived, setShowArchived] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(initialOpportunityId ?? null);
  const [demoOpportunityOverrides, setDemoOpportunityOverrides] = useState<
    Record<string, DemoOpportunityOverride>
  >(readDemoOpportunityOverrides);
  const [demoActivityLog, setDemoActivityLog] =
    useState<Record<string, PipelineActivityRow[]>>(readDemoActivityLog);
  const [demoRemovedIds, setDemoRemovedIds] = useState<string[]>(readDemoOpportunityRemovals);

  useEffect(() => {
    if (initialOpportunityId) setSelectedId(initialOpportunityId);
  }, [initialOpportunityId]);

  const opportunitiesQuery = useQuery({
    queryKey: ["pipeline-opportunities", showArchived],
    queryFn: () => listFn({ data: { includeArchived: showArchived } }),
  });
  const membersQuery = useQuery({
    queryKey: ["pipeline-members"],
    queryFn: () => membersFn(),
  });
  const crmSnapshotQuery = useQuery({
    queryKey: ["pipeline-crm-snapshot"],
    queryFn: () => crmSnapshotFn(),
  });
  const detailQuery = useQuery({
    queryKey: ["pipeline-opportunity", selectedId],
    queryFn: () => getFn({ data: { id: selectedId ?? "" } }),
    enabled: Boolean(selectedId),
  });

  const rawOpportunities = opportunitiesQuery.data ?? EMPTY_OPPORTUNITIES;
  const opportunities = useMemo(
    () =>
      rawOpportunities
        .filter((opportunity) => !demoRemovedIds.includes(opportunity.id))
        .map((opportunity) => applyDemoOpportunityOverride(opportunity, demoOpportunityOverrides)),
    [demoOpportunityOverrides, demoRemovedIds, rawOpportunities],
  );
  const members = membersQuery.data ?? [];
  // The CRM command-center rollup reads a server snapshot that still carries a
  // sample's account/contact/action after its opportunity was removed locally.
  // Prune those so the rollup reflects the deletion too.
  const crmSnapshot = useMemo(() => {
    const base = crmSnapshotQuery.data ?? null;
    if (!base) return null;
    return pruneRemovedDemoCrm(base, demoRemovedIds);
  }, [crmSnapshotQuery.data, demoRemovedIds]);

  // Client directory for the pick-or-add field: existing CRM accounts, unioned
  // with any client names already on opportunities, deduped + sorted.
  const accountNames = useMemo(() => {
    const names = new Map<string, string>();
    const add = (raw: string | null | undefined) => {
      const name = (raw ?? "").trim();
      if (name) names.set(name.toLowerCase(), name);
    };
    for (const account of crmSnapshot?.accounts ?? []) add(account.name);
    for (const opportunity of opportunities) add(opportunity.client);
    return Array.from(names.values()).sort((a, b) => a.localeCompare(b));
  }, [crmSnapshot, opportunities]);

  useEffect(() => {
    writeDemoOpportunityOverrides(demoOpportunityOverrides);
  }, [demoOpportunityOverrides]);
  useEffect(() => {
    writeDemoActivityLog(demoActivityLog);
  }, [demoActivityLog]);
  useEffect(() => {
    writeDemoOpportunityRemovals(demoRemovedIds);
  }, [demoRemovedIds]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const next = opportunities.filter((opportunity) => {
      const haystack = [
        opportunity.name,
        opportunity.client,
        opportunity.assigned_to,
        opportunity.project_type,
        opportunity.source,
      ]
        .join(" ")
        .toLowerCase();
      return (
        (!q || haystack.includes(q)) &&
        (stageFilter === "all" || opportunity.stage === stageFilter) &&
        (assignedFilter === "all" || opportunity.assigned_to === assignedFilter) &&
        (typeFilter === "all" || opportunity.project_type === typeFilter)
      );
    });
    next.sort((a, b) => sortOpportunities(a, b, sortMode));
    return next;
  }, [assignedFilter, opportunities, search, sortMode, stageFilter, typeFilter]);

  const assignedOptions = useMemo(
    () =>
      Array.from(
        new Set(opportunities.map((opportunity) => opportunity.assigned_to).filter(Boolean)),
      ).sort((a, b) => a.localeCompare(b)),
    [opportunities],
  );
  const typeOptions = useMemo(
    () =>
      Array.from(
        new Set(opportunities.map((opportunity) => opportunity.project_type).filter(Boolean)),
      ).sort((a, b) => a.localeCompare(b)),
    [opportunities],
  );
  const activeFilterCount = [
    search.trim(),
    stageFilter !== "all",
    assignedFilter !== "all",
    typeFilter !== "all",
    showArchived,
  ].filter(Boolean).length;
  // Filters that live behind the "More filters" popover — badge the trigger when any are set.
  const secondaryFilterCount = [
    assignedFilter !== "all",
    typeFilter !== "all",
    showArchived,
  ].filter(Boolean).length;

  const metrics = useMemo(() => computePipelineMetrics(opportunities), [opportunities]);
  useEffect(() => {
    onSummary?.({ activeCount: metrics.activeCount, weighted: metrics.weighted });
  }, [onSummary, metrics.activeCount, metrics.weighted]);

  const invalidatePipeline = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["pipeline-opportunities"] }),
      queryClient.invalidateQueries({ queryKey: ["pipeline-opportunity", selectedId] }),
      queryClient.invalidateQueries({ queryKey: ["pipeline-crm-snapshot"] }),
    ]);
  };

  const createMutation = useMutation({
    mutationFn: (input: CreateOpportunityInput) => createFn({ data: input }),
    onSuccess: async (result) => {
      await invalidatePipeline();
      toast.success("Opportunity created");
      if (result.duplicateWarning) {
        toast.warning("Possible duplicate opportunity", {
          description: "Same client and opportunity name already exist in this CRM.",
        });
      }
    },
    onError: (error) =>
      toast.error("Opportunity did not save", { description: errorMessage(error) }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Record<string, unknown> }) =>
      updateFn({ data: { id, patch } }),
    onSuccess: async () => {
      await invalidatePipeline();
      toast.success("Opportunity updated");
    },
    onError: (error) =>
      toast.error("Opportunity did not update", { description: errorMessage(error) }),
  });

  const noteMutation = useMutation({
    mutationFn: ({ id, note }: { id: string; note: string }) => noteFn({ data: { id, note } }),
    onSuccess: async () => {
      await invalidatePipeline();
      toast.success("Communication logged");
    },
    onError: (error) =>
      toast.error("Communication did not save", { description: errorMessage(error) }),
  });

  const createActionMutation = useMutation({
    mutationFn: (input: CreateNextActionInput) => createActionFn({ data: input }),
    onSuccess: async () => {
      await invalidatePipeline();
      toast.success("CRM action added");
    },
    onError: (error) => toast.error("Action did not save", { description: errorMessage(error) }),
  });

  const createEstimateMutation = useMutation({
    mutationFn: (opportunity: PipelineOpportunityRow) =>
      createEstimateFn({
        data: {
          name: `${opportunity.name} Estimate`.slice(0, 200),
          description: opportunity.scope_summary || opportunity.client || opportunity.name,
          opportunity_id: opportunity.id,
          project_type: /residential/i.test(opportunity.project_type)
            ? "residential"
            : "commercial",
        },
      }),
    onSuccess: (result) => {
      toast.success("Estimate created from CRM opportunity");
      window.location.assign(`/estimates/${result.id}`);
    },
    onError: (error) => toast.error("Estimate did not start", { description: errorMessage(error) }),
  });

  const convertMutation = useMutation({
    mutationFn: (id: string) => convertFn({ data: { id } }),
    onSuccess: async (result) => {
      await Promise.all([
        invalidatePipeline(),
        queryClient.invalidateQueries({ queryKey: ["projects"] }),
        queryClient.invalidateQueries({ queryKey: ["project", result.project_id] }),
      ]);
      toast.success("Converted to project");
      window.location.assign(`/projects/${result.project_id}`);
    },
    onError: (error) =>
      toast.error("Opportunity did not convert", { description: errorMessage(error) }),
  });

  // "Delete" archives: the pipeline schema keeps deleted opportunities as
  // archived rows (same hidden-not-erased pattern as projects).
  const deleteMutation = useMutation({
    mutationFn: (id: string) => archiveFn({ data: { id } }),
    onSuccess: async (_result, id) => {
      await invalidatePipeline();
      setSelectedId(null);
      if (isDemoOpportunityId(id)) {
        toast.success("Sample opportunity removed");
      } else {
        toast.success("Opportunity deleted", {
          description: "It moved to Archived. Turn on the Archived switch to see it again.",
        });
      }
    },
    onError: (error) =>
      toast.error("Opportunity did not delete", { description: errorMessage(error) }),
  });

  const completeActionMutation = useMutation({
    mutationFn: (id: string) => completeActionFn({ data: { id } }),
    onSuccess: async () => {
      await invalidatePipeline();
      toast.success("CRM action completed");
    },
    onError: (error) =>
      toast.error("Action did not complete", { description: errorMessage(error) }),
  });

  const resetFilters = () => {
    setSearch("");
    setStageFilter("all");
    setAssignedFilter("all");
    setTypeFilter("all");
    setShowArchived(false);
  };

  const applyLocalDemoRemoval = (id: string) => {
    if (!isDemoOpportunityId(id)) return;
    setDemoRemovedIds((current) => (current.includes(id) ? current : [...current, id]));
  };

  const applyLocalDemoPatch = (id: string, patch: Record<string, unknown>) => {
    if (!isDemoOpportunityId(id)) return;
    const normalizedPatch = normalizeDemoOpportunityPatch(patch);
    if (Object.keys(normalizedPatch).length === 0) return;
    const now = new Date().toISOString();
    const source = opportunities.find((opportunity) => opportunity.id === id);
    setDemoOpportunityOverrides((current) => {
      const merged: DemoOpportunityOverride = {
        ...current[id],
        ...normalizedPatch,
        last_activity_at: now,
        updated_at: now,
      };
      if (
        Object.prototype.hasOwnProperty.call(normalizedPatch, "estimated_contract") ||
        Object.prototype.hasOwnProperty.call(normalizedPatch, "estimated_cost")
      ) {
        const contract = Number(merged.estimated_contract ?? source?.estimated_contract ?? 0);
        const cost = Number(merged.estimated_cost ?? source?.estimated_cost ?? 0);
        merged.estimated_gp_pct = contract > 0 ? ((contract - cost) / contract) * 100 : 0;
      }
      return { ...current, [id]: merged };
    });
  };

  const handleStageChange = (id: string, stage: PipelineStage) => {
    // Moving a deal to a decided stage settles its probability: Won is a lock at
    // 100%, Lost/No-bid drop to 0%. Active stages keep whatever probability the
    // user set. Saves the "why is Won still at 60%?" manual fixup.
    const patch: { stage: PipelineStage; probability?: number } = { stage };
    if (stage === "won") patch.probability = 100;
    else if (stage === "lost" || stage === "no_bid") patch.probability = 0;
    applyLocalDemoPatch(id, patch);
    updateMutation.mutate({ id, patch });
  };

  const selected = detailQuery.data?.opportunity
    ? applyDemoOpportunityOverride(detailQuery.data.opportunity, demoOpportunityOverrides)
    : null;
  const selectedActivity = useMemo(() => {
    const remoteActivity = detailQuery.data?.activity ?? [];
    if (!selectedId) return remoteActivity;
    const localActivity = demoActivityLog[selectedId] ?? [];
    if (localActivity.length === 0) return remoteActivity;
    return [...localActivity, ...remoteActivity].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );
  }, [demoActivityLog, detailQuery.data?.activity, selectedId]);

  const addLocalDemoCommunication = (id: string, note: string) => {
    if (!isDemoOpportunityId(id)) return;
    const opportunity = selected ?? opportunities.find((item) => item.id === id);
    if (!opportunity) return;
    const now = new Date().toISOString();
    const activity = makeDemoCommunicationActivity(opportunity, note, now);
    setDemoActivityLog((current) => ({
      ...current,
      [id]: [activity, ...(current[id] ?? [])].slice(0, 50),
    }));
    applyLocalDemoPatch(id, { last_activity_at: now, updated_at: now });
  };

  if (workspaceMode === "followup") {
    return (
      <div className="space-y-5">
        <CrmDemoControl />
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1.5">
          <h1 className="font-serif text-[30px] font-normal leading-none text-foreground">
            Follow-Up Studio
          </h1>
          <span className="text-sm text-muted-foreground">
            Useful material, prepared messages, and disciplined follow-through.
          </span>
        </div>
        <Tabs
          value={workspaceMode}
          onValueChange={(value) => setWorkspaceMode(value as "pipeline" | "followup")}
        >
          <TabsList className="h-auto rounded-xl border border-hairline bg-surface p-1 shadow-card">
            <TabsTrigger value="pipeline" className="gap-1.5">
              <KanbanSquare className="h-3.5 w-3.5" /> Pipeline
            </TabsTrigger>
            <TabsTrigger value="followup" className="gap-1.5">
              <CalendarClock className="h-3.5 w-3.5" /> Follow-Up Studio
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <FollowUpStudio
          opportunities={opportunities}
          members={members}
          onOpenOpportunity={(id) => {
            setSelectedId(id);
            setWorkspaceMode("pipeline");
          }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <CrmDemoControl />
      {/* 1. Page header inside the CRM tab */}
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1.5">
        <h1 className="font-serif text-[30px] font-normal leading-none text-foreground">
          Sales pipeline
        </h1>
        <span className="text-sm text-muted-foreground">
          Lead → estimate → bid → won → project.
        </span>
        <div className="ml-auto">
          <OpportunityCreateDialog
            members={members}
            accounts={accountNames}
            isCreating={createMutation.isPending}
            onCreate={(input) => createMutation.mutateAsync(input).then(() => undefined)}
            trigger={
              <Button type="button" className="gap-1.5">
                <Plus className="h-4 w-4" /> New opportunity
              </Button>
            }
          />
        </div>
      </div>

      <Tabs
        value={workspaceMode}
        onValueChange={(value) => setWorkspaceMode(value as "pipeline" | "followup")}
      >
        <TabsList className="h-auto rounded-xl border border-hairline bg-surface p-1 shadow-card">
          <TabsTrigger value="pipeline" className="gap-1.5">
            <KanbanSquare className="h-3.5 w-3.5" /> Pipeline
          </TabsTrigger>
          <TabsTrigger value="followup" className="gap-1.5">
            <CalendarClock className="h-3.5 w-3.5" /> Follow-Up Studio
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {/* 2. Glance grid: rail lists (left) + pipeline-at-a-glance (right) */}
      <div className="grid items-start gap-4 xl:grid-cols-[1.25fr_1fr]">
        <PipelineRailLists
          opportunities={opportunities}
          openActions={crmSnapshot?.openActions ?? []}
          onOpen={setSelectedId}
        />
        <PipelineGlanceCard metrics={metrics} />
      </div>

      {/* 4. Toolbar */}
      <div className="flex flex-wrap items-center gap-2.5 rounded-xl border border-hairline bg-surface p-3 shadow-card">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search opportunity, client, source, type, or assignee"
            className="pl-9"
          />
        </div>
        <Select
          value={stageFilter}
          onValueChange={(value) => setStageFilter(value as PipelineStage | "all")}
        >
          <SelectTrigger className="w-full sm:w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All stages</SelectItem>
            {STAGE_ORDER.map((stage) => (
              <SelectItem key={stage} value={stage}>
                {STAGE_LABELS[stage]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={sortMode} onValueChange={(value) => setSortMode(value as PipelineSortMode)}>
          <SelectTrigger className="w-full sm:w-[190px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="last_activity_at">Sort · Last activity</SelectItem>
            <SelectItem value="bid_due_date">Sort · Bid due</SelectItem>
            <SelectItem value="estimated_contract">Sort · Est. contract</SelectItem>
          </SelectContent>
        </Select>
        <Tabs value={viewMode} onValueChange={(value) => setViewMode(value as PipelineViewMode)}>
          <TabsList>
            <TabsTrigger value="kanban">
              <KanbanSquare className="mr-1.5 h-3.5 w-3.5" />
              Kanban
            </TabsTrigger>
            <TabsTrigger value="list">
              <List className="mr-1.5 h-3.5 w-3.5" />
              List
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <Popover>
          <PopoverTrigger asChild>
            <Button type="button" variant="outline" size="sm" className="gap-1.5">
              <SlidersHorizontal className="h-3.5 w-3.5" />
              More filters
              {secondaryFilterCount > 0 && (
                <span className="ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-clay/15 px-1 text-[10px] font-bold text-clay">
                  {secondaryFilterCount}
                </span>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-72 space-y-3">
            <div className="eyebrow">Filters</div>
            <Select value={assignedFilter} onValueChange={setAssignedFilter}>
              <SelectTrigger>
                <SelectValue placeholder="All assignees" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All assignees</SelectItem>
                {assignedOptions.map((assignee) => (
                  <SelectItem key={assignee} value={assignee}>
                    {assignee}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger>
                <SelectValue placeholder="All types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                {typeOptions.map((type) => (
                  <SelectItem key={type} value={type}>
                    {type}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <label className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
              <span>Show archived</span>
              <Switch checked={showArchived} onCheckedChange={setShowArchived} />
            </label>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={resetFilters}
              disabled={activeFilterCount === 0}
              className="w-full justify-start gap-1.5"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Reset filters
            </Button>
            <div className="border-t border-hairline pt-3">
              <div className="eyebrow mb-2">Quick-add a lead</div>
              <QuickAddOpportunity
                isCreating={createMutation.isPending}
                onCreate={(input) => createMutation.mutateAsync(input).then(() => undefined)}
              />
            </div>
          </PopoverContent>
        </Popover>
      </div>

      {opportunitiesQuery.isLoading ? (
        <div className="rounded-lg border border-hairline bg-card p-8 text-sm text-muted-foreground shadow-card">
          Loading CRM…
        </div>
      ) : opportunitiesQuery.isError ? (
        <div className="rounded-lg border border-danger/30 bg-danger/5 p-4 text-sm text-danger">
          {errorMessage(opportunitiesQuery.error)}
        </div>
      ) : opportunities.length === 0 ? (
        // First run: the pipeline is genuinely empty. Don't claim a filter hid
        // rows (the board/list say "no match for the current filters"); invite
        // the first pursuit instead.
        <div className="rounded-lg border border-hairline bg-card p-10 text-center shadow-card">
          <h3 className="font-serif text-2xl text-foreground">No pursuits in your pipeline yet</h3>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            Track every lead from first call to signed contract. Add your first opportunity to start
            building the pipeline.
          </p>
          <div className="mt-5 flex justify-center">
            <OpportunityCreateDialog
              members={members}
              accounts={accountNames}
              isCreating={createMutation.isPending}
              onCreate={(input) => createMutation.mutateAsync(input).then(() => undefined)}
              trigger={
                <Button type="button" className="gap-1.5">
                  <Plus className="h-4 w-4" /> New opportunity
                </Button>
              }
            />
          </div>
        </div>
      ) : viewMode === "kanban" ? (
        <PipelineKanban
          opportunities={filtered}
          onOpen={setSelectedId}
          onStageChange={handleStageChange}
        />
      ) : (
        <PipelineList
          opportunities={filtered}
          onOpen={setSelectedId}
          onStageChange={handleStageChange}
        />
      )}

      {/* 3. CRM command center — kept live below the board, behind a collapse */}
      <PipelineCrmOverview
        snapshot={crmSnapshot}
        opportunities={opportunities}
        isLoading={crmSnapshotQuery.isLoading}
        completingActionId={
          typeof completeActionMutation.variables === "string"
            ? completeActionMutation.variables
            : null
        }
        onCompleteAction={(id) => completeActionMutation.mutate(id)}
      />

      <OpportunityDetail
        open={Boolean(selectedId)}
        opportunity={selected}
        activity={selectedActivity}
        members={members}
        accounts={accountNames}
        isLoading={detailQuery.isLoading}
        isSaving={updateMutation.isPending}
        isAddingNote={noteMutation.isPending}
        isCreatingAction={createActionMutation.isPending}
        isCreatingEstimate={createEstimateMutation.isPending}
        isConverting={convertMutation.isPending}
        isDeleting={deleteMutation.isPending}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null);
        }}
        onUpdate={(patch) => {
          if (!selectedId) return Promise.resolve();
          applyLocalDemoPatch(selectedId, patch);
          return updateMutation.mutateAsync({ id: selectedId, patch }).then(() => undefined);
        }}
        onAddNote={(note) => {
          if (!selectedId) return Promise.resolve();
          addLocalDemoCommunication(selectedId, note);
          return noteMutation.mutateAsync({ id: selectedId, note }).then(() => undefined);
        }}
        onCreateAction={(input) => createActionMutation.mutateAsync(input).then(() => undefined)}
        onCreateEstimate={() => {
          if (!selected) return Promise.resolve();
          return createEstimateMutation.mutateAsync(selected).then(() => undefined);
        }}
        onConvert={() => {
          if (!selectedId) return Promise.resolve();
          if (selected?.estimated_contract === 0) {
            toast.warning("No estimated contract value", {
              description: "The project will convert with a $0 contract until you update it.",
            });
          }
          return convertMutation.mutateAsync(selectedId).then(() => undefined);
        }}
        onDelete={() => {
          if (!selectedId) return Promise.resolve();
          applyLocalDemoRemoval(selectedId);
          return deleteMutation.mutateAsync(selectedId).then(() => undefined);
        }}
      />
    </div>
  );
}

function sortOpportunities(
  a: PipelineOpportunityRow,
  b: PipelineOpportunityRow,
  sortMode: PipelineSortMode,
) {
  if (sortMode === "estimated_contract") {
    return b.estimated_contract - a.estimated_contract;
  }
  if (sortMode === "bid_due_date") {
    const aDate = a.bid_due_date ? new Date(`${a.bid_due_date}T00:00:00`).getTime() : Infinity;
    const bDate = b.bid_due_date ? new Date(`${b.bid_due_date}T00:00:00`).getTime() : Infinity;
    return aDate - bDate;
  }
  return new Date(b.last_activity_at).getTime() - new Date(a.last_activity_at).getTime();
}

function errorMessage(error: unknown) {
  return friendlyActionError(error, "Something went wrong. Try again.");
}

function applyDemoOpportunityOverride(
  opportunity: PipelineOpportunityRow,
  overrides: Record<string, DemoOpportunityOverride>,
) {
  if (!isDemoOpportunityId(opportunity.id)) return opportunity;
  const override = overrides[opportunity.id];
  return override ? { ...opportunity, ...override } : opportunity;
}

function readDemoOpportunityOverrides(): Record<string, DemoOpportunityOverride> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(DEMO_OPPORTUNITY_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed)
        .filter(([id, value]) => isDemoOpportunityId(id) && value && typeof value === "object")
        .map(([id, value]) => [
          id,
          normalizeDemoOpportunityPatch(value as Record<string, unknown>),
        ]),
    );
  } catch {
    return {};
  }
}

function writeDemoOpportunityOverrides(overrides: Record<string, DemoOpportunityOverride>) {
  if (typeof window === "undefined") return;
  const entries = Object.entries(overrides).filter(([, override]) => Object.keys(override).length);
  if (entries.length === 0) {
    window.localStorage.removeItem(DEMO_OPPORTUNITY_STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(
    DEMO_OPPORTUNITY_STORAGE_KEY,
    JSON.stringify(Object.fromEntries(entries)),
  );
}

function writeDemoOpportunityRemovals(removedIds: string[]) {
  if (typeof window === "undefined") return;
  if (removedIds.length === 0) {
    window.localStorage.removeItem(DEMO_REMOVED_STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(DEMO_REMOVED_STORAGE_KEY, JSON.stringify(removedIds));
}

function readDemoActivityLog(): Record<string, PipelineActivityRow[]> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(DEMO_ACTIVITY_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed)
        .filter(([id, value]) => isDemoOpportunityId(id) && Array.isArray(value))
        .map(([id, value]) => [
          id,
          (value as unknown[])
            .map(normalizeDemoActivity)
            .filter((item): item is PipelineActivityRow => Boolean(item))
            .slice(0, 50),
        ])
        .filter(([, activity]) => activity.length > 0),
    );
  } catch {
    return {};
  }
}

function writeDemoActivityLog(activityLog: Record<string, PipelineActivityRow[]>) {
  if (typeof window === "undefined") return;
  const entries = Object.entries(activityLog)
    .filter(([id, activity]) => isDemoOpportunityId(id) && activity.length > 0)
    .map(([id, activity]) => [id, activity.slice(0, 50)]);
  if (entries.length === 0) {
    window.localStorage.removeItem(DEMO_ACTIVITY_STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(
    DEMO_ACTIVITY_STORAGE_KEY,
    JSON.stringify(Object.fromEntries(entries)),
  );
}

function normalizeDemoActivity(value: unknown): PipelineActivityRow | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const opportunityId = typeof row.opportunity_id === "string" ? row.opportunity_id : "";
  if (!isDemoOpportunityId(opportunityId)) return null;
  const eventType = row.event_type === "note_added" ? "note_added" : "field_update";
  return {
    id: typeof row.id === "string" ? row.id : `${opportunityId}-local-${Date.now()}`,
    opportunity_id: opportunityId,
    organization_id: typeof row.organization_id === "string" ? row.organization_id : "",
    event_type: eventType,
    from_value: "",
    to_value: "",
    notes: typeof row.notes === "string" ? row.notes : "",
    created_by: typeof row.created_by === "string" ? row.created_by : null,
    created_at: typeof row.created_at === "string" ? row.created_at : new Date().toISOString(),
  };
}

function makeDemoCommunicationActivity(
  opportunity: PipelineOpportunityRow,
  note: string,
  createdAt: string,
): PipelineActivityRow {
  return {
    id: `${opportunity.id}-local-${createdAt}`,
    opportunity_id: opportunity.id,
    organization_id: opportunity.organization_id,
    event_type: "note_added",
    from_value: "",
    to_value: "",
    notes: note,
    created_by: opportunity.created_by,
    created_at: createdAt,
  };
}

function normalizeDemoOpportunityPatch(patch: Record<string, unknown>): DemoOpportunityOverride {
  const normalized: DemoOpportunityOverride = {};
  assignStringPatch(normalized, patch, "name");
  assignStringPatch(normalized, patch, "client");
  assignStringPatch(normalized, patch, "client_contact_name");
  assignStringPatch(normalized, patch, "client_contact_email");
  assignStringPatch(normalized, patch, "client_contact_phone");
  assignStagePatch(normalized, patch);
  assignNumberPatch(normalized, patch, "estimated_contract");
  assignNumberPatch(normalized, patch, "estimated_cost");
  assignNumberPatch(normalized, patch, "probability");
  assignStringPatch(normalized, patch, "source");
  assignStringPatch(normalized, patch, "project_type");
  assignStringPatch(normalized, patch, "scope_summary");
  assignStringPatch(normalized, patch, "bid_decision_reason");
  assignStringPatch(normalized, patch, "assigned_to");
  assignStringPatch(normalized, patch, "notes");
  assignNullableStringPatch(normalized, patch, "bid_due_date");
  assignNullableStringPatch(normalized, patch, "decision_date");
  assignNullableStringPatch(normalized, patch, "bid_decision_date");
  assignBidDecisionPatch(normalized, patch);
  assignStringPatch(normalized, patch, "last_activity_at");
  assignStringPatch(normalized, patch, "updated_at");
  return normalized;
}

function assignStringPatch<K extends keyof DemoOpportunityOverride>(
  target: DemoOpportunityOverride,
  patch: Record<string, unknown>,
  key: K,
) {
  const value = patch[key];
  if (typeof value === "string") target[key] = value as DemoOpportunityOverride[K];
}

function assignNullableStringPatch<K extends keyof DemoOpportunityOverride>(
  target: DemoOpportunityOverride,
  patch: Record<string, unknown>,
  key: K,
) {
  const value = patch[key];
  if (typeof value === "string" || value === null) {
    target[key] = value as DemoOpportunityOverride[K];
  }
}

function assignNumberPatch<K extends keyof DemoOpportunityOverride>(
  target: DemoOpportunityOverride,
  patch: Record<string, unknown>,
  key: K,
) {
  const value = Number(patch[key]);
  if (Number.isFinite(value)) target[key] = value as DemoOpportunityOverride[K];
}

function assignStagePatch(target: DemoOpportunityOverride, patch: Record<string, unknown>) {
  if (typeof patch.stage === "string" && STAGE_ORDER.includes(patch.stage as PipelineStage)) {
    target.stage = patch.stage as PipelineStage;
  }
}

function assignBidDecisionPatch(target: DemoOpportunityOverride, patch: Record<string, unknown>) {
  if (
    patch.bid_decision === "undecided" ||
    patch.bid_decision === "bid" ||
    patch.bid_decision === "no_bid"
  ) {
    target.bid_decision = patch.bid_decision;
  }
}
