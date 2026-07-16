import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  Clock3,
  Play,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { getHarborDemoModuleStatus, resetHarborDemoModule } from "@/lib/projects.functions";
import type { HarborDemoModuleStatus } from "@/lib/demo-seed";
import {
  HARBOR_IOR_FLOW,
  HARBOR_ONBOARDING_LESSONS,
  type HarborOnboardingLesson,
} from "@/lib/harbor-onboarding";

const roleTone = (role: HarborOnboardingLesson["role"]) => {
  switch (role) {
    case "Superintendent":
      return "border-warning/30 bg-warning/[0.07] text-warning";
    case "PM + accounting":
      return "border-clay/30 bg-clay/[0.07] text-clay";
    case "Project manager":
      return "border-accent/30 bg-accent/[0.07] text-clay";
    default:
      return "border-hairline bg-secondary text-muted-foreground";
  }
};

const readinessCopy = (status: HarborDemoModuleStatus | undefined) => {
  switch (status) {
    case "current":
      return { label: "Lesson ready", tone: "text-success", dot: "bg-success" };
    case "failed":
      return { label: "Needs repair", tone: "text-danger", dot: "bg-danger" };
    case "upgrade":
      return { label: "Update available", tone: "text-warning", dot: "bg-warning" };
    case "missing":
      return { label: "Setup needed", tone: "text-warning", dot: "bg-warning" };
    default:
      return {
        label: "Checking lesson",
        tone: "text-muted-foreground",
        dot: "bg-muted-foreground",
      };
  }
};

export interface HarborStartHereTarget {
  tab: HarborOnboardingLesson["target"]["tab"];
  wipView?: "daily" | "production";
}

export function HarborStartHere({
  projectId,
  onOpenWorkspace,
}: {
  projectId: string;
  onOpenWorkspace: (target: HarborStartHereTarget) => void;
}) {
  const loadStatus = useServerFn(getHarborDemoModuleStatus);
  const resetLesson = useServerFn(resetHarborDemoModule);
  const queryClient = useQueryClient();
  const storageKey = `overwatch:harbor-start-here:${projectId}:v1`;
  const [selectedModuleKey, setSelectedModuleKey] = useState(
    HARBOR_ONBOARDING_LESSONS[0].moduleKey,
  );
  const [visitedModuleKeys, setVisitedModuleKeys] = useState<Set<string>>(new Set());
  const [resetCandidate, setResetCandidate] = useState<HarborOnboardingLesson | null>(null);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(storageKey);
      const parsed = stored ? (JSON.parse(stored) as unknown) : [];
      if (Array.isArray(parsed)) {
        setVisitedModuleKeys(
          new Set(parsed.filter((value): value is string => typeof value === "string")),
        );
      }
    } catch {
      setVisitedModuleKeys(new Set());
    }
  }, [storageKey]);

  const statusQuery = useQuery({
    queryKey: ["harbor-demo-module-status", projectId],
    queryFn: () => loadStatus({ data: { projectId } }),
  });

  const resetMutation = useMutation({
    mutationFn: (lesson: HarborOnboardingLesson) =>
      resetLesson({ data: { projectId, moduleKey: lesson.moduleKey } }),
    onSuccess: async (_result, lesson) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["harbor-demo-module-status", projectId] }),
        queryClient.invalidateQueries({ queryKey: ["project", projectId] }),
      ]);
      setVisitedModuleKeys((current) => {
        const next = new Set(current);
        next.delete(lesson.moduleKey);
        window.localStorage.setItem(storageKey, JSON.stringify([...next]));
        return next;
      });
      setResetCandidate(null);
      toast.success(`${lesson.shortTitle} restored`, {
        description: "The Harbor lesson is back at its starting point.",
      });
    },
    onError: (error) => {
      toast.error("Lesson did not reset", {
        description: error instanceof Error ? error.message : "Refresh and try again.",
      });
    },
  });

  const moduleStatusByKey = useMemo(
    () => new Map((statusQuery.data?.modules ?? []).map((module) => [module.key, module.status])),
    [statusQuery.data?.modules],
  );
  const selectedLesson =
    HARBOR_ONBOARDING_LESSONS.find((lesson) => lesson.moduleKey === selectedModuleKey) ??
    HARBOR_ONBOARDING_LESSONS[0];
  const selectedReadiness = readinessCopy(moduleStatusByKey.get(selectedLesson.moduleKey));
  const readyCount = HARBOR_ONBOARDING_LESSONS.filter(
    (lesson) => moduleStatusByKey.get(lesson.moduleKey) === "current",
  ).length;
  const exploredCount = HARBOR_ONBOARDING_LESSONS.filter((lesson) =>
    visitedModuleKeys.has(lesson.moduleKey),
  ).length;

  const markLessonExplored = (lesson: HarborOnboardingLesson) => {
    setVisitedModuleKeys((current) => {
      const next = new Set(current);
      next.add(lesson.moduleKey);
      window.localStorage.setItem(storageKey, JSON.stringify([...next]));
      return next;
    });
  };

  const openLesson = (lesson: HarborOnboardingLesson) => {
    markLessonExplored(lesson);
    onOpenWorkspace(lesson.target);
  };

  return (
    <div className="space-y-6">
      <section className="relative overflow-hidden rounded-xl bg-dark-panel px-5 py-7 text-background shadow-card sm:px-7 sm:py-9">
        <div
          aria-hidden="true"
          className="absolute right-5 top-5 h-2.5 w-2.5 rounded-full bg-signal motion-safe:animate-pulse"
        />
        <div className="relative max-w-4xl motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:duration-500">
          <p className="font-mono text-[9.5px] font-bold uppercase tracking-[0.16em] text-clay">
            Harbor Residence · Start Here
          </p>
          <h1 className="mt-3 max-w-3xl font-serif text-3xl leading-[1.05] sm:text-5xl">
            Run the job before the job runs you.
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-background/70 sm:text-base">
            OverWatch turns field facts into management decisions while there is still time to
            protect schedule and gross profit. These short lessons show the complete operating loop
            on one real working project.
          </p>
        </div>

        <div className="relative mt-7 grid gap-px overflow-hidden rounded-xl border border-background/15 bg-background/15 sm:grid-cols-2 xl:grid-cols-4">
          {HARBOR_IOR_FLOW.map((step, index) => (
            <div
              key={step.label}
              className="bg-dark-panel p-4 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:duration-500"
              style={{ animationDelay: `${index * 90}ms`, animationFillMode: "both" }}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-clay">
                  0{index + 1} · {step.owner}
                </span>
                {index < HARBOR_IOR_FLOW.length - 1 ? (
                  <ArrowRight className="h-3.5 w-3.5 text-background/35" />
                ) : (
                  <ShieldCheck className="h-3.5 w-3.5 text-success" />
                )}
              </div>
              <h2 className="mt-3 font-serif text-xl">{step.label}</h2>
              <p className="mt-1.5 text-xs leading-5 text-background/60">{step.detail}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="border-y border-hairline py-5">
        <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_280px] md:items-center">
          <div>
            <p className="eyebrow">The method in plain English</p>
            <h2 className="mt-2 font-serif text-2xl text-foreground">
              The field reports facts. The PM turns them into a plan. Accounting turns the plan into
              clean billing.
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
              High-performing contractors already manage through production, forecast, risk, and
              recovery. OverWatch connects that discipline in one operating record so the process is
              visible, repeatable, and easier to teach.
            </p>
          </div>
          <div className="rounded-xl border border-hairline bg-card p-4">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-foreground">Your walkthrough</span>
              <span className="text-muted-foreground">
                {exploredCount} of {HARBOR_ONBOARDING_LESSONS.length} explored
              </span>
            </div>
            <Progress
              value={(exploredCount / HARBOR_ONBOARDING_LESSONS.length) * 100}
              className="mt-3 h-1.5"
            />
            <p className="mt-3 text-xs text-muted-foreground">
              {readyCount} lessons have their live Harbor data ready.
            </p>
          </div>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
        <div className="min-w-0 lg:sticky lg:top-6 lg:self-start">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <p className="eyebrow">Choose a lesson</p>
              <p className="mt-1 text-xs text-muted-foreground">Short. Real. In job order.</p>
            </div>
            <Sparkles className="h-4 w-4 text-clay" />
          </div>
          <ol className="flex gap-2 overflow-x-auto pb-2 lg:block lg:space-y-1 lg:overflow-visible lg:pb-0">
            {HARBOR_ONBOARDING_LESSONS.map((lesson) => {
              const isSelected = selectedLesson.moduleKey === lesson.moduleKey;
              const isExplored = visitedModuleKeys.has(lesson.moduleKey);
              const readiness = readinessCopy(moduleStatusByKey.get(lesson.moduleKey));
              return (
                <li key={lesson.moduleKey} className="min-w-[230px] lg:min-w-0">
                  <button
                    type="button"
                    onClick={() => setSelectedModuleKey(lesson.moduleKey)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      isSelected
                        ? "bg-secondary text-foreground"
                        : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
                    )}
                  >
                    <span
                      className={cn(
                        "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border font-mono text-[10px] font-bold",
                        isExplored
                          ? "border-success/30 bg-success/[0.08] text-success"
                          : isSelected
                            ? "border-clay/30 bg-clay/[0.08] text-clay"
                            : "border-hairline bg-card text-muted-foreground",
                      )}
                    >
                      {isExplored ? <Check className="h-3.5 w-3.5" /> : lesson.number}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">
                        {lesson.shortTitle}
                      </span>
                      <span className="mt-0.5 flex items-center gap-1.5 text-[10.5px]">
                        <span className={cn("h-1.5 w-1.5 rounded-full", readiness.dot)} />
                        {lesson.role}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </div>

        <article
          key={selectedLesson.moduleKey}
          className="min-w-0 rounded-xl border border-hairline bg-card p-5 shadow-card motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:duration-300 sm:p-7"
        >
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-hairline pb-5">
            <div className="max-w-3xl">
              <div className="flex flex-wrap items-center gap-2">
                <span className="eyebrow">Lesson {selectedLesson.number}</span>
                <span
                  className={cn(
                    "rounded-full border px-2 py-0.5 text-[10.5px] font-semibold",
                    roleTone(selectedLesson.role),
                  )}
                >
                  {selectedLesson.role}
                </span>
                <span className="inline-flex items-center gap-1 text-[10.5px] text-muted-foreground">
                  <Clock3 className="h-3 w-3" /> {selectedLesson.duration}
                </span>
              </div>
              <h2 className="mt-3 font-serif text-3xl text-foreground">{selectedLesson.title}</h2>
              <p className="mt-2 text-sm font-semibold text-foreground">{selectedLesson.promise}</p>
            </div>
            <div
              className={cn(
                "flex items-center gap-2 text-xs font-semibold",
                selectedReadiness.tone,
              )}
            >
              <span className={cn("h-2 w-2 rounded-full", selectedReadiness.dot)} />
              {selectedReadiness.label}
            </div>
          </div>

          <div className="grid gap-7 py-6 xl:grid-cols-[minmax(0,1fr)_300px]">
            <div>
              <p className="eyebrow">Why it matters</p>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
                {selectedLesson.why}
              </p>

              <p className="eyebrow mt-7">Do this in Harbor</p>
              <ol className="mt-3 space-y-3">
                {selectedLesson.steps.map((step, index) => (
                  <li key={step} className="flex items-start gap-3">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-secondary font-mono text-[10px] font-bold text-clay">
                      {index + 1}
                    </span>
                    <span className="pt-0.5 text-sm leading-5 text-foreground">{step}</span>
                  </li>
                ))}
              </ol>
            </div>

            <aside className="rounded-xl bg-dark-panel p-5 text-background">
              <p className="font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-clay">
                What success looks like
              </p>
              <CheckCircle2 className="mt-4 h-7 w-7 text-success" />
              <p className="mt-3 font-serif text-xl leading-6">{selectedLesson.result}</p>
              <p className="mt-4 text-xs leading-5 text-background/60">
                You are using the real Harbor workflow. Nothing here bypasses normal permissions or
                application rules.
              </p>
            </aside>
          </div>

          <div className="flex flex-col gap-3 border-t border-hairline pt-5 sm:flex-row sm:items-center sm:justify-between">
            <Button
              type="button"
              variant="signal"
              className="gap-2 sm:w-auto"
              onClick={() => openLesson(selectedLesson)}
            >
              <Play className="h-4 w-4" />
              {selectedLesson.target.actionLabel}
              <ArrowRight className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="gap-2 text-muted-foreground"
              disabled={!statusQuery.data?.registryAvailable || resetMutation.isPending}
              onClick={() => setResetCandidate(selectedLesson)}
            >
              <RotateCcw className="h-3.5 w-3.5" /> Reset this lesson
            </Button>
          </div>

          {statusQuery.isError ? (
            <p className="mt-4 text-xs text-danger">
              Lesson readiness could not be checked. You can still open the workspace.
            </p>
          ) : null}
        </article>
      </section>

      <section className="rounded-xl border border-hairline bg-secondary/50 p-5 sm:flex sm:items-center sm:justify-between sm:gap-6">
        <div className="flex items-start gap-3">
          <Users className="mt-0.5 h-5 w-5 shrink-0 text-clay" />
          <div>
            <p className="text-sm font-semibold text-foreground">
              Teach the handoff, not just the button.
            </p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Superintendent records the truth. PM reviews and controls it. Accounting packages and
              collects it. Leadership sees the outcome.
            </p>
          </div>
        </div>
      </section>

      <AlertDialog
        open={Boolean(resetCandidate)}
        onOpenChange={(open) => !open && setResetCandidate(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset this Harbor lesson?</AlertDialogTitle>
            <AlertDialogDescription>
              This restores the canonical {resetCandidate?.shortTitle} training records to their
              starting state. It leaves unrelated and user-created records alone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep my work</AlertDialogCancel>
            <AlertDialogAction
              disabled={!resetCandidate || resetMutation.isPending}
              onClick={(event) => {
                event.preventDefault();
                if (resetCandidate) resetMutation.mutate(resetCandidate);
              }}
            >
              {resetMutation.isPending ? "Resetting…" : "Reset lesson"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
