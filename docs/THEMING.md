# Theming — the ALP house skin (Brand Kit v2), as wired into Overwatch

**Read this before touching anything visual.** Overwatch wears the **ALP house
design system, Brand Kit v2** — the July 2026 reskin amendment for the
authenticated app: warm ivory grounds, Source Serif 4 display, Archivo UI, mono
labels, hairlines over boxes, and ONE rationed coral accent. The original house
spec lives in [`docs/AOS-DESIGN-SYSTEM.md`](./AOS-DESIGN-SYSTEM.md); v2 amends
its palette and type for the app tier (marketing surfaces keep the original
kit — never port v2 values to marketing). The authoritative v2 screen
references are the mocks in the reskin handoff package (kept outside this
public repo; Marshall has it locally at
`~/Claude Overwatch/overwatch-reskin-handoff/` — `HANDOFF_NOTES.md` there is
binding). This file is the **practical bridge**: how the system is wired into
*this* Vite + Tailwind v4 + shadcn app, and the rules every agent follows.

## The one idea

**One house skin, differentiated by name and content — never by palette or
accent.** There is no "Overwatch blue." Warm, light-first, typographic, calm.
Type carries the page; structure is hairlines and whitespace; the coral is
rationed to true CTAs only.

## Where the theme lives

- **All tokens: [`src/styles.css`](../src/styles.css)** — the single source of
  truth. Tailwind v4 is CSS-first (there is **no `tailwind.config.js`**). The
  `@theme inline` block maps Tailwind color utilities to CSS vars; `:root` and
  `.dark` hold the values.
- **`src/styles.css` is Shared / theme-layer territory.** Do **not** edit it as
  part of feature work. Palette or token changes are their own task in a
  dedicated window (see AGENTS.md module ownership).

## Token vocabulary — use these, never raw hex

| House token (v2) | CSS var / role | Tailwind utility | Use for |
|---|---|---|---|
| `--paper` #FAF9F5 | `--background` | `bg-background` | Page ground (warm ivory) |
| `--surface` #FFFFFF | `--surface` / `--card` | `bg-surface` `bg-card` | Cards / panels (sit white above the ground) |
| `--paper2` #F0EEE6 | `--muted` / `--secondary` | `bg-muted` `bg-secondary` | Inset fills, chips, hover rows, active nav |
| `--ink` #1F1E1B | `--foreground` / `--primary` | `text-foreground` `bg-primary` | Text; default (dark) button |
| `--muted` #76736B | `--muted-foreground` | `text-muted-foreground` | Secondary text, labels |
| `--edge` #E4E1D6 | `--border` / `--hairline` / `--input` | `border` `hairline` | Hairline rules & borders |
| `--signal` #D97757 | `--signal` | `bg-signal` `text-signal` | **THE** accent (coral) — CTAs & true emphasis ONLY. Text on it is ink (`--signal-foreground` #231A15), not white |
| `--clay` #C36E4F | `--clay` / `--accent` | `bg-accent` `text-clay` | Active/selected/highlight, eyebrows, small warm accents |
| `--dark` #1F1E1B | `--dark-panel` | `bg-dark-panel` | Dark stat tiles, result panels, media frames |
| `--good` #4C8055 | `--success` | `text-success` | On-goal / ahead / success / live |
| `--warn` #96702E | `--warning` | `text-warning` | Caution / drift |
| `--crit` #A8402F | `--destructive` / `--danger` | `bg-destructive` `text-danger` | Off-goal / behind / failure / danger |

Schedule-health color rule (app-wide, from the handoff): ahead/on-plan →
`--good`, drift → `--warn`, behind baseline → `--crit`. Verdict pulse dots
follow the same rule.

Fonts: `--font-sans` (**Archivo**) body & UI · `--font-serif` (**Source Serif
4**) display headings **and all serif numerals** via `.font-serif` ·
`--font-mono` (JetBrains Mono, weight 700 for labels) eyebrows, labels, data.
All load via the Google Fonts link in `src/routes/__root.tsx` (Inter stays
loaded only for the pinned CPM print typography). Scale cues: page H1 serif
~30–34px · card H2 serif ~20–22px · body 13–14px · mono labels 8.5–10px at
.12em tracking.

Radius: cards 14px (`rounded-xl`) · inner elements 8–10px
(`rounded-md`/`rounded-lg`) · pills 999px. Shadows: minimal — hairlines do the
structural work; the floating nav rail is the one soft wide glow
(`shadow-nav`).

## Structural signatures (v2, reused across the app)

- **Project nav** — a floating rounded sidebar (radius ~15px, `shadow-nav`),
  grouped CRM · Money · Field · Risk · Parties · Docs, active group expanded,
  status hints on the right of each item.
- **Portfolio shell** — a top-bar (Portfolio · CRM · Estimates · Team ·
  Billing) with company switcher, NO project sidebar. Used by business-layer
  pages.
- **Footer** — "OverWatch ▪ — an ALP product" wordmark left, context summary
  right, on `#FDFDFC`, 70px tall — on every app page (`AppFooter`).
- **Verdict-led pages** — a serif headline states the answer ("Gross profit is
  $34,519 above signed…"), then supporting metrics.
- **Modals** — centered over a dimmed backdrop; two-column where dense; sticky
  Cancel / primary footer.

## Signature helpers already in the app

- **Buttons** — `<Button>` default is **ink** (the house dark button). For the
  one rationed coral CTA per view, use `<Button variant="signal">`. Secondary
  actions use `secondary` / `outline` / `ghost`. Never make two things coral on
  one screen.
- **`.eyebrow`** — mono, uppercase, `.12em` tracking, clay. Put a mono eyebrow
  above section titles; it's the house signature. Often numbered on true
  sequences (`01 · Forecast`).
- **`.font-serif`** — Source Serif 4 for display headings, big editorial
  statements, and serif money figures.

## Rules for agents (the short list)

**Do**
- Reach for a **token** (`bg-signal`, `variant="signal"`, `.eyebrow`, `--clay`,
  `--dark-panel`, `text-muted-foreground`) — never a hardcoded hex.
- Lead sections with a mono eyebrow → serif headline → muted sub.
- Structure with hairlines (`border`/`hairline`) and whitespace, not boxes.
- Ration the coral: at most one `variant="signal"` CTA per view.
- Use `--good`/`--warn`/`--crit` for scorecard/state — they're semantic, not
  brand accents.
- Honor `prefers-reduced-motion` on any animation.
- Design the 375px column first (much traffic is mobile in-app browsers).

**Don't**
- ❌ Invent a second accent or an "Overwatch blue." One clay, one rationed coral.
- ❌ Hardcode hex in components (`color="#1b7a6e"`, `bg-[#...]`). It bypasses the
  theme and won't move when the palette does.
- ❌ Edit `src/styles.css` inside a feature task.
- ❌ Use dark-by-default or tech gradients. Dark is deliberate focal contrast
  (`--dark-panel`), not the ground.
- ❌ Number things that aren't a genuine sequence.

## Known debt

Some pre-existing feature components hardcode hex (e.g. plan-room `#1b7a6e`)
instead of using tokens. When you touch such a file for other reasons, migrate
the colors you're already editing onto tokens — don't add new hardcoded colors.
Exception: takeoff/count measurement colors are **user-chosen data**, not brand
tokens — leave them as data.
