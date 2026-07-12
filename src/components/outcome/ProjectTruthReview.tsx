import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listSchedule } from "@/lib/schedule.functions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MoneyInput } from "@/components/ui/money-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ClipboardCheck,
  ChevronLeft,
  ChevronRight,
  Target,
  RefreshCw,
  ArrowLeftRight,
  CheckCircle2,
} from "lucide-react";
import { fmtUSD } from "@/lib/format";
import type {
  ProjectRow,
  ExposureRow,
  ChangeOrderRow,
  BucketRow,
  DecisionRow,
} from "@/lib/projects.functions";
import {
  remainingExposureValue,
  type ExposureCategory,
  type HoldClass,
  type ResponsePath,
  type Rollup,
} from "@/lib/ior";
import { generateIorPdf, downloadPdfBytes, type IorPdfStyle } from "@/lib/ior-pdf";

const RESPONSE_META: Record<ResponsePath, { label: string; icon: typeof Target; meaning: string }> =
  {
    eliminate: {
      label: "Eliminate",
      icon: Target,
      meaning: "Remove the risk entirely (scope cut, redesign, swap subcontractor).",
    },
    recover: {
      label: "Recover",
      icon: RefreshCw,
      meaning: "Earn it back — submit a CO, recover schedule, push for owner approval.",
    },
    offset: {
      label: "Offset",
      icon: ArrowLeftRight,
      meaning: "Fund it from another bucket, contingency, or buyout savings.",
    },
    accept: {
      label: "Accept",
      icon: CheckCircle2,
      meaning: "Book the loss and protect the rest. Last resort.",
    },
  };

const CATEGORY_LABELS: Record<ExposureCategory, string> = {
  owner_decision: "Owner decision",
  design_drift: "Design drift",
  trade_performance: "Trade performance",
  procurement: "Procurement",
  schedule_compression: "Schedule compression",
  allowance_overrun: "Allowance overrun",
  field_change: "Field change",
  closeout_punch: "Closeout / punch",
  other: "Other",
};

type NewExposure = {
  title: string;
  description: string;
  category: ExposureCategory;
  dollar_exposure: number;
  probability: number;
  owner: string;
  response_path: ResponsePath | null;
  hold_class: HoldClass;
};

type ResolutionUpdate = { id: string; status: ExposureRow["status"]; note: string };

const STEPS = [
  {
    key: "schedule",
    title: "Schedule",
    q: "Did the forecasted completion date move since last review?",
  },
  {
    key: "new_exposure",
    title: "New risk dollars",
    q: "Did any owner decision, design change, trade issue, or procurement slip create new probable cost?",
  },
  {
    key: "treatment",
    title: "Treatment paths",
    q: "For every active exposure, confirm the treatment path. This is the spine of the report.",
  },
  {
    key: "co_updates",
    title: "Change orders",
    q: "Did any pending CO become more or less likely?",
  },
  {
    key: "resolutions",
    title: "Resolutions",
    q: "Did any active exposure get recovered, eliminated, or formally accepted?",
  },
  {
    key: "decisions",
    title: "Required decisions",
    q: "What are the top decisions required to protect margin this cycle?",
  },
  {
    key: "narrative",
    title: "Narrative",
    q: "Write the executive summary — the story the PM will tell in the meeting.",
  },
] as const;

export function ProjectTruthReview({
  project,
  exposures,
  changeOrders,
  buckets,
  decisions,
  rollup,
  onSubmit,
  pending,
}: {
  project: ProjectRow;
  exposures: ExposureRow[];
  changeOrders: ChangeOrderRow[];
  buckets: BucketRow[];
  decisions: DecisionRow[];
  rollup: Rollup;
  onSubmit: (input: {
    reviewer: string;
    forecast_completion_date_before: string | null;
    forecast_completion_date_after: string | null;
    summary_notes: string;
    body_markdown: string;
    pdf_style: IorPdfStyle;
    kpi_snapshot: Record<string, number | string>;
    newExposures: NewExposure[];
    resolutionUpdates: ResolutionUpdate[];
    pdfBytes: Uint8Array;
  }) => void;
  pending?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [reviewer, setReviewer] = useState("PM");
  const [forecastDate, setForecastDate] = useState<string>(project.forecast_completion_date ?? "");
  const [scheduleNote, setScheduleNote] = useState("");
  const [pdfStyle, setPdfStyle] = useState<IorPdfStyle>("executive");
  const [narrative, setNarrative] = useState("");

  const listScheduleFn = useServerFn(listSchedule);
  const { data: scheduleData } = useQuery({
    queryKey: ["schedule", project.id],
    queryFn: () => listScheduleFn({ data: { projectId: project.id } }),
  });

  // New exposures captured in step 2
  const [newExposures, setNewExposures] = useState<NewExposure[]>([]);
  const [draftExp, setDraftExp] = useState<NewExposure>({
    title: "",
    description: "",
    category: "other",
    dollar_exposure: 0,
    probability: 75,
    owner: "",
    response_path: null,
    hold_class: "E-Hold",
  });
  const [draftErr, setDraftErr] = useState<string | null>(null);

  // Step 3: treatment path overrides for *all* active exposures (existing + new)
  const activeExisting = useMemo(
    () => exposures.filter((e) => remainingExposureValue(e) > 0),
    [exposures],
  );
  const [treatmentOverrides, setTreatmentOverrides] = useState<Record<string, ResponsePath>>({});

  // Step 5: resolutions
  const [resolutions, setResolutions] = useState<Record<string, ResolutionUpdate>>({});

  const reset = () => {
    setStep(0);
    setReviewer("PM");
    setForecastDate(project.forecast_completion_date ?? "");
    setScheduleNote("");
    setPdfStyle("executive");
    setNarrative("");
    setNewExposures([]);
    setDraftExp({
      title: "",
      description: "",
      category: "other",
      dollar_exposure: 0,
      probability: 75,
      owner: "",
      response_path: null,
      hold_class: "E-Hold",
    });
    setDraftErr(null);
    setTreatmentOverrides({});
    setResolutions({});
  };

  const addDraftExposure = () => {
    if (!draftExp.title.trim()) {
      setDraftErr("Title is required.");
      return;
    }
    if (!(draftExp.dollar_exposure > 0)) {
      setDraftErr(
        "Dollar exposure must be greater than zero — that is the whole point of the register.",
      );
      return;
    }
    if (!draftExp.response_path) {
      setDraftErr("Pick a treatment path before saving.");
      return;
    }
    setDraftErr(null);
    setNewExposures([...newExposures, draftExp]);
    setDraftExp({
      title: "",
      description: "",
      category: "other",
      dollar_exposure: 0,
      probability: 75,
      owner: "",
      response_path: null,
      hold_class: "E-Hold",
    });
  };

  // Validation for step 3 (treatment): every active exposure (existing + new) has a path
  const allTreatedItems = useMemo(() => {
    const items: { key: string; title: string; current: ResponsePath; isNew: boolean }[] = [];
    activeExisting.forEach((e) =>
      items.push({
        key: e.id,
        title: e.title,
        current: treatmentOverrides[e.id] ?? e.response_path,
        isNew: false,
      }),
    );
    newExposures.forEach((e, i) =>
      items.push({
        key: `new-${i}`,
        title: e.title,
        current: e.response_path ?? "recover",
        isNew: true,
      }),
    );
    return items;
  }, [activeExisting, newExposures, treatmentOverrides]);

  const canAdvance = (): boolean => {
    const key = STEPS[step].key;
    if (key === "schedule") return true;
    if (key === "new_exposure") return true;
    if (key === "treatment") {
      // every item must have a treatment path — they always do here, but force confirmation toggle
      return allTreatedItems.every((it) => !!it.current);
    }
    if (key === "narrative") return narrative.trim().length > 20;
    return true;
  };

  const submit = async () => {
    const summary = [
      scheduleNote && `Schedule: ${scheduleNote}`,
      newExposures.length > 0 &&
        `${newExposures.length} new exposure${newExposures.length === 1 ? "" : "s"} logged`,
      Object.keys(treatmentOverrides).length > 0 &&
        `${Object.keys(treatmentOverrides).length} treatment path${Object.keys(treatmentOverrides).length === 1 ? "" : "s"} updated`,
      Object.keys(resolutions).length > 0 &&
        `${Object.keys(resolutions).length} exposure${Object.keys(resolutions).length === 1 ? "" : "s"} resolved`,
    ]
      .filter(Boolean)
      .join(" · ");

    const kpiSnapshot = {
      originalGP: rollup.originalGP,
      originalGPpct: rollup.originalGPpct,
      indicatedGP: rollup.indicatedGP,
      indicatedGPpct: rollup.indicatedGPpct,
      gpAtRisk: rollup.gpAtRisk,
      exposureHolds: rollup.exposureHolds,
      contingencyHold: rollup.contingencyHold,
      forecastedFinalContract: rollup.forecastedFinalContract,
      forecastedFinalCost: rollup.forecastedFinalCost,
    };

    // Generate PDF NOW for the historical record + immediate download
    const pdfBytes = await generateIorPdf(
      {
        project: {
          ...project,
          forecast_completion_date: forecastDate || project.forecast_completion_date,
        },
        rollup,
        exposures,
        changeOrders,
        buckets,
        decisions,
        reviews: [],
        milestones: scheduleData?.milestones ?? [],
        scheduleRisks: scheduleData?.risks ?? [],
        narrative,
        generatedAt: new Date(),
      },
      pdfStyle,
    );

    onSubmit({
      reviewer,
      forecast_completion_date_before: project.forecast_completion_date,
      forecast_completion_date_after: forecastDate || null,
      summary_notes: summary,
      body_markdown: narrative,
      pdf_style: pdfStyle,
      kpi_snapshot: kpiSnapshot,
      newExposures,
      resolutionUpdates: Object.values(resolutions),
      pdfBytes,
    });

    downloadPdfBytes(
      pdfBytes,
      `IOR_${project.name.replace(/\s+/g, "_")}_${new Date().toISOString().slice(0, 10)}.pdf`,
    );
    setOpen(false);
    reset();
  };

  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;

  const liveRoll = rollup;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) reset();
      }}
    >
      <Button onClick={() => setOpen(true)} className="gap-1.5">
        <ClipboardCheck className="h-4 w-4" /> Create IOR Report
      </Button>

      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="eyebrow">Weekly IOR review</div>
          <DialogTitle className="font-serif text-2xl font-normal">Create IOR Report</DialogTitle>
        </DialogHeader>

        <div className="mb-2 mt-1 flex items-center gap-1">
          {STEPS.map((s, i) => (
            <div
              key={s.key}
              className={`h-1 flex-1 rounded-full ${i <= step ? "bg-accent" : "bg-secondary"}`}
            />
          ))}
        </div>
        <div className="flex items-center justify-between font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
          <span>
            Step {step + 1} of {STEPS.length} · {current.title}
          </span>
          <span className="tabular">
            Indicated GP {fmtUSD(liveRoll.indicatedGP)} · GP at risk {fmtUSD(liveRoll.gpAtRisk)}
          </span>
        </div>

        <div className="space-y-5 py-4">
          <p className="font-serif text-xl leading-snug text-foreground">{current.q}</p>

          {current.key === "schedule" && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Baseline completion</Label>
                  <Input
                    value={
                      project.baseline_completion_date
                        ? new Date(project.baseline_completion_date).toLocaleDateString()
                        : "—"
                    }
                    disabled
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Forecasted completion</Label>
                  <Input
                    type="date"
                    value={forecastDate}
                    onChange={(e) => setForecastDate(e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Schedule movement</Label>
                <Textarea
                  rows={3}
                  value={scheduleNote}
                  onChange={(e) => setScheduleNote(e.target.value)}
                  placeholder="Owner allowance decision pushed cabinetry release 3 weeks."
                />
              </div>
            </div>
          )}

          {current.key === "new_exposure" && (
            <div className="space-y-4">
              {newExposures.length > 0 && (
                <div className="rounded-md border border-hairline">
                  <table className="w-full text-xs">
                    <thead className="bg-surface text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 text-left">Logged this cycle</th>
                        <th className="px-3 py-2 text-right">$</th>
                        <th className="px-3 py-2 text-right">Prob</th>
                        <th className="px-3 py-2 text-left">Path</th>
                      </tr>
                    </thead>
                    <tbody>
                      {newExposures.map((e, i) => (
                        <tr key={i} className="border-t border-hairline">
                          <td className="px-3 py-2 font-medium">{e.title}</td>
                          <td className="px-3 py-2 text-right tabular">
                            {fmtUSD(e.dollar_exposure)}
                          </td>
                          <td className="px-3 py-2 text-right text-muted-foreground">
                            {e.probability}%
                          </td>
                          <td className="px-3 py-2 text-accent">
                            {e.response_path ? RESPONSE_META[e.response_path].label : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="rounded-lg border border-hairline bg-surface p-4 space-y-3">
                <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                  Add an exposure
                </div>
                <Input
                  placeholder="Title (e.g., Custom range hood lead time slipped)"
                  value={draftExp.title}
                  onChange={(e) => setDraftExp({ ...draftExp, title: e.target.value })}
                />
                <Textarea
                  rows={2}
                  placeholder="What changed and what is the probable dollar consequence if nothing else changes?"
                  value={draftExp.description}
                  onChange={(e) => setDraftExp({ ...draftExp, description: e.target.value })}
                />
                <div className="grid grid-cols-3 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Category</Label>
                    <Select
                      value={draftExp.category}
                      onValueChange={(v) =>
                        setDraftExp({ ...draftExp, category: v as ExposureCategory })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(Object.keys(CATEGORY_LABELS) as ExposureCategory[]).map((k) => (
                          <SelectItem key={k} value={k}>
                            {CATEGORY_LABELS[k]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-danger">$ exposure *</Label>
                    <MoneyInput
                      value={draftExp.dollar_exposure}
                      onValueChange={(v) => setDraftExp({ ...draftExp, dollar_exposure: v })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Probability %</Label>
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      value={draftExp.probability}
                      onChange={(e) =>
                        setDraftExp({ ...draftExp, probability: Number(e.target.value) })
                      }
                    />
                  </div>
                </div>
                <TreatmentPicker
                  value={draftExp.response_path}
                  onChange={(v) => setDraftExp({ ...draftExp, response_path: v })}
                />
                {draftErr && <p className="text-xs text-danger">{draftErr}</p>}
                <Button variant="outline" size="sm" onClick={addDraftExposure}>
                  Save exposure
                </Button>
              </div>
            </div>
          )}

          {current.key === "treatment" && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Treatment path is the spine of the report. Every dollar of exposure has a path —
                eliminate, recover, offset, or accept.
              </p>
              {allTreatedItems.length === 0 && (
                <p className="rounded-md border border-hairline bg-surface px-3 py-4 text-sm text-muted-foreground">
                  No active exposures. The next time risk surfaces, log it here.
                </p>
              )}
              {allTreatedItems.map((it) => (
                <div key={it.key} className="rounded-lg border border-hairline bg-surface p-3.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="text-sm font-semibold">{it.title}</div>
                    {it.isNew && (
                      <span className="rounded-sm bg-accent/15 px-1.5 py-0.5 text-[10px] font-medium uppercase text-accent">
                        new
                      </span>
                    )}
                  </div>
                  <div className="mt-2">
                    <TreatmentPicker
                      value={it.current}
                      onChange={(v) => {
                        if (it.isNew) {
                          const idx = Number(it.key.replace("new-", ""));
                          setNewExposures(
                            newExposures.map((e, i) =>
                              i === idx ? { ...e, response_path: v } : e,
                            ),
                          );
                        } else {
                          setTreatmentOverrides({ ...treatmentOverrides, [it.key]: v! });
                        }
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}

          {current.key === "co_updates" && (
            <div className="space-y-2">
              {changeOrders.filter((c) => c.status === "Pending").length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No pending change orders. Update probabilities later from the Change Orders tab if
                  anything moves.
                </p>
              ) : (
                <ul className="rounded-md border border-hairline bg-surface">
                  {changeOrders
                    .filter((c) => c.status === "Pending")
                    .map((c) => (
                      <li
                        key={c.id}
                        className="flex items-baseline justify-between border-b border-hairline px-3 py-2 last:border-0 text-sm"
                      >
                        <div>
                          <span className="font-mono text-xs text-muted-foreground">
                            {c.number}
                          </span>{" "}
                          {c.description}
                        </div>
                        <div className="tabular text-muted-foreground">
                          {fmtUSD(c.contract_amount)} · {c.probability}%
                        </div>
                      </li>
                    ))}
                </ul>
              )}
              <p className="text-xs text-muted-foreground">
                Adjust probabilities directly on the Change Orders tab after this review.
              </p>
            </div>
          )}

          {current.key === "resolutions" && (
            <div className="space-y-3">
              {activeExisting.length === 0 ? (
                <p className="text-sm text-muted-foreground">No active exposures to resolve.</p>
              ) : (
                activeExisting.map((e) => {
                  const r = resolutions[e.id];
                  return (
                    <div key={e.id} className="rounded-md border border-hairline bg-surface p-3">
                      <div className="flex items-baseline justify-between">
                        <div className="text-sm font-medium">{e.title}</div>
                        <div className="text-xs tabular text-muted-foreground">
                          {fmtUSD(e.dollar_exposure)} · {e.probability}%
                        </div>
                      </div>
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        <Select
                          value={r?.status ?? e.status}
                          onValueChange={(v) =>
                            setResolutions({
                              ...resolutions,
                              [e.id]: {
                                id: e.id,
                                status: v as ExposureRow["status"],
                                note: r?.note ?? "",
                              },
                            })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="active">Still active</SelectItem>
                            <SelectItem value="recovered">Recovered</SelectItem>
                            <SelectItem value="eliminated">Eliminated</SelectItem>
                            <SelectItem value="accepted">Accepted (booked)</SelectItem>
                            <SelectItem value="released">Released</SelectItem>
                          </SelectContent>
                        </Select>
                        <Input
                          placeholder="One-line note (CO approved, scope cut, etc.)"
                          value={r?.note ?? ""}
                          onChange={(ev) =>
                            setResolutions({
                              ...resolutions,
                              [e.id]: {
                                id: e.id,
                                status: r?.status ?? e.status,
                                note: ev.target.value,
                              },
                            })
                          }
                        />
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}

          {current.key === "decisions" && (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                Open decisions show on the Decisions tab. Make sure each unresolved exposure has a
                decision owner and due date.
              </p>
              {decisions.filter((d) => d.status !== "resolved").length === 0 ? (
                <p className="rounded-md border border-hairline bg-surface px-3 py-3 text-sm text-muted-foreground">
                  No open decisions logged yet.
                </p>
              ) : (
                <ul className="rounded-md border border-hairline bg-surface">
                  {decisions
                    .filter((d) => d.status !== "resolved")
                    .map((d) => (
                      <li
                        key={d.id}
                        className="border-b border-hairline px-3 py-2 last:border-0 text-sm"
                      >
                        <div className="flex items-baseline justify-between">
                          <span>{d.decision}</span>
                          <span
                            className={`text-xs uppercase tracking-wider ${d.status === "overdue" ? "text-danger" : "text-muted-foreground"}`}
                          >
                            {d.status}
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {d.owner || "—"} · due{" "}
                          {d.due_date ? new Date(d.due_date).toLocaleDateString() : "—"}
                        </div>
                      </li>
                    ))}
                </ul>
              )}
            </div>
          )}

          {current.key === "narrative" && (
            <div className="space-y-3">
              <div className="rounded-md border border-hairline bg-surface px-3 py-2 text-xs text-muted-foreground">
                This is the story your PM will tell in the meeting. It will be the executive summary
                of the PDF report.
              </div>
              <Textarea
                rows={8}
                value={narrative}
                onChange={(e) => setNarrative(e.target.value)}
                placeholder="Project remains on budget despite a 3-week schedule slip driven by window delivery. Lighting selections still trending 30% over allowance — owner decision required by Friday to recover."
              />

              <div className="space-y-1.5">
                <Label className="text-xs">Reviewer</Label>
                <Input value={reviewer} onChange={(e) => setReviewer(e.target.value)} />
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="flex items-center justify-between sm:justify-between">
          <Button
            variant="ghost"
            disabled={step === 0}
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            className="gap-1.5"
          >
            <ChevronLeft className="h-4 w-4" /> Back
          </Button>
          {isLast ? (
            <Button onClick={submit} disabled={pending || !canAdvance()}>
              {pending ? "Saving…" : "Save IOR report & download PDF"}
            </Button>
          ) : (
            <Button
              onClick={() => setStep((s) => s + 1)}
              disabled={!canAdvance()}
              className="gap-1.5"
            >
              Next <ChevronRight className="h-4 w-4" />
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TreatmentPicker({
  value,
  onChange,
}: {
  value: ResponsePath | null;
  onChange: (v: ResponsePath) => void;
}) {
  return (
    <div>
      <div className="font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
        Treatment path
      </div>
      <div className="mt-1.5 grid grid-cols-2 gap-2 md:grid-cols-4">
        {(
          Object.entries(RESPONSE_META) as [ResponsePath, (typeof RESPONSE_META)[ResponsePath]][]
        ).map(([k, meta]) => {
          const active = value === k;
          const Icon = meta.icon;
          return (
            <button
              key={k}
              type="button"
              onClick={() => onChange(k)}
              className={`rounded-lg border px-3 py-2.5 text-left text-xs transition-colors ${active ? "border-accent bg-accent/10" : "border-hairline bg-card hover:border-accent/50"}`}
            >
              <div
                className={`flex items-center gap-1.5 font-semibold ${active ? "text-clay" : "text-foreground"}`}
              >
                <Icon className="h-3.5 w-3.5" /> {meta.label}
              </div>
              <div className="mt-0.5 leading-snug text-muted-foreground">{meta.meaning}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
