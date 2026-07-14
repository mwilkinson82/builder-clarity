// Portfolio / Home screen — Reskin B6.
//
// The dark hero gives way to a light "briefing card" (border-top clay), followed
// by a NEW narrative "position this morning" band that reads the company's live
// gross-profit posture in one sentence + four proportion bars. Everything else —
// the Owner⇄PM toggle, the CRM pipeline, the won→delivery handoff, the posture
// tiles that filter the field worklist, the pursuits rail and company card — is
// preserved and restyled onto the ALP house tokens (via the portfolio-home.css
// alias layer). No figure is fabricated: the band is pure display off the same
// aggregates that feed the posture tiles and hero stats.
import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { AppFooter } from "@/components/layout/AppFooter";
import { closeProject } from "@/lib/projects.functions";
import { type HeroStat, type WorklistJob } from "./portfolio-home-data";
import { homeInitials, useHomeAccess, useHomeIdentity, type HomeIdentity } from "./home-identity";
import { useHomeMetrics } from "./use-home-metrics";
import { compactUSD, type HomeMetrics } from "./portfolio-home-metrics";
import { AvatarMenu } from "./home-avatar-menu";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import "./portfolio-home.css";

type HomeView = "owner" | "pm";
type WorklistFilter = "all" | "at-risk" | "overdue";

/** Render a "**bold**" placeholder string with the bold spans emphasized. */
function boldParts(text: string) {
  return text
    .split("**")
    .map((part, i) => (i % 2 === 1 ? <b key={i}>{part}</b> : <span key={i}>{part}</span>));
}

function toneClass(prefix: "ow-tone" | "ow-bg", tone: WorklistJob["tone"]) {
  return `${prefix}-${tone}`;
}

// CRM / projects live as tabs on the portfolio route; the cutover keeps these
// `?tab=` URLs working, so the home links here need no re-wiring when B6 lands on /.
const crmHref = (oppId?: string) => `/?tab=crm${oppId ? `&opportunity=${oppId}` : ""}`;
const CRM_HREF = "/?tab=crm";
const PROJECTS_HREF = "/?tab=projects";

/** The owning company's logo (initials fallback), shown left of a job's name. */
function JobLogo({ url, name }: { url: string; name: string }) {
  // Fall back to the company's initials when there's no logo URL *or* the image
  // fails to load — a broken <img> placeholder is worse than clean initials.
  const [failed, setFailed] = useState(false);
  return (
    <span className="ow-jobrow__logo" title={name}>
      {url && !failed ? (
        <img src={url} alt="" onError={() => setFailed(true)} />
      ) : (
        homeInitials(name, "•")
      )}
    </span>
  );
}

// A worklist row action to close a job out — always behind a confirm so nobody
// closes a live job by accident.
function CloseJobButton({ projectId, name }: { projectId: string; name: string }) {
  const qc = useQueryClient();
  const closeFn = useServerFn(closeProject);
  const mutation = useMutation({
    mutationFn: () => closeFn({ data: { projectId } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      toast.success("Job closed out");
    },
    onError: (err) => {
      toast.error("Could not close the job", {
        description: err instanceof Error ? err.message : "Try again.",
      });
    },
  });
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <button type="button" className="ow-jobrow__close" title="Close this job out">
          Close
        </button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Close {name} out?</AlertDialogTitle>
          <AlertDialogDescription>
            This marks the job complete and moves it to Closed jobs. It drops out of your active
            portfolio and its numbers — you can reopen it anytime.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction disabled={mutation.isPending} onClick={() => mutation.mutate()}>
            {mutation.isPending ? "Closing…" : "Close job"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// The light briefing card that opens both views: tenant logo + dateline eyebrow,
// serif greeting, the "needs you" alert, two path buttons, and a 2×2 stat grid.
function BriefingCard({
  identity,
  greeting,
  alert,
  stats,
  primary,
  secondary,
}: {
  identity: HomeIdentity;
  greeting: string;
  alert: { kicker: string; body: string };
  stats: HeroStat[];
  primary: { label: string; href: string };
  secondary: { label: string; href: string };
}) {
  return (
    <section className="ow-brief">
      <div className="ow-wrap ow-brief__card">
        <div className="ow-brief__main">
          <div className="ow-brief__id">
            <span className="ow-brief__logo" title={identity.companyName}>
              {identity.companyLogo ? (
                <img src={identity.companyLogo} alt="" />
              ) : (
                identity.companyInitials
              )}
            </span>
            <div>
              <div className="ow-brief__eyebrow">
                {identity.companyName} · {identity.dateline}
              </div>
              <h1 className="ow-brief__greet">{greeting}</h1>
            </div>
          </div>
          <div className="ow-brief__alert">
            <span className="ow-brief__alert-kicker">
              <span />
              {alert.kicker}
            </span>
            <span className="ow-brief__alert-div" />
            <span className="ow-brief__alert-body">{boldParts(alert.body)}</span>
          </div>
          <div className="ow-brief__cta">
            <a href={primary.href} className="ow-btn ow-btn--dark">
              {primary.label}
            </a>
            <a href={secondary.href} className="ow-btn ow-btn--outline">
              {secondary.label}
            </a>
          </div>
        </div>
        <div className="ow-brief__stats">
          {stats.map((stat) => {
            const crit = stat.valueTone === "crit";
            return (
              <div className="ow-brief__stat" key={stat.label}>
                <div className={`ow-brief__stat-label${crit ? " is-crit" : ""}`}>{stat.label}</div>
                <div className={`ow-brief__stat-value${crit ? " is-crit" : ""}`}>{stat.value}</div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// One proportion-bar row of the narrative band.
function PositionBar({
  label,
  fill,
  width,
  value,
}: {
  label: string;
  fill: "good" | "crit" | "warn" | "clay";
  width: number;
  value: string;
}) {
  return (
    <div className="ow-posbar">
      <span className="ow-posbar__label">{label}</span>
      <span className="ow-posbar__track">
        <span
          className={`ow-posbar__fill ow-bg-${fill}${fill === "clay" ? " is-clay" : ""}`}
          style={{ width: `${width}%` }}
        />
      </span>
      <span className={`ow-posbar__val ow-tone-${fill}`}>{value}</span>
    </div>
  );
}

// The NEW "position this morning" band — company-wide GP posture in one sentence
// plus four proportion bars, all read straight off metrics.position (no re-derive).
function NarrativeBand({
  identity,
  position,
}: {
  identity: HomeIdentity;
  position: HomeMetrics["position"];
}) {
  const { indicatedGP, gpAtRiskExposed, gpAtRiskPct, openHoldsTotal, weighted } = position;
  // Bar widths are shares of indicated GP, clamped so a sliver still paints and no
  // bar overruns its track. Weighted pursuit keeps a small floor so it never vanishes.
  const riskPct = Math.min(100, Math.max(0, gpAtRiskPct));
  const heldPct = indicatedGP > 0 ? Math.min(100, (openHoldsTotal / indicatedGP) * 100) : 0;
  const weightedPct =
    indicatedGP > 0 ? Math.max(8, Math.min(100, (weighted / indicatedGP) * 100)) : 8;
  const hasRisk = gpAtRiskExposed > 0;

  return (
    <section className="ow-position">
      <div className="ow-wrap ow-position__wrap">
        <div className="ow-position__main">
          <div className="ow-eyebrow">The position this morning</div>
          <h2 className="ow-position__lead">
            The company is indicating <em className="ow-tone-good">{compactUSD(indicatedGP)}</em> of
            gross profit —{" "}
            {hasRisk ? (
              <em className="ow-tone-crit">
                {compactUSD(gpAtRiskExposed)} forecasting below signed
              </em>
            ) : (
              <em className="ow-tone-good">every job holding at or above signed</em>
            )}
            .
          </h2>
          <div className="ow-position__bars">
            <PositionBar
              label="Indicated GP"
              fill="good"
              width={100}
              value={compactUSD(indicatedGP)}
            />
            <PositionBar
              label="Forecasting below signed"
              fill="crit"
              width={riskPct}
              value={compactUSD(gpAtRiskExposed)}
            />
            <PositionBar
              label="Held against live risk"
              fill="warn"
              width={heldPct}
              value={compactUSD(openHoldsTotal)}
            />
            <PositionBar
              label="Weighted pursuit"
              fill="clay"
              width={weightedPct}
              value={compactUSD(weighted)}
            />
          </div>
        </div>
        <div className="ow-position__mark" aria-hidden="true">
          <span className="ow-position__mark-square">
            {identity.companyLogo ? (
              <img src={identity.companyLogo} alt="" />
            ) : (
              identity.companyInitials
            )}
          </span>
          <span className="ow-position__mark-label">{identity.companyName}</span>
        </div>
      </div>
    </section>
  );
}

export function PortfolioHome() {
  const identity = useHomeIdentity();
  const access = useHomeAccess();
  const { metrics } = useHomeMetrics();
  const [view, setView] = useState<HomeView>("owner");
  const [filter, setFilter] = useState<WorklistFilter>("all");

  // PM-scoped users only ever see the PM view; the Owner⇄PM switch is theirs to
  // flip only when they can see the company-wide track.
  const effectiveView: HomeView = access.canSeeOwnerView ? view : "pm";

  const filteredJobs = useMemo(() => {
    if (filter === "at-risk") return metrics.worklist.filter((j) => j.atRisk);
    if (filter === "overdue") return metrics.worklist.filter((j) => j.overdue);
    return metrics.worklist;
  }, [filter, metrics.worklist]);

  const shownLabel =
    filter === "at-risk"
      ? `At risk · ${filteredJobs.length}`
      : filter === "overdue"
        ? `Overdue · ${filteredJobs.length}`
        : `Showing all ${filteredJobs.length}`;

  return (
    <div className="ow-home">
      <div className="ow-shell">
        {/* ---------- customer-forward header (white-label) ---------- */}
        <header className="ow-header">
          <Link
            to="/team"
            className="ow-switcher"
            title={`${identity.companyName} — switch workspace`}
          >
            <span className="ow-switcher__logo">
              {identity.companyLogo ? (
                <img src={identity.companyLogo} alt="" />
              ) : (
                identity.companyInitials
              )}
            </span>
            <span className="ow-switcher__name">{identity.companyName}</span>
            <span className="ow-switcher__caret">▾</span>
          </Link>
          <nav className="ow-nav">
            <a className="is-active" href="/" aria-current="page">
              Portfolio
            </a>
            <a href={PROJECTS_HREF}>Projects</a>
            {access.canSeeOwnerView ? <a href={CRM_HREF}>CRM</a> : null}
            <Link to="/estimates">Estimates</Link>
            <Link to="/billing">Billing</Link>
            <Link to="/reports">Reports</Link>
            <Link to="/team">Team</Link>
          </nav>
          <div className="ow-header__right">
            <div className="ow-search" role="search">
              <span>⌕</span>
              <span>Search…</span>
            </div>
            <a href={PROJECTS_HREF} className="ow-btn ow-btn--signal">
              + New project
            </a>
            <NotificationBell className="border-white/15 bg-white/10 text-white/75 hover:text-white" />
            <AvatarMenu identity={identity} />
          </div>
        </header>

        {/* ---------- level marker + live view toggle ---------- */}
        <div className="ow-levelbar">
          <span className="ow-levelpill">
            <span className="ow-levelpill__dot" />
            Portfolio level
          </span>
          {access.canSeeOwnerView ? (
            <span className="ow-viewas">
              <span className="ow-viewas__label">View as</span>
              <span className="ow-toggle" role="group" aria-label="View as">
                <button
                  type="button"
                  className={`ow-seg${view === "owner" ? " is-active" : ""}`}
                  aria-pressed={view === "owner"}
                  onClick={() => setView("owner")}
                >
                  ◔ Owner
                </button>
                <button
                  type="button"
                  className={`ow-seg${view === "pm" ? " is-active" : ""}`}
                  aria-pressed={view === "pm"}
                  onClick={() => setView("pm")}
                >
                  ◱ PM
                </button>
              </span>
            </span>
          ) : null}
        </div>

        {effectiveView === "owner" ? (
          <OwnerView
            identity={identity}
            metrics={metrics}
            filter={filter}
            setFilter={setFilter}
            filteredJobs={filteredJobs}
            shownLabel={shownLabel}
          />
        ) : (
          <PmView identity={identity} metrics={metrics} />
        )}

        <AppFooter context={`${identity.companyName} · Portfolio`} />
      </div>
    </div>
  );
}

function OwnerView({
  identity,
  metrics,
  filter,
  setFilter,
  filteredJobs,
  shownLabel,
}: {
  identity: HomeIdentity;
  metrics: HomeMetrics;
  filter: WorklistFilter;
  setFilter: (f: WorklistFilter) => void;
  filteredJobs: WorklistJob[];
  shownLabel: string;
}) {
  const tileFilter: Record<string, WorklistFilter> = {
    active: "all",
    "at-risk": "at-risk",
    overdue: "overdue",
  };

  // "N of M at risk" — read straight off the posture tiles so it never disagrees
  // with the At-risk / Active tiles beside it.
  const atRiskValue = metrics.posture.find((t) => t.key === "at-risk")?.value ?? "0";
  const activeValue = metrics.posture.find((t) => t.key === "active")?.value ?? "0";
  const atRiskSummary = `${atRiskValue} of ${activeValue} at risk`;

  return (
    <>
      <BriefingCard
        identity={identity}
        greeting={`${identity.greeting}, ${identity.userFirstName}.`}
        alert={metrics.ownerAlert}
        stats={metrics.ownerStats}
        primary={{ label: `Open ${identity.companyName} projects →`, href: PROJECTS_HREF }}
        secondary={{ label: `Open ${identity.companyName} CRM →`, href: CRM_HREF }}
      />

      <NarrativeBand identity={identity} position={metrics.position} />

      {/* Track 1 · Winning work — CRM pipeline + won→delivery handoff */}
      <section className="ow-track">
        <div className="ow-wrap">
          <div className="ow-track__head">
            <div>
              <div className="ow-eyebrow">Track 1 · Winning work</div>
              <div className="ow-track__title">
                Pipeline &amp; pursuits{" "}
                <span className="ow-track__title-sub">— CRM → Estimating → Contract</span>
              </div>
            </div>
            <a href={CRM_HREF} className="ow-btn ow-btn--dark">
              Open {identity.companyName} CRM board →
            </a>
          </div>
          <div className="ow-pipeline">
            {metrics.pipeline.map((stage) => (
              // Estimating opens the Estimates module (its bid); every other stage
              // opens that opportunity on the CRM board.
              <a
                key={stage.key}
                href={stage.estimatesLink ? "/estimates" : crmHref(stage.oppId)}
                className={`ow-stage${stage.dim ? " is-dim" : ""}${
                  stage.highlight === "clay"
                    ? " is-clay"
                    : stage.highlight === "good"
                      ? " is-good"
                      : ""
                }`}
              >
                <div className="ow-stage__top">
                  <span className="ow-stage__label">{stage.label}</span>
                  {stage.estimatesLink ? <span className="ow-stage__link">Estimates ↗</span> : null}
                </div>
                <div className="ow-stage__count">{stage.count}</div>
                {stage.name ? (
                  <>
                    <div className="ow-stage__name">{stage.name}</div>
                    <div className="ow-stage__meta">{stage.meta}</div>
                  </>
                ) : (
                  <div className="ow-stage__empty">{stage.meta}</div>
                )}
              </a>
            ))}
          </div>

          {/* handoff banner, now inline in Track 1 (only when a pursuit has crossed over) */}
          {metrics.handoffName ? (
            <div className="ow-handoff">
              <span className="ow-handoff__arrow">↓</span>
              <div className="ow-handoff__text">
                <b>Won pursuits convert to managed projects.</b>{" "}
                <span>
                  {metrics.handoffName} just crossed over — it now lives in the delivery track
                  below.
                </span>
              </div>
              <a href={CRM_HREF} className="ow-btn ow-btn--outline">
                See conversions →
              </a>
            </div>
          ) : null}

          <div className="ow-note">
            Estimating is a pipeline stage — the bid is built in <b>OverWatch Estimates</b>, then
            negotiated before a contract is signed.
          </div>
        </div>
      </section>

      {/* Track 2 · Building it — posture tiles + field worklist + pursuits/company rail */}
      <section className="ow-track ow-track--last">
        <div className="ow-wrap">
          <div className="ow-track__head">
            <div>
              <div className="ow-eyebrow">Track 2 · Building it</div>
              <div className="ow-track__title">
                Company-wide posture{" "}
                <span className="ow-track__title-sub">— click a tile to filter the worklist</span>
              </div>
            </div>
            <span className="ow-track__summary">{atRiskSummary}</span>
          </div>

          <div className="ow-tiles">
            {metrics.posture.map((tile) => {
              if (tile.variant === "dark") {
                return (
                  <div className="ow-tile ow-tile--dark" key={tile.key}>
                    <div className="ow-tile__label">{tile.label}</div>
                    <div className="ow-tile__value">{tile.value}</div>
                    <div
                      className={`ow-tile__sub${tile.subTone === "good" ? " is-good" : tile.subTone === "crit" ? " is-crit" : ""}`}
                    >
                      {tile.sub}
                    </div>
                  </div>
                );
              }
              const target = tileFilter[tile.key] ?? "all";
              const isActive = tile.key !== "active" && filter === target;
              return (
                <button
                  type="button"
                  className={`ow-tile ow-tile--filter${isActive ? " is-active" : ""}`}
                  key={tile.key}
                  onClick={() => setFilter(target)}
                  aria-pressed={isActive}
                >
                  <div className={`ow-tile__label${tile.labelTone === "crit" ? " is-crit" : ""}`}>
                    {tile.label}
                  </div>
                  <div className={`ow-tile__value${tile.valueTone === "crit" ? " is-crit" : ""}`}>
                    {tile.value}
                  </div>
                  <div className="ow-tile__sub">{tile.sub}</div>
                </button>
              );
            })}
          </div>

          <div className="ow-delivery">
            <div>
              <div className="ow-worklist-head">
                <span className="ow-worklist-head__title">What needs you on the field</span>
                <span className="ow-rule" />
                <span className="ow-worklist-head__count">{shownLabel}</span>
                {filter !== "all" ? (
                  <button type="button" className="ow-clear" onClick={() => setFilter("all")}>
                    Clear ×
                  </button>
                ) : null}
              </div>

              <div className="ow-worklist">
                {filteredJobs.length === 0 ? (
                  <div className="ow-worklist__empty">Nothing in this filter right now.</div>
                ) : (
                  filteredJobs.map((job) => (
                    <div className="ow-jobrow" key={job.id}>
                      <span className={`ow-jobrow__dot ${toneClass("ow-bg", job.tone)}`} />
                      <div className={`ow-jobrow__tag ${toneClass("ow-tone", job.tone)}`}>
                        {job.tag}
                      </div>
                      <JobLogo url={job.logoUrl} name={job.orgName} />
                      <div className="ow-jobrow__body">
                        <div className="ow-jobrow__name">{job.name}</div>
                        <div className="ow-jobrow__desc">{job.desc}</div>
                      </div>
                      {job.value ? (
                        <div className={`ow-jobrow__val ${toneClass("ow-tone", job.tone)}`}>
                          {job.value}
                        </div>
                      ) : null}
                      <CloseJobButton projectId={job.id} name={job.name} />
                      <Link
                        to="/projects/$projectId"
                        params={{ projectId: job.id }}
                        className="ow-jobrow__open"
                      >
                        Open →
                      </Link>
                    </div>
                  ))
                )}

                {/* closed jobs collapse, merged into the worklist footer row */}
                {metrics.closedJobs.length > 0 ? (
                  <details className="ow-closed">
                    <summary className="ow-closed__summary">
                      Show all {metrics.worklist.length} · Closed jobs ({metrics.closedJobs.length})
                    </summary>
                    {metrics.closedJobs.map((job) => (
                      <div className="ow-jobrow" key={job.id}>
                        <span className="ow-jobrow__dot ow-bg-muted" />
                        <div className="ow-jobrow__tag ow-tone-muted">{job.tag}</div>
                        <JobLogo url={job.logoUrl} name={job.orgName} />
                        <div className="ow-jobrow__body">
                          <div className="ow-jobrow__name">{job.name}</div>
                          <div className="ow-jobrow__desc">{job.desc}</div>
                        </div>
                        <Link
                          to="/projects/$projectId"
                          params={{ projectId: job.id }}
                          className="ow-jobrow__open"
                        >
                          Open →
                        </Link>
                      </div>
                    ))}
                  </details>
                ) : null}
              </div>
            </div>

            {/* rail: pursuits needing a move + company card */}
            <aside className="ow-aside">
              <div className="ow-card">
                <div className="ow-eyebrow">Pursuits needing a move</div>
                {metrics.pursuits.length === 0 ? (
                  <div className="ow-pursuit__context" style={{ padding: "8px 0" }}>
                    No pursuits waiting on a move.
                  </div>
                ) : null}
                {metrics.pursuits.map((pursuit, i) => (
                  <a
                    className="ow-pursuit"
                    key={`${pursuit.title}-${i}`}
                    href={crmHref(pursuit.oppId)}
                  >
                    <span className="ow-pursuit__row">
                      <span className="ow-pursuit__title">{pursuit.title}</span>
                      <span
                        className={`ow-pursuit__due${pursuit.dueTone === "crit" ? " is-crit" : ""}`}
                      >
                        {pursuit.due}
                      </span>
                    </span>
                    <span className="ow-pursuit__context">{pursuit.context}</span>
                  </a>
                ))}
              </div>

              <div className="ow-card">
                <div className="ow-company__head">
                  <span className="ow-company__logo">
                    {identity.companyLogo ? (
                      <img src={identity.companyLogo} alt="" />
                    ) : (
                      identity.companyInitials
                    )}
                  </span>
                  <div>
                    <div className="ow-company__eyebrow">Company</div>
                    <div className="ow-company__name">{identity.companyName}</div>
                  </div>
                </div>
                <Link to="/billing" className="ow-company__row">
                  <span>Billing &amp; payouts</span>
                  <span className="ow-company__row-meta">→</span>
                </Link>
                <Link to="/team" className="ow-company__row">
                  <span>Clients &amp; team</span>
                  <span className="ow-company__row-meta">→</span>
                </Link>
                <Link to="/team" className="ow-company__row">
                  <span>Plan &amp; storage</span>
                  <span className="ow-company__row-meta">62%</span>
                </Link>
              </div>
            </aside>
          </div>
        </div>
      </section>
    </>
  );
}

function PmView({ identity, metrics }: { identity: HomeIdentity; metrics: HomeMetrics }) {
  const greeting = `${identity.greeting === "Good morning" ? "Morning" : identity.greeting}, ${identity.userFirstName}.`;
  return (
    <>
      <BriefingCard
        identity={identity}
        greeting={greeting}
        alert={metrics.pmAlert}
        stats={metrics.pmStats}
        primary={{ label: "Start today's logs →", href: PROJECTS_HREF }}
        secondary={{ label: "My to-dos →", href: PROJECTS_HREF }}
      />

      <section className="ow-track ow-track--last">
        <div className="ow-wrap">
          <div className="ow-worklist-head">
            <span className="ow-worklist-head__title">Your jobs — sorted by what needs you</span>
            <span className="ow-rule" />
          </div>
          <div className="ow-worklist">
            {metrics.pmJobs.length === 0 ? (
              <div className="ow-worklist__empty">No jobs yet.</div>
            ) : null}
            {metrics.pmJobs.map((job, i) => (
              <div className="ow-jobrow" key={job.id}>
                <span className={`ow-jobrow__dot ${toneClass("ow-bg", job.tone)}`} />
                <div className={`ow-jobrow__tag ${toneClass("ow-tone", job.tone)}`}>{job.tag}</div>
                <JobLogo url={job.logoUrl} name={job.orgName} />
                <div className="ow-jobrow__body">
                  <div className="ow-jobrow__name">{job.name}</div>
                  <div className="ow-jobrow__desc">{job.desc}</div>
                </div>
                {i < 3 ? (
                  <Link
                    to="/projects/$projectId"
                    params={{ projectId: job.id }}
                    className="ow-btn ow-btn--dark"
                    style={{ fontSize: 12, padding: "9px 15px" }}
                  >
                    Open job →
                  </Link>
                ) : (
                  <Link
                    to="/projects/$projectId"
                    params={{ projectId: job.id }}
                    className="ow-jobrow__open"
                  >
                    Open →
                  </Link>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
