import { createFileRoute, Link } from "@tanstack/react-router";
import { BookOpen, LifeBuoy, Mail, MessageSquareWarning } from "lucide-react";

// Scaffold for the Support center (footer "Support" destination, decision #2).
// Intentionally a shell — the real content (ticketing, contextual help, status)
// is built out later. Styled from the house tokens like the rest of the app.
export const Route = createFileRoute("/_authenticated/support")({
  ssr: false,
  head: () => ({ meta: [{ title: "Support — Overwatch" }] }),
  component: SupportPage,
});

const SUPPORT_OPTIONS = [
  {
    icon: BookOpen,
    title: "Documentation",
    body: "Guides for estimating, billing, IOR reviews, and the daily field workflow.",
    action: "Browse docs",
    ready: false,
  },
  {
    icon: Mail,
    title: "Email support",
    body: "Reach the ALP team directly. We answer during business hours, Mon–Fri.",
    action: "support@alpcontractorcircle.com",
    href: "mailto:support@alpcontractorcircle.com",
    ready: true,
  },
  {
    icon: MessageSquareWarning,
    title: "Report an issue",
    body: "Something broken or a number that looks wrong? Send it with the project in view.",
    action: "Open a report",
    ready: false,
  },
];

function SupportPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto w-full max-w-3xl px-6 py-14">
        <Link
          to="/"
          className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground transition hover:text-foreground"
        >
          ← Home
        </Link>

        <div className="mt-6 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-dark-panel text-dark-panel-foreground">
            <LifeBuoy className="h-5 w-5" />
          </span>
          <div>
            <p className="eyebrow">Support · OverWatch</p>
            <h1 className="font-serif text-4xl leading-none text-foreground">How can we help?</h1>
          </div>
        </div>
        <p className="mt-4 max-w-xl text-sm text-muted-foreground">
          This is the start of the OverWatch support center. Email is live now; the rest lands as we
          build it out.
        </p>

        <div className="mt-8 grid gap-3 sm:grid-cols-2">
          {SUPPORT_OPTIONS.map((opt) => {
            const Icon = opt.icon;
            const inner = (
              <>
                <div className="flex items-center gap-2.5">
                  <Icon className="h-4 w-4 text-clay" />
                  <span className="text-sm font-semibold text-foreground">{opt.title}</span>
                  {!opt.ready ? (
                    <span className="ml-auto rounded-full border border-hairline px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
                      Soon
                    </span>
                  ) : null}
                </div>
                <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">{opt.body}</p>
                <div className="mt-3 font-mono text-[11px] font-bold text-foreground">
                  {opt.action} →
                </div>
              </>
            );
            const cls =
              "block rounded-lg border border-hairline bg-card p-4 text-left transition hover:border-accent/40";
            return opt.href ? (
              <a key={opt.title} href={opt.href} className={cls}>
                {inner}
              </a>
            ) : (
              <div key={opt.title} className={`${cls} opacity-80`}>
                {inner}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
