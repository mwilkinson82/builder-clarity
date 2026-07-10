// A deploy that lands while a tab is open replaces every hashed JS/CSS chunk on
// the server. The open tab still holds the old build's chunk names, so the next
// lazily-loaded route or tab it opens fetches a file that no longer exists — the
// import fails and the screen goes blank with no error UI and no way to recover
// except a manual refresh (this killed a live product demo on 2026-07-09).
//
// Vite reports exactly that failure as a `vite:preloadError` event on window, so
// we reload the page once instead: the shell HTML is served no-cache, the reload
// lands on the new build, and the user's click works on the second try. The URL
// (project, ?tab=…) survives the reload, so they stay where they were.

const RELOADED_AT_KEY = "overwatch-stale-chunk-reloaded-at";
const RELOAD_LOOP_WINDOW_MS = 60_000;

let installed = false;

export function reloadOnStaleDeploy() {
  if (installed) return;
  installed = true;
  window.addEventListener("vite:preloadError", (event) => {
    // A second failure right after a reload isn't a stale deploy — the network
    // or host itself is unhealthy. Surface the error instead of reload-looping.
    // Same if we can't record the reload timestamp: never reload untracked.
    try {
      const lastReload = Number(sessionStorage.getItem(RELOADED_AT_KEY) ?? 0);
      if (Date.now() - lastReload < RELOAD_LOOP_WINDOW_MS) return;
      sessionStorage.setItem(RELOADED_AT_KEY, String(Date.now()));
    } catch {
      return;
    }
    event.preventDefault();
    window.location.reload();
  });
}
