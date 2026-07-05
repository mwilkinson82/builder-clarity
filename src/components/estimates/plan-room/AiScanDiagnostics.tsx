// Scan diagnostics dialog (AITAKEOFF2 Task 4, upgraded in AITAKEOFF3
// Task 3) — the founder's microscope. Super-admin only (enforced
// server-side): the exemplar crop actually sent to the model, every stage-A
// tile with its mapped candidates drawn ON the thumbnail, every stage-B
// verification crop with its verdict, and the token-implied perceived
// megapixels so a silent API resize flags at a glance. Enough to distinguish
// "the model is wrong" from "the plumbing fed it garbage".

import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Microscope } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  getAiScanDiagnostics,
  type AiScanDiagnostics as AiScanDiagnosticsData,
  type AiScanDiagnosticsTile,
  type AiScanSheetSummary,
  type AiScanVerification,
} from "@/lib/ai-takeoff/ai-scan-diagnostics.functions";
import type { DetectionTileFrame } from "@/lib/ai-takeoff/coord-transforms";

// Marker palette: verification verdicts on thumbnails.
const MARKER_ACCEPTED = "#16a34a"; // verified match
const MARKER_REJECTED = "#dc2626"; // verification said no
const MARKER_UNVERIFIED = "#d97706"; // never verified (deduped away or capped)
const MARKER_SUPPRESSED = "#2563eb"; // suppressed: the estimator already marked it

interface ImageMarker {
  leftPct: number;
  topPct: number;
  color: string;
}

/** Sheet-space point → percent position inside a tile/crop image. */
function markerFor(
  point: { x: number; y: number },
  frame: DetectionTileFrame,
  rect: { width: number; height: number },
  color: string,
): ImageMarker | null {
  if (rect.width <= 0 || rect.height <= 0) return null;
  const localX = (point.x - frame.originSheetX) / frame.sheetPerPxX;
  const localY = (point.y - frame.originSheetY) / frame.sheetPerPxY;
  const leftPct = (localX / rect.width) * 100;
  const topPct = (localY / rect.height) * 100;
  if (leftPct < 0 || leftPct > 100 || topPct < 0 || topPct > 100) return null;
  return { leftPct, topPct, color };
}

/** Thumbnail with position markers drawn on it — no number cross-referencing. */
function MarkedImage({
  src,
  alt,
  markers,
  className,
}: {
  src: string;
  alt: string;
  markers: ImageMarker[];
  className?: string;
}) {
  return (
    <div className="relative inline-block max-w-full">
      <img src={src} alt={alt} className={className} loading="lazy" />
      {markers.map((marker, index) => (
        <span
          key={index}
          className="absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2"
          style={{
            left: `${marker.leftPct}%`,
            top: `${marker.topPct}%`,
            borderColor: marker.color,
            backgroundColor: `${marker.color}33`,
          }}
        />
      ))}
    </div>
  );
}

const pointKey = (point: { x: number; y: number }) => `${point.x.toFixed(6)},${point.y.toFixed(6)}`;

/**
 * The proposal funnel, one line per sheet (AITAKEOFF7 Task 4): every count
 * between "engines proposed" and "stage B judged" is visible, so a radius
 * bug that swallows candidates shows up on the first screenshot.
 */
function SheetSummaryCard({ summary }: { summary: AiScanSheetSummary }) {
  // Template hits are already NMS'd with the SAME radius, so the union can
  // only ADD model-only candidates — fewer out than template hits in is a
  // geometric impossibility unless a radius bug is eating candidates.
  const collapseLooksWrong =
    summary.proposedTemplate > 0 && summary.afterUnionDedupe < summary.proposedTemplate;
  return (
    <div
      className="rounded-md border border-hairline p-3 text-xs text-muted-foreground"
      data-testid="ai-diagnostics-sheet-summary"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">sheet {summary.sheetId.slice(0, 8)}…</Badge>
        <span className="font-medium text-foreground" data-testid="ai-diagnostics-funnel">
          {summary.proposedTemplate} template + {summary.proposedModel} model proposed →{" "}
          {summary.afterUnionDedupe} after dedupe → {summary.afterSuppression} after suppression →{" "}
          {summary.verified} verified
        </span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        {summary.footprintRasterPx !== null && (
          <span>footprint {Math.round(summary.footprintRasterPx)}px</span>
        )}
        {summary.radius && (
          <span>
            radius ({summary.radius.x.toFixed(4)}, {summary.radius.y.toFixed(4)}) of sheet
          </span>
        )}
        {summary.stageATiles > 0 ? (
          <span>{summary.stageATiles} stage-A tiles</span>
        ) : (
          <span>stage A skipped (template-only)</span>
        )}
        {summary.templateEngine === "ok" && summary.templateElapsedMs !== null && (
          <span>template engine ok in {summary.templateElapsedMs}ms</span>
        )}
        {summary.templateEngine === "skipped" && <span>template engine skipped</span>}
        {summary.templateEngine === "failed" && (
          <Badge variant="destructive" data-testid="ai-diagnostics-template-failed">
            template engine failed{summary.templateError ? `: ${summary.templateError}` : ""}
          </Badge>
        )}
        {collapseLooksWrong && (
          <Badge variant="destructive" data-testid="ai-diagnostics-collapse-flag">
            heavy dedupe collapse — check the radius line above
          </Badge>
        )}
      </div>
    </div>
  );
}

function TileCard({
  tile,
  verdictByPoint,
}: {
  tile: AiScanDiagnosticsTile;
  verdictByPoint: Map<string, boolean>;
}) {
  const markers: ImageMarker[] =
    tile.frame && tile.rect
      ? [
          ...tile.mappedCandidates.map((candidate) => {
            const verdict = verdictByPoint.get(pointKey(candidate));
            const color =
              verdict === true
                ? MARKER_ACCEPTED
                : verdict === false
                  ? MARKER_REJECTED
                  : MARKER_UNVERIFIED;
            return markerFor(candidate, tile.frame!, tile.rect!, color);
          }),
          ...tile.suppressedNearExisting.map((candidate) =>
            markerFor(candidate, tile.frame!, tile.rect!, MARKER_SUPPRESSED),
          ),
        ].filter((marker): marker is ImageMarker => marker !== null)
      : [];

  return (
    <div className="rounded-md border border-hairline p-3" data-testid="ai-diagnostics-tile">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Badge variant="outline">tile {tile.tileIndex}</Badge>
        <span>sheet {tile.sheetId.slice(0, 8)}…</span>
        {tile.metadataMissing && (
          <Badge variant="destructive" data-testid="ai-diagnostics-tile-orphan">
            metadata missing
          </Badge>
        )}
        {tile.frame && (
          <span>
            origin ({tile.frame.originSheetX.toFixed(4)}, {tile.frame.originSheetY.toFixed(4)})
          </span>
        )}
        {tile.rect && (
          <span>
            {tile.rect.width}×{tile.rect.height}px @ ({tile.rect.left}, {tile.rect.top})
          </span>
        )}
        <span>{tile.mappedCandidates.length} candidates</span>
        {tile.suppressedNearExisting.length > 0 && (
          <span data-testid="ai-diagnostics-suppressed-count">
            {tile.suppressedNearExisting.length} suppressed — already marked by hand
          </span>
        )}
        {tile.usage && (
          <span>
            {tile.usage.inputTokens}in/{tile.usage.outputTokens}out tok
          </span>
        )}
        {tile.tokenCheck && Number.isFinite(tile.tokenCheck.tileImpliedMegapixels) && (
          <span data-testid="ai-diagnostics-tile-mp">
            tile ⇒ ~{tile.tokenCheck.tileImpliedMegapixels}MP
            {tile.tokenCheck.suspectedResize ? "" : " (ok)"}
          </span>
        )}
        {tile.tokenCheck?.suspectedResize && (
          <Badge variant="destructive" data-testid="ai-diagnostics-resize-flag">
            resize suspected
          </Badge>
        )}
      </div>
      {tile.imageUrl && (
        <div className="mt-2">
          <MarkedImage
            src={tile.imageUrl}
            alt={`Tile ${tile.tileIndex}`}
            markers={markers}
            className="max-h-48 rounded border border-hairline"
          />
        </div>
      )}
      {tile.mappedCandidates.length > 0 && (
        <p className="mt-2 break-words text-xs text-muted-foreground">
          Candidates:{" "}
          {tile.mappedCandidates
            .map((candidate) => `(${candidate.x.toFixed(4)}, ${candidate.y.toFixed(4)})`)
            .join(" ")}
        </p>
      )}
      {tile.rawResponse && (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-muted-foreground">
            Raw model response
          </summary>
          <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-surface p-2 text-[11px]">
            {tile.rawResponse}
          </pre>
        </details>
      )}
    </div>
  );
}

function VerificationCard({ verification }: { verification: AiScanVerification }) {
  const markers: ImageMarker[] = [];
  if (verification.mappedPoint && verification.frame && verification.window) {
    const finalMarker = markerFor(
      verification.mappedPoint,
      verification.frame,
      verification.window,
      verification.match ? MARKER_ACCEPTED : MARKER_REJECTED,
    );
    if (finalMarker) markers.push(finalMarker);
  }
  // The pre-snap stage-B center in amber: raw vs final IS the correction
  // vector, visible on the crop itself (AITAKEOFF4 Task 1).
  if (verification.rawCenterPx && verification.snappedCenterPx && verification.window) {
    const { width, height } = verification.window;
    if (width > 0 && height > 0) {
      markers.push({
        leftPct: (verification.rawCenterPx.x / width) * 100,
        topPct: (verification.rawCenterPx.y / height) * 100,
        color: MARKER_UNVERIFIED,
      });
    }
  }
  const snapDeltaPx =
    verification.rawCenterPx && verification.snappedCenterPx
      ? Math.hypot(
          verification.snappedCenterPx.x - verification.rawCenterPx.x,
          verification.snappedCenterPx.y - verification.rawCenterPx.y,
        )
      : null;

  return (
    <div
      className="rounded-md border border-hairline p-3"
      data-testid="ai-diagnostics-verification"
    >
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Badge
          variant={verification.match ? "secondary" : "destructive"}
          data-testid="ai-diagnostics-verdict"
        >
          {verification.match ? "verified" : "rejected"}
        </Badge>
        <Badge variant="outline">candidate {verification.candidateIndex}</Badge>
        <span>sheet {verification.sheetId.slice(0, 8)}…</span>
        {verification.originLabel && (
          <Badge variant="outline" data-testid="ai-diagnostics-origin">
            {verification.originLabel}
          </Badge>
        )}
        {verification.observed && (
          <span className="basis-full" data-testid="ai-diagnostics-observed">
            model saw: “{verification.observed}”
          </span>
        )}
        {verification.metadataMissing && <Badge variant="destructive">metadata missing</Badge>}
        {verification.window && (
          <span>
            {verification.window.width}×{verification.window.height}px @ ({verification.window.left}
            , {verification.window.top})
          </span>
        )}
        {verification.match && !verification.centerRefined && (
          <span>center fallback: stage-A point</span>
        )}
        {snapDeltaPx !== null && (
          <span data-testid="ai-diagnostics-snap-delta">
            snap moved the center {snapDeltaPx.toFixed(1)}px
          </span>
        )}
        {verification.match && verification.rawCenterPx && !verification.snappedCenterPx && (
          <span>no ink blob to snap to — stage-B center kept</span>
        )}
        {verification.usage && (
          <span>
            {verification.usage.inputTokens}in/{verification.usage.outputTokens}out tok
          </span>
        )}
      </div>
      {verification.imageUrl && (
        <div className="mt-2">
          <MarkedImage
            src={verification.imageUrl}
            alt={`Verification crop ${verification.candidateIndex}`}
            markers={markers}
            className="max-h-40 rounded border border-hairline"
          />
        </div>
      )}
      {verification.rawResponse && (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-muted-foreground">
            Raw verify response
          </summary>
          <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap rounded bg-surface p-2 text-[11px]">
            {verification.rawResponse}
          </pre>
        </details>
      )}
    </div>
  );
}

export function AiScanDiagnosticsDialog({
  open,
  onOpenChange,
  defaultOperationId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultOperationId: string | null;
}) {
  const getDiagnosticsFn = useServerFn(getAiScanDiagnostics);
  const [operationId, setOperationId] = useState(defaultOperationId ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [diagnostics, setDiagnostics] = useState<AiScanDiagnosticsData | null>(null);

  const load = useCallback(
    async (id: string) => {
      const trimmed = id.trim();
      if (!trimmed) return;
      setLoading(true);
      setError("");
      try {
        const result = await getDiagnosticsFn({ data: { operation_id: trimmed } });
        setDiagnostics(result);
      } catch (loadError) {
        setDiagnostics(null);
        setError(
          loadError instanceof Error ? loadError.message : "Diagnostics could not be loaded.",
        );
      } finally {
        setLoading(false);
      }
    },
    [getDiagnosticsFn],
  );

  // Opening the dialog loads the most recent scan automatically.
  useEffect(() => {
    if (!open) return;
    const id = defaultOperationId ?? "";
    setOperationId(id);
    setDiagnostics(null);
    setError("");
    if (id) void load(id);
  }, [defaultOperationId, load, open]);

  const operation = diagnostics?.operation ?? null;
  // Verification verdicts keyed by the stage-A candidate point they judged,
  // so tile thumbnails can color their markers without cross-referencing.
  const verdictByPoint = new Map<string, boolean>();
  for (const verification of diagnostics?.verifications ?? []) {
    if (verification.candidate) {
      verdictByPoint.set(pointKey(verification.candidate), verification.match);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Microscope className="h-4 w-4" />
            Scan diagnostics
          </DialogTitle>
          <DialogDescription>
            What the model actually saw at both stages: the exemplar crop, every tile with its
            candidates drawn on, and every verification crop with its verdict. Images are kept for
            ~24 hours.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1 space-y-1.5">
            <Label className="text-xs">AI operation id</Label>
            <Input
              value={operationId}
              onChange={(event) => setOperationId(event.target.value)}
              placeholder="ai_operations row id"
              data-testid="ai-diagnostics-operation-id"
            />
          </div>
          <Button
            type="button"
            size="sm"
            onClick={() => void load(operationId)}
            disabled={loading || !operationId.trim()}
            data-testid="ai-diagnostics-load"
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Load"}
          </Button>
        </div>

        {error && (
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
        )}

        {operation && (
          <div className="space-y-4">
            <div className="rounded-md border border-hairline bg-surface p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={operation.status === "succeeded" ? "secondary" : "outline"}>
                  {operation.status}
                </Badge>
                <span className="text-xs text-muted-foreground">{operation.modelUsed}</span>
                <span className="text-xs text-muted-foreground">
                  {operation.sheetsCompleted}/{operation.sheetIds.length} sheets ·{" "}
                  {operation.creditsCharged} credits · API cost{" "}
                  {(operation.apiCostCents / 100).toLocaleString(undefined, {
                    style: "currency",
                    currency: "USD",
                  })}
                </span>
              </div>
              <p className="mt-2 text-sm">
                <span className="font-medium">Model saw the exemplar as:</span>{" "}
                <span data-testid="ai-diagnostics-echo">
                  {operation.exemplarDescription || "— no echo recorded —"}
                </span>
              </p>
              {operation.error && (
                <p className="mt-1 text-xs text-destructive">Error: {operation.error}</p>
              )}
            </div>

            {!diagnostics?.diagnosticsAvailable ? (
              <p className="rounded-md border border-dashed border-hairline p-3 text-sm text-muted-foreground">
                No diagnostic images remain for this scan (they expire after ~24 hours or the scan
                predates diagnostics capture).
              </p>
            ) : (
              <>
                {diagnostics.sheetSummaries.length > 0 && (
                  <div className="space-y-3">
                    <p className="text-sm font-medium">
                      Proposal funnel — engines proposed → dedupe → suppression → verified
                    </p>
                    {diagnostics.sheetSummaries.map((sheetSummary) => (
                      <SheetSummaryCard key={sheetSummary.sheetId} summary={sheetSummary} />
                    ))}
                  </div>
                )}

                <div className="space-y-1.5">
                  <p className="text-sm font-medium">Exemplar crop sent to the model</p>
                  {diagnostics.exemplarUrl ? (
                    <img
                      src={diagnostics.exemplarUrl}
                      alt="Exemplar crop sent to the model"
                      className="max-h-64 rounded-md border border-hairline"
                      data-testid="ai-diagnostics-exemplar-image"
                    />
                  ) : (
                    <p className="text-xs text-muted-foreground">Exemplar image not retained.</p>
                  )}
                </div>

                <div className="space-y-3">
                  <p className="text-sm font-medium">
                    Tiles ({diagnostics.tiles.length}) — stage-A candidates drawn on each tile
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Markers: <span style={{ color: MARKER_ACCEPTED }}>green</span> verified,{" "}
                    <span style={{ color: MARKER_REJECTED }}>red</span> rejected in verification,{" "}
                    <span style={{ color: MARKER_UNVERIFIED }}>amber</span> never verified (deduped
                    across tiles or capped), <span style={{ color: MARKER_SUPPRESSED }}>blue</span>{" "}
                    suppressed — the estimator already marked that symbol.
                  </p>
                  {diagnostics.tiles.map((tile) => (
                    <TileCard
                      key={`${tile.sheetId}-${tile.tileIndex}`}
                      tile={tile}
                      verdictByPoint={verdictByPoint}
                    />
                  ))}
                </div>

                <div className="space-y-3">
                  <p className="text-sm font-medium">
                    Verifications ({diagnostics.verifications.length}) — each candidate judged on a
                    zoomed crop
                  </p>
                  {diagnostics.verifications.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      No verification artifacts (stage A found no candidates, or the scan predates
                      two-stage detection).
                    </p>
                  ) : (
                    diagnostics.verifications.map((verification) => (
                      <VerificationCard
                        key={`${verification.sheetId}-${verification.candidateIndex}`}
                        verification={verification}
                      />
                    ))
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
