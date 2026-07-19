import { Captions, Film, Volume2, VolumeX } from "lucide-react";
import type { HarborLessonMedia } from "@/lib/harbor-onboarding-media";

export function HarborLessonVideo({ media }: { media: HarborLessonMedia }) {
  if (media.status === "ready" && media.videoSrc) {
    return (
      <figure className="overflow-hidden rounded-xl border border-hairline bg-dark-panel shadow-card">
        <video
          key={media.videoSrc}
          controls
          playsInline
          preload="metadata"
          poster={media.posterSrc}
          className="aspect-video w-full bg-dark-panel object-cover"
          aria-label={media.title}
        >
          <source src={media.videoSrc} type="video/mp4" />
          {media.captionsSrc ? (
            <track default kind="captions" src={media.captionsSrc} srcLang="en" label="English" />
          ) : null}
          Your browser does not support embedded video.
        </video>
        <figcaption className="flex flex-col gap-3 border-t border-background/10 px-4 py-3 text-background sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold">{media.title}</p>
            <p className="mt-0.5 text-xs text-background/60">{media.summary}</p>
          </div>
          <div className="flex shrink-0 items-center gap-3 font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-background/55">
            {media.hasNarration ? (
              <span className="inline-flex items-center gap-1.5">
                <Volume2 className="h-3.5 w-3.5 text-clay" /> Narrated
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5">
                <VolumeX className="h-3.5 w-3.5 text-clay" /> Silent pilot
              </span>
            )}
            <span className="inline-flex items-center gap-1.5">
              <Captions className="h-3.5 w-3.5 text-clay" /> Captions
            </span>
          </div>
        </figcaption>
      </figure>
    );
  }

  return (
    <section className="relative aspect-video overflow-hidden rounded-xl border border-background/10 bg-dark-panel p-5 text-background shadow-card sm:p-7">
      <div aria-hidden="true" className="absolute inset-x-0 top-0 h-1 bg-signal" />
      <div className="flex h-full flex-col justify-between">
        <div className="flex items-start justify-between gap-4">
          <img
            src="/overwatch-lockup-reversed.svg"
            alt="OverWatch"
            className="h-auto w-32 sm:w-40"
          />
          <span className="rounded-full border border-background/15 px-2.5 py-1 font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-clay">
            Storyboard ready
          </span>
        </div>
        <div className="max-w-2xl motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:duration-500">
          <Film className="mb-4 h-7 w-7 text-signal" />
          <p className="font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-clay">
            Motion guide · {media.durationLabel}
          </p>
          <h3 className="mt-2 font-serif text-2xl leading-tight sm:text-3xl">{media.title}</h3>
          <p className="mt-2 max-w-xl text-xs leading-5 text-background/65 sm:text-sm">
            {media.summary}
          </p>
        </div>
        <p className="text-[10.5px] text-background/45">
          The lesson is usable now. Narration and the final motion render are the remaining media
          steps.
        </p>
      </div>
    </section>
  );
}
