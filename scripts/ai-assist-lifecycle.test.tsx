import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", () => ({
  useServerFn: (fn: unknown) => fn,
}));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() },
}));
vi.mock("@/components/estimates/plan-room/useAiCredits", () => ({
  useAiCredits: () => ({
    creditSummary: null,
    creditSummaryLoading: false,
    refreshCredits: vi.fn(),
    purchasePack: vi.fn(),
    isPurchasing: false,
  }),
}));
vi.mock("@/components/estimates/plan-room/AiScanDiagnostics", () => ({
  AiScanDiagnosticsDialog: () => null,
}));
vi.mock("@/lib/ai-takeoff/ai-takeoff.functions", () => ({
  beginAiCountScan: vi.fn(),
  completeAiCountScan: vi.fn(),
  failAiCountScan: vi.fn(),
  recordAiGhostRejection: vi.fn(),
  recordAiScanSheetSummary: vi.fn(),
  scanSheetTileForAiCounts: vi.fn(),
  verifyAiCountCandidate: vi.fn(),
}));
vi.mock("@/lib/ai-takeoff/ai-scan-diagnostics.functions", () => ({
  listPriorSheetRejections: vi.fn(),
}));
vi.mock("@/lib/ai-takeoff/ai-embed.functions", () => ({
  embedCropsForAiCounts: vi.fn(),
}));
vi.mock("@/lib/plan-room.functions", () => ({
  createTakeoffMeasurement: vi.fn(),
  updateTakeoffMeasurement: vi.fn(),
  planRoomBucket: "plan-room",
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { storage: { from: vi.fn() } },
}));
vi.mock("@/components/estimates/plan-room/aiDetectionRender", () => ({
  renderDetectionSheet: vi.fn(),
  renderExemplarCrop: vi.fn(),
  renderVerifyWindow: vi.fn(),
  sliceDetectionTiles: vi.fn(),
}));
vi.mock("@/lib/ai-takeoff/template-match/template-match-client", () => ({
  createTemplateMatchSession: vi.fn(),
}));

import { AiAssistPanel } from "@/components/estimates/plan-room/AiAssistPanel";
import { AiReviewBar } from "@/components/estimates/plan-room/AiReviewBar";
import {
  useAiAssist,
  type AiAssistController,
  type AiExternalReviewOutcome,
} from "@/components/estimates/plan-room/useAiAssist";
import type { AiCountProposal } from "@/lib/ai-takeoff/ai-takeoff-domain";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const PANEL_POSITION_STORAGE_KEY = "overwatch.plan-room.ai-panel-position.v1";

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function mount(element: React.ReactNode) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(element));
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
  window.sessionStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const proposal: AiCountProposal = {
  id: "proposal-1",
  sheetId: "sheet-a",
  x: 0.25,
  y: 0.4,
  confidence: 0.95,
  status: "pending",
  source: "model",
  originalX: 0.25,
  originalY: 0.4,
  nudged: false,
};

function reviewController(overrides: Partial<AiAssistController> = {}): AiAssistController {
  return {
    open: true,
    phase: "review",
    proposals: [proposal],
    pendingCount: 1,
    acceptedCount: 0,
    activeProposal: proposal,
    isAccepting: false,
    navigateReview: vi.fn(),
    acceptActiveProposal: vi.fn(),
    rejectActiveProposal: vi.fn(),
    nudgeActiveProposal: vi.fn(),
    acceptAllRemaining: vi.fn(),
    endReview: vi.fn(),
    ...overrides,
  } as unknown as AiAssistController;
}

function LifecycleHarness({
  onComplete,
}: {
  onComplete: (outcome: AiExternalReviewOutcome) => void;
}) {
  const [currentSheetId] = useState("sheet-a");
  const ai = useAiAssist({
    estimateId: "estimate-a",
    sheets: [],
    planSets: [],
    measurements: [],
    currentSheetId,
    viewSize: { width: 1_000, height: 1_000 },
    openSheet: vi.fn(),
    onTakeoffsChanged: vi.fn(),
  });
  return (
    <div>
      <button
        type="button"
        data-testid="seed-review"
        onClick={() =>
          ai.beginExternalReview({
            label: "Floor drains",
            radius: { x: 0.01, y: 0.01 },
            points: [{ sheetId: "sheet-a", x: 0.25, y: 0.4 }],
            onComplete,
          })
        }
      >
        Seed review
      </button>
      <button
        type="button"
        data-testid="toggle-ai"
        onClick={() => (ai.open ? ai.closePanel() : ai.openPanel())}
      >
        Toggle AI
      </button>
      <output data-testid="ai-state">
        {String(ai.open)}|{ai.phase}|{ai.proposals.length}
      </output>
      <AiReviewBar ai={ai} />
    </div>
  );
}

describe("AI Assist lifecycle", () => {
  it("ends the review and clears proposal ghosts when the panel toggle closes", () => {
    const onComplete = vi.fn();
    mount(<LifecycleHarness onComplete={onComplete} />);

    act(() => container!.querySelector<HTMLButtonElement>('[data-testid="seed-review"]')!.click());
    expect(container!.querySelector('[data-testid="ai-state"]')?.textContent).toBe("true|review|1");
    expect(container!.querySelector('[data-testid="ai-review-bar"]')).not.toBeNull();

    act(() => container!.querySelector<HTMLButtonElement>('[data-testid="toggle-ai"]')!.click());
    expect(container!.querySelector('[data-testid="ai-state"]')?.textContent).toBe("false|idle|0");
    expect(container!.querySelector('[data-testid="ai-review-bar"]')).toBeNull();
    expect(onComplete).toHaveBeenCalledWith({
      accepted: [],
      rejectedCount: 0,
      discardedCount: 1,
    });
  });

  it("keeps End review visible and all compact controls in a wrapping action row", () => {
    const endReview = vi.fn();
    mount(<AiReviewBar ai={reviewController({ endReview })} />);

    const bar = container!.querySelector<HTMLElement>('[data-testid="ai-review-bar"]')!;
    const actions = bar.lastElementChild as HTMLElement;
    const end = container!.querySelector<HTMLButtonElement>('[data-testid="ai-review-end"]')!;
    expect(actions.className).toContain("flex-wrap");
    expect(end.textContent).toContain("End review");
    expect(container!.querySelector('[aria-label="Nudge AI proposal left"]')).not.toBeNull();
    act(() => end.click());
    expect(endReview).toHaveBeenCalledOnce();
  });

  it("clamps a saved floating position on open and clamps again after resize", () => {
    let parentWidth = 375;
    let parentHeight = 600;
    let panelHeight = 450;
    let resizeObserverCallback: ResizeObserverCallback | null = null;
    const observedElements: Element[] = [];
    container = document.createElement("div");
    container.getBoundingClientRect = () =>
      ({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: parentWidth,
        bottom: parentHeight,
        width: parentWidth,
        height: parentHeight,
        toJSON: () => ({}),
      }) as DOMRect;
    document.body.appendChild(container);
    root = createRoot(container);

    const originalWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth");
    const originalHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
      configurable: true,
      get() {
        return (this as HTMLElement).dataset.testid === "ai-assist-panel" ? 330 : 0;
      },
    });
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
      configurable: true,
      get() {
        return (this as HTMLElement).dataset.testid === "ai-assist-panel" ? panelHeight : 0;
      },
    });
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: ResizeObserverCallback) {
          resizeObserverCallback = callback;
        }

        observe(target: Element) {
          observedElements.push(target);
        }

        unobserve() {}

        disconnect() {}
      },
    );
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);

    const closed = reviewController({
      open: false,
      phase: "idle",
      creditSummary: {
        balanceCredits: 0,
        aiAssistConfigured: false,
        schemaReady: true,
        isSuperAdmin: false,
        packs: [],
      } as AiAssistController["creditSummary"],
    });
    act(() => root!.render(<AiAssistPanel ai={closed} />));
    window.sessionStorage.setItem(PANEL_POSITION_STORAGE_KEY, JSON.stringify({ x: 900, y: 900 }));

    const opened = { ...closed, open: true };
    act(() => root!.render(<AiAssistPanel ai={opened} />));
    const panel = container.querySelector<HTMLElement>('[data-testid="ai-assist-panel"]')!;
    expect(panel.style.left).toBe("37px");
    expect(panel.style.top).toBe("142px");
    expect(observedElements).toContain(container);
    expect(observedElements).toContain(panel);

    panelHeight = 550;
    act(() => resizeObserverCallback!([], {} as ResizeObserver));
    expect(panel.style.top).toBe("42px");

    parentWidth = 300;
    parentHeight = 400;
    act(() => window.dispatchEvent(new Event("resize")));
    expect(panel.style.left).toBe("8px");
    expect(panel.style.top).toBe("8px");

    if (originalWidth) Object.defineProperty(HTMLElement.prototype, "offsetWidth", originalWidth);
    if (originalHeight)
      Object.defineProperty(HTMLElement.prototype, "offsetHeight", originalHeight);
  });
});
