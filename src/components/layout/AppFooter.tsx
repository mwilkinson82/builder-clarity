import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";

/**
 * v2 house footer — one of the structural signatures (docs/THEMING.md):
 * "OverWatch ▪ — an ALP product" wordmark left, a context summary right,
 * 70px tall on the wash ground, on every app page. The Help link makes support
 * reachable from every page that renders the footer.
 */
export function AppFooter({ context }: { context?: ReactNode }) {
  return (
    <footer className="mt-auto flex h-[70px] shrink-0 items-center justify-between gap-4 border-t border-hairline bg-wash px-5 font-mono text-[9.5px] font-bold uppercase tracking-[0.14em] text-muted-foreground sm:px-12">
      <span className="flex items-baseline gap-2.5 whitespace-nowrap">
        <span className="font-sans text-[30px] font-bold normal-case leading-none tracking-[-0.036em] text-muted-foreground">
          OverWatch
          <span aria-hidden="true" className="ml-1.5 inline-block h-[9px] w-[9px] bg-accent" />
        </span>
        <span className="hidden sm:inline">— an ALP product</span>
      </span>
      <div className="flex min-w-0 items-center gap-4">
        <Link to="/support" className="shrink-0 transition-colors hover:text-foreground">
          Help &amp; support
        </Link>
        {context ? (
          <span className="hidden min-w-0 truncate text-right sm:block">{context}</span>
        ) : null}
      </div>
    </footer>
  );
}
