# SYMBOLDISCOVERY.md — The Identification Library (committed direction)

Read AGENTS.md. **Estimating** agent territory (`src/lib/ai-takeoff/`,
`src/components/estimates/plan-room/`). No migrations in Stage 0.

## The founder's product (2026-07-06, the committed path — do not deviate)

> Scan the file → the AI identifies all the distinct pictures/symbols and
> presents them to the estimator → the estimator names the ones that matter
> ("this is a Mechanical Brush") → the AI counts every one of them. Labeled
> groups become an identification library that compounds across sheets and
> projects.

The AI does the DISCOVERY; the human does the NAMING. This inverts today's
shipped flow (human hunts one symbol, AI finds more like it), which caps out
on exemplar-crop quality — proven twice on A-100: the identical engine swings
49 hits @0.96 → 3 hits @0.64 purely on what one human click happens to crop
(51% background ink in the failing template). Discovery replaces "one click
must be clean" with "work with the ensemble," and labeled cluster members are
ALREADY LOCATED — they become counts directly, no template match required for
the core flow, and no per-tile VLM pass at all.

## Standing evidence (what is proven vs. assumed — keep this honest)

- PROVEN (offline, this exact A-100 sheet): density-peak candidates →
  DINOv2 embeddings → cosine clustering self-groups brushes (15), blowers,
  section callouts, tanks — unsupervised, clutter and all. Junk candidates
  (~101 linework fragments of 185) self-segregate into one amorphous cluster
  and do NOT contaminate real groups. Known gap: over-proposal + ~half the
  PACKED brushes missed (NMS/threshold — tunable; Stage 2 tops up).
- PROVEN (live): pixel template engine reaches ~full recall (47–49 @0.9+)
  when handed a clean single-symbol template. Reused in Stage 2, seeded from
  a cluster's cleanest member instead of a human click.
- BUILT + code-proven (live blockers all cleared): candidate proposer
  (detectCandidatePeaks, #133), server CLIP embedding on Replicate
  (#133/#134; account rate limit raised by Replicate support), 429/5xx
  retry hardening (#140 — MERGE BEFORE Stage 0 QA).
- ASSUMED, NOT PROVEN (Stage 0 exists to test exactly this): that CLIP
  (krthr/clip-embeddings) clusters as well as DINOv2 did offline. If it
  doesn't: REPLICATE_EMBED_MODEL is env-swappable to a DINOv2 endpoint —
  config, not code. AITAKEOFF14's lesson is binding: green synthetic
  fixtures prove structure, only the REAL A-100 result gates a stage.

## Stage 0 — see the library before building the product (this PR)

- Pure module `embedding-cluster-domain.ts`: deterministic greedy
  average-linkage agglomerative clustering over cosine similarity;
  per-cluster size, cohesion, medoid index. Headless fixtures wired into
  `test:ai` (synthetic vector groups + noise).
- Server fn `discoverSheetSymbols` (own file): auth → charge 1 credit
  (failure refunds) → embed candidate crops via replicate.server →
  cluster SERVER-SIDE → return `{clusters: [{memberIndexes, medoidIndex,
  cohesion}]}` — vectors never ship to the client.
- QA flag `?aiDiscover=1` (ai-engine-flag pattern; sticky per session).
  "Discover symbols" action: render sheet → detectCandidatePeaks → crop
  base64s → server fn → cluster grid dialog (member crops per cluster,
  counts, cohesion). Production users unaffected without the flag.
- GATE (eyes on A-100, post-merge): a brush cluster containing MOST of the
  ~12–15 brushes, junk self-segregated into ignorable clusters.
  KILL-CRITERIA: if CLIP clusters junk → swap embed model (env) and re-QA;
  if discovery cannot surface the brush group at all → STOP, no Stage 1 UI
  gets built on a broken front half.

## Stage 1 — the library flow (only after Stage 0 passes on A-100)

Cluster cards → estimator labels or ignores → labeled members become review
ghosts (existing accept/reject/nudge bar, existing measurement write path) →
counted. Ignoring junk clusters costs nothing.

## Stage 2 — recall top-up

Seed the template engine from the labeled cluster's cleanest member (best
mean cosine to its own cluster) to catch packed/missed instances; union +
dedupe through the existing canonical radius path.

## Stage 3 — the flywheel (parked until 0–2 are real)

Labeled groups persist per org (library), pre-matching future sheets. This is
the co-pilot moat; do not start it early.

## Non-negotiables

- One stage per PR; every stage gated on the REAL A-100 result, not fixtures.
- Recall-first stays doctrine: over-proposal is reviewable, misses are not.
- Agents stop at PR-open; merges are the founder's.
- The pick-one-symbol flow stays shipped and untouched as the fallback.
