import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { KpiStrip } from "@/components/outcome/KpiStrip";
import { OutcomeWaterfall } from "@/components/outcome/OutcomeWaterfall";
import { HoldsPanel } from "@/components/outcome/HoldsPanel";
import { BuyoutTable } from "@/components/outcome/BuyoutTable";
import { ChangeOrdersTable } from "@/components/outcome/ChangeOrdersTable";
import { ScheduleRisk } from "@/components/outcome/ScheduleRisk";
import { DecisionsTable } from "@/components/outcome/DecisionsTable";
import { initialHolds, project, type Hold } from "@/components/outcome/data";
import { fmtUSD } from "@/lib/format";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Project Outcome Review — Harbor Residence" },
      { name: "description", content: "Forecast-to-finish control for margin, risk, schedule, and owner decisions on luxury custom home projects." },
      { property: "og:title", content: "Project Outcome Review — Harbor Residence" },
      { property: "og:description", content: "Forecast-to-finish control for margin, risk, schedule, and owner decisions." },
    ],
  }),
  component: OutcomeDashboard,
});

function OutcomeDashboard() {
  const [holds, setHolds] = useState<Hold[]>(initialHolds);

  const figures = useMemo(() => {
    const active = holds.filter((h) => h.status !== "Released");
    const exposureHolds = active.filter((h) => h.type === "E-Hold").reduce((s, h) => s + h.amount, 0);
    const contingencyHold = active.filter((h) => h.type === "C-Hold").reduce((s, h) => s + h.amount, 0);

    const forecastedGPBeforeHolds = project.forecastedFinalContract - project.forecastedFinalCostBeforeHolds;
    const indicatedGP = forecastedGPBeforeHolds - exposureHolds - contingencyHold;
    const originalGP = project.originalContract - project.originalCostBudget;
    const indicatedGPpct = (indicatedGP / project.forecastedFinalContract) * 100;
    const originalGPpct = (originalGP / project.originalContract) * 100;
    const gpAtRisk = originalGP - indicatedGP;

    return {
      exposureHolds,
      contingencyHold,
      forecastedGPBeforeHolds,
      indicatedGP,
      originalGP,
      indicatedGPpct,
      originalGPpct,
      gpAtRisk,
    };
  }, [holds]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="relative border-b border-hairline bg-surface-elevated">
        <div className="absolute inset-0 grid-bg opacity-40" />
        <div className="relative mx-auto max-w-[1400px] px-6 py-10 lg:px-10 lg:py-14">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="flex items-center gap-3 text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                <span className="inline-block h-px w-8 bg-accent" />
                Project Outcome Review
              </div>
              <h1 className="mt-3 font-serif text-5xl leading-[1.05] text-foreground lg:text-6xl">
                {project.name}
              </h1>
              <p className="mt-3 max-w-2xl text-base text-muted-foreground">
                Forecast-to-finish control for margin, risk, schedule, and owner decisions.
              </p>
            </div>
            <dl className="grid grid-cols-2 gap-x-10 gap-y-3 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Client</dt>
                <dd className="mt-0.5 text-foreground">{project.client}</dd>
              </div>
              <div>
                <dt className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Original Contract</dt>
                <dd className="mt-0.5 tabular text-foreground">{fmtUSD(project.originalContract)}</dd>
              </div>
              <div>
                <dt className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Forecasted Final</dt>
                <dd className="mt-0.5 tabular text-foreground">{fmtUSD(project.forecastedFinalContract)}</dd>
              </div>
            </dl>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1400px] space-y-8 px-6 py-10 lg:px-10">
        <KpiStrip
          originalGP={figures.originalGP}
          originalGPpct={figures.originalGPpct}
          forecastedGP={figures.forecastedGPBeforeHolds}
          indicatedGP={figures.indicatedGP}
          indicatedGPpct={figures.indicatedGPpct}
          gpAtRisk={figures.gpAtRisk}
          exposureHolds={figures.exposureHolds}
          contingencyHold={figures.contingencyHold}
          pendingCOs={project.pendingCOs}
          scheduleWeeks={project.scheduleVarianceWeeks}
        />

        <Tabs defaultValue="outcome" className="space-y-6">
          <TabsList className="h-auto w-full justify-start gap-1 rounded-lg border border-hairline bg-card p-1">
            {[
              ["outcome", "Outcome"],
              ["buyout", "Buyout"],
              ["holds", "Holds"],
              ["change-orders", "Change Orders"],
              ["schedule", "Schedule Risk"],
              ["decisions", "Required Decisions"],
            ].map(([v, label]) => (
              <TabsTrigger
                key={v}
                value={v}
                className="rounded-md px-4 py-2 text-sm data-[state=active]:bg-foreground data-[state=active]:text-background"
              >
                {label}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="outcome" className="rounded-lg border border-hairline bg-card p-6 lg:p-10 shadow-card">
            <div className="mb-6 flex items-baseline justify-between">
              <div>
                <h2 className="font-serif text-3xl text-foreground">Financial Outcome</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  From original contract through indicated gross profit. The budget shows what we hoped would happen; this shows what is probably going to happen.
                </p>
              </div>
            </div>
            <OutcomeWaterfall
              originalContract={project.originalContract}
              approvedCOs={project.approvedCOs}
              pendingCOs={project.pendingCOs}
              forecastedFinalContract={project.forecastedFinalContract}
              originalCostBudget={project.originalCostBudget}
              forecastedFinalCost={project.forecastedFinalCostBeforeHolds}
              forecastedGPBeforeHolds={figures.forecastedGPBeforeHolds}
              exposureHolds={figures.exposureHolds}
              contingencyHold={figures.contingencyHold}
              indicatedGP={figures.indicatedGP}
              indicatedGPpct={figures.indicatedGPpct}
            />
          </TabsContent>

          <TabsContent value="buyout">
            <SectionHeader title="Buyout Status" subtitle="Scope-by-scope view of budget, commitments, and projected remaining cost." />
            <BuyoutTable />
          </TabsContent>

          <TabsContent value="holds">
            <SectionHeader title="Holds" subtitle="Reserved margin against specific exposures (E-Holds) and general remaining uncertainty (C-Hold)." />
            <HoldsPanel holds={holds} setHolds={setHolds} />
          </TabsContent>

          <TabsContent value="change-orders">
            <SectionHeader title="Change Orders" subtitle="Approved, pending, unpriced, submitted, and disputed changes affecting contract value." />
            <ChangeOrdersTable />
          </TabsContent>

          <TabsContent value="schedule">
            <SectionHeader title="Schedule Risk" subtitle="Completion forecast, decision bottlenecks, procurement and trade performance risks." />
            <ScheduleRisk />
          </TabsContent>

          <TabsContent value="decisions">
            <SectionHeader title="Required Decisions" subtitle="The owner-level moves that will protect — or erode — indicated gross profit." />
            <DecisionsTable />
          </TabsContent>
        </Tabs>

        <footer className="border-t border-hairline pt-6 text-xs text-muted-foreground">
          Indicated GP recalculates as holds are added, released, or escalated. Last reviewed by Project Executive on {new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}.
        </footer>
      </main>
    </div>
  );
}

function SectionHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="mb-5">
      <h2 className="font-serif text-3xl text-foreground">{title}</h2>
      <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{subtitle}</p>
    </div>
  );
}
