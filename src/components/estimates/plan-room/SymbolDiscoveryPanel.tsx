import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Check, EyeOff, Loader2, RefreshCw, ScanSearch, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { EstimateLineItemRow } from "@/lib/estimates.functions";
import type { SymbolDiscoveryController } from "./useSymbolDiscovery";

const UNLINKED_VALUE = "__unlinked__";
const COUNT_UNITS = new Set(["EA", "EACH", "COUNT", "CT", "PC", "PCS", "UNIT", "UNITS"]);

function isCountCompatibleLine(item: EstimateLineItemRow) {
  return COUNT_UNITS.has(item.unit.trim().toUpperCase());
}

function CropThumb({ base64, size }: { base64: string; size: number }) {
  return (
    <img
      src={`data:image/png;base64,${base64}`}
      alt="Candidate drawing symbol"
      className="rounded-md border border-hairline bg-surface object-contain"
      style={{ width: size, height: size }}
    />
  );
}

export interface StartDiscoveryGroupReviewInput {
  clusterIndex: number;
  label: string;
  trade: string;
  unit: string;
  estimateLineItemId: string | null;
  costLibraryItemId: string | null;
}

export function SymbolDiscoveryPanel({
  discovery,
  lineItems,
  onStartReview,
}: {
  discovery: SymbolDiscoveryController;
  lineItems: EstimateLineItemRow[];
  onStartReview: (input: StartDiscoveryGroupReviewInput) => void;
}) {
  const {
    phase,
    progress,
    error,
    result,
    selectedClusterIndex,
    ignoredClusterIndexes,
    reviewedGroups,
    selectGroup,
    clearSelection,
    ignoreGroup,
    rescan,
    close,
  } = discovery;
  const [label, setLabel] = useState("");
  const [trade, setTrade] = useState("");
  const [lineItemId, setLineItemId] = useState(UNLINKED_VALUE);

  const groups = useMemo(
    () =>
      (result?.clusters ?? [])
        .map((cluster, index) => ({ cluster, index }))
        .filter(({ cluster }) => cluster.memberIndexes.length >= 2),
    [result],
  );
  const countLineItems = useMemo(() => lineItems.filter(isCountCompatibleLine), [lineItems]);
  const selected = groups.find(({ index }) => index === selectedClusterIndex) ?? null;
  const suggestion =
    result?.librarySuggestions.find((item) => item.clusterIndex === selectedClusterIndex) ?? null;

  useEffect(() => {
    if (!selected) return;
    setLabel(suggestion?.label ?? "");
    setTrade(suggestion?.trade ?? "");
    const matchingLine = suggestion?.costLibraryItemId
      ? countLineItems.find((item) => item.library_item_id === suggestion.costLibraryItemId)
      : null;
    setLineItemId(matchingLine?.id ?? UNLINKED_VALUE);
  }, [countLineItems, selected, suggestion]);

  const selectedLine =
    lineItemId === UNLINKED_VALUE
      ? null
      : (countLineItems.find((item) => item.id === lineItemId) ?? null);
  const selectedMembers = selected
    ? selected.cluster.memberIndexes
        .map((memberIndex) => ({ memberIndex, crop: result?.crops[memberIndex] }))
        .filter(
          (member): member is { memberIndex: number; crop: NonNullable<typeof member.crop> } =>
            Boolean(member.crop),
        )
    : [];
  const unreviewedCount = groups.filter(
    ({ index }) => !ignoredClusterIndexes.includes(index) && !reviewedGroups[index],
  ).length;

  return (
    <div
      className="absolute right-4 top-20 flex max-h-[min(72vh,680px)] w-[360px] max-w-[calc(100vw-2rem)] flex-col rounded-lg border border-hairline bg-card/95 shadow-2xl backdrop-blur"
      data-testid="symbol-discovery-panel"
    >
      <div className="flex items-center justify-between gap-3 border-b border-hairline bg-surface/80 px-3 py-2">
        <div>
          <p className="eyebrow">AI markup review</p>
          <h2 className="flex items-center gap-1.5 font-serif text-lg">
            <ScanSearch className="h-4 w-4" />
            Identify drawing symbols
          </h2>
        </div>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-8 w-8"
          onClick={close}
          disabled={phase === "running"}
          title="Close symbol discovery"
          aria-label="Close symbol discovery"
          data-testid="symbol-discovery-close"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {phase === "running" && (
          <div
            className="flex items-center gap-2 rounded-md border border-hairline bg-surface px-3 py-4 text-sm"
            role="status"
            aria-live="polite"
          >
            <Loader2 className="h-4 w-4 animate-spin" />
            {progress || "Reading the drawing…"}
          </div>
        )}
        {error && (
          <div
            className="space-y-2 rounded-md border border-danger/40 bg-danger/5 px-3 py-2 text-sm text-danger"
            role="alert"
          >
            <p>{error}</p>
            <Button type="button" size="sm" variant="outline" onClick={() => void rescan()}>
              Try again
            </Button>
          </div>
        )}

        {phase === "done" && result && (
          <div className="space-y-3">
            <div className="flex items-start justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                {result.candidateCount} possible marks grouped into {groups.length} repeated symbol
                {groups.length === 1 ? "" : "s"}. Dashed marks are proposals only.
              </p>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 shrink-0 gap-1 px-2 text-xs"
                onClick={() => void rescan()}
                title="Scan this sheet again for one AI credit"
              >
                <RefreshCw className="h-3 w-3" />
                Re-scan
              </Button>
            </div>
            {result.libraryExampleCount > 0 && (
              <p className="rounded-md border border-hairline bg-muted px-2 py-1.5 text-xs text-muted-foreground">
                Compared with {result.libraryExampleCount} estimator-approved company example
                {result.libraryExampleCount === 1 ? "" : "s"}. Labels appear only when both the
                repeated group and a near-exact member clear the high-confidence checks. Every
                suggestion still requires confirmation.
              </p>
            )}

            {!selected && unreviewedCount === 0 && (
              <div className="rounded-md border border-success/30 bg-success/5 p-3 text-sm">
                <p className="flex items-center gap-1.5 font-medium text-success">
                  <Check className="h-4 w-4" /> All repeated groups addressed
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Accepted counts are now normal takeoffs. Ignored groups changed nothing.
                </p>
              </div>
            )}

            {!selected && unreviewedCount > 0 && (
              <div className="space-y-1.5">
                <p className="eyebrow">Choose a group</p>
                {groups.map(({ cluster, index }) => {
                  const medoid = result.crops[cluster.medoidIndex];
                  const saved = reviewedGroups[index];
                  const ignored = ignoredClusterIndexes.includes(index);
                  const groupSuggestion = result.librarySuggestions.find(
                    (item) => item.clusterIndex === index,
                  );
                  return (
                    <button
                      key={index}
                      type="button"
                      className="flex w-full items-center gap-2 rounded-md border border-hairline p-2 text-left hover:bg-surface disabled:opacity-60"
                      onClick={() => selectGroup(index)}
                      disabled={ignored}
                      data-testid="symbol-discovery-group-option"
                    >
                      {medoid && <CropThumb base64={medoid.base64} size={44} />}
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium">
                          {groupSuggestion?.label || `Group ${index + 1}`}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {cluster.memberIndexes.length} proposed ·{" "}
                          {Math.round(cluster.cohesion * 100)}% alike
                        </span>
                      </span>
                      {saved ? (
                        <Badge variant="secondary">{saved.accepted} accepted</Badge>
                      ) : ignored ? (
                        <Badge variant="outline">Ignored</Badge>
                      ) : groupSuggestion ? (
                        <Badge variant="outline">Library suggestion</Badge>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            )}

            {selected && (
              <div className="space-y-3" data-testid="symbol-discovery-selected-group">
                <div className="flex items-center justify-between gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 gap-1 px-1 text-xs"
                    onClick={clearSelection}
                  >
                    <ArrowLeft className="h-3 w-3" /> All groups
                  </Button>
                  <Badge variant="outline">{selected.cluster.memberIndexes.length} proposed</Badge>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {selectedMembers.slice(0, 8).map(({ crop, memberIndex }) => (
                    <CropThumb key={memberIndex} base64={crop.base64} size={52} />
                  ))}
                </div>
                {suggestion && (
                  <div className="rounded-md border border-clay/30 bg-clay/5 px-2 py-1.5 text-xs">
                    Company library suggests <strong>{suggestion.label}</strong> at{" "}
                    {Math.round(suggestion.score * 100)}% combined group evidence. Confirm it below.
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label htmlFor="symbol-discovery-label">What is this symbol?</Label>
                  <Input
                    id="symbol-discovery-label"
                    value={label}
                    onChange={(event) => setLabel(event.target.value)}
                    placeholder="Example: Mechanical Brush"
                    data-testid="symbol-discovery-label"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="symbol-discovery-trade">Trade or category</Label>
                  <Input
                    id="symbol-discovery-trade"
                    value={trade}
                    onChange={(event) => setTrade(event.target.value)}
                    placeholder="Example: Equipment"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Estimate destination</Label>
                  <Select value={lineItemId} onValueChange={setLineItemId}>
                    <SelectTrigger data-testid="symbol-discovery-estimate-line">
                      <SelectValue placeholder="Keep unlinked for now" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={UNLINKED_VALUE}>Keep unlinked for now</SelectItem>
                      {countLineItems.map((item) => (
                        <SelectItem key={item.id} value={item.id}>
                          {item.cost_code ? `${item.cost_code} · ` : ""}
                          {item.description} · {item.unit}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[11px] text-muted-foreground">
                    Only count-compatible estimate rows are shown. Accepted counts sync through the
                    selected row’s normal trust checks.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="signal"
                  className="w-full"
                  disabled={!label.trim()}
                  onClick={() =>
                    onStartReview({
                      clusterIndex: selected.index,
                      label: label.trim(),
                      trade: trade.trim(),
                      unit: selectedLine?.unit || suggestion?.unit || "EA",
                      estimateLineItemId: selectedLine?.id ?? null,
                      costLibraryItemId:
                        selectedLine?.library_item_id ?? suggestion?.costLibraryItemId ?? null,
                    })
                  }
                  data-testid="symbol-discovery-start-review"
                >
                  Review {selected.cluster.memberIndexes.length} proposed counts
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="w-full gap-1.5 text-muted-foreground"
                  onClick={() => ignoreGroup(selected.index)}
                  data-testid="symbol-discovery-ignore-group"
                >
                  <EyeOff className="h-3.5 w-3.5" /> Ignore this group
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
