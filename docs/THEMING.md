# Theming — the ALP house skin, as wired into Overwatch

**Read this before touching anything visual.** Overwatch wears the **ALP house
design system** — one skin shared with the sibling AOS app and every ALP
marketing surface. The canonical spec lives in
[`docs/AOS-DESIGN-SYSTEM.md`](./AOS-DESIGN-SYSTEM.md) (copied into this repo so
agents without the author's local files can read it). This file is the
**practical bridge**: how that system is wired into *this* Vite + Tailwind v4 +
shadcn app, and the rules every agent follows.

## The one idea

**One house skin, differentiated by name and content — never by palette or
accent.** There is no "Overwatch blue." Warm, light-first, typographic, calm.
Type carries the page; structure is hairlines and whitespace; the orange is
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

| House token (spec §2) | CSS var / role | Tailwind utility | Use for |
|---|---|---|---|
| `--paper` #F7F2EA | `--background` | `bg-background` | Page ground |
| `--surface` #F8F4ED | `--surface` / `--card` | `bg-surface` `bg-card` | Cards, work-surfaces |
| `--paper2` #EFEADE | `--muted` / `--secondary` | `bg-muted` `bg-secondary` | Inset fills, chips, tracks |
| `--ink` #1C1A17 | `--foreground` / `--primary` | `text-foreground` `bg-primary` | Text; default (dark) button |
| `--muted` #6B655D | `--muted-foreground` | `text-muted-foreground` | Secondary text, labels |
| `--edge` #DCD5C8 | `--border` / `--hairline` / `--input` | `border` `hairline` | Hairline rules & borders |
| `--signal` #F76A16 | `--signal` | `bg-signal` `text-signal` | **THE** accent — CTAs & true emphasis ONLY |
| `--clay` #D97757 | `--clay` / `--accent` | `bg-accent` `text-clay` | Active/selected/highlight, eyebrows, small warm accents |
| `--dark` #171310 | `--dark-panel` | `bg-dark-panel` | Dark stat tiles, media frames, pop-up graphic |
| `--good` #2FA98C | `--success` | `text-success` | On-goal / success / live |
| `--warn` #C69A3C | `--warning` | `text-warning` | Caution |
| `--crit` #B5432E | `--destructive` / `--danger` | `bg-destructive` `text-danger` | Off-goal / failure / danger |

Fonts: `--font-sans` (Helvetica Neue) body & UI · `--font-serif` (Instrument
Serif) display/headings via `.font-serif` · `--font-mono` (JetBrains Mono)
eyebrows, labels, numbers. All three load via the Google Fonts link in
`src/routes/__root.tsx`.

## Signature helpers already in the app

- **Buttons** — `<Button>` default is **ink** (the house dark button). For the
  one rationed orange CTA per view, use `<Button variant="signal">`. Secondary
  actions use `secondary` / `outline` / `ghost`. Never make two things orange on
  one screen.
- **`.eyebrow`** — mono, uppercase, `.22em` tracking, clay. Put a mono eyebrow
  above section titles; it's the house signature. Often numbered on true
  sequences (`01 · First principles`).
- **`.font-serif`** — Instrument Serif for display headings and big editorial
  statements.

## Rules for agents (the short list)

**Do**
- Reach for a **token** (`bg-signal`, `variant="signal"`, `.eyebrow`, `--clay`,
  `--dark-panel`, `text-muted-foreground`) — never a hardcoded hex.
- Lead sections with a mono eyebrow → serif headline → muted sub.
- Structure with hairlines (`border`/`hairline`) and whitespace, not boxes.
- Ration the orange: at most one `variant="signal"` CTA per view.
- Use `--good`/`--warn`/`--crit` for scorecard/state — they're semantic, not
  brand accents.
- Honor `prefers-reduced-motion` on any animation.
- Design the 375px column first (much traffic is mobile in-app browsers).

**Don't**
- ❌ Invent a second accent or an "Overwatch blue." One clay, one rationed orange.
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
