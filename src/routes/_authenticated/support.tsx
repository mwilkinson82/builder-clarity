import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  BookOpen,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  ExternalLink,
  FolderPlus,
  LifeBuoy,
  Mail,
  ReceiptText,
  Send,
  ShieldCheck,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { getCompanyWorkspaceContext } from "@/lib/team.functions";
import { submitSupportRequest } from "@/lib/support.functions";
import {
  REPORT_CATEGORIES,
  REPORT_CATEGORY_LABEL,
  type SupportReportCategory,
} from "@/lib/support-request";

export const Route = createFileRoute("/_authenticated/support")({
  ssr: false,
  head: () => ({ meta: [{ title: "Help & support — Overwatch" }] }),
  component: SupportPage,
});

const GETTING_STARTED = [
  {
    icon: FolderPlus,
    title: "Create your first project",
    body: "A project is the container for everything — budget, schedule, daily reports, and billing. Start on the Portfolio home and add one.",
    to: "/" as const,
    cta: "Go to Portfolio",
  },
  {
    icon: Users,
    title: "Invite your team",
    body: "Open Team to send invites. Give each person a role — owner, PM, member, or viewer — so they only see what they should.",
    to: "/team" as const,
    cta: "Open Team",
  },
  {
    icon: ReceiptText,
    title: "Bill your work",
    body: "In Billing you build a pay application from your schedule of values and send it out for payment. Progress you log on the job flows straight in.",
    to: "/billing" as const,
    cta: "Open Billing",
  },
];

const GLOSSARY: { term: string; name: string; body: string }[] = [
  {
    term: "GP",
    name: "Gross profit",
    body: "What's left after job costs — the contract value minus what the work actually costs you to build.",
  },
  {
    term: "SOV",
    name: "Schedule of values",
    body: "The line-by-line breakdown of a contract that you bill against, one row per scope of work.",
  },
  {
    term: "CO",
    name: "Change order",
    body: "An approved change to a signed contract's scope and price, added after the original deal.",
  },
  {
    term: "E-Hold",
    name: "Exposure hold",
    body: "Money reserved against a specific, identified risk — a delayed package, an overrun allowance.",
  },
  {
    term: "C-Hold",
    name: "Contingency hold",
    body: "Money reserved for the general uncertainty left in scope you haven't bought out yet.",
  },
];

function SectionEyebrow({ children }: { children: string }) {
  return <p className="eyebrow">{children}</p>;
}

function ReportIssueForm() {
  const [category, setCategory] = useState<SupportReportCategory>("issue");
  const [message, setMessage] = useState("");

  const loadCompany = useServerFn(getCompanyWorkspaceContext);
  const { data: company } = useQuery({
    queryKey: ["company-workspace-context"],
    queryFn: () => loadCompany(),
  });

  const submit = useServerFn(submitSupportRequest);

  // The page a reporter was on before opening Help is far more useful than the
  // support route itself — capture it from the (same-origin) referrer.
  const routePath = useMemo(() => {
    if (typeof window === "undefined") return "";
    try {
      const ref = document.referrer;
      if (ref) {
        const url = new URL(ref);
        if (url.origin === window.location.origin) return `${url.pathname}${url.search}`;
      }
    } catch {
      /* fall through to current path */
    }
    return window.location.pathname;
  }, []);

  const appVersion = (import.meta.env.VITE_COMMIT_SHA as string | undefined)?.trim() ?? "";

  const mutation = useMutation({
    mutationFn: () =>
      submit({
        data: {
          category,
          message: message.trim(),
          routePath,
          organizationId: company?.id ?? "",
          organizationName: company?.name ?? "",
          appVersion,
          userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
        },
      }),
    onSuccess: () => {
      toast.success("Thanks — we got it", {
        description: "The team will follow up by email if we need more.",
      });
      setMessage("");
      setCategory("issue");
    },
    onError: () => {
      toast.error("That didn't send", {
        description: "Check your connection and try again, or email us below.",
      });
    },
  });

  const canSend = message.trim().length > 0 && !mutation.isPending;

  return (
    <form
      className="rounded-lg border border-hairline bg-card p-5 shadow-card"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSend) mutation.mutate();
      }}
    >
      <div className="flex items-center gap-2">
        <Send className="h-4 w-4 text-clay" />
        <h2 className="font-serif text-2xl text-foreground">Tell us what's going on</h2>
      </div>
      <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
        Broken thing, a number that looks wrong, or an idea — send it straight from here. We
        automatically include the page you were on so you don't have to explain where.
      </p>

      <div className="mt-4 flex flex-wrap gap-2" role="radiogroup" aria-label="What kind of note">
        {REPORT_CATEGORIES.map((key) => (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={category === key}
            onClick={() => setCategory(key)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-semibold transition-colors",
              category === key
                ? "border-clay bg-clay/10 text-foreground"
                : "border-hairline text-muted-foreground hover:text-foreground",
            )}
          >
            {REPORT_CATEGORY_LABEL[key]}
          </button>
        ))}
      </div>

      <label htmlFor="support-message" className="sr-only">
        Your message
      </label>
      <Textarea
        id="support-message"
        value={message}
        onChange={(event) => setMessage(event.target.value)}
        maxLength={5000}
        rows={5}
        placeholder="What happened, and what did you expect instead?"
        className="mt-3 resize-y"
      />

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <span className="text-[11px] text-muted-foreground">
          {company?.name ? `Sending as ${company.name}` : "Sent to the Overwatch team"}
        </span>
        <Button type="submit" variant="signal" size="sm" disabled={!canSend}>
          {mutation.isPending ? "Sending…" : mutation.isError ? "Try again" : "Send to Overwatch"}
        </Button>
      </div>

      {mutation.isError ? (
        <p className="mt-2 text-xs text-danger" role="alert">
          We couldn't send that just now. Try again, or email us below.
        </p>
      ) : null}
    </form>
  );
}

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
            <SectionEyebrow>Help &amp; support · Overwatch</SectionEyebrow>
            <h1 className="font-serif text-4xl leading-none text-foreground">How can we help?</h1>
          </div>
        </div>
        <p className="mt-4 max-w-xl text-sm text-muted-foreground">
          New here? Start with the three steps below. Stuck on something specific? Send it straight
          to our team — no email app required.
        </p>

        {/* Getting started — the day-one path comes first. */}
        <section className="mt-8">
          <div className="flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-clay" />
            <h2 className="font-serif text-2xl text-foreground">Getting started</h2>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {GETTING_STARTED.map((step, index) => {
              const Icon = step.icon;
              return (
                <Link
                  key={step.title}
                  to={step.to}
                  className="group flex flex-col rounded-lg border border-hairline bg-card p-4 transition hover:border-accent/40"
                >
                  <div className="flex items-center gap-2">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-dark-panel font-mono text-[10px] font-bold text-dark-panel-foreground">
                      {index + 1}
                    </span>
                    <Icon className="h-4 w-4 text-clay" />
                  </div>
                  <span className="mt-3 text-sm font-semibold text-foreground">{step.title}</span>
                  <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
                    {step.body}
                  </p>
                  <span className="mt-3 font-mono text-[11px] font-bold text-clay transition group-hover:underline">
                    {step.cta} →
                  </span>
                </Link>
              );
            })}
          </div>
        </section>

        {/* Report an issue / feedback — the real, mobile-safe intake. */}
        <section className="mt-4">
          <ReportIssueForm />
        </section>

        {/* Plain-language glossary — matches the terms used across the app. */}
        <section className="mt-4 rounded-lg border border-hairline bg-card p-5 shadow-card">
          <h2 className="font-serif text-2xl text-foreground">Words you'll see</h2>
          <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
            A quick read on the shorthand Overwatch uses for money and risk.
          </p>
          <dl className="mt-4 grid gap-3 sm:grid-cols-2">
            {GLOSSARY.map((entry) => (
              <div key={entry.term} className="rounded-md border border-hairline bg-surface p-3">
                <dt className="flex items-baseline gap-2">
                  <span className="font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-clay">
                    {entry.term}
                  </span>
                  <span className="text-sm font-semibold text-foreground">{entry.name}</span>
                </dt>
                <dd className="mt-1 text-xs leading-relaxed text-muted-foreground">{entry.body}</dd>
              </div>
            ))}
          </dl>
        </section>

        {/* Direct contact — a plain fallback that also works from a laptop. */}
        <section className="mt-4 rounded-lg border border-hairline bg-card p-5 shadow-card">
          <div className="flex items-center gap-2">
            <Mail className="h-4 w-4 text-clay" />
            <h2 className="font-serif text-2xl text-foreground">Email the team</h2>
          </div>
          <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
            Prefer email, or need to attach a file? Reach us directly. We answer during business
            hours, Mon–Fri.
          </p>
          <a
            href="mailto:support@alpcontractorcircle.com"
            className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-clay hover:underline"
          >
            support@alpcontractorcircle.com <Mail className="h-3.5 w-3.5" />
          </a>
        </section>

        {/* Payments & billing help — real content, but below the day-one path. */}
        <div className="mt-12 border-t border-hairline pt-8">
          <SectionEyebrow>Payments &amp; billing</SectionEyebrow>
          <h2 className="mt-1 font-serif text-3xl leading-none text-foreground">
            Getting paid online
          </h2>
          <p className="mt-3 max-w-xl text-sm text-muted-foreground">
            Once you're taking card and ACH payments through Stripe, the sections below cover the
            common questions.
          </p>
        </div>

        <section className="mt-6 rounded-lg border border-hairline bg-card p-5 shadow-card">
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
