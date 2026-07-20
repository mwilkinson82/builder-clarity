import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";

import { CashForecastTab } from "@/components/billing/portfolio/CashForecastTab";
import type { PortfolioBillingTotals } from "@/components/billing/portfolio/portfolio-billing-shared";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const ZERO_TOTALS: PortfolioBillingTotals = {
  project_count: 0,
  total_contract: 0,
  total_earned: 0,
  total_billed: 0,
  total_over_under: 0,
  total_cost: 0,
  estimated_gross_profit: 0,
  gross_profit_pct: 0,
  open_receivable: 0,
  retainage_held: 0,
  cash_collected_30_days: 0,
  cash_position: 0,
  aging: { current: 0, days_30: 0, days_60: 0, days_90: 0 },
};

let root: Root | null = null;
let container: HTMLElement | null = null;

function renderForecast({
  loading = false,
  error = null,
  retry = () => {},
}: { loading?: boolean; error?: string | null; retry?: () => void } = {}) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <CashForecastTab
        totals={ZERO_TOTALS}
        projects={[]}
        openInvoices={[]}
        cockpitLoading={loading}
        cockpitError={error}
        onCockpitRetry={retry}
        today="2026-07-20T00:00:00.000Z"
      />,
    );
  });
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

test("cash forecast never presents zero while invoice data is still loading", () => {
  renderForecast({ loading: true });

  expect(container?.textContent).toContain("Loading the complete cash forecast");
  expect(container?.textContent).not.toContain("13-week expected cash in");
  expect(container?.textContent).not.toContain("$0");
});

test("cash forecast surfaces a failed dependency and offers retry", () => {
  const retry = vi.fn();
  renderForecast({ error: "Payment activity did not load", retry });

  expect(container?.textContent).toContain("Cash forecast did not load");
  expect(container?.textContent).toContain("Payment activity did not load");
  expect(container?.textContent).not.toContain("13-week expected cash in");
  expect(container?.textContent).not.toContain("$0");

  const retryButton = Array.from(container?.querySelectorAll("button") ?? []).find(
    (button) => button.textContent?.trim() === "Retry",
  );
  expect(retryButton).toBeDefined();
  act(() => retryButton?.click());
  expect(retry).toHaveBeenCalledTimes(1);
});
