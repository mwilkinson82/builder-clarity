// STALE-TAB regression (2026-07-09): two field bug reports in one night were
// features already live in the current build — the reporter's tab was simply
// running the previous deploy, and nothing ever told them. watchForNewDeploy
// compares the served shell's hashed /assets/*.js chunk names (the build
// fingerprint) against a baseline and fires once when they change. These tests
// drive the real module with a stubbed fetch and real focus events.

import { afterEach, beforeEach, expect, test, vi } from "vitest";

const SHELL_A = `<html><head>
<script type="module" src="/assets/index-AAA111.js"></script>
<script type="module" src="/assets/vendor-BBB222.js"></script>
</head><body></body></html>`;

const SHELL_B = SHELL_A.replaceAll("AAA111", "CCC333");

// The module guards with a module-scoped `installed` flag, so each test gets a
// fresh import via vi.resetModules().
async function freshWatcher() {
  vi.resetModules();
  const mod = await import("@/lib/new-version-toast");
  return mod.watchForNewDeploy;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const respondWith = (html: string) =>
  Promise.resolve({ ok: true, text: () => Promise.resolve(html) });

const focusWindow = async () => {
  window.dispatchEvent(new Event("focus"));
  // Let the async check settle.
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

test("fires once when the served build changes, not before", async () => {
  const watch = await freshWatcher();
  const onNewVersion = vi.fn();
  fetchMock.mockImplementation(() => respondWith(SHELL_A));
  watch(onNewVersion);
  await focusWindow(); // baseline established from SHELL_A

  // Same build served again — quiet.
  await vi.advanceTimersByTimeAsync(61_000);
  await focusWindow();
  expect(onNewVersion).not.toHaveBeenCalled();

  // New build lands on the server; the next refocus notices it.
  fetchMock.mockImplementation(() => respondWith(SHELL_B));
  await vi.advanceTimersByTimeAsync(61_000);
  await focusWindow();
  expect(onNewVersion).toHaveBeenCalledTimes(1);

  // And never fires again after that (no toast spam).
  await vi.advanceTimersByTimeAsync(61_000);
  await focusWindow();
  expect(onNewVersion).toHaveBeenCalledTimes(1);
});

test("throttles checks — rapid refocus does not hammer the server", async () => {
  const watch = await freshWatcher();
  fetchMock.mockImplementation(() => respondWith(SHELL_A));
  watch(vi.fn());
  await focusWindow();
  const callsAfterBaseline = fetchMock.mock.calls.length;

  await focusWindow();
  await focusWindow();
  await focusWindow();
  expect(fetchMock.mock.calls.length).toBe(callsAfterBaseline);
});

test("a failed or offline check stays silent and recovers later", async () => {
  const watch = await freshWatcher();
  const onNewVersion = vi.fn();
  fetchMock.mockImplementation(() => Promise.reject(new Error("offline")));
  watch(onNewVersion);
  await focusWindow(); // baseline attempt fails — no crash, no callback
  expect(onNewVersion).not.toHaveBeenCalled();

  // Back online: first good read becomes the baseline, change detected after.
  fetchMock.mockImplementation(() => respondWith(SHELL_A));
  await vi.advanceTimersByTimeAsync(61_000);
  await focusWindow();
  fetchMock.mockImplementation(() => respondWith(SHELL_B));
  await vi.advanceTimersByTimeAsync(61_000);
  await focusWindow();
  expect(onNewVersion).toHaveBeenCalledTimes(1);
});
