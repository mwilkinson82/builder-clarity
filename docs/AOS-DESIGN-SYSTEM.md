# AOS / ALP — Design System

**The single source of truth for how every AOS & ALP surface looks, moves, and reads.**
Anthropic/Claude-family *editorial* treatment of the AOS brand — warm, light-first, typographic, calm, premium.

> **How to use this doc.** Drop a copy of this file into any repo you're styling (site or app) and read it first. It supersedes the older `~/Downloads/AOS-web-design-system.md` and `~/Downloads/alp-aos-brand-kit.md` — the tokens below are pulled from the **live shipped code** at startaos.com (which had drifted from those older docs). When something here conflicts with an old file, **this wins**.

## 0. Brand architecture — ONE house skin (the Anthropic model)

**ALP is the master brand** (Marshall Wilkinson — the billion-dollar construction consultant; the ALP Contractor Circle audience knows him as ALP). **AOS and Overwatch are products under ALP** — the way **Claude, Claude Code, Claude Cowork, and Claude Design** all live under Anthropic wearing **one identical brand skin**. Same tokens, same type, same motion, same components across every product and surface. Products differentiate by **name and content — never by a different palette or accent.**

Consequences that govern all work here:
- This is not "the AOS design system" — it's the **ALP house system**. It applies **identically** to AOS, Overwatch, and any future ALP tool, plus every marketing site, app, and the link-in-bio.
- **No per-product accent.** One rationed orange everywhere. Don't invent an "Overwatch blue."
- The **AOS marketing page (startaos.com) is the reference standard** for what this skin looks like done right. **The actual applications (AOS app, Overwatch app) lag it and must be reskinned up to that bar** — that's the core of the app work.
- Every surface should feel like one company shipped it. A user moving from the ALP bio → an AOS/Overwatch marketing site → the app should never feel a seam.

Reference implementations (study these before building):
- `~/G&M Works/aos-marketing/index.html` — the home page (hero + live neural map, "The Six" reel, dark blocks, footer, pop-up card).
- `~/G&M Works/aos-marketing/why.html` — the interactive first-principles page (operating-spine hero, scroll-fill statement, accordions, proof toggle, tabs, stepper, quiz).
- Live: https://startaos.com and https://startaos.com/why

---

## 1. Philosophy — the ten rules

1. **Warm & light-first.** Cream paper ground (`--paper`), never dark-by-default. Dark is used *deliberately* as focal contrast (product media, stat tiles, the pop-up graphic).
2. **Typography IS the design.** Instrument Serif at big clamp sizes carries every page. No decorative UI to compensate.
3. **One rationed accent.** Signal orange `#F76A16` is for CTAs and *true* emphasis only. Soft terracotta `--clay` handles eyebrows and small accents. **Never introduce a second brand accent** or a tech gradient.
4. **Hairlines, not boxes.** Structure with 1px `--edge` rules and whitespace. Rounded cards are used sparingly and only when a thing is genuinely a discrete object.
5. **Product media is the hero.** A dark screenshot/live tool on cream is the focal point. Wrap it in the AOS bracket-corner `[ ]` frame.
6. **Motion is subtle and meaningful.** Fade-and-rise reveal on scroll; a "current" running a system; sequential draw-ins; scroll-linked text fill. Every animation must *mean* something. Always honor `prefers-reduced-motion`.
7. **Copy is short, plain, confident.** Tied to money, risk, capacity. No hype, no filler. Active voice. A control says exactly what it does.
8. **Numbering/structure must be true.** Only number things that are genuinely a sequence. Eyebrows encode the section's role, not decoration.
9. **Fictional data only on public surfaces.** Summit Builders / ALP Team — **never** real client names (G&M, Ken/Paul/Marty/Nancy).
10. **Evoke Anthropic, don't copy it.** Open fonts only. **Never** use Styrene/Tiempos/Copernicus or Anthropic's logo/marks.

---

## 2. Color tokens (canonical — from live code)

**Two ground tiers (the Anthropic model).** Anthropic runs a deeper ivory on *marketing* (anthropic.com) and a near-white on the *product* (claude.ai). We do the same: the token *names are identical everywhere* — only the four ground values differ between the marketing build and the app build. Everything below the grounds (ink, muted, dark, signal, clay, semantic, fonts) is **identical across both tiers.**

```css
/* ===== EDITORIAL / MARKETING tier — sites, landing pages, link-in-bio ===== */
/* Deeper editorial cream. This is startaos.com's ground; keep it warm. */
:root{
  --paper:#F7F2EA;    /* page ground (warm editorial cream) */
  --surface:#F8F4ED;  /* cards / raised work-surfaces */
  --paper2:#EFEADE;   /* subtle inset fills, chips, toggle tracks */
  --edge:#DCD5C8;     /* hairline borders & rules */
}

/* ===== PRODUCT / APP tier — AOS app, Overwatch app ===== */
/* Lighter warm-white, in claude.ai's brightness league but still clearly warm. */
:root{
  --paper:#FAF7F0;    /* app ground (warm white) */
  --surface:#FFFFFF;  /* raised panels/cards sit white/near-white ABOVE the ground */
  --paper2:#F2EEE5;   /* subtle inset fills, chips, hover rows (a touch below ground) */
  --edge:#E7E1D6;     /* hairline borders & rules (warm, reads on both ground & white) */
}

/* ===== SHARED across BOTH tiers — never fork these ===== */
:root{
  --ink:#1C1A17;      /* primary text (warm near-black) */
  --muted:#6B655D;    /* secondary text, labels */
  --dark:#171310;     /* dark panels: stat tiles, media frames, pop-up graphic */
  --signal:#F76A16;   /* THE accent — CTAs & true emphasis ONLY */
  --clay:#D97757;     /* eyebrows & small warm accents (= claude.ai's clay #D97757) */
  /* semantic (state) — separate from the brand accent: */
  --crit:#B5432E;     /* off-goal / failure / danger */
  --good:#2FA98C;     /* on-goal / success / live */
  --warn:#C69A3C;     /* caution */
  /* fonts */
  --serif:"Instrument Serif",ui-serif,Georgia,serif;
  --sans:"Helvetica Neue",Helvetica,Arial,ui-sans-serif,system-ui;
  --mono:"JetBrains Mono",ui-monospace,Menlo,monospace;
}
```

**Usage rules**
- **Pick the ground tier by surface, not by taste:** anything marketing/editorial (sites, landing, bio) = the cream tier; anything you log into and operate (AOS app, Overwatch app) = the warm-white tier. Everything else about the two is identical, so a user never feels a brand seam moving site → app.
- **Reference values for verification:** claude.ai product light-mode ground is `#FFFFFF` with panels at `#F8F8F6`/`#F4F4F1`, hairlines `#E2E1DA`, text `#121212`, clay `#D97757` (pulled live 2026-07-08). Our app tier deliberately sits a hair *warmer* than Claude's neutral so it stays on-brand rather than a literal copy.
- Orange `--signal` is precious. If two things on a screen are orange, one of them is wrong.
- `--clay` (terracotta) is for mono eyebrows and tiny accents — it's the "warm" that keeps orange rationed.
- On dark panels, emphasis fills to orange; success/live is `--good` teal; danger is a lighter red (`#EF8A7A`) for contrast.
- `--good`/`--crit`/`--warn` are **semantic**, not brand accents — use them for scorecard/state, and they don't "count" against the one-accent rule.

---

## 3. Typography

**Three families, three jobs — never mix roles.**
- **Instrument Serif** (400) — all display/headings, and big editorial statements. Set `letter-spacing:-.01em`, `line-height:1.03–1.2`.
- **Helvetica Neue** — body & UI. 17px / 1.65, `letter-spacing:.005em`.
- **JetBrains Mono** (500/700) — eyebrows, labels, numbers, meta. Uppercase, `letter-spacing:.18–.22em`.

**Scale (clamp, responsive):**
```css
h1.hero      { font-size:clamp(44px,6.4vw,86px); max-width:13ch; text-wrap:balance; }
h1.big       { font-size:clamp(40px,7vw,80px);   max-width:16ch; }  /* interior hero */
h2.lead      { font-size:clamp(28px,4.4vw,46px); max-width:22ch; text-wrap:balance; }
.big-statement{font-size:clamp(30px,5.4vw,62px); }  /* scroll-fill hero statements */
.sub         { color:var(--muted); font-size:19px; line-height:1.55; max-width:60ch; }
.eyebrow     { font-family:var(--mono); font-weight:700; font-size:12px;
               letter-spacing:.22em; text-transform:uppercase; color:var(--clay); }
```
- Body measure: **~60ch max**. Headlines: cap width in `ch` so they break well.
- **A mono eyebrow sits above almost every section title.** It's a signature.

---

## 4. Layout & spacing

```css
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font-family:var(--sans);
     font-size:17px;line-height:1.65;-webkit-font-smoothing:antialiased;
     letter-spacing:.005em;overflow-x:hidden}
.wrap{max-width:1160px;margin:0 auto;padding-left:28px;padding-right:28px} /* sites */
/* interior editorial pages use a tighter 1000px .wrap */
section{padding:64px 0}          /* home rhythm; interior pages use 76px */
section{border-top:1px solid var(--edge)}  /* hairline section separators */
```
- **Spacing gotcha (learned the hard way):** never write `.wrap{padding:0 28px}` — the shorthand zeroes section vertical padding and collapses the rhythm. Keep horizontal padding as `padding-left/right` longhand so `section{padding:… 0}` survives.
- Sticky nav: `rgba(247,242,234,.82)` + `backdrop-filter:saturate(140%) blur(10px)` + bottom hairline.

---

## 5. Buttons

```css
.btn{display:inline-flex;align-items:center;gap:8px;font-weight:600;font-size:15px;
     padding:12px 22px;border-radius:11px;cursor:pointer;
     transition:transform .12s,background .12s,border-color .12s,color .12s}
.btn:hover{transform:translateY(-1px)}
.btn-primary{background:var(--signal);color:#fff;box-shadow:0 8px 20px -8px rgba(247,106,22,.6)}
.btn-dark   {background:var(--ink);color:var(--surface)} .btn-dark:hover{background:#2C2A26}
.btn-outline{background:transparent;color:var(--ink);border:1.5px solid var(--edge)}
.btn-outline:hover{border-color:var(--ink)}
```
- One primary (orange) CTA per view. Secondary actions use dark or outline.
- Arrow affordance `→` in CTA labels ("Start free →", "Read the first-principles case →").

---

## 6. Signature components

- **Mono eyebrow** — `.eyebrow` above titles; often numbered on sequences (`01 · First principles`).
- **App-window mock** — a fake product UI on a dark/cream card: gold `AOS` mark + `ALP Operating System` + workspace switcher (`Summit Builders ▾`) + avatar; inside, a real-looking tool (scorecard, accountability chart, L10 agenda). Used to show the product without shipping screenshots.
- **Dark stat tiles** — `--dark` panel, mono uppercase label, big serif value, `--good`/`--crit` delta. The dashboard/KPI vocabulary.
- **Bracket-corner `[ ]` frame** — the AOS tech-frame around hero media (two corner brackets, not a full border).
- **Pop-up card (Anthropic-style)** — fixed bottom-right, graphic tile on top + eyebrow + serif hook + orange CTA. Surfaces on scroll (see motion), dismissible per session. Full impl in `aos-marketing/index.html` (`.popcard`).
- **Accordion cards** — `<details>` with a **CSS-drawn +/× toggle** (two pseudo-element bars, rotate 45° on open — never a text glyph, it won't center).
- **Scorecard table** — mono headers, `--good`/`--crit` state pills, "→ Issues" flags.
- **Chaos↔Operating-system toggle**, **pill tabs**, **SOP stepper**, **radio-circle quiz** — all in `why.html`; reuse those patterns rather than reinventing.

---

## 7. Motion system

**Canonical reveal-on-scroll (with sibling stagger)** — use verbatim:
```js
(function(){
  var els=document.querySelectorAll('.reveal');
  if(!('IntersectionObserver' in window)){els.forEach(e=>e.classList.add('in'));return;}
  var io=new IntersectionObserver(function(es){es.forEach(function(en){
    if(en.isIntersecting){var el=en.target,
      sibs=[].slice.call(el.parentNode.children).filter(c=>c.classList.contains('reveal'));
      el.style.transitionDelay=Math.min(sibs.indexOf(el)*90,360)+'ms';
      el.classList.add('in');io.unobserve(el);}
  });},{threshold:.16,rootMargin:'0px 0px -8% 0px'});
  els.forEach(e=>io.observe(e));
})();
```
```css
.reveal{opacity:0;transform:translateY(20px);
        transition:opacity .8s cubic-bezier(.2,.7,.2,1),transform .8s cubic-bezier(.2,.7,.2,1)}
.reveal.in{opacity:1;transform:none}
@media (prefers-reduced-motion:reduce){.reveal{opacity:1;transform:none;transition:none}}
```

**The motion vocabulary (pick what the content calls for):**
- **Fade-and-rise reveal** — default for everything entering view. Easing `cubic-bezier(.2,.7,.2,1)`, stagger siblings ~90ms (cap 360ms).
- **The "current"** — a gradient/spark that travels a connective line, with nodes pulsing in a wave as it passes. The AOS signature (hero operating-spine, pop-up graphic). Signals "a system running."
- **Sequential draw-in** — list/table rows revealing in order along a spine with node dots (the "derivation").
- **Scroll-fill statement** — big serif text, grayed (`--edge`), words fill to ink left-to-right as you scroll through it; emphasis phrases fill to `--signal`. (Google-Labs-style; impl in `why.html` `#fill`.)
- **Scroll-triggered surface** — the pop-up appears when a specific element passes a viewport % (rAF-throttled scroll check), not on a timer.
- **Always** guard infinite/scroll animations behind `prefers-reduced-motion`.

**The operating-spine motif (reusable signature graphic)** — five connected nodes = the five essentials / six disciplines, with a current running through. Inline SVG, self-contained, animates. Copy from `aos-marketing/index.html` `.popfig` (compact) or `why.html` `.spine` (full-width). Node labels M·E·D·C·L (Market, Estimating, Delivery, Cash, Leadership) or the six V/P/D/I/P/T.

---

## 8. Copy voice

- Short, plain, confident. Tie to money / risk / capacity ("die solvent on paper", "before they become write-offs").
- Mono eyebrow → serif headline → muted sub. That triad is the rhythm.
- Controls are literal: button says "Publish", toast says "Published".
- No exclamation hype. The calm *is* the confidence.

---

## 9. Mobile-first (critical for the bio page & anything Instagram-fed)

- Design the **375px** column first, enhance up. Most AOS traffic is Instagram in-app browser.
- Tap targets ≥ 44px. Generous vertical spacing; single column.
- Clamp type so headlines never overflow at 375px; test at 320px.
- Sticky/fixed elements must not cover content on short viewports; pop-up/card collapses to `left:12px;right:12px` full-width on ≤560px.
- Respect iOS safe-area (`env(safe-area-inset-*)`) for bottom-fixed elements.
- Fast: inline critical CSS, lazy/async media, no layout shift (reserve media aspect-ratios).

---

## 10. Head / SEO boilerplate (real sites)

Every public page ships: `<title>` + meta description, `<link rel=canonical>`, `robots` meta, `theme-color #F7F2EA`, favicon set (16/32/ico/apple/manifest), full Open Graph + Twitter card (`og:image` 1200×630 with width/height/alt), and JSON-LD (`Organization` + `WebSite` + `SoftwareApplication`). Fonts via Google Fonts (`Instrument+Serif` + `JetBrains+Mono`) — real sites may use the CDN; for sandboxed artifacts inline as `@font-face` data-URIs instead.

---

## 11. Where things live (deploy map)

| Surface | Repo / path | Host | Deploy |
|---|---|---|---|
| AOS marketing home | `~/G&M Works/aos-marketing/` | Vercel `aos-marketing` | `npx vercel deploy --prod` from folder |
| Why page | same repo `/why.html` (`vercel.json` rewrite) | Vercel | same |
| Overlap Map landing | `~/G&M Works/overlap-map-landing/` | Vercel | `npx vercel deploy --prod` |
| Overlap Map tool | `~/G&M Works/aos-overlap-map/` · `mwilkinson82/aos-overlap-map` | GitHub Pages | `git push` |
| **Marshall-in-bio** | `mwilkinson82/linkinbiomarshall` | **Lovable** | branch → PR → merge to main → Lovable deploys |
| **AOS app (Overwatch)** | `mwilkinson82/eos-accelerator` (private) | Lovable Cloud | branch → PR → merge → Lovable applies migrations & deploys |
| ALP Contractor Circle site | *(TBD — get repo/host)* | ? | ? |

**Lovable workflow note:** for Lovable-deployed repos you edit via GitHub PR; Lovable applies migrations and redeploys on merge to main. It's a Vite/React app, not hand-authored HTML — apply this system via the app's CSS/theme layer (tokens as CSS vars), not by pasting raw HTML.

---

## 12. Do / Don't

**Do:** ration the orange · lead with a mono eyebrow · let type carry the page · put product media in a bracket frame on dark · reveal on scroll · keep copy short and money-tied · fictional data on public surfaces · honor reduced-motion · mobile-first for Instagram traffic.

**Don't:** add a second accent · use dark-by-default or tech gradients · use Anthropic's fonts/logo · number things that aren't sequences · box everything (use hairlines) · animate for decoration · ship real client names publicly · use `.wrap{padding:0 X}` shorthand.
