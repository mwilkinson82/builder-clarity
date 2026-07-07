// Symbol discovery results (SYMBOLDISCOVERY Stages 0-1, QA-flagged).
// Shows the estimator "the kinds of symbols the AI found on this sheet" —
// each cluster as a card: the medoid crop large, members alongside, count up
// front. Stage 1: name a group and its members become review ghosts on the
// canvas (the existing accept/reject/nudge bar counts them). Ignoring a junk
// group costs nothing — just don't name it.

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowRight, Loader2, RefreshCw, ScanSearch } from "lucide-react";
import type { EmbeddingCluster } from "@/lib/ai-takeoff/embedding-match/embedding-cluster-domain";
import type { SymbolDiscoveryController } from "./useSymbolDiscovery";

function CropThumb({ base64, size }: { base64: string; size: number }) {
  return (
    <img
      src={`data:image/png;base64,${base64}`}
      alt="Symbol candidate"
      className="rounded border border-hairline bg-white object-contain"
      style={{ width: size, height: size }}
    />
  );
}

export function SymbolDiscoveryDialog({
  discovery,
  onCountCluster,
}: {
  discovery: SymbolDiscoveryController;
  /** Stage 1: hand a named cluster to the review flow (workspace wires it). */
  onCountCluster?: (input: { cluster: EmbeddingCluster; label: string }) => void;
}) {
  const { open, phase, progress, error, result, rescan, close } = discovery;
  const [labelDrafts, setLabelDrafts] = useState<Record<number, string>>({});
  const groups = result?.clusters.filter((cluster) => cluster.memberIndexes.length >= 2) ?? [];
  const singletonCount = result ? result.clusters.length - groups.length : 0;

  return (
    <Dialog open={open} onOpenChange={(next) => (!next ? close() : undefined)}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ScanSearch className="h-4 w-4" />
            Symbols found{result ? ` on ${result.sheetLabel}` : ""}
          </DialogTitle>
          <DialogDescription>
            The AI groups what it sees on the sheet. Name a group and review its matches on the plan
            — every count still needs your accept. Groups you don't name are simply ignored.
          </DialogDescription>
        </DialogHeader>

        {phase === "running" && (
          <div className="flex items-center gap-2 rounded-md border border-hairline bg-surface px-3 py-4 text-sm">
            <Loader2 className="h-4 w-4 animate-spin" />
            {progress || "Working…"}
          </div>
        )}

        {error && (
          <div className="rounded-md border border-danger/40 bg-danger/5 px-3 py-2 text-sm text-danger">
            {error}
          </div>
        )}

        {phase === "done" && result && (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                {result.candidateCount} candidates → {result.clusters.length} groups (
                {groups.length} with 2+ matches, {singletonCount} one-offs) · embed{" "}
                {Math.round(result.embedElapsedMs / 1000)}s · total{" "}
                {Math.round(result.totalElapsedMs / 1000)}s
              </p>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 shrink-0 gap-1.5 px-2 text-xs"
                onClick={() => void rescan()}
                title="Run discovery again on this sheet"
              >
                <RefreshCw className="h-3 w-3" />
                Re-scan (1 credit)
              </Button>
            </div>
            {groups.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Nothing grouped — every candidate looked unique at this threshold.
              </p>
            )}
            {groups.map((cluster, index) => {
              const medoid = result.crops[cluster.medoidIndex];
              const members = cluster.memberIndexes
                .filter((memberIndex) => memberIndex !== cluster.medoidIndex)
                .slice(0, 7)
                .map((memberIndex) => result.crops[memberIndex]);
              const draftKey = cluster.memberIndexes[0];
              const draft = labelDrafts[draftKey] ?? "";
              return (
                <div
                  key={draftKey}
                  className="flex items-start gap-3 rounded-md border border-hairline bg-surface p-3"
                  data-testid="discovery-cluster-card"
                >
                  {medoid && <CropThumb base64={medoid.base64} size={72} />}
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">Group {index + 1}</span>
                      <Badge variant="outline">{cluster.memberIndexes.length} found</Badge>
                      <span className="text-xs text-muted-foreground">
                        {Math.round(cluster.cohesion * 100)}% alike
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {members.map((crop, memberIndex) => (
                        <CropThumb key={memberIndex} base64={crop.base64} size={40} />
                      ))}
                      {cluster.memberIndexes.length - 1 > members.length && (
                        <span className="self-center text-xs text-muted-foreground">
                          +{cluster.memberIndexes.length - 1 - members.length} more
                        </span>
                      )}
                    </div>
                    {onCountCluster && (
                      <div className="flex items-center gap-2 pt-1">
                        <Input
                          value={draft}
                          onChange={(event) =>
                            setLabelDrafts((current) => ({
                              ...current,
                              [draftKey]: event.target.value,
                            }))
                          }
                          placeholder="Name this symbol, e.g. Mechanical Brush"
                          className="h-8 text-sm"
                          data-testid="discovery-cluster-label"
                        />
                        <Button
                          type="button"
                          size="sm"
                          className="h-8 shrink-0 gap-1.5"
                          disabled={!draft.trim()}
                          onClick={() => onCountCluster({ cluster, label: draft.trim() })}
                          data-testid="discovery-cluster-count"
                        >
                          Count these
                          <ArrowRight className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
