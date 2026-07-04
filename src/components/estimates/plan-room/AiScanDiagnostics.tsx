// Scan diagnostics dialog (AITAKEOFF2 Task 4) — the founder's microscope.
// Super-admin only (enforced server-side): shows the exemplar crop actually
// sent to the model, every tile with its sheet-space origin, the raw model
// responses, and the mapped positions. Enough to distinguish "the model is
// wrong" from "the plumbing fed it garbage" for any accuracy report.

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
} from "@/lib/ai-takeoff/ai-scan-diagnostics.functions";

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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Microscope className="h-4 w-4" />
            Scan diagnostics
          </DialogTitle>
          <DialogDescription>
            What the model actually saw: the exemplar crop, every tile with its sheet-space origin,
            the raw responses, and the mapped positions. Images are kept for ~24 hours.
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
                    Tiles ({diagnostics.tiles.length}) — origin is the tile's top-left in normalized
                    sheet space
                  </p>
                  {diagnostics.tiles.map((tile) => (
                    <div
                      key={`${tile.sheetId}-${tile.tileIndex}`}
                      className="rounded-md border border-hairline p-3"
                      data-testid="ai-diagnostics-tile"
                    >
                      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <Badge variant="outline">tile {tile.tileIndex}</Badge>
                        <span>sheet {tile.sheetId.slice(0, 8)}…</span>
                        {tile.frame && (
                          <span>
                            origin ({tile.frame.originSheetX.toFixed(4)},{" "}
                            {tile.frame.originSheetY.toFixed(4)})
                          </span>
                        )}
                        {tile.rect && (
                          <span>
                            {tile.rect.width}×{tile.rect.height}px @ ({tile.rect.left},{" "}
                            {tile.rect.top})
                          </span>
                        )}
                        <span>{tile.mappedCandidates.length} mapped</span>
                        {tile.usage && (
                          <span>
                            {tile.usage.inputTokens}in/{tile.usage.outputTokens}out tok
                          </span>
                        )}
                      </div>
                      {tile.imageUrl && (
                        <img
                          src={tile.imageUrl}
                          alt={`Tile ${tile.tileIndex}`}
                          className="mt-2 max-h-48 rounded border border-hairline"
                          loading="lazy"
                        />
                      )}
                      {tile.mappedCandidates.length > 0 && (
                        <p className="mt-2 break-words text-xs text-muted-foreground">
                          Mapped:{" "}
                          {tile.mappedCandidates
                            .map(
                              (candidate) =>
                                `(${candidate.x.toFixed(4)}, ${candidate.y.toFixed(4)} @ ${candidate.confidence.toFixed(2)})`,
                            )
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
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
