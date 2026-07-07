// Runtime AI-engine selection (AITAKEOFF12 follow-up).
// The detection engine is normally chosen at build time via VITE_AI_ENGINE
// (default "pixel"). This adds a RUNTIME override so the embedding engine can be
// QA'd on the LIVE deploy without a special build: `?aiEngine=embedding` in the
// URL flips it on and sticks for the session (localStorage); `?aiEngine=pixel`
// (or clearing storage) flips back. Everyone without the override stays on the
// build-time default, so production is unaffected.

import { resolveAiEngine, type AiEngine } from "./embedding-match-domain";

const STORAGE_KEY = "overwatch.aiEngine";

/**
 * The engine to use for this scan: a URL `?aiEngine=` override (persisted for
 * the session) wins, then session storage, then the build-time default. SSR-safe
 * — on the server there is no window, so it returns the build default.
 */
export function activeAiEngine(): AiEngine {
  if (typeof window !== "undefined") {
    try {
      const param = new URLSearchParams(window.location.search).get("aiEngine");
      if (param) window.localStorage.setItem(STORAGE_KEY, param);
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored) return resolveAiEngine(stored);
    } catch {
      // Storage disabled (private mode) — fall through to the build default.
    }
  }
  return resolveAiEngine(import.meta.env.VITE_AI_ENGINE);
}

// Symbol discovery (SYMBOLDISCOVERY Stage 2b — LIVE for all users). The
// server-side render (Rung 2) removed the only blocker (the browser render that
// timed out on dense sheets), so Discover is on by default. `?aiDiscover=0`
// remains as a sticky per-session KILL SWITCH; `?aiDiscover=1` re-enables.
const DISCOVERY_STORAGE_KEY = "overwatch.aiDiscover";

export function aiDiscoveryEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const param = new URLSearchParams(window.location.search).get("aiDiscover");
    if (param) window.localStorage.setItem(DISCOVERY_STORAGE_KEY, param);
    // On for everyone; only an explicit, sticky ?aiDiscover=0 opts a session out.
    return window.localStorage.getItem(DISCOVERY_STORAGE_KEY) !== "0";
  } catch {
    return true;
  }
}
