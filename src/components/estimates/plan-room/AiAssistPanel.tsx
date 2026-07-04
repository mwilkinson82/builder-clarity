// AI Assist panel (AITAKEOFF1 Task 3, ergonomics fixed in AITAKEOFF2 Task 3).
// Suggest, never force: the estimator counts one symbol, the model finds the
// rest, and every match still needs a human accept. Credit balance and cost
// stay visible the whole time; out of credits routes into the buy panel.
//
// Ergonomics (founder finding): the panel is draggable by its header with the
// position remembered per session, defaults clear of the takeoff toolbar, and
// collapses to a pill while the review bar is active — the review bar and the
// panel never both demand the same screen edge.

import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import {
  ChevronsUpDown,
  Coins,
  GripHorizontal,
  Loader2,
  Microscope,
  MousePointerClick,
  Sparkles,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import {
  AI_ASSIST_FIRST_RUN_MESSAGE,
  AI_ASSIST_NOT_CONFIGURED_MESSAGE,
  aiAssistAvailability,
} from "@/lib/ai-takeoff/ai-takeoff-domain";
import { centsToDollars } from "./planRoomShared";
import { AiScanDiagnosticsDialog } from "./AiScanDiagnostics";
import type { AiAssistController } from "./useAiAssist";

// Session-remembered panel position (same storage-blocked fallback story as
// the cockpit panel layouts in planRoomShared).
const PANEL_POSITION_STORAGE_KEY = "overwatch.plan-room.ai-panel-position.v1";
let panelPositionMemory: string | null = null;

type PanelPosition = { x: number; y: number };

function readStoredPanelPosition(): PanelPosition | null {
  let raw: string | null = panelPositionMemory;
  if (typeof window !== "undefined") {
    try {
      raw = window.sessionStorage.getItem(PANEL_POSITION_STORAGE_KEY) ?? panelPositionMemory;
    } catch {
      raw = panelPositionMemory;
    }
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PanelPosition>;
    const x = Number(parsed.x);
    const y = Number(parsed.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { x: Math.max(0, x), y: Math.max(0, y) };
  } catch {
    return null;
  }
}

function writeStoredPanelPosition(position: PanelPosition) {
  const raw = JSON.stringify(position);
  panelPositionMemory = raw;
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(PANEL_POSITION_STORAGE_KEY, raw);
  } catch {
    // Storage blocked; the in-memory copy keeps the session working.
  }
}

const PANEL_EDGE_GAP = 8;
// Default: right side, low enough to clear the cockpit command deck and the
// standard-mode top edge — the takeoff toolbar stays reachable mid-review.
const PANEL_DEFAULT_TOP = 112;

function CreditBalanceChip({ balance, loading }: { balance: number | null; loading: boolean }) {
  return (
    <Badge variant="outline" className="gap-1" data-testid="ai-credit-balance">
      <Coins className="h-3 w-3" />
      {loading || balance === null ? "…" : `${balance} credit${balance === 1 ? "" : "s"}`}
    </Badge>
  );
}

export function AiAssistPanel({ ai }: { ai: AiAssistController }) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const positionRef = useRef<PanelPosition | null>(null);
  const dragRef = useRef<{ pointerId: number; offsetX: number; offsetY: number } | null>(null);
  const [position, setPositionState] = useState<PanelPosition | null>(() =>
    readStoredPanelPosition(),
  );
  const [reviewExpanded, setReviewExpanded] = useState(false);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);

  const setPosition = useCallback((next: PanelPosition) => {
    positionRef.current = next;
    setPositionState(next);
  }, []);

  // Leaving review resets the pill expansion for the next review.
  useEffect(() => {
    if (ai.phase !== "review") setReviewExpanded(false);
  }, [ai.phase]);

  const clampToParent = useCallback((next: PanelPosition): PanelPosition => {
    const panel = panelRef.current;
    const parent = panel?.parentElement;
    if (!panel || !parent) return next;
    const parentRect = parent.getBoundingClientRect();
    const maxX = Math.max(PANEL_EDGE_GAP, parentRect.width - panel.offsetWidth - PANEL_EDGE_GAP);
    // Keep at least the header on screen vertically.
    const maxY = Math.max(PANEL_EDGE_GAP, parentRect.height - 56);
    return {
      x: Math.min(maxX, Math.max(PANEL_EDGE_GAP, next.x)),
      y: Math.min(maxY, Math.max(PANEL_EDGE_GAP, next.y)),
    };
  }, []);

  const onHeaderPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    // Buttons inside the header keep their own clicks.
    if ((event.target as HTMLElement).closest("button,input,select,textarea")) return;
    const panel = panelRef.current;
    const parent = panel?.parentElement;
    if (!panel || !parent) return;
    const panelRect = panel.getBoundingClientRect();
    const parentRect = parent.getBoundingClientRect();
    dragRef.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - panelRect.left,
      offsetY: event.clientY - panelRect.top,
    };
    // Anchor the default CSS position into explicit coordinates first.
    setPosition({ x: panelRect.left - parentRect.left, y: panelRect.top - parentRect.top });
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const onHeaderPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const panel = panelRef.current;
    const parent = panel?.parentElement;
    if (!panel || !parent) return;
    const parentRect = parent.getBoundingClientRect();
    setPosition(
      clampToParent({
        x: event.clientX - parentRect.left - drag.offsetX,
        y: event.clientY - parentRect.top - drag.offsetY,
      }),
    );
  };

  const onHeaderPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (positionRef.current) writeStoredPanelPosition(positionRef.current);
  };

  if (!ai.open) return null;

  const summary = ai.creditSummary;
  const balance = summary?.balanceCredits ?? null;
  const availability = aiAssistAvailability({
    configured: summary ? summary.aiAssistConfigured : true,
    hasExemplar: Boolean(ai.exemplar),
    balanceCredits: balance ?? 0,
    quoteCredits: ai.quoteCredits,
  });
  const schemaPending = Boolean(summary && !summary.schemaReady);
  const showBuyPanel = availability.state === "out_of_credits" && !schemaPending;
  const isSuperAdmin = Boolean(summary?.isSuperAdmin);

  const positionStyle = position
    ? { left: position.x, top: position.y }
    : { right: PANEL_EDGE_GAP + 4, top: PANEL_DEFAULT_TOP };

  const dragHandleProps = {
    onPointerDown: onHeaderPointerDown,
    onPointerMove: onHeaderPointerMove,
    onPointerUp: onHeaderPointerUp,
    onPointerCancel: onHeaderPointerUp,
  };

  // Review pill (Task 3): while the review bar owns the bottom edge, the
  // panel shrinks to a pill so the takeoff toolbar stays reachable.
  if (ai.phase === "review" && !reviewExpanded) {
    return (
      <div ref={panelRef} className="absolute" style={positionStyle} data-testid="ai-assist-pill">
        <button
          type="button"
          className="flex items-center gap-2 rounded-full border border-hairline bg-card/95 px-3 py-1.5 text-xs font-medium shadow-lg backdrop-blur"
          onClick={() => setReviewExpanded(true)}
          title="Expand the AI Assist panel"
        >
          <Sparkles className="h-3.5 w-3.5 text-amber-600" />
          Reviewing — {ai.pendingCount} left
          <ChevronsUpDown className="h-3 w-3 text-muted-foreground" />
        </button>
      </div>
    );
  }

  return (
    <div
      ref={panelRef}
      className="absolute w-[330px] max-w-[calc(100vw-2rem)] rounded-lg border border-hairline bg-card/95 shadow-2xl backdrop-blur"
      style={positionStyle}
      data-testid="ai-assist-panel"
    >
      <div
        className="flex cursor-grab touch-none items-center justify-between gap-2 rounded-t-lg border-b border-hairline bg-surface/80 px-3 py-2 active:cursor-grabbing"
        data-testid="ai-assist-panel-header"
        {...dragHandleProps}
      >
        <div className="flex items-center gap-1.5 text-sm font-semibold">
          <GripHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
          <Sparkles className="h-4 w-4 text-amber-600" />
          AI Assist
        </div>
        <div className="flex items-center gap-1.5">
          <CreditBalanceChip balance={balance} loading={ai.creditSummaryLoading} />
          {ai.phase === "review" && (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              title="Collapse to a pill while reviewing"
              onClick={() => setReviewExpanded(false)}
            >
              <ChevronsUpDown className="h-3.5 w-3.5" />
            </Button>
          )}
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            title="Close AI Assist"
            onClick={ai.closePanel}
            data-testid="ai-assist-close"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="p-3 pt-2">
        {summary && !summary.aiAssistConfigured ? (
          <div className="mt-1 rounded-md border border-hairline bg-surface px-3 py-4 text-sm">
            <p className="font-medium" data-testid="ai-assist-not-configured">
              {AI_ASSIST_NOT_CONFIGURED_MESSAGE}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              AI counting needs an Anthropic API key on the server before it can scan drawings. Ask
              your Overwatch admin to add ANTHROPIC_API_KEY.
            </p>
          </div>
        ) : schemaPending ? (
          <p className="mt-1 rounded-md border border-hairline bg-surface px-3 py-4 text-sm text-muted-foreground">
            AI credits are still being set up for this workspace. Check back after the next update.
          </p>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">{AI_ASSIST_FIRST_RUN_MESSAGE}</p>

            <Separator className="my-3" />

            <div className="space-y-2">
              <Label className="text-xs font-medium">Exemplar — the symbol to find</Label>
              {ai.exemplar ? (
                <div className="flex items-center justify-between gap-2 rounded-md border border-hairline bg-surface px-2 py-1.5">
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className="h-3 w-3 shrink-0 rounded-full"
                      style={{ backgroundColor: ai.exemplar.color }}
                    />
                    <span className="truncate text-sm" data-testid="ai-exemplar-label">
                      {ai.exemplar.label || "Count marker"}
                    </span>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs"
                    onClick={ai.clearExemplar}
                  >
                    Change
                  </Button>
                </div>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  variant={ai.pickingExemplar ? "default" : "outline"}
                  className="w-full gap-1.5"
                  onClick={() => ai.setPickingExemplar(!ai.pickingExemplar)}
                  data-testid="ai-pick-exemplar"
                >
                  <MousePointerClick className="h-3.5 w-3.5" />
                  {ai.pickingExemplar
                    ? "Now click one of your count markers…"
                    : "Pick one of your count markers"}
                </Button>
              )}
            </div>

            <div className="mt-3 space-y-2">
              <Label className="text-xs font-medium">Where to look</Label>
              <Select
                value={ai.scope}
                onValueChange={(value) => ai.setScope(value === "all" ? "all" : "sheet")}
              >
                <SelectTrigger className="h-8" data-testid="ai-scope-select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sheet">This sheet (1 credit)</SelectItem>
                  <SelectItem value="all">
                    All sheets ({ai.scope === "all" ? ai.targetSheetCount : "up to 30"} credits — 1
                    per sheet)
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <p
              className={cn(
                "mt-3 rounded-md px-2 py-1.5 text-xs",
                availability.state === "out_of_credits"
                  ? "bg-amber-50 text-amber-900"
                  : "bg-surface text-muted-foreground",
              )}
              data-testid="ai-assist-status"
            >
              {availability.message}
            </p>

            {ai.scanError && (
              <p className="mt-2 rounded-md bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
                {ai.scanError}
              </p>
            )}

            {ai.phase === "scanning" && ai.scanProgress ? (
              <div className="mt-3 space-y-2 rounded-md border border-hairline bg-surface px-3 py-2">
                <div className="flex items-center gap-2 text-sm">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Scanning sheet{" "}
                  {Math.min(ai.scanProgress.sheetsDone + 1, ai.scanProgress.sheetsTotal)} of{" "}
                  {ai.scanProgress.sheetsTotal}
                  {ai.scanProgress.currentSheetLabel
                    ? ` — ${ai.scanProgress.currentSheetLabel}`
                    : ""}
                </div>
                {/* The echo check (AITAKEOFF2): the model's own description of
                    the exemplar it received. A wrong line here means the crop
                    is corrupted — stop and open scan diagnostics. */}
                <p
                  className="rounded bg-amber-50 px-2 py-1 text-xs text-amber-900"
                  data-testid="ai-echo-line"
                >
                  Looking for:{" "}
                  {ai.scanProgress.exemplarDescription || "confirming the exemplar with the model…"}
                </p>
                {ai.scanProgress.references &&
                  (ai.scanProgress.references.extraPositives > 0 ||
                    ai.scanProgress.references.negatives > 0) && (
                    <p className="text-xs text-muted-foreground" data-testid="ai-reference-summary">
                      Using {ai.scanProgress.references.extraPositives} accepted match
                      {ai.scanProgress.references.extraPositives === 1 ? "" : "es"} and{" "}
                      {ai.scanProgress.references.negatives} rejection
                      {ai.scanProgress.references.negatives === 1 ? "" : "s"} as references.
                    </p>
                  )}
                {ai.scanProgress.verifying && ai.scanProgress.verifying.total > 0 && (
                  <p className="text-xs text-muted-foreground" data-testid="ai-verify-progress">
                    Double-checking possible match{" "}
                    {Math.min(ai.scanProgress.verifying.done + 1, ai.scanProgress.verifying.total)}{" "}
                    of {ai.scanProgress.verifying.total} up close…
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  {ai.scanProgress.found} match{ai.scanProgress.found === 1 ? "" : "es"} confirmed
                  so far.
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="w-full"
                  onClick={ai.cancelScan}
                >
                  Cancel scan (unused credits refund)
                </Button>
              </div>
            ) : ai.phase === "review" ? (
              <p className="mt-3 rounded-md border border-hairline bg-surface px-3 py-2 text-xs text-muted-foreground">
                Review is running on the canvas — accept or reject each ghost from the bar below.
              </p>
            ) : (
              <Button
                type="button"
                size="sm"
                className="mt-3 w-full gap-1.5"
                disabled={availability.state !== "ready" || ai.targetSheetCount === 0}
                onClick={() => void ai.runScan()}
                data-testid="ai-find-more"
              >
                <Sparkles className="h-3.5 w-3.5" />
                Find more like this
              </Button>
            )}

            {showBuyPanel && summary && (
              <div className="mt-3 space-y-2 rounded-md border border-amber-200 bg-amber-50/60 p-2">
                <p className="text-xs font-medium text-amber-900">Buy credits</p>
                {summary.packs.map((pack) => (
                  <Button
                    key={pack.id}
                    type="button"
                    size="sm"
                    variant="outline"
                    className="w-full justify-between"
                    disabled={ai.isPurchasing}
                    onClick={() => void ai.purchasePack(pack.id)}
                    data-testid={`ai-buy-pack-${pack.id}`}
                  >
                    <span>{pack.label}</span>
                    <span className="tabular-nums">
                      ${centsToDollars(pack.amountCents).toFixed(2)}
                    </span>
                  </Button>
                ))}
                <p className="text-[11px] text-amber-900/80">
                  Checkout opens in Stripe; credits land on your company the moment payment
                  completes.
                </p>
              </div>
            )}

            {isSuperAdmin && (
              <>
                <Separator className="my-3" />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="w-full gap-1.5"
                  onClick={() => setDiagnosticsOpen(true)}
                  data-testid="ai-open-diagnostics"
                >
                  <Microscope className="h-3.5 w-3.5" />
                  Scan diagnostics
                </Button>
              </>
            )}
          </>
        )}
      </div>

      {isSuperAdmin && (
        <AiScanDiagnosticsDialog
          open={diagnosticsOpen}
          onOpenChange={setDiagnosticsOpen}
          defaultOperationId={ai.lastOperationId}
        />
      )}
    </div>
  );
}
