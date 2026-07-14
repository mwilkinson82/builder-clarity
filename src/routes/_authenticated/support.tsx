import { createFileRoute, Link } from "@tanstack/react-router";
import {
  BookOpen,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  ExternalLink,
  LifeBuoy,
  Mail,
  MessageSquareWarning,
  ShieldCheck,
} from "lucide-react";

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
          Money support comes first. Use the checklist below for Stripe setup, payment limits, and
          any invoice payment that does not look right.
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

        <section className="mt-10 rounded-lg border border-hairline bg-card p-5 shadow-card">
          <div className="flex items-center gap-2">
            <CircleDollarSign className="h-4 w-4 text-clay" />
            <h2 className="font-serif text-2xl text-foreground">Online payment limits</h2>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            OverWatch starts every company with a $25,000 ceiling for one card or ACH debit payment.
            Stripe may apply a lower account-specific limit. OverWatch cannot approve or override
            Stripe's underwriting.
          </p>
          <ol className="mt-4 space-y-3">
            {[
              "Finish the company's live Stripe setup under Company → Getting paid.",
              "Contact Stripe Support from that connected account and request the needed ACH transaction and weekly limits.",
              "Record the requested amount and Stripe case or approval reference under Company → Getting paid.",
              "Use the invoice's direct bank or wire instructions for anything above the approved ceiling.",
            ].map((step, index) => (
              <li key={step} className="flex gap-3 text-sm text-muted-foreground">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-dark-panel font-mono text-[10px] font-bold text-dark-panel-foreground">
                  {index + 1}
                </span>
                <span className="pt-0.5 leading-relaxed">{step}</span>
              </li>
            ))}
          </ol>
          <a
            href="https://support.stripe.com/contact"
            target="_blank"
            rel="noreferrer"
            className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-clay hover:underline"
          >
            Open Stripe Support <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </section>

        <section className="mt-4 rounded-lg border border-hairline bg-card p-5 shadow-card">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-clay" />
            <h2 className="font-serif text-2xl text-foreground">What payment status means</h2>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-md border border-hairline bg-surface p-3">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <CheckCircle2 className="h-4 w-4 text-success" /> Paid
              </div>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Stripe confirmed the money. OverWatch records it in the payment ledger, updates the
                invoice balance, and sends an in-app notification.
              </p>
            </div>
            <div className="rounded-md border border-hairline bg-surface p-3">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Clock3 className="h-4 w-4 text-warning" /> Processing
              </div>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                ACH debit is authorized but not settled. OverWatch keeps the invoice open and locks
                duplicate online payments until Stripe reports success or failure.
              </p>
            </div>
          </div>
        </section>

        <section className="mt-4 rounded-lg border border-hairline bg-card p-5 shadow-card">
          <h2 className="font-serif text-2xl text-foreground">When money needs attention</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Email support with the company, project, invoice number, amount, payment date and time,
            and the Stripe payment or Checkout ID if it is visible. Never send API keys, webhook
            secrets, passwords, or bank-login credentials.
          </p>
          <a
            href="mailto:support@alpcontractorcircle.com?subject=OverWatch%20payment%20support"
            className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-clay hover:underline"
          >
            Email OverWatch payment support <Mail className="h-3.5 w-3.5" />
          </a>
        </section>
      </div>
    </div>
  );
}
