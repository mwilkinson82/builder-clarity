import type { ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getCompanyWorkspaceContext } from "@/lib/team.functions";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

/**
 * v2 business-layer shell: the shared top bar for every portfolio/business
 * page (Portfolio · Projects · CRM · Estimates · Billing · Reports · Team) with the company
 * switcher. NOT for project-detail pages — those keep the floating rail.
 *
 * Self-fetches the company context off the shared query key so a page only
 * needs `<PortfolioTopBar active="…" />`; the `actions` slot carries any
 * page-specific CTA (e.g. "+ New estimate").
 */
type NavKey = "portfolio" | "projects" | "crm" | "estimates" | "billing" | "reports" | "team";

const NAV: { key: NavKey; label: string }[] = [
  { key: "portfolio", label: "Portfolio" },
  { key: "projects", label: "Projects" },
  { key: "crm", label: "CRM" },
  { key: "estimates", label: "Estimates" },
  { key: "billing", label: "Billing" },
  { key: "reports", label: "Reports" },
  { key: "team", label: "Team" },
];

function initialsOf(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "OW"
  );
}

export function PortfolioTopBar({ active, actions }: { active: NavKey; actions?: ReactNode }) {
  const navigate = useNavigate();
  const loadCompany = useServerFn(getCompanyWorkspaceContext);
  const { data: company } = useQuery({
    queryKey: ["company-workspace-context"],
    queryFn: () => loadCompany(),
  });

  const name = company?.name || "Company";
  const logo = company?.logo_url || "";

  const navItemClass = (key: NavKey) =>
    cn(
      "border-b-2 px-0.5 py-1.5 text-[13px] transition-colors",
      key === active
        ? "border-clay font-semibold text-foreground"
        : "border-transparent font-medium text-muted-foreground hover:text-foreground",
    );

  return (
    <header className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-hairline bg-surface px-5 py-3 sm:px-10">
      {/* Company switcher — routes to Team (the settings console) as today;
          real multi-company switching would be new behavior. */}
      <Link to="/team" className="flex shrink-0 items-center gap-2" aria-label={`${name} settings`}>
        {logo ? (
          <img src={logo} alt="" className="h-7 w-7 rounded-lg object-contain" />
        ) : (
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary font-serif text-[11px] text-primary-foreground">
            {initialsOf(name)}
          </span>
        )}
        <span className="max-w-[180px] truncate text-[13.5px] font-semibold text-foreground">
          {name}
        </span>
        <span className="text-[11px] text-muted-foreground">▾</span>
      </Link>

      <nav className="flex items-center gap-5">
        <Link to="/" className={navItemClass("portfolio")}>
          Portfolio
        </Link>
        <Link to="/" search={{ tab: "projects" }} className={navItemClass("projects")}>
          Projects
        </Link>
        <Link to="/" search={{ tab: "crm" }} className={navItemClass("crm")}>
          CRM
        </Link>
        <Link to="/estimates" className={navItemClass("estimates")}>
          Estimates
        </Link>
        <Link to="/billing" className={navItemClass("billing")}>
          Billing
        </Link>
        <Link to="/reports" className={navItemClass("reports")}>
          Reports
        </Link>
        <Link to="/team" className={navItemClass("team")}>
          Team
        </Link>
      </nav>

      <div className="ml-auto flex items-center gap-3">
        {actions}
        <button
          type="button"
          onClick={() => {
            void supabase.auth.signOut().then(() => navigate({ to: "/auth" }));
          }}
          className="text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          Sign out
        </button>
      </div>
    </header>
  );
}

export type { NavKey as PortfolioNavKey };
