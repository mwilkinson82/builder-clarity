import { useState } from "react";
import { CheckCircle2, ClipboardCheck, History } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ProductionSovCertificationRow } from "@/lib/production-forecast.functions";

interface CertificationBucket {
  id: string;
  cost_code: string;
  bucket: string;
}

interface CertificationHistoryPanelProps {
  certifications: ProductionSovCertificationRow[];
  buckets: CertificationBucket[];
  isLoading?: boolean;
}

const RECENT_CERTIFICATION_LIMIT = 5;

function dateOnly(value: string | null): string {
  if (!value) return "Not recorded";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function dateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || "Not recorded";
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function percent(value: number): string {
  return `${value.toFixed(1)}%`;
}

function pace(value: number | null, unit: string): string {
  if (value == null) return "Not captured";
  return `${value.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${unit || "units"}/workday`;
}

export function CertificationHistoryPanel({
  certifications,
  buckets,
  isLoading = false,
}: CertificationHistoryPanelProps) {
  const [showAll, setShowAll] = useState(false);
  const bucketById = new Map(buckets.map((bucket) => [bucket.id, bucket]));
  const latestValidCertificationIds = new Set<string>();
  const seenValidBuckets = new Set<string>();
  for (const certification of certifications) {
    if (certification.invalidated_at || seenValidBuckets.has(certification.cost_bucket_id))
      continue;
    seenValidBuckets.add(certification.cost_bucket_id);
    latestValidCertificationIds.add(certification.id);
  }
  const visibleCertifications = showAll
    ? certifications
    : certifications.slice(0, RECENT_CERTIFICATION_LIMIT);

  return (
    <div className="border-t border-hairline px-5 py-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="eyebrow flex items-center gap-2">
            <History className="h-3.5 w-3.5" /> Certification history
          </div>
          <h3 className="mt-1 font-serif text-xl font-normal text-foreground">
            Every PM billing-position decision, preserved
          </h3>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            The record keeps the billing SOV at review time, the PM-reviewed WIP recommendation, the
            certified position, and the reason for any difference. Certification never changes
            Billing or creates a pay application.
          </p>
        </div>
        {certifications.length > 0 ? (
          <Badge variant="outline" className="gap-1.5 border-success/30 text-success">
            <ClipboardCheck className="h-3.5 w-3.5" /> {certifications.length} certified
          </Badge>
        ) : null}
      </div>

      {isLoading ? (
        <div className="mt-4 rounded-lg border border-dashed border-hairline px-4 py-6 text-sm text-muted-foreground">
          Loading certification history…
        </div>
      ) : certifications.length === 0 ? (
        <div className="mt-4 rounded-lg border border-dashed border-hairline px-4 py-6">
          <div className="font-semibold text-foreground">No SOV positions certified yet</div>
          <p className="mt-1 text-sm text-muted-foreground">
            After a PM certifies a reviewed WIP recommendation, the complete decision record will
            appear here newest first.
          </p>
        </div>
      ) : (
        <div className="mt-4 divide-y divide-hairline rounded-lg border border-hairline">
          {visibleCertifications.map((certification) => {
            const bucket = bucketById.get(certification.cost_bucket_id);
            const isLatest = latestValidCertificationIds.has(certification.id);
            return (
              <article key={certification.id} className="px-4 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="font-semibold text-foreground">
                        {[bucket?.cost_code, bucket?.bucket].filter(Boolean).join(" · ") ||
                          "Cost-coded scope"}
                      </h4>
                      {isLatest ? (
                        <Badge variant="outline" className="border-success/30 text-success">
                          <CheckCircle2 className="mr-1 h-3 w-3" /> Latest
                        </Badge>
                      ) : null}
                      {certification.invalidated_at ? (
                        <Badge variant="outline" className="border-danger/30 text-danger">
                          Invalidated
                        </Badge>
                      ) : null}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      Certified {dateTime(certification.certified_at)} by{" "}
                      <span className="font-medium text-foreground">
                        {certification.certified_by_name || "Project manager"}
                      </span>
                    </div>
                  </div>
                  <div className="font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                    Evidence {dateOnly(certification.source_period_start)} –{" "}
                    {dateOnly(certification.source_period_end)}
                  </div>
                </div>

                {certification.invalidated_at ? (
                  <div className="mt-3 rounded-md border border-danger/30 bg-danger/10 px-3 py-2.5">
                    <div className="font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-danger">
                      Not eligible for Billing
                    </div>
                    <p className="mt-1 text-sm leading-relaxed text-foreground">
                      {certification.invalidation_reason_detail ||
                        "The reviewed Daily WIP evidence is no longer current. Create a new certification from the latest review."}
                    </p>
                  </div>
                ) : null}

                <div className="mt-4 grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-hairline bg-hairline sm:grid-cols-3">
                  <div className="bg-surface px-3 py-3">
                    <div className="font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                      Billing SOV at review
                    </div>
                    <div className="mt-1 font-serif text-xl tabular-nums text-foreground">
                      {percent(certification.current_sov_percent)}
                    </div>
                  </div>
                  <div className="bg-surface px-3 py-3">
                    <div className="font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                      Reviewed WIP recommends
                    </div>
                    <div className="mt-1 font-serif text-xl tabular-nums text-foreground">
                      {percent(certification.recommended_percent)}
                    </div>
                  </div>
                  <div className="bg-muted/30 px-3 py-3">
                    <div className="font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                      PM certified
                    </div>
                    <div className="mt-1 font-serif text-xl tabular-nums text-foreground">
                      {percent(certification.certified_percent)}
                    </div>
                  </div>
                </div>

                <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
                  <div className="rounded-md bg-muted/30 px-3 py-2.5">
                    <div className="font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                      PM decision note
                    </div>
                    <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                      {certification.certification_note || "No adjustment note recorded."}
                    </p>
                  </div>
                  <div className="grid gap-1 text-xs text-muted-foreground lg:min-w-[250px] lg:text-right">
                    <span>
                      Recent pace: {pace(certification.recent_daily_pace, certification.unit)}
                    </span>
                    <span>
                      Required pace: {pace(certification.required_daily_pace, certification.unit)}
                    </span>
                    <span>Billing target: {dateOnly(certification.target_date)}</span>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {certifications.length > RECENT_CERTIFICATION_LIMIT ? (
        <div className="mt-3 flex justify-end">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setShowAll((value) => !value)}
          >
            {showAll
              ? `Show recent ${RECENT_CERTIFICATION_LIMIT}`
              : `Show all ${certifications.length} certifications`}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
