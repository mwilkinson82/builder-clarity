import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DiscoveryMarkupLayer } from "@/components/estimates/plan-room/DiscoveryMarkupLayer";
import type { DiscoveryMarkup } from "@/components/estimates/plan-room/useSymbolDiscovery";
import {
  parseSymbolEmbedding,
  resolveSymbolLibrarySuggestions,
} from "@/lib/ai-takeoff/symbol-library-domain";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const unit = (size: number, index: number) =>
  Array.from({ length: size }, (_, current) => (current === index ? 1 : 0));

const atCosine = (score: number) => [
  score,
  Math.sqrt(1 - score * score),
  ...Array.from({ length: 62 }, () => 0),
];

describe("AI symbol identification library", () => {
  it("suggests only a high-confidence estimator-approved label", () => {
    const embeddings = [unit(64, 0), unit(64, 1), unit(64, 2)];
    const suggestions = resolveSymbolLibrarySuggestions({
      clusters: [
        { memberIndexes: [0, 1], medoidIndex: 0, cohesion: 0.9 },
        { memberIndexes: [2], medoidIndex: 2, cohesion: 1 },
      ],
      embeddings,
      examples: [
        {
          itemId: "brush",
          label: "Mechanical Brush",
          trade: "Equipment",
          unit: "EA",
          costLibraryItemId: null,
          embedding: unit(64, 0),
        },
      ],
      threshold: 0.8,
    });
    expect(suggestions).toEqual([
      expect.objectContaining({
        clusterIndex: 0,
        itemId: "brush",
        label: "Mechanical Brush",
        score: 1,
      }),
    ]);
  });

  it("fails closed on malformed or undersized stored embeddings", () => {
    expect(parseSymbolEmbedding([1, 2, 3])).toBeNull();
    expect(parseSymbolEmbedding([...unit(64, 0).slice(0, 63), Number.NaN])).toBeNull();
    expect(parseSymbolEmbedding(unit(64, 0))).toHaveLength(64);
  });

  it("requires representative and near-exact member evidence before suggesting a label", () => {
    const embeddings = [atCosine(0.81), atCosine(0.84), atCosine(0.83), unit(64, 0)];
    const suggestions = resolveSymbolLibrarySuggestions({
      clusters: [
        { memberIndexes: [0, 1], medoidIndex: 0, cohesion: 0.85 },
        { memberIndexes: [2, 3], medoidIndex: 2, cohesion: 0.85 },
      ],
      embeddings,
      examples: [
        {
          itemId: "brush",
          label: "Mechanical Brush",
          trade: "Equipment",
          unit: "EA",
          costLibraryItemId: null,
          embedding: unit(64, 0),
        },
      ],
      threshold: 0.9,
      memberThreshold: 0.95,
    });

    expect(suggestions).toEqual([
      expect.objectContaining({
        clusterIndex: 1,
        itemId: "brush",
        label: "Mechanical Brush",
        score: 0.915,
      }),
    ]);
  });

  it("renders keyboard-addressable dashed proposals separately from accepted counts", () => {
    const markups: DiscoveryMarkup[] = [
      {
        id: "group-1-member-1",
        clusterIndex: 0,
        memberIndex: 3,
        groupNumber: 1,
        groupCount: 4,
        x: 0.25,
        y: 0.5,
        libraryLabel: "Mechanical Brush",
      },
    ];
    const markup = renderToStaticMarkup(
      <svg>
        <DiscoveryMarkupLayer
          markups={markups}
          activeClusterIndex={0}
          viewSize={{ width: 1000, height: 700 }}
          onSelectGroup={() => undefined}
        />
      </svg>,
    );
    expect(markup).toContain('data-testid="ai-discovery-markup-layer"');
    expect(markup).toContain('role="button"');
    expect(markup).toContain("Possible Mechanical Brush");
    expect(markup).not.toContain("ai-ghost-accepted");
  });

  it("keeps a canvas pointer capture from swallowing direct markup selection", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    let parentPointerDowns = 0;
    let selected = -1;
    act(() =>
      root.render(
        <svg onPointerDown={() => (parentPointerDowns += 1)}>
          <DiscoveryMarkupLayer
            markups={[
              {
                id: "selectable",
                clusterIndex: 2,
                memberIndex: 0,
                groupNumber: 3,
                groupCount: 5,
                x: 0.5,
                y: 0.5,
                libraryLabel: "",
              },
            ]}
            activeClusterIndex={null}
            viewSize={{ width: 1000, height: 700 }}
            onSelectGroup={(clusterIndex) => (selected = clusterIndex)}
          />
        </svg>,
      ),
    );
    const target = container.querySelector('[data-testid="ai-discovery-markup"]');
    expect(target).not.toBeNull();
    act(() => {
      target?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      target?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(parentPointerDowns).toBe(0);
    expect(selected).toBe(2);
    act(() => root.unmount());
    container.remove();
  });

  it("keeps library tables read-only and the save path estimator-validated", () => {
    const sql = readFileSync(
      resolve(
        process.cwd(),
        "supabase/migrations/20260716033423_ai_symbol_identification_library.sql",
      ),
      "utf8",
    );
    expect(sql).toContain("ALTER TABLE public.ai_symbol_library_items ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain("GRANT SELECT ON TABLE public.ai_symbol_library_items TO authenticated");
    expect(sql).not.toContain(
      "GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.ai_symbol_library_items TO authenticated",
    );
    expect(sql).toContain("public.can_manage_estimate(e.id)");
    expect(sql).toContain("v_operation.created_by IS DISTINCT FROM v_user_id");
    expect(sql).toContain("p_accepted_count NOT BETWEEN 1 AND 96");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.save_ai_symbol_library_example");
  });
});
