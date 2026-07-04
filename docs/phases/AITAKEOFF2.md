# AITAKEOFF2.md — See What the Model Sees (Claude Code task spec)

Read AGENTS.md. **Estimating** agent, ai-takeoff module territory. Branch:
`estimating/ai-takeoff-fix-pipeline`. No migrations expected except one
nullable column noted in Task 1; flag loudly regardless.

Founder live QA of Phase A (production, Crystal Carwash set): exemplar = a
car-wash brush wheel (large, highly distinctive radial symbol). Result:
10-12 proposals mostly on EMPTY drawing regions; the single plausible match
was OFFSET from the real symbol ("geographically very close, but not on
it"). Read those two symptoms as the diagnosis: (a) empty-region matches =
the exemplar crop the model received was likely empty or wrong (coordinate-
space bug in crop extraction: PDF-point vs pixel scaling and/or PDF's
bottom-up Y axis), and (b) the consistent near-miss = tile-local
coordinates mapped back without tile offset / with the same Y confusion.
Assume plumbing over model failure and prove it with visibility.

## Task 0 — The exemplar must be provably right
- Extract the exemplar crop from a CLEAN render of the PDF region (no
  overlay layer — the human's marker dot must never appear in the crop).
- Fix the coordinate transform chain explicitly: marker position (sheet
  space) → PDF points (mind the Y axis) → render pixels at crop DPI. Write
  the transforms as pure functions in the ai-takeoff module.
- Size the crop to capture a full symbol with margin (the marker sits at
  the symbol's center; pad generously — these symbols can be inches wide at
  sheet scale). Render at a DPI where linework is legible (target the crop
  at ~512-768px on its long side).
- **The echo check (the permanent safeguard):** the scan prompt requires the
  model to first return a one-line description of the exemplar symbol
  before any matches. Store it on ai_operations (new nullable text column
  `exemplar_description` — the one migration) and display it in the AI
  Assist panel while scanning: "Looking for: circular brush with radial
  spokes." A founder reading "a small green dot" or "blank area" sees the
  corruption instantly. This ships permanently, not as debug.

## Task 1 — Round-trip coordinate integrity
- Tile rendering and response mapping share the same pure transform module;
  every tile carries its sheet-space origin and scale, and proposal
  coordinates map back as tile-local → sheet space through one tested path.
- Unit tests with synthetic fixtures: render a generated PDF containing a
  known glyph at known coordinates; assert the exemplar crop contains the
  glyph (pixel sampling), and assert a mock response at the glyph's
  tile-local position maps back to within a few points of the true sheet
  position. Both Y-axis regressions must be impossible to reintroduce
  silently.

## Task 2 — Prompt hardening against eager matching
- Instruct: match only the SAME symbol type; empty or ambiguous regions are
  never matches; return an empty list over guessing; per-match confidence
  required; return matches as small bounding boxes (center derived
  server-side) rather than bare points.
- Client-side floor: discard matches below a confidence threshold (config,
  default 0.5) before they ever become ghosts, and cap proposals per sheet
  (config, default 60) as a runaway guard.

## Task 3 — Panel ergonomics (founder finding)
The AI Assist panel currently covers the takeoff toolbar (undo, tool
switches) — unreachable mid-review. Make the panel draggable by its header
with position remembered per session, default-position it clear of the
toolbar, and collapse it to a pill while the review bar is active (the
review bar and panel must never both demand the same screen edge).

## Task 4 — Scan diagnostics (super-admin)
For is_super_admin only: a "scan diagnostics" view on an ai_operations row
showing the exemplar crop image actually sent, tile thumbnails with their
sheet-space origins, the raw model response, and the mapped positions.
Retain diagnostic images transiently (existing storage, 24h cleanup or
overwrite-per-op). This is the founder's microscope for every future
accuracy report.

## Task 5 — Validate and ship
Gate + test:estimating + test:ai (the new transform/round-trip fixtures).
PR titled `AI takeoff: exemplar integrity + coordinate round-trip + panel
ergonomics`. Founder re-QA on the same Crystal Carwash sheet: the echo line
must describe a brush wheel, and the five real blowers must ghost within
marker distance of the symbols.
