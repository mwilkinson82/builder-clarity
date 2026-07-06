// Incremental-placement smoke (AITAKEOFF13 — fast first paint).
// Pins the split that lets template ghosts paint in ~12s while the model
// enriches around them: template hits become ghosts immediately (deduped vs
// existing counts, capped), and model candidates that land on a placed ghost
// or exceed the leftover budget never buy a stage-B verify. Run: npm run test:ai

import assert from "node:assert/strict";
import {
  planModelToVerify,
  planTemplateGhosts,
} from "../src/lib/ai-takeoff/incremental-placement.ts";
import { sheetRadiusFromLongEdge } from "../src/lib/ai-takeoff/ai-takeoff-domain.ts";

const radius = sheetRadiusFromLongEdge(0.008, 1000, 1000);
const hit = (x: number, y: number, score = 0.9) => ({
  x,
  y,
  score,
  rotationDeg: 0,
  scale: 1,
  templateIndex: 0,
});

// --- planTemplateGhosts: the ghosts painted the instant the matcher returns ---

{
  const ghosts = planTemplateGhosts({
    templateHits: [hit(0.2, 0.2), hit(0.5, 0.5), hit(0.8, 0.8)],
    existingPoints: [],
    radius,
    maxPerSheet: 10,
  });
  assert.equal(ghosts.length, 3, "every template hit becomes a ghost when nothing blocks it");
  assert.ok(
    ghosts.every((g) => g.source === "template" && g.templateHit),
    "placed ghosts keep their template origin",
  );
}

{
  const ghosts = planTemplateGhosts({
    templateHits: [hit(0.2, 0.2), hit(0.5, 0.5)],
    existingPoints: [{ x: 0.2, y: 0.2 }],
    radius,
    maxPerSheet: 10,
  });
  assert.equal(ghosts.length, 1, "a template hit on an already-counted marker is dropped");
  assert.ok(
    ghosts.every((g) => !(Math.abs(g.x - 0.2) < 1e-9 && Math.abs(g.y - 0.2) < 1e-9)),
    "the surviving ghost is the one away from the existing marker",
  );
}

{
  const ghosts = planTemplateGhosts({
    templateHits: [hit(0.1, 0.1, 0.5), hit(0.3, 0.3, 0.95), hit(0.6, 0.6, 0.7)],
    existingPoints: [],
    radius,
    maxPerSheet: 2,
  });
  assert.equal(ghosts.length, 2, "the per-sheet cap bounds the template ghosts");
  assert.ok(
    ghosts.some((g) => g.confidence === 0.95),
    "the strongest hit always survives the cap",
  );
}

// --- planModelToVerify: model enrichment AROUND the placed ghosts ---

{
  const toVerify = planModelToVerify({
    modelCandidates: [
      { x: 0.5, y: 0.5, confidence: 0.5 }, // lands on a placed ghost
      { x: 0.9, y: 0.9, confidence: 0.5 }, // genuinely new
    ],
    placedGhostPoints: [{ x: 0.5, y: 0.5 }],
    existingPoints: [],
    radius,
    maxPerSheet: 10,
    templateGhostCount: 1,
  });
  assert.equal(
    toVerify.length,
    1,
    "a model candidate on a placed template ghost is not re-verified",
  );
  assert.equal(toVerify[0].source, "model", "the surviving candidate is model-sourced");
}

{
  const toVerify = planModelToVerify({
    modelCandidates: [{ x: 0.9, y: 0.9, confidence: 0.5 }],
    placedGhostPoints: [],
    existingPoints: [],
    radius,
    maxPerSheet: 3,
    templateGhostCount: 3,
  });
  assert.equal(toVerify.length, 0, "a full sheet of template ghosts leaves the model zero budget");
}

{
  const toVerify = planModelToVerify({
    modelCandidates: [
      { x: 0.1, y: 0.1, confidence: 0.9 },
      { x: 0.4, y: 0.4, confidence: 0.8 },
      { x: 0.9, y: 0.9, confidence: 0.7 },
    ],
    placedGhostPoints: [],
    existingPoints: [],
    radius,
    maxPerSheet: 4,
    templateGhostCount: 2,
  });
  assert.equal(toVerify.length, 2, "model verifies fill only the budget the template ghosts left");
  assert.ok(
    toVerify.every((c) => c.confidence >= 0.8),
    "the leftover budget goes to the strongest model candidates",
  );
}

{
  const toVerify = planModelToVerify({
    modelCandidates: [{ x: 0.2, y: 0.2, confidence: 0.5 }],
    placedGhostPoints: [],
    existingPoints: [{ x: 0.2, y: 0.2 }],
    radius,
    maxPerSheet: 10,
    templateGhostCount: 0,
  });
  assert.equal(toVerify.length, 0, "a model candidate on an existing marker is dropped");
}

console.log("ai-incremental-placement-smoke: OK");
