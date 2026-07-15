import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { Bot, Calculator, CheckCircle2, ChevronDown, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  getTakeoffAssembly,
  proposeTakeoffAssemblyInputs,
  saveTakeoffAssembly,
} from "@/lib/plan-room-assembly.functions";
import type { MeasurementScopeQueueItem } from "@/lib/plan-room-measurement-scope";
import type { TakeoffMeasurementRow } from "@/lib/plan-room.functions";
import {
  calculateTakeoffAssembly,
  defaultTakeoffAssemblyInputs,
  takeoffAssemblyTemplate,
  takeoffAssemblyTemplatesForUnit,
  type TakeoffAssemblyCitation,
  type TakeoffAssemblyInputProposal,
  type TakeoffAssemblyStatus,
  type TakeoffAssemblyTemplateId,
} from "@/lib/takeoff-assembly";
import { cn } from "@/lib/utils";

interface AssemblyReviewResult {
  operation_id: string;
  credits_charged: number;
  model: string;
  provider: string;
  template_id: TakeoffAssemblyTemplateId;
  formula_version: string;
  citations: TakeoffAssemblyCitation[];
  proposals: TakeoffAssemblyInputProposal[];
}

const assemblyStatusLabel = (status: TakeoffAssemblyStatus | undefined) => {
  if (status === "confirmed") return "Estimator confirmed";
  if (status === "stale") return "Needs reconfirmation";
  if (status === "draft") return "Draft";
  return "Not saved";
};

const formattedAssemblyQuantity = (quantity: number, unit: string) =>
  `${unit === "EA" ? Math.ceil(quantity).toLocaleString() : quantity.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${unit}`;

export function TakeoffAssemblyWorkbench({
  estimateId,
  measurement,
  scopeItems,
}: {
  estimateId: string;
  measurement: TakeoffMeasurementRow;
  scopeItems: MeasurementScopeQueueItem[];
}) {
  const qc = useQueryClient();
  const getAssemblyFn = useServerFn(getTakeoffAssembly);
  const saveAssemblyFn = useServerFn(saveTakeoffAssembly);
  const proposeInputsFn = useServerFn(proposeTakeoffAssemblyInputs);
  const compatibleTemplates = useMemo(
    () => takeoffAssemblyTemplatesForUnit(measurement.unit),
    [measurement.unit],
  );
  const [open, setOpen] = useState(false);
  const [templateId, setTemplateId] = useState<TakeoffAssemblyTemplateId | "">(
    compatibleTemplates[0]?.id ?? "",
  );
  const [inputDrafts, setInputDrafts] = useState<Record<string, string>>({});
  const [confirmedKeys, setConfirmedKeys] = useState<string[]>([]);
  const [review, setReview] = useState<AssemblyReviewResult | null>(null);

  const assemblyQuery = useQuery({
    queryKey: ["takeoff-assembly", estimateId, measurement.id],
    queryFn: () =>
      getAssemblyFn({
        data: { estimate_id: estimateId, takeoff_measurement_id: measurement.id },
      }),
    enabled: compatibleTemplates.length > 0,
  });
  const assembly = assemblyQuery.data?.assembly ?? null;
  const template = templateId ? takeoffAssemblyTemplate(templateId) : null;

  useEffect(() => {
    const saved = assemblyQuery.data?.assembly;
    const nextTemplate =
      saved?.template_id ?? compatibleTemplates[0]?.id ?? ("" as TakeoffAssemblyTemplateId | "");
    setTemplateId(nextTemplate);
    setReview(null);
    if (!nextTemplate) {
      setInputDrafts({});
      setConfirmedKeys([]);
      return;
    }
    const values = saved?.confirmed_inputs ?? defaultTakeoffAssemblyInputs(nextTemplate);
    setInputDrafts(
      Object.fromEntries(Object.entries(values).map(([key, value]) => [key, String(value)])),
    );
    const nextDefinition = takeoffAssemblyTemplate(nextTemplate);
    setConfirmedKeys(
      saved?.status === "confirmed"
        ? (nextDefinition?.inputs.map((definition) => definition.key) ?? [])
        : [],
    );
    if (saved) setOpen(true);
  }, [assemblyQuery.data?.assembly, compatibleTemplates, measurement.id]);

  const relevantScope = useMemo(
    () =>
      scopeItems.filter(
        (item) => item.status === "completed" && item.takeoff_measurement_id === measurement.id,
      ),
    [measurement.id, scopeItems],
  );
  const sourceCitations: TakeoffAssemblyCitation[] =
    review?.citations ??
    assembly?.source_citations ??
    relevantScope.map((item) => ({
      plan_sheet_id: item.plan_sheet_id,
      source_line: item.source_line,
      source_excerpt: item.source_excerpt,
    }));
  const savedReviewMatchesTemplate = assembly?.template_id === templateId;
  const proposals =
    review?.proposals ?? (savedReviewMatchesTemplate ? (assembly?.ai_proposals ?? []) : []);
  const aiOperationId =
    review?.operation_id ??
    (savedReviewMatchesTemplate ? (assembly?.ai_operation_id ?? null) : null);

  const calculation = useMemo(() => {
    if (!templateId || !template) return { result: null, error: "Choose an assembly." };
    try {
      return {
        result: calculateTakeoffAssembly({
          templateId,
          geometryQuantity: measurement.quantity,
          geometryUnit: measurement.unit,
          inputs: Object.fromEntries(
            template.inputs.map((definition) => [
              definition.key,
              Number(inputDrafts[definition.key]),
            ]),
          ),
        }),
        error: "",
      };
    } catch (error) {
      return {
        result: null,
        error: error instanceof Error ? error.message : "Assembly inputs are incomplete.",
      };
    }
  }, [inputDrafts, measurement.quantity, measurement.unit, template, templateId]);

  const saveMutation = useMutation({
    mutationFn: (status: "draft" | "confirmed") => {
      if (!templateId || !template || !calculation.result) {
        throw new Error(calculation.error || "Complete the assembly inputs first.");
      }
      if (measurement.calculation_status !== "current") {
        throw new Error("Reverify this takeoff before saving its assembly.");
      }
      if (
        status === "confirmed" &&
        template.inputs.some((definition) => !confirmedKeys.includes(definition.key))
      ) {
        throw new Error("Confirm every assembly input before approving the calculation.");
      }
      return saveAssemblyFn({
        data: {
          estimate_id: estimateId,
          takeoff_measurement_id: measurement.id,
          template_id: templateId,
          inputs: calculation.result.inputs,
          ai_operation_id: aiOperationId,
          status,
        },
      });
    },
    onSuccess: ({ assembly: saved }, status) => {
      qc.setQueryData(["takeoff-assembly", estimateId, measurement.id], {
        assembly: saved,
        ready: true,
      });
      toast.success(
        status === "confirmed"
          ? "Assembly confirmed from the trusted takeoff and estimator inputs."
          : "Assembly draft saved without affecting the estimate.",
      );
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Assembly did not save"),
  });

  const reviewMutation = useMutation({
    mutationFn: () => {
      if (!templateId) throw new Error("Choose an assembly first.");
      return proposeInputsFn({
        data: {
          estimate_id: estimateId,
          takeoff_measurement_id: measurement.id,
          template_id: templateId,
        },
      });
    },
    onSuccess: (result) => {
      setReview(result);
      toast.success(
        result.proposals.length > 0
          ? `${result.proposals.length} cited input proposal${result.proposals.length === 1 ? "" : "s"} ready. Confirm each one yourself.`
          : "The cited note contained no explicit assembly values, so AI left every input unchanged.",
      );
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Cited requirements were not reviewed"),
  });

  if (compatibleTemplates.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-hairline px-3 py-2 text-xs text-muted-foreground">
        Assembly Workbench requires a trusted LF or SF takeoff. Counts remain in the reviewed count
        workflow.
      </div>
    );
  }

  const ready = assemblyQuery.data?.ready !== false;
  const allConfirmed =
    template?.inputs.every((definition) => confirmedKeys.includes(definition.key)) ?? false;

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="rounded-md border border-hairline bg-card"
      data-testid="takeoff-assembly-workbench"
    >
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left"
        >
          <span className="flex min-w-0 items-center gap-2">
            <Calculator className="h-4 w-4 shrink-0 text-primary" />
            <span>
              <span className="block text-sm font-medium text-foreground">Assembly Workbench</span>
              <span className="block text-[11px] text-muted-foreground">
                Formula outputs from confirmed estimator inputs
              </span>
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-2">
            <Badge
              variant={assembly?.status === "confirmed" ? "secondary" : "outline"}
              className={cn(
                assembly?.status === "stale" && "border-warning/40 bg-warning/10 text-warning",
              )}
            >
              {assemblyStatusLabel(assembly?.status)}
            </Badge>
            <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
          </span>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-4 border-t border-hairline p-3">
        {assemblyQuery.isPending ? (
          <p className="rounded-md border border-dashed border-hairline px-3 py-2 text-xs text-muted-foreground">
            Loading the saved assembly and audit state…
          </p>
        ) : assemblyQuery.isError ? (
          <p className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-xs text-foreground">
            {assemblyQuery.error instanceof Error
              ? assemblyQuery.error.message
              : "The saved assembly could not be loaded."}
          </p>
        ) : !ready ? (
          <p className="rounded-md border border-dashed border-hairline px-3 py-2 text-xs text-muted-foreground">
            Assembly Workbench is waiting for its Lovable database migration.
          </p>
        ) : (
          <>
            <div className="rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-xs">
              <p className="flex items-start gap-1.5 font-medium text-foreground">
                <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                AI can read cited requirements. It does not measure this drawing or approve any
                factor.
              </p>
              <p className="mt-1 text-muted-foreground">
                The saved result is recalculated in the database from {measurement.quantity}{" "}
                {measurement.unit}
                {measurement.calculation_scale_revision
                  ? ` at scale revision ${measurement.calculation_scale_revision}`
                  : ""}
                . It does not change the estimate until you deliberately use an output.
              </p>
            </div>

            {measurement.calculation_status !== "current" && (
              <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-foreground">
                This takeoff is not current. Recalculate and complete Scale Assurance before
                confirming an assembly.
              </p>
            )}

            <div className="space-y-1.5">
              <Label>Assembly type</Label>
              <Select
                value={templateId}
                onValueChange={(value: TakeoffAssemblyTemplateId) => {
                  setTemplateId(value);
                  setInputDrafts(
                    Object.fromEntries(
                      Object.entries(defaultTakeoffAssemblyInputs(value)).map(([key, next]) => [
                        key,
                        String(next),
                      ]),
                    ),
                  );
                  setConfirmedKeys([]);
                  setReview(null);
                }}
              >
                <SelectTrigger data-testid="takeoff-assembly-template">
                  <SelectValue placeholder="Choose an assembly" />
                </SelectTrigger>
                <SelectContent>
                  {compatibleTemplates.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">{template?.description}</p>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-hairline bg-surface px-3 py-2">
              <div>
                <p className="text-xs font-medium text-foreground">Cited requirement review</p>
                <p className="text-[11px] text-muted-foreground">
                  {relevantScope.length > 0
                    ? `${relevantScope.length} accepted note citation${relevantScope.length === 1 ? "" : "s"} available.`
                    : "No completed cited scope note is attached; enter inputs manually."}
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 gap-1.5"
                disabled={
                  reviewMutation.isPending ||
                  relevantScope.length === 0 ||
                  measurement.calculation_status !== "current"
                }
                onClick={() => reviewMutation.mutate()}
                data-testid="takeoff-assembly-ai-review"
              >
                <Bot className="h-3.5 w-3.5" />
                {reviewMutation.isPending ? "Reading cited note…" : "Ask AI · up to 1 credit"}
              </Button>
            </div>

            {proposals.length > 0 && (
              <div className="space-y-2" data-testid="takeoff-assembly-ai-proposals">
                <p className="text-xs font-medium text-foreground">AI-proposed inputs</p>
                {proposals.map((proposal) => {
                  const definition = template?.inputs.find(
                    (candidate) => candidate.key === proposal.input_key,
                  );
                  if (!definition) return null;
                  return (
                    <div
                      key={`${proposal.input_key}-${proposal.source_line}`}
                      className="rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-xs"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="font-medium text-foreground">
                            {definition.label}: {proposal.value} {definition.unit}
                          </p>
                          <p className="mt-1 text-[11px] text-muted-foreground">
                            {proposal.source_line} · “{proposal.source_excerpt}”
                          </p>
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-7 shrink-0 px-2 text-[10px]"
                          onClick={() => {
                            setInputDrafts((current) => ({
                              ...current,
                              [proposal.input_key]: String(proposal.value),
                            }));
                            setConfirmedKeys((current) =>
                              current.filter((key) => key !== proposal.input_key),
                            );
                          }}
                        >
                          Apply for review
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {template && (
              <div className="space-y-3" data-testid="takeoff-assembly-inputs">
                <div>
                  <p className="text-xs font-medium text-foreground">Estimator inputs</p>
                  <p className="text-[11px] text-muted-foreground">
                    Check each row only after you verify the value for this scope.
                  </p>
                </div>
                {template.inputs.map((definition) => (
                  <div
                    key={definition.key}
                    className="grid gap-2 rounded-md border border-hairline px-3 py-2 sm:grid-cols-[minmax(0,1fr)_110px_92px] sm:items-center"
                  >
                    <div>
                      <Label htmlFor={`assembly-${measurement.id}-${definition.key}`}>
                        {definition.label}
                      </Label>
                      <p className="mt-0.5 text-[10px] text-muted-foreground">
                        {definition.description}
                      </p>
                    </div>
                    <div className="relative">
                      <Input
                        id={`assembly-${measurement.id}-${definition.key}`}
                        type="number"
                        min={definition.min}
                        max={definition.max}
                        step={definition.step}
                        value={inputDrafts[definition.key] ?? ""}
                        onChange={(event) => {
                          setInputDrafts((current) => ({
                            ...current,
                            [definition.key]: event.target.value,
                          }));
                          setConfirmedKeys((current) =>
                            current.filter((key) => key !== definition.key),
                          );
                        }}
                      />
                      <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-[9px] text-muted-foreground">
                        {definition.unit}
                      </span>
                    </div>
                    <label className="flex cursor-pointer items-center gap-2 text-[11px] text-foreground">
                      <Checkbox
                        checked={confirmedKeys.includes(definition.key)}
                        onCheckedChange={(checked) =>
                          setConfirmedKeys((current) =>
                            checked
                              ? [...new Set([...current, definition.key])]
                              : current.filter((key) => key !== definition.key),
                          )
                        }
                        aria-label={`Confirm ${definition.label}`}
                      />
                      Confirmed
                    </label>
                  </div>
                ))}
              </div>
            )}

            <div className="space-y-2" data-testid="takeoff-assembly-output-preview">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-xs font-medium text-foreground">Deterministic preview</p>
                  <p className="text-[10px] text-muted-foreground">
                    {calculation.result?.formulaVersion ?? "assembly-engine-v1"}
                  </p>
                </div>
                <Badge variant="outline">No estimate impact</Badge>
              </div>
              {calculation.result ? (
                <div className="divide-y divide-hairline rounded-md border border-hairline">
                  {calculation.result.outputs.map((output) => (
                    <div key={output.key} className="px-3 py-2">
                      <div className="flex items-center justify-between gap-3 text-xs">
                        <span className="font-medium text-foreground">{output.label}</span>
                        <span className="tabular-nums text-foreground">
                          {formattedAssemblyQuantity(output.quantity, output.unit)}
                        </span>
                      </div>
                      <p className="mt-0.5 text-[10px] text-muted-foreground">{output.formula}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-xs">
                  {calculation.error}
                </p>
              )}
            </div>

            {sourceCitations.length > 0 && (
              <div className="space-y-1.5" data-testid="takeoff-assembly-citations">
                <p className="text-xs font-medium text-foreground">Source notes retained</p>
                {sourceCitations.map((citation, index) => (
                  <p
                    key={`${citation.plan_sheet_id ?? "sheet"}-${citation.source_line}-${index}`}
                    className="rounded-md border border-hairline bg-surface px-3 py-2 text-[11px] text-muted-foreground"
                  >
                    {citation.sheet_number ? `${citation.sheet_number} · ` : ""}
                    {citation.source_line} · “{citation.source_excerpt}”
                  </p>
                ))}
              </div>
            )}

            <div className="grid gap-2 sm:grid-cols-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => saveMutation.mutate("draft")}
                disabled={
                  saveMutation.isPending ||
                  !calculation.result ||
                  measurement.calculation_status !== "current"
                }
                data-testid="takeoff-assembly-save-draft"
              >
                Save draft
              </Button>
              <Button
                type="button"
                className="gap-1.5"
                onClick={() => saveMutation.mutate("confirmed")}
                disabled={
                  saveMutation.isPending ||
                  !calculation.result ||
                  !allConfirmed ||
                  measurement.calculation_status !== "current"
                }
                data-testid="takeoff-assembly-confirm"
              >
                <CheckCircle2 className="h-3.5 w-3.5" /> Confirm assembly
              </Button>
            </div>
            {!allConfirmed && (
              <p className="text-[11px] text-muted-foreground">
                Confirm all {template?.inputs.length ?? 0} inputs to approve this assembly. Saving a
                draft keeps the work without representing it as estimator-approved.
              </p>
            )}
          </>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
