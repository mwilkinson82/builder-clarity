import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CockpitFloatingPanelHeader } from "@/components/estimates/plan-room/CockpitFloatingPanelHeader";
import { CommandCenterToolsNav } from "@/components/estimates/plan-room/CommandCenterToolsNav";

describe("Plan Room Takeoff Tools responsive layout", () => {
  it("keeps docked workspace tabs in two columns with wrapping labels", () => {
    const markup = renderToStaticMarkup(
      <CommandCenterToolsNav value="ai" onChange={() => undefined} />,
    );

    expect(markup).toContain("grid-cols-2");
    expect(markup).not.toContain("sm:grid-cols-4");
    expect(markup).toContain("whitespace-normal");
    expect(markup).toContain("Estimate Worksheet");
  });

  it("uses a dedicated control row in a docked floating panel", () => {
    const markup = renderToStaticMarkup(
      <CockpitFloatingPanelHeader
        title="Takeoff Tools"
        closeTestId="close"
        dragTestId="drag"
        resetTestId="reset"
        maximizeTestId="maximize"
        layoutLabel="390 x 520 · docked right · drag in any direction"
        maximized={false}
        onMoveStart={() => undefined}
        onMove={() => undefined}
        onMoveEnd={() => undefined}
        onReset={() => undefined}
        onToggleMaximize={() => undefined}
        onClose={() => undefined}
      />,
    );

    expect(markup).toContain("grid-cols-1");
    expect(markup).toContain("grid-cols-3");
    expect(markup).toContain("Full screen");
    expect(markup).toContain("Minimize");
  });

  it("restores a single-row tab strip only in the full workspace", () => {
    const markup = renderToStaticMarkup(
      <CommandCenterToolsNav expanded value="worksheet" onChange={() => undefined} />,
    );

    expect(markup).toContain("grid-cols-4");
    expect(markup).toContain('aria-current="page"');
  });
});
