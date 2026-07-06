// Symbol discovery results (SYMBOLDISCOVERY Stage 0, QA-flagged).
// Shows the estimator "the kinds of symbols the AI found on this sheet" —
// each cluster as a card: the medoid crop large, members alongside, count up
// front. Stage 0 is eyes-on validation only: no labeling, no counting yet.
// The gate: on A-100, a brush group holding most of the ~12-15 brushes with
// junk self-segregated. If that fails, Stage 1 does not get built.

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Loader2, ScanSearch } from "lucide-react";
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

export function SymbolDiscoveryDialog({ discovery }: { discovery: SymbolDiscoveryController }) {
  const { open, phase, progress, error, result, close } = discovery;
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
            The AI groups what it sees on the sheet; you name only the groups that matter. Preview
            build — grouping only, counting comes next.
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
            <p className="text-xs text-muted-foreground">
              {result.candidateCount} candidates → {result.clusters.length} groups ({groups.length}{" "}
              with 2+ matches, {singletonCount} one-offs) · grouping threshold{" "}
              {result.similarityThreshold.toFixed(2)} · embed{" "}
              {Math.round(result.embedElapsedMs / 1000)}s · total{" "}
              {Math.round(result.totalElapsedMs / 1000)}s
            </p>
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
              return (
                <div
                  key={cluster.memberIndexes[0]}
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
