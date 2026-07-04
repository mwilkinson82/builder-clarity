// AI Assist panel (AITAKEOFF1 Task 3).
// Suggest, never force: the estimator counts one symbol, the model finds the
// rest, and every match still needs a human accept. Credit balance and cost
// stay visible the whole time; out of credits routes into the buy panel.

import { Coins, Loader2, MousePointerClick, Sparkles, X } from "lucide-react";
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
import type { AiAssistController } from "./useAiAssist";

function CreditBalanceChip({ balance, loading }: { balance: number | null; loading: boolean }) {
  return (
    <Badge variant="outline" className="gap-1" data-testid="ai-credit-balance">
      <Coins className="h-3 w-3" />
      {loading || balance === null ? "…" : `${balance} credit${balance === 1 ? "" : "s"}`}
    </Badge>
  );
}

export function AiAssistPanel({ ai }: { ai: AiAssistController }) {
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

  return (
    <div
      className="w-[330px] max-w-[calc(100vw-2rem)] rounded-lg border border-hairline bg-card/95 p-3 shadow-2xl backdrop-blur"
      data-testid="ai-assist-panel"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-sm font-semibold">
          <Sparkles className="h-4 w-4 text-amber-600" />
          AI Assist
        </div>
        <div className="flex items-center gap-1.5">
          <CreditBalanceChip balance={balance} loading={ai.creditSummaryLoading} />
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

      {summary && !summary.aiAssistConfigured ? (
        <div className="mt-3 rounded-md border border-hairline bg-surface px-3 py-4 text-sm">
          <p className="font-medium" data-testid="ai-assist-not-configured">
            {AI_ASSIST_NOT_CONFIGURED_MESSAGE}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            AI counting needs an Anthropic API key on the server before it can scan drawings. Ask
            your Overwatch admin to add ANTHROPIC_API_KEY.
          </p>
        </div>
      ) : schemaPending ? (
        <p className="mt-3 rounded-md border border-hairline bg-surface px-3 py-4 text-sm text-muted-foreground">
          AI credits are still being set up for this workspace. Check back after the next update.
        </p>
      ) : (
        <>
          <p className="mt-2 text-xs text-muted-foreground">{AI_ASSIST_FIRST_RUN_MESSAGE}</p>

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
                {ai.scanProgress.currentSheetLabel ? ` — ${ai.scanProgress.currentSheetLabel}` : ""}
              </div>
              <p className="text-xs text-muted-foreground">
                {ai.scanProgress.found} match{ai.scanProgress.found === 1 ? "" : "es"} found so far.
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
                Checkout opens in Stripe; credits land on your company the moment payment completes.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
