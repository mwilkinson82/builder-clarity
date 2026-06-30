import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { KanbanSquare, List, RotateCcw, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  addOpportunityNote,
  archiveOpportunity,
  convertToProject,
  createOpportunity,
  getOpportunity,
  listOpportunities,
  listPipelineMembers,
  updateOpportunity,
  type CreateOpportunityInput,
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
import { PipelineKanban } from "./PipelineKanban";
import { PipelineList } from "./PipelineList";
import { PipelineMetrics } from "./PipelineMetrics";
import { OpportunityCreateDialog } from "./OpportunityCreateDialog";
import { OpportunityDetail } from "./OpportunityDetail";
import {
  STAGE_LABELS,
  STAGE_ORDER,
  type PipelineSortMode,
  type PipelineViewMode,
} from "./pipeline-ui";

type PipelineWorkspaceProps = {
  initialOpportunityId?: string | null;
};

const EMPTY_OPPORTUNITIES: PipelineOpportunityRow[] = [];

export function PipelineWorkspace({ initialOpportunityId }: PipelineWorkspaceProps) {
  const queryClient = useQueryClient();
  const listFn = useServerFn(listOpportunities);
  const membersFn = useServerFn(listPipelineMembers);
  const getFn = useServerFn(getOpportunity);
  const createFn = useServerFn(createOpportunity);
  const updateFn = useServerFn(updateOpportunity);
  const noteFn = useServerFn(addOpportunityNote);
  const convertFn = useServerFn(convertToProject);
  const archiveFn = useServerFn(archiveOpportunity);

  const [viewMode, setViewMode] = useState<PipelineViewMode>("kanban");
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState<PipelineStage | "all">("all");
  const [assignedFilter, setAssignedFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [sortMode, setSortMode] = useState<PipelineSortMode>("last_activity_at");
  const [showArchived, setShowArchived] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(initialOpportunityId ?? null);

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
  const detailQuery = useQuery({
    queryKey: ["pipeline-opportunity", selectedId],
    queryFn: () => getFn({ data: { id: selectedId ?? "" } }),
    enabled: Boolean(selectedId),
  });

  const opportunities = opportunitiesQuery.data ?? EMPTY_OPPORTUNITIES;
  const members = membersQuery.data ?? [];

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

  const invalidatePipeline = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["pipeline-opportunities"] }),
      queryClient.invalidateQueries({ queryKey: ["pipeline-opportunity", selectedId] }),
    ]);
  };

  const createMutation = useMutation({
    mutationFn: (input: CreateOpportunityInput) => createFn({ data: input }),
    onSuccess: async (result) => {
      await invalidatePipeline();
      toast.success("Opportunity created");
      if (result.duplicateWarning) {
        toast.warning("Possible duplicate opportunity", {
          description: "Same client and opportunity name already exist in this pipeline.",
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
      toast.success("Note added");
    },
    onError: (error) => toast.error("Note did not save", { description: errorMessage(error) }),
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

  const archiveMutation = useMutation({
    mutationFn: (id: string) => archiveFn({ data: { id } }),
    onSuccess: async () => {
      await invalidatePipeline();
      setSelectedId(null);
      toast.success("Opportunity archived");
    },
    onError: (error) =>
      toast.error("Opportunity did not archive", { description: errorMessage(error) }),
  });

  const resetFilters = () => {
    setSearch("");
    setStageFilter("all");
    setAssignedFilter("all");
    setTypeFilter("all");
    setShowArchived(false);
  };

  const selected = detailQuery.data?.opportunity ?? null;

  return (
    <div className="space-y-6">
      <PipelineMetrics opportunities={opportunities} />

      <div className="rounded-lg border border-hairline bg-card p-4 shadow-card">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-1 flex-col gap-3 lg:flex-row lg:items-center">
            <div className="relative flex-1">
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
              <SelectTrigger className="w-full lg:w-[180px]">
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
            <Select value={assignedFilter} onValueChange={setAssignedFilter}>
              <SelectTrigger className="w-full lg:w-[180px]">
                <SelectValue />
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
              <SelectTrigger className="w-full lg:w-[180px]">
                <SelectValue />
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
            <Select
              value={sortMode}
              onValueChange={(value) => setSortMode(value as PipelineSortMode)}
            >
              <SelectTrigger className="w-full lg:w-[190px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="last_activity_at">Last activity</SelectItem>
                <SelectItem value="bid_due_date">Bid due</SelectItem>
                <SelectItem value="estimated_contract">Est. contract</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <Switch checked={showArchived} onCheckedChange={setShowArchived} />
              Archived
            </label>
            <Tabs
              value={viewMode}
              onValueChange={(value) => setViewMode(value as PipelineViewMode)}
            >
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
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={resetFilters}
              disabled={activeFilterCount === 0}
            >
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
              Reset
            </Button>
            <OpportunityCreateDialog
              members={members}
              isCreating={createMutation.isPending}
              onCreate={(input) => createMutation.mutateAsync(input).then(() => undefined)}
            />
          </div>
        </div>
      </div>

      {opportunitiesQuery.isLoading ? (
        <div className="rounded-lg border border-hairline bg-card p-8 text-sm text-muted-foreground shadow-card">
          Loading pipeline…
        </div>
      ) : opportunitiesQuery.isError ? (
        <div className="rounded-lg border border-danger/30 bg-danger/5 p-4 text-sm text-danger">
          {errorMessage(opportunitiesQuery.error)}
        </div>
      ) : viewMode === "kanban" ? (
        <PipelineKanban
          opportunities={filtered}
          onOpen={setSelectedId}
          onStageChange={(id, stage) => updateMutation.mutate({ id, patch: { stage } })}
        />
      ) : (
        <PipelineList
          opportunities={filtered}
          onOpen={setSelectedId}
          onStageChange={(id, stage) => updateMutation.mutate({ id, patch: { stage } })}
        />
      )}

      <OpportunityDetail
        open={Boolean(selectedId)}
        opportunity={selected}
        activity={detailQuery.data?.activity ?? []}
        members={members}
        isLoading={detailQuery.isLoading}
        isSaving={updateMutation.isPending}
        isAddingNote={noteMutation.isPending}
        isConverting={convertMutation.isPending}
        isArchiving={archiveMutation.isPending}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null);
        }}
        onUpdate={(patch) => {
          if (!selectedId) return Promise.resolve();
          return updateMutation.mutateAsync({ id: selectedId, patch }).then(() => undefined);
        }}
        onAddNote={(note) => {
          if (!selectedId) return Promise.resolve();
          return noteMutation.mutateAsync({ id: selectedId, note }).then(() => undefined);
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
        onArchive={() => {
          if (!selectedId) return Promise.resolve();
          return archiveMutation.mutateAsync(selectedId).then(() => undefined);
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
  return error instanceof Error ? error.message : "Unknown error";
}
