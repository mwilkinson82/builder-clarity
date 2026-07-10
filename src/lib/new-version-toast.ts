// The companion to reload-on-stale-deploy.ts, covering the OTHER stale-tab
// case: a deploy lands while a tab is open, but the old build keeps working —
// no chunk ever 404s, so the preloadError guard never fires and the user runs
// yesterday's app indefinitely. That cost two field bug reports on 2026-07-09
// alone ("client stops being a dropdown", "can't approve my draft cost") for
// features that were already live in the current build.
//
// Detection needs no build-id plumbing: the served shell HTML references the
// build's hashed /assets/*.js chunks, and those names change on every deploy.
// Compare what the server hands out now against what this tab is running —
// checked when the tab regains focus (the exact moment stale tabs resurface)
// and on a slow poll — and offer a one-click refresh when they differ. The
// URL survives the reload, so the user stays exactly where they were.

const CHECK_THROTTLE_MS = 60_000;
const POLL_INTERVAL_MS = 5 * 60_000;

// The build fingerprint of a shell document: its hashed module-script names.
function fingerprintOf(html: string): string {
  const sources = [...html.matchAll(/src="(\/assets\/[^"]+\.js)"/g)].map((match) => match[1]);
  return [...new Set(sources)].sort().join("|");
}

let installed = false;

export function watchForNewDeploy(onNewVersion: () => void) {
  if (installed || typeof window === "undefined") return;
  installed = true;

  let baseline: string | null = null;
  let lastCheckAt = 0;
  let fired = false;
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  const fetchFingerprint = async (): Promise<string | null> => {
    try {
      const response = await fetch("/", { cache: "no-store" });
      if (!response.ok) return null;
      const fingerprint = fingerprintOf(await response.text());
      return fingerprint || null;
    } catch {
      // Offline / flaky network — never bother the user over a failed check.
      return null;
    }
  };

  const check = async () => {
    if (fired) return;
    const now = Date.now();
    if (now - lastCheckAt < CHECK_THROTTLE_MS) return;
    lastCheckAt = now;

    const current = await fetchFingerprint();
    if (!current) return;
    if (baseline === null) {
      // First successful read is the reference build. Taken from the server
      // rather than the running document so SSR/streaming quirks can't skew it;
      // worst case a deploy in the first minute waits for the NEXT deploy.
      baseline = current;
      return;
    }
    if (current !== baseline) {
      fired = true;
      if (pollTimer) clearInterval(pollTimer);
      onNewVersion();
    }
  };

  // Establish the baseline right away, then watch the moments stale tabs
  // resurface: tab becomes visible, window regains focus, and a slow poll for
  // tabs that just sit open on a wallboard.
  void check();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void check();
  });
  window.addEventListener("focus", () => void check());
  pollTimer = setInterval(() => void check(), POLL_INTERVAL_MS);
}
