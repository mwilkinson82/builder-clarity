import type { HarborDemoModuleKey } from "@/lib/demo-seed";

export type HarborLessonMediaStatus = "ready" | "storyboard";

export interface HarborLessonMedia {
  status: HarborLessonMediaStatus;
  title: string;
  summary: string;
  durationLabel: string;
  hasNarration?: boolean;
  videoSrc?: string;
  captionsSrc?: string;
  posterSrc?: string;
}

export const HARBOR_LESSON_MEDIA: Record<HarborDemoModuleKey, HarborLessonMedia> = {
  "project-foundation": {
    status: "ready",
    title: "The OverWatch operating loop",
    summary:
      "See how field truth becomes PM control, a commercial decision, and an early financial outcome.",
    durationLabel: "About 60 seconds",
    hasNarration: false,
    videoSrc: "/onboarding/harbor/lesson-01-overwatch-operating-loop.mp4",
    captionsSrc: "/onboarding/harbor/lesson-01-overwatch-operating-loop.vtt",
    posterSrc: "/onboarding/harbor/lesson-01-overwatch-operating-loop-poster.png",
  },
  "budget-sov": {
    status: "storyboard",
    title: "Cost budget versus owner billing value",
    summary: "Separate what the work costs from what the owner pays so margin stays visible.",
    durationLabel: "60-second guide",
  },
  "subcontract-buyout": {
    status: "storyboard",
    title: "A buyout is more than a contract total",
    summary: "Connect committed cost, planned quantity, production pace, and payment control.",
    durationLabel: "75-second guide",
  },
  "daily-reports-wip": {
    status: "storyboard",
    title: "Capture field truth once",
    summary: "Turn crews, hours, quantities, delays, and evidence into a reusable job record.",
    durationLabel: "60-second guide",
  },
  "daily-wip-cpm-evidence": {
    status: "storyboard",
    title: "Turn the daily record into management control",
    summary: "Review progress, cost, earned value, and pace before the information moves upstream.",
    durationLabel: "75-second guide",
  },
  "cpm-schedule": {
    status: "storyboard",
    title: "Use field evidence without surrendering PM judgment",
    summary:
      "Apply the Daily WIP recommendation, keep CPM unchanged, or use another supported value.",
    durationLabel: "60-second guide",
  },
  "production-control": {
    status: "storyboard",
    title: "Know whether the crew is earning the plan",
    summary:
      "Compare installed units per labor-hour with the target and watch the trend change over time.",
    durationLabel: "75-second guide",
  },
  "billing-workspace": {
    status: "storyboard",
    title: "Bridge PM judgment and accounting control",
    summary:
      "Start billing with certified project truth while accounting controls the final instrument.",
    durationLabel: "75-second guide",
  },
  "ior-commercial-position": {
    status: "storyboard",
    title: "Run the IOR before the loss is final",
    summary: "Give every exposure dollars, an owner, a recovery path, and a next action.",
    durationLabel: "75-second guide",
  },
  inspections: {
    status: "storyboard",
    title: "Close the quality loop",
    summary:
      "Keep failed work connected to correction, responsibility, reinspection, and financial risk.",
    durationLabel: "60-second guide",
  },
  claims: {
    status: "storyboard",
    title: "Build the claim while the work continues",
    summary:
      "Preserve notice, cause, cost, schedule effect, and supporting documents in one timeline.",
    durationLabel: "60-second guide",
  },
};
