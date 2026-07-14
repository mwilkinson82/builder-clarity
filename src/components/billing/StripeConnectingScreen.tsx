import { useEffect, useState } from "react";
import { ArrowRight, Check, CreditCard, LoaderCircle, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";

interface StripeConnectingScreenProps {
  businessName: string;
  action: "onboard" | "dashboard";
}

export function StripeConnectingScreen({ businessName, action }: StripeConnectingScreenProps) {
  const [takingLonger, setTakingLonger] = useState(false);
  const safeBusinessName = businessName.trim() || "your company";
  const verb = action === "dashboard" ? "Opening" : "Connecting";

  useEffect(() => {
    const timer = window.setTimeout(() => setTakingLonger(true), 12_000);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-6 py-12 text-foreground">
      <div className="pointer-events-none absolute inset-0 opacity-70" aria-hidden="true">
        <div className="absolute left-[-12rem] top-[-10rem] h-[28rem] w-[28rem] rounded-full bg-clay/10 blur-3xl" />
        <div className="absolute bottom-[-14rem] right-[-10rem] h-[30rem] w-[30rem] rounded-full bg-[#635bff]/10 blur-3xl" />
      </div>

      <section
        aria-live="polite"
        aria-busy="true"
        className="relative w-full max-w-3xl rounded-2xl border border-hairline bg-card p-6 shadow-card sm:p-10"
      >
        <div className="text-center">
          <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-clay">
            OverWatch secure handoff
          </p>
          <h1 className="mt-3 font-serif text-3xl text-foreground sm:text-4xl">
            {verb} {safeBusinessName} to Stripe
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">
            We are creating a private Stripe session for this connected business. Your OverWatch
            workspace is still open in the previous tab.
          </p>
        </div>

        <div className="mx-auto my-9 flex max-w-xl items-center justify-center" aria-hidden="true">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border border-hairline bg-primary text-sm font-bold tracking-[0.12em] text-primary-foreground shadow-card">
            OW
          </div>
          <div className="relative mx-3 h-px flex-1 overflow-visible bg-hairline sm:mx-5">
            <div className="absolute inset-y-[-1px] left-0 w-1/2 animate-pulse bg-gradient-to-r from-clay via-[#635bff] to-transparent motion-reduce:animate-none" />
            <ArrowRight className="absolute -right-1 -top-2.5 h-5 w-5 text-[#635bff]" />
          </div>
          <div className="relative flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-[#635bff] text-2xl font-bold text-white shadow-card">
            S
            <span className="absolute inset-[-7px] animate-ping rounded-[1.25rem] border border-[#635bff]/30 motion-reduce:animate-none" />
          </div>
          <div className="relative mx-3 h-px flex-1 overflow-visible bg-hairline sm:mx-5">
            <div className="absolute inset-y-[-1px] left-0 w-1/2 animate-pulse bg-gradient-to-r from-[#635bff] to-transparent motion-reduce:animate-none" />
            <ArrowRight className="absolute -right-1 -top-2.5 h-5 w-5 text-clay" />
          </div>
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border border-clay/30 bg-clay/10 text-clay shadow-card">
            <CreditCard className="h-6 w-6" />
          </div>
        </div>

        <div className="mx-auto grid max-w-xl gap-3">
          <div className="flex items-center gap-3 rounded-lg border border-success/25 bg-success/10 px-4 py-3">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-success text-white">
              <Check className="h-3.5 w-3.5" />
            </span>
            <div>
              <p className="text-sm font-semibold">Secure session started</p>
              <p className="text-xs text-muted-foreground">
                No bank credentials pass through OverWatch.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-lg border border-[#635bff]/25 bg-[#635bff]/5 px-4 py-3">
            <LoaderCircle className="h-6 w-6 animate-spin text-[#635bff] motion-reduce:animate-none" />
            <div>
              <p className="text-sm font-semibold">
                {action === "dashboard"
                  ? "Preparing the Stripe Dashboard"
                  : `Connecting ${safeBusinessName}`}
              </p>
              <p className="text-xs text-muted-foreground">
                Stripe may take a few seconds to respond.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-lg border border-hairline bg-surface px-4 py-3 text-muted-foreground">
            <span className="flex h-6 w-6 items-center justify-center rounded-full border border-hairline font-mono text-[10px]">
              03
            </span>
            <div>
              <p className="text-sm font-semibold text-foreground">Opening Stripe in this tab</p>
              <p className="text-xs">You will return to Getting Paid when Stripe is finished.</p>
            </div>
          </div>
        </div>

        <div className="mx-auto mt-7 flex max-w-xl gap-3 rounded-lg border border-hairline bg-surface px-4 py-3">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-success" />
          <p className="text-xs leading-relaxed text-muted-foreground">
            Clients pay {safeBusinessName} directly. OverWatch never holds the invoice principal; it
            can receive only the disclosed application fee on an online payment.
          </p>
        </div>

        {takingLonger ? (
          <div className="mx-auto mt-5 max-w-xl rounded-lg border border-warning/30 bg-warning/10 p-4 text-sm text-warning">
            <p className="font-semibold">Stripe is taking longer than expected.</p>
            <p className="mt-1 text-xs leading-relaxed">
              You can keep waiting, or return to OverWatch and try again. Nothing has been charged
              and no payment settings were changed.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="outline" onClick={() => window.close()}>
                Close this tab
              </Button>
              <Button type="button" size="sm" asChild>
                <a href="/team?section=paid">Return to Getting Paid</a>
              </Button>
            </div>
          </div>
        ) : null}
      </section>
    </main>
  );
}
