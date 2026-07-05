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
