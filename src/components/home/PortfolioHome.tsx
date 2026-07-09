// Portfolio / Home screen — redesign option 6a (Turn 6, interactive).
//
// PHASE 1: a faithful, client-side reproduction of the approved 6a mock with the
// design's placeholder data. The two behaviors 6a demonstrates are real here:
//   • the Owner ⇄ PM view toggle (client state; wire to real role in Phase 2)
//   • clickable posture tiles that filter the field worklist in place
// PHASE 2 (separate PR) replaces placeholders with live CRM + project aggregates.
//
// The design canvas renders as a fixed 1240px "device card"; here it's adapted
// to a real full-page route (centered shell, no dramatic float shadow). On-dark
// hex tints are kept verbatim — the one place the house system allows literal hex.
import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";

import { type HeroStat, type WorklistJob } from "./portfolio-home-data";
import { homeInitials, useHomeIdentity, type HomeIdentity } from "./home-identity";
import { useHomeMetrics } from "./use-home-metrics";
import { type HomeMetrics } from "./portfolio-home-metrics";
import { AvatarMenu } from "./home-avatar-menu";
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
  return `${prefix}-${tone === "muted" ? "" : tone}`.trim();
}

/** The owning company's logo (initials fallback), shown left of a job's name. */
function JobLogo({ url, name }: { url: string; name: string }) {
  return (
    <span className="ow-jobrow__logo" title={name}>
      {url ? <img src={url} alt="" /> : homeInitials(name, "•")}
    </span>
  );
}

function HeroStats({ stats }: { stats: HeroStat[] }) {
  return (
    <div className="ow-hero__stats">
      {stats.map((stat) => (
        <div className="ow-hero__stat" key={stat.label}>
          <div className={`ow-hero__stat-label${stat.valueTone === "crit" ? " is-crit" : ""}`}>
            {stat.label}
          </div>
          <div className="ow-hero__stat-row">
            <span className={`ow-hero__stat-value${stat.valueTone === "crit" ? " is-crit" : ""}`}>
              {stat.value}
            </span>
            {stat.ticker ? (
              <span
                className={`ow-hero__stat-ticker${stat.tickerTone === "crit" ? " is-crit" : ""}`}
              >
                {stat.ticker}
              </span>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}

export function PortfolioHome() {
  const identity = useHomeIdentity();
  const { metrics } = useHomeMetrics();
  const [view, setView] = useState<HomeView>("owner");
  const [filter, setFilter] = useState<WorklistFilter>("all");

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
          <div className="ow-brand">
            <span className="ow-logo">
              {identity.companyLogo ? (
                <img
                  src={identity.companyLogo}
                  alt=""
                  style={{ width: "100%", height: "100%", borderRadius: 10, objectFit: "cover" }}
                />
              ) : (
                identity.companyInitials
              )}
            </span>
            <Link
              to="/team"
              className="ow-brandname"
              style={{ color: "inherit", textDecoration: "none", display: "inline-flex", gap: 7 }}
            >
              {identity.companyName} <span style={{ color: "var(--muted)", fontSize: 12 }}>▾</span>
            </Link>
          </div>
          <nav className="ow-nav">
            <a className="is-active" href="/home-preview" aria-current="page">
              Portfolio
            </a>
            <a href="/?tab=crm">CRM</a>
            <Link to="/estimates">Estimates</Link>
            <Link to="/billing">Billing</Link>
            <Link to="/reports">Reports</Link>
          </nav>
          <div className="ow-header__right">
            <div className="ow-search" role="search">
              <span>⌕</span>
              <span>Search…</span>
            </div>
            <Link to="/" className="ow-btn ow-btn--signal">
              + New project
            </Link>
            <AvatarMenu identity={identity} />
          </div>
        </header>

        {/* ---------- level marker + live view toggle ---------- */}
        <div className="ow-levelbar">
          <span className="ow-levelpill">
            <span className="ow-levelpill__dot" />
            Portfolio level
          </span>
          <span className="ow-levelbar__hint">Try the switch →</span>
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
        </div>

        {view === "owner" ? (
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

        <HomeFooter />
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

  return (
    <>
      {/* dark hero */}
      <section className="ow-hero">
        <div className="ow-hero__date">{identity.dateline}</div>
        <h1 className="ow-hero__greet">
          {identity.greeting}, {identity.userFirstName}.
        </h1>
        <div className="ow-hero__alert">
          <span className="ow-hero__alert-kicker">
            <span />
            {metrics.ownerAlert.kicker}
          </span>
          <span className="ow-hero__alert-div" />
          <span className="ow-hero__alert-body">{boldParts(metrics.ownerAlert.body)}</span>
        </div>
        <HeroStats stats={metrics.ownerStats} />
        <div className="ow-hero__cta">
          <Link to="/" className="ow-btn ow-btn--light">
            Open {identity.companyName} projects →
          </Link>
          <a href="/?tab=crm" className="ow-btn ow-btn--ghost-dark">
            Open {identity.companyName} CRM →
          </a>
        </div>
      </section>

      {/* new business — CRM pipeline */}
      <section className="ow-section">
        <div className="ow-section__head">
          <div>
            <div className="ow-eyebrow">New business · CRM → Estimating → Contract</div>
            <div className="ow-lead">Pipeline &amp; pursuits</div>
          </div>
          <a href="/?tab=crm" className="ow-btn ow-btn--dark">
            Open {identity.companyName} CRM board →
          </a>
        </div>
        <div className="ow-pipeline">
          {metrics.pipeline.map((stage) => (
            <div
              key={stage.key}
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
                {stage.estimatesLink ? (
                  <Link to="/estimates" className="ow-stage__link">
                    Estimates ↗
                  </Link>
                ) : null}
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
            </div>
          ))}
        </div>
        <div className="ow-note">
          Estimating is a pipeline stage — the bid is built in <b>OverWatch Estimates</b>, then
          negotiated before a contract is signed.
        </div>
      </section>

      {/* handoff: won → managed project (only when a pursuit has actually crossed over) */}
      {metrics.handoffName ? (
        <div className="ow-handoff">
          <span className="ow-handoff__arrow">↓</span>
          <div style={{ flex: 1 }}>
            <div className="ow-handoff__title">Won pursuits convert to managed projects.</div>
            <div className="ow-handoff__sub">
              {metrics.handoffName} just crossed over — it now lives in the delivery track below.
            </div>
          </div>
          <a href="/?tab=crm" className="ow-btn ow-btn--dark">
            See pursuit conversions →
          </a>
        </div>
      ) : null}

      {/* delivery: posture tiles + worklist + rail */}
      <div className="ow-delivery">
        <div className="ow-delivery__main">
          <div className="ow-eyebrow">Active projects · Field &amp; IOR delivery</div>
          <div className="ow-lead">Company-wide posture</div>
          <div className="ow-delivery__hint">Click a tile to filter the worklist.</div>

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
          </div>
        </div>

        {/* rail: pursuits needing a move + company card */}
        <aside className="ow-rail">
          <div className="ow-rail__title">Pursuits needing a move</div>
          {metrics.pursuits.length === 0 ? (
            <div className="ow-pursuit__context" style={{ padding: "8px 0" }}>
              No pursuits waiting on a move.
            </div>
          ) : null}
          {metrics.pursuits.map((pursuit, i) => (
            <button
              type="button"
              className="ow-pursuit"
              key={`${pursuit.title}-${i}`}
              style={{ width: "100%", textAlign: "left", background: "none" }}
            >
              <span className="ow-pursuit__row">
                <span className="ow-pursuit__title">{pursuit.title}</span>
                <span className={`ow-pursuit__due${pursuit.dueTone === "crit" ? " is-crit" : ""}`}>
                  {pursuit.due}
                </span>
              </span>
              <span className="ow-pursuit__context">{pursuit.context}</span>
            </button>
          ))}

          <div className="ow-company">
            <div className="ow-company__head">
              <span className="ow-company__logo">
                {identity.companyLogo ? (
                  <img
                    src={identity.companyLogo}
                    alt=""
                    style={{ width: "100%", height: "100%", borderRadius: 7, objectFit: "cover" }}
                  />
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
              <span className="ow-company__row-meta is-mono">62%</span>
            </Link>
          </div>
        </aside>
      </div>
    </>
  );
}

function PmView({ identity, metrics }: { identity: HomeIdentity; metrics: HomeMetrics }) {
  return (
    <>
      <section className="ow-hero">
        <div className="ow-hero__date">{identity.dateline}</div>
        <h1 className="ow-hero__greet">
          {identity.greeting === "Good morning" ? "Morning" : identity.greeting},{" "}
          {identity.userFirstName}.
        </h1>
        <div className="ow-hero__alert">
          <span className="ow-hero__alert-kicker">
            <span />
            {metrics.pmAlert.kicker}
          </span>
          <span className="ow-hero__alert-div" />
          <span className="ow-hero__alert-body">{boldParts(metrics.pmAlert.body)}</span>
        </div>
        <HeroStats stats={metrics.pmStats} />
        <div className="ow-hero__cta">
          <Link to="/" className="ow-btn ow-btn--light">
            Start today's logs →
          </Link>
          <Link to="/" className="ow-btn ow-btn--ghost-dark">
            My to-dos →
          </Link>
        </div>
      </section>

      <section className="ow-section">
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
      </section>
    </>
  );
}

function HomeFooter() {
  return (
    <footer>
      <div className="ow-footer-brand">
        <div className="ow-footer-kicker">Run every job through the money.</div>
        <div className="ow-wordmark">
          OverWatch
          <span className="ow-wordmark__dot" />
        </div>
      </div>
      <div className="ow-footer-bar">
        <span>© 2026 ALP · OVERWATCH — AN ALP PRODUCT</span>
        <span className="ow-footer-bar__links">
          <a href="/support">SUPPORT</a>
          <a href="/support">DOCS</a>
          <a href="/auth">SIGN OUT</a>
        </span>
      </div>
    </footer>
  );
}
