import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import {
  ArrowRight,
  BookOpenCheck,
  FileSearch,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getPlanScopeBrief } from "@/lib/plan-scope-brief.functions";
import {
  PLAN_SCOPE_BRIEF_REVIEW_KINDS,
  type PlanScopeBriefItem,
  type PlanScopeBriefReviewKind,
} from "@/lib/plan-scope-brief";
import type { PlanSetRow } from "@/lib/plan-room.functions";

type BriefFilter = "all" | PlanScopeBriefReviewKind;

const generatedDate = (value: string) => {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Brief recorded";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
};

const reviewKindLabel = (value: PlanScopeBriefReviewKind) => {
  if (value === "count") return "Count review";
  if (value === "linear") return "Length review";
  if (value === "area") return "Area review";
  if (value === "assembly") return "Assembly review";
  if (value === "allowance") return "Pricing / allowance";
  return "Scope coordination";
};

export function PlanScopeBriefPanel({
  estimateId,
  planSet,
  pending,
  progress,
  evidencePending,
  onGenerate,
  onOpenEvidence,
}: {
  estimateId: string;
  planSet: PlanSetRow | null;
  pending: boolean;
  progress: string;
  evidencePending: boolean;
  onGenerate: () => void;
  onOpenEvidence: (item: PlanScopeBriefItem) => void;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<BriefFilter>("all");
  const getBriefFn = useServerFn(getPlanScopeBrief);
  const briefQuery = useQuery({
    queryKey: ["plan-scope-brief", estimateId, planSet?.id],
    queryFn: () =>
      getBriefFn({ data: { estimate_id: estimateId, plan_set_id: planSet?.id ?? "" } }),
    enabled: Boolean(planSet?.id),
  });
  const brief = briefQuery.data?.brief ?? null;
  const filteredItems = useMemo(
    () => (brief?.items ?? []).filter((item) => filter === "all" || item.review_kind === filter),
    [brief?.items, filter],
  );
  const groupedItems = useMemo(() => {
    const groups = new Map<string, PlanScopeBriefItem[]>();
    for (const item of filteredItems) {
      const current = groups.get(item.trade) ?? [];
      current.push(item);
      groups.set(item.trade, current);
    }
    return [...groups.entries()];
  }, [filteredItems]);

  return (
    <>
      <section
        className="rounded-lg border border-hairline bg-card p-4 shadow-card"
        data-testid="plan-scope-brief-launcher"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="eyebrow flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5" /> AI estimator briefing
            </div>
            <h2 className="mt-1 font-serif text-xl">Estimator Scope Brief</h2>
          </div>
          <Badge variant="outline">
            {brief ? `${brief.items.length} cited` : briefQuery.isLoading ? "Loading" : "Not built"}
          </Badge>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Reads selectable plan notes across this set and organizes cited scope for estimator
          review. It does not take off, measure, price, or certify completeness.
        </p>

        {brief ? (
          <div className="mt-3 grid grid-cols-3 gap-2 border-y border-hairline py-2 text-center">
            <div className="border-r border-hairline px-1">
              <p className="font-serif text-lg text-foreground">{brief.items.length}</p>
              <p className="text-[10px] text-muted-foreground">scope prompts</p>
            </div>
            <div className="border-r border-hairline px-1">
              <p className="font-serif text-lg text-foreground">{brief.cited_sheet_count}</p>
              <p className="text-[10px] text-muted-foreground">cited sheets</p>
            </div>
            <div className="px-1">
              <p className="font-serif text-lg text-foreground">
                {brief.source_sheet_count}/{brief.total_sheet_count}
              </p>
              <p className="text-[10px] text-muted-foreground">note evidence</p>
            </div>
          </div>
        ) : null}

        {briefQuery.data?.ready === false ? (
          <p className="mt-3 text-xs text-warning">
            Scope Brief audit history is waiting for its Lovable migration.
          </p>
        ) : null}
        {pending && progress ? (
          <p className="mt-3 text-xs text-muted-foreground">{progress}</p>
        ) : null}

        <div className="mt-3 grid gap-2">
          {brief ? (
            <Button
              type="button"
              variant="outline"
              className="gap-1.5"
              onClick={() => setOpen(true)}
            >
              <BookOpenCheck className="h-4 w-4" /> Open cited brief
            </Button>
          ) : null}
          <Button
            type="button"
            variant={brief ? "ghost" : "outline"}
            className="gap-1.5"
            disabled={!planSet || pending}
            onClick={onGenerate}
          >
            <RefreshCw className={`h-4 w-4 ${pending ? "animate-spin" : ""}`} />
            {pending
              ? "Building cited brief…"
              : brief
                ? "Refresh brief · 2 credits"
                : "Build brief · 2 credits"}
          </Button>
        </div>
        <p className="mt-2 text-[10px] text-muted-foreground">
          One plan-set brief = 2 credits. Platform admins are unmetered.
        </p>
      </section>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[88vh] max-w-6xl overflow-hidden p-0">
          <DialogHeader className="border-b border-hairline px-6 py-5">
            <div className="eyebrow flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5" /> Estimator-controlled cited brief
            </div>
            <DialogTitle className="font-serif text-2xl">Estimator Scope Brief</DialogTitle>
            <DialogDescription>
              {planSet?.name || planSet?.source_file_name || "Current drawing set"}. AI organized
              cited review prompts; it did not measure, count, infer assemblies, price, or verify
              that the set is complete.
            </DialogDescription>
          </DialogHeader>

          <div className="overflow-y-auto px-6 py-5">
            {brief ? (
              <>
                <div className="grid gap-px overflow-hidden rounded-lg border border-hairline bg-hairline sm:grid-cols-4">
                  {[
                    ["Cited prompts", String(brief.items.length)],
                    ["Cited sheets", String(brief.cited_sheet_count)],
                    ["Note evidence", `${brief.source_sheet_count} / ${brief.total_sheet_count}`],
                    ["Generated", generatedDate(brief.generated_at)],
                  ].map(([label, value]) => (
                    <div key={label} className="bg-card px-4 py-3">
                      <p className="eyebrow">{label}</p>
                      <p className="mt-1 text-sm font-medium text-foreground">{value}</p>
                    </div>
                  ))}
                </div>

                <div className="mt-4 flex flex-wrap gap-1.5" aria-label="Scope brief filters">
                  <Button
                    type="button"
                    size="sm"
                    variant={filter === "all" ? "secondary" : "ghost"}
                    className="h-8 text-xs"
                    onClick={() => setFilter("all")}
                  >
                    All {brief.items.length}
                  </Button>
                  {PLAN_SCOPE_BRIEF_REVIEW_KINDS.map((kind) => {
                    const count = brief.items.filter((item) => item.review_kind === kind).length;
                    if (count === 0) return null;
                    return (
                      <Button
                        key={kind}
                        type="button"
                        size="sm"
                        variant={filter === kind ? "secondary" : "ghost"}
                        className="h-8 text-xs"
                        onClick={() => setFilter(kind)}
                      >
                        {reviewKindLabel(kind)} {count}
                      </Button>
                    );
                  })}
                </div>

                {brief.warnings.length > 0 ? (
                  <div className="mt-4 rounded-md border border-warning/30 bg-warning/10 px-4 py-3 text-xs text-warning">
                    {brief.warnings.map((warning) => (
                      <p key={warning}>{warning}</p>
                    ))}
                  </div>
                ) : null}

                {groupedItems.length === 0 ? (
                  <div className="mt-4 rounded-md border border-dashed border-hairline p-4 text-sm text-muted-foreground">
                    No cited prompts match this filter.
                  </div>
                ) : (
                  <div className="mt-5 space-y-5" data-testid="plan-scope-brief-items">
                    {groupedItems.map(([trade, items]) => (
                      <section key={trade}>
                        <div className="mb-2 flex items-center justify-between gap-3">
                          <h3 className="font-serif text-lg">{trade}</h3>
                          <Badge variant="outline">{items.length} prompts</Badge>
                        </div>
                        <div className="divide-y divide-hairline overflow-hidden rounded-lg border border-hairline">
                          {items.map((item) => (
                            <div
                              key={item.id}
                              className="grid gap-3 bg-card px-4 py-3 lg:grid-cols-[minmax(0,1fr)_170px] lg:items-start"
                            >
                              <div>
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <span className="text-sm font-medium text-foreground">
                                    {item.scope_label}
                                  </span>
                                  <Badge variant="secondary">
                                    {reviewKindLabel(item.review_kind)}
                                  </Badge>
                                </div>
                                <p className="mt-1 text-[11px] text-muted-foreground">
                                  {item.sheet_number || "Unnumbered"} · {item.source_line} · “
                                  {item.source_excerpt}”
                                </p>
                                <p className="mt-2 text-xs text-foreground">
                                  {item.estimator_prompt}
                                </p>
                              </div>
                              <div className="flex justify-start lg:justify-end">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  className="gap-1.5"
                                  disabled={evidencePending}
                                  onClick={() => onOpenEvidence(item)}
                                >
                                  <FileSearch className="h-3.5 w-3.5" /> Open cited sheet
                                  <ArrowRight className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </section>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div className="rounded-md border border-dashed border-hairline p-4 text-sm text-muted-foreground">
                Build the brief from the Plan Room to create a cited estimator checklist.
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
