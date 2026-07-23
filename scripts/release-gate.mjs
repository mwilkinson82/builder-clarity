import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const scriptsDir = path.join(root, "scripts");
const profileArg = process.argv.find((arg) => arg.startsWith("--profile"));
const profileIndex = process.argv.indexOf("--profile");
const profile = profileArg?.includes("=")
  ? profileArg.split("=")[1]
  : profileIndex >= 0
    ? process.argv[profileIndex + 1]
    : "pr";

if (!new Set(["pr", "live"]).has(profile)) {
  console.error(`Unknown release-gate profile: ${profile}`);
  process.exit(2);
}

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const vitest = path.join(
  root,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "vitest.cmd" : "vitest",
);
const eslint = path.join(
  root,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "eslint.cmd" : "eslint",
);
const maxOldSpace = "--max-old-space-size=8192";
const nodeOptions = [
  maxOldSpace,
  ...(process.env.NODE_OPTIONS ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .filter((option) => !option.startsWith("--max-old-space-size=")),
].join(" ");
const gateEnv = {
  ...process.env,
  FORCE_COLOR: "1",
  NODE_OPTIONS: nodeOptions,
};
const lintExclusions = new Set([
  "src/routeTree.gen.ts",
  "src/integrations/supabase/types.ts",
  "src/lib/estimate-seed-data.ts",
]);
delete gateEnv.NO_COLOR;

function runGit(args, { allowFailure = false } = {}) {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    env: gateEnv,
  });
  if (result.status !== 0 && !allowFailure) {
    throw new Error(result.stderr.trim() || `git ${args.join(" ")} failed`);
  }
  return result.status === 0 ? result.stdout.trim() : "";
}

function run(name, command, args, options = {}) {
  const stepStartedAt = Date.now();
  console.log(`\n=== ${name} ===`);
  const result = spawnSync(command, args, {
    cwd: root,
    env: { ...gateEnv, ...options.env },
    stdio: "inherit",
  });
  const seconds = ((Date.now() - stepStartedAt) / 1000).toFixed(1);

  if (result.error) {
    throw new Error(`Could not start ${name}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const error = new Error(`${name} failed after ${seconds}s.`);
    error.exitCode = result.status || 1;
    throw error;
  }

  return `${name} (${seconds}s)`;
}

function commandVersion(command, args = ["--version"]) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    env: gateEnv,
  });
  return result.status === 0 ? result.stdout.trim() : "";
}

function packageVersion(packageName) {
  const packageFile = path.join(root, "node_modules", ...packageName.split("/"), "package.json");
  if (!existsSync(packageFile)) return "missing";
  return JSON.parse(readFileSync(packageFile, "utf8")).version ?? "unknown";
}

function reportDependencyContract() {
  const lockfile = path.join(root, "bun.lock");
  if (!existsSync(lockfile) || readFileSync(lockfile).length === 0) {
    throw new Error("bun.lock is missing or empty; a frozen dependency install is impossible.");
  }

  const trackedLock = runGit(["ls-files", "--error-unmatch", "bun.lock"], {
    allowFailure: true,
  });
  if (trackedLock !== "bun.lock") {
    throw new Error("bun.lock is not tracked by Git.");
  }

  const bunVersion = commandVersion(process.platform === "win32" ? "bun.exe" : "bun");
  if (process.env.CI === "true" && !bunVersion) {
    throw new Error("Bun is required in CI so bun.lock can be installed with --frozen-lockfile.");
  }

  console.log("\n=== Resolved toolchain and dependency graph ===");
  console.log(`Node: ${process.version}`);
  console.log(`Bun: ${bunVersion || "not installed (local gate; CI requires Bun)"}`);
  console.log(`NODE_OPTIONS: ${nodeOptions}`);
  for (const packageName of [
    "typescript",
    "eslint",
    "prettier",
    "vitest",
    "vite",
    "react",
    "@supabase/supabase-js",
    "@lovable.dev/vite-tanstack-config",
  ]) {
    console.log(`${packageName}: ${packageVersion(packageName)}`);
  }
}

function isUsableBaseSha(value) {
  return Boolean(value && !/^0+$/.test(value) && /^[0-9a-f]{7,40}$/i.test(value));
}

function changedFiles() {
  const files = new Set();
  const configuredBase = process.env.RELEASE_GATE_BASE_SHA?.trim() ?? "";
  const baseRef = process.env.GITHUB_BASE_REF?.trim() ?? "";
  let base = isUsableBaseSha(configuredBase) ? configuredBase : "";

  if (!base && baseRef) {
    const remoteBase = `origin/${baseRef}`;
    if (runGit(["rev-parse", "--verify", remoteBase], { allowFailure: true })) {
      base = runGit(["merge-base", "HEAD", remoteBase], { allowFailure: true });
    }
  }
  if (!base) {
    base = runGit(["rev-parse", "HEAD^"], { allowFailure: true });
  }

  if (base) {
    for (const file of runGit(["diff", "--name-only", "--diff-filter=ACMR", `${base}...HEAD`], {
      allowFailure: true,
    }).split("\n")) {
      if (file) files.add(file);
    }
  }

  for (const args of [
    ["diff", "--name-only", "--diff-filter=ACMR", "HEAD"],
    ["ls-files", "--others", "--exclude-standard"],
  ]) {
    for (const file of runGit(args, { allowFailure: true }).split("\n")) {
      if (file) files.add(file);
    }
  }

  return [...files].filter((file) => existsSync(path.join(root, file))).sort();
}

function lintableChangedFiles() {
  return changedFiles().filter(
    (file) =>
      /\.(?:[cm]?[jt]sx?)$/.test(file) &&
      !lintExclusions.has(file) &&
      !file.startsWith("public/ort/"),
  );
}

function summarizeFullLint(changedLintFiles) {
  console.log("\n=== Application/test-source lint inventory (advisory debt separation) ===");
  const result = spawnSync(
    eslint,
    [
      ".",
      "--format",
      "json",
      "--ignore-pattern",
      "public/ort/**",
      "--ignore-pattern",
      "src/routeTree.gen.ts",
      "--ignore-pattern",
      "src/integrations/supabase/types.ts",
      "--ignore-pattern",
      "src/lib/estimate-seed-data.ts",
    ],
    {
      cwd: root,
      env: { ...gateEnv, FORCE_COLOR: "0" },
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  if (result.error) {
    console.warn(`Could not inventory full lint: ${result.error.message}`);
    return;
  }
  if (result.status !== 0 && result.status !== 1) {
    throw new Error(
      `Full lint inventory could not run (exit ${result.status ?? "unknown"}): ` +
        (result.stderr.trim() || "no diagnostic output"),
    );
  }

  let reports;
  try {
    reports = JSON.parse(result.stdout || "[]");
  } catch {
    console.warn("Full lint returned output that was not valid ESLint JSON.");
    const tail = `${result.stdout}\n${result.stderr}`.trim().split("\n").slice(-40).join("\n");
    if (tail) console.warn(tail);
    return;
  }

  const changed = new Set(changedLintFiles.map((file) => path.resolve(root, file)));
  const problems = reports
    .filter((report) => report.errorCount > 0 || report.warningCount > 0)
    .map((report) => ({
      filePath: path.resolve(report.filePath),
      errorCount: report.errorCount,
      warningCount: report.warningCount,
    }))
    .sort(
      (left, right) =>
        right.errorCount + right.warningCount - (left.errorCount + left.warningCount),
    );
  const changedProblems = problems.filter((report) => changed.has(report.filePath));
  const unchangedProblems = problems.filter((report) => !changed.has(report.filePath));
  const totals = (items) =>
    items.reduce(
      (sum, item) => ({
        errors: sum.errors + item.errorCount,
        warnings: sum.warnings + item.warningCount,
      }),
      { errors: 0, warnings: 0 },
    );

  if (changedProblems.length > 0) {
    const changedTotals = totals(changedProblems);
    throw new Error(
      `Full lint still reports ${changedTotals.errors} error(s) and ` +
        `${changedTotals.warnings} warning(s) in changed files.`,
    );
  }
  if (unchangedProblems.length === 0) {
    console.log("Full repository lint is clean.");
    return;
  }

  const unchangedTotals = totals(unchangedProblems);
  console.warn(
    `Changed-file lint is clean. Existing unchanged-file debt: ` +
      `${unchangedTotals.errors} error(s), ${unchangedTotals.warnings} warning(s) ` +
      `across ${unchangedProblems.length} file(s).`,
  );
  for (const report of unchangedProblems.slice(0, 20)) {
    console.warn(
      `- ${path.relative(root, report.filePath)}: ` +
        `${report.errorCount} error(s), ${report.warningCount} warning(s)`,
    );
  }
  if (unchangedProblems.length > 20) {
    console.warn(`- …and ${unchangedProblems.length - 20} more unchanged file(s).`);
  }
}

function criticalTestGroups() {
  const allTests = readdirSync(scriptsDir)
    .filter((file) => /\.test\.[cm]?[jt]sx?$/.test(file))
    .sort();
  const select = (predicate) =>
    allTests.filter(predicate).map((file) => path.join("scripts", file));
  const exact = (names) => names.map((file) => path.join("scripts", file));

  const groups = [
    {
      name: "Auth callback and MagicLink containment",
      files: exact([
        "auth-callback-secret-scrub.test.tsx",
        "auth-p0-provisioning-authorization-lockdown.test.ts",
        "auth-provisioning-hardening.test.ts",
        "auth-session-verification.test.tsx",
        "authenticated-access-mode.test.ts",
        "authenticated-access-mode-behavioral.test.tsx",
        "account-provisioning-disabled-seat.test.ts",
        "client-access-resend-containment.test.ts",
        "magic-link-auth-user-lookup.test.ts",
        "magic-link-handler-behavioral.test.ts",
        "magic-link-invite-containment.test.ts",
        "magic-link-redirect-containment.test.ts",
        "safe-internal-path.test.ts",
      ]),
      minimum: 13,
    },
    {
      name: "Team role and authorization containment",
      files: exact([
        "team-role-containment.test.ts",
        "authz-capability-split.test.ts",
        "authz-app-guards.test.ts",
      ]),
      minimum: 3,
    },
    {
      name: "Plan Room interaction and command integrity",
      files: select(
        (file) =>
          file.startsWith("plan-room-") ||
          [
            "ai-assist-lifecycle.test.tsx",
            "ai-count-source-provenance.test.ts",
            "estimate-quantity-source-review.test.ts",
            "plan-sheet-identity.test.ts",
            "scale-assurance-ui.test.tsx",
            "scope-brief-work-status.test.ts",
            "sheet-sidebar-identity.test.tsx",
          ].includes(file),
      ),
      minimum: 10,
    },
    {
      name: "Financial command and ledger integrity",
      files: select((file) =>
        /financial|billing-(?:application|invoice)|payment|cost-actual|change-order.*integrity|budget-sov|invoice-checkout|certification-history|production-forecast|subcontract-(?:financial|payment)/.test(
          file,
        ),
      ),
      minimum: 15,
    },
    {
      name: "Email queue migration order and containment",
      files: select((file) => file.startsWith("email-queue-")),
      minimum: 1,
    },
  ];

  for (const group of groups) {
    const missing = group.files.filter((file) => !existsSync(path.join(root, file)));
    if (missing.length > 0) {
      throw new Error(`${group.name} is missing test file(s): ${missing.join(", ")}`);
    }
    if (group.files.length < group.minimum) {
      throw new Error(
        `${group.name} resolved only ${group.files.length} test file(s); ` +
          `the release contract requires at least ${group.minimum}.`,
      );
    }
  }

  return groups;
}

function routeManifestSnapshot() {
  const routeManifest = path.join(root, "src", "routeTree.gen.ts");
  if (!existsSync(routeManifest)) {
    throw new Error("Generated route manifest src/routeTree.gen.ts is missing.");
  }
  return readFileSync(routeManifest, "utf8");
}

function proveGeneratedSourcesCurrent(beforeBuild) {
  if (routeManifestSnapshot() !== beforeBuild) {
    throw new Error(
      "Production build changed src/routeTree.gen.ts. Regenerate and review the route manifest " +
        "before release.",
    );
  }
}

function currentGitCommit() {
  const configured = process.env.OVERWATCH_EXPECTED_COMMIT?.trim() ?? "";
  const commit = configured || runGit(["rev-parse", "HEAD"]);
  if (!/^[0-9a-f]{7,40}$/i.test(commit)) {
    throw new Error(`Expected release commit is invalid: ${commit || "(empty)"}`);
  }
  return commit.toLowerCase();
}

function currentRemoteMainCommit() {
  const output = runGit(["ls-remote", "origin", "refs/heads/main"]);
  const commit = output.split(/\s+/, 1)[0]?.toLowerCase() ?? "";
  if (!/^[0-9a-f]{40}$/.test(commit)) {
    throw new Error(`Could not resolve GitHub origin/main: ${output || "(empty)"}`);
  }
  return commit;
}

function verifiedReleaseUrl(value, surface) {
  const url = new URL(value);
  if (url.protocol !== "https:") {
    throw new Error(`${surface} must use HTTPS: ${url}`);
  }
  if (/(?:^|\.)vercel\.app$/i.test(url.hostname) || /vercel/i.test(url.hostname)) {
    throw new Error(`${surface} points at Vercel; Lovable is the controlling deployment surface.`);
  }
  if (surface === "Lovable published domain" && !/(?:^|\.)lovable\.app$/i.test(url.hostname)) {
    throw new Error(`${surface} must be a lovable.app hostname: ${url.hostname}`);
  }
  return url;
}

async function deployedCommit(baseUrl, surface) {
  const route = new URL("/estimates", baseUrl);
  const response = await fetch(route, { redirect: "follow" });
  if (!response.ok) {
    throw new Error(`${surface} returned ${response.status} at ${route}.`);
  }
  const html = await response.text();
  const commit = html.match(/data-commit-sha="([0-9a-f]{7,40})"/i)?.[1]?.toLowerCase() ?? "";
  if (!commit) {
    throw new Error(`${surface} did not expose data-commit-sha at ${route}.`);
  }
  console.log(`${surface}: ${route.origin} is serving ${commit}`);
  return commit;
}

async function proveLovablePublication() {
  console.log("\n=== Lovable publication proof ===");
  const expected = currentGitCommit();
  const remoteMain = currentRemoteMainCommit();
  if (expected !== remoteMain) {
    throw new Error(
      `Expected release commit ${expected} is not current GitHub origin/main ${remoteMain}.`,
    );
  }
  const lovableUrl = verifiedReleaseUrl(
    process.env.OVERWATCH_LOVABLE_URL ?? "https://builder-clarity.lovable.app",
    "Lovable published domain",
  );
  const customUrl = verifiedReleaseUrl(
    process.env.OVERWATCH_CUSTOM_DOMAIN ?? "https://overwatch.alpcontractorcircle.com",
    "Custom production domain",
  );
  const lovableCommit = await deployedCommit(lovableUrl, "Lovable published domain");
  const customCommit = await deployedCommit(customUrl, "Custom production domain");
  const expectedPrefix = expected.slice(0, 8);

  for (const [surface, commit] of [
    ["Lovable published domain", lovableCommit],
    ["Custom production domain", customCommit],
  ]) {
    if (!commit.startsWith(expectedPrefix)) {
      throw new Error(`${surface} is serving ${commit}; expected ${expected}.`);
    }
  }
  if (
    !lovableCommit.startsWith(customCommit.slice(0, 8)) &&
    !customCommit.startsWith(lovableCommit.slice(0, 8))
  ) {
    throw new Error(
      `Published surfaces disagree: Lovable=${lovableCommit}, custom=${customCommit}.`,
    );
  }
}

const completed = [];
const startedAt = Date.now();

try {
  reportDependencyContract();

  const changedLintFiles = lintableChangedFiles();
  if (changedLintFiles.length > 0) {
    completed.push(run("Changed-file lint", eslint, changedLintFiles));
  } else {
    console.log("\n=== Changed-file lint ===");
    console.log("No changed JavaScript or TypeScript files.");
  }
  summarizeFullLint(changedLintFiles);

  for (const group of criticalTestGroups()) {
    completed.push(run(group.name, vitest, ["run", ...group.files]));
  }

  completed.push(run("TypeScript", npm, ["run", "typecheck"]));
  const routeManifestBeforeBuild = routeManifestSnapshot();
  completed.push(run("Production build", npm, ["run", "build"]));
  proveGeneratedSourcesCurrent(routeManifestBeforeBuild);
  completed.push(
    run("Built Daily WIP deployment coherence", npm, ["run", "verify:daily-wip:build"]),
  );
  completed.push(run("Phase 0 contracts", npm, ["run", "smoke:phase0"]));
  completed.push(run("Complete Vitest regression suite", npm, ["run", "test:unit"]));

  for (const [name, script] of [
    ["Estimating smoke", "test:estimating"],
    ["AI takeoff smoke", "test:ai:smoke"],
    ["CPM behavior", "test:cpm"],
    ["Harbor demo engine", "test:demo"],
    ["CRM pipeline", "test:crm"],
    ["Billing payments", "test:billing"],
    ["Budget contracts", "test:budget"],
    ["Subcontract accounting", "test:sub"],
    ["Compliance", "test:compliance"],
    ["Submittals", "test:submittals"],
    ["Daily WIP", "test:wip"],
    ["AIA PDF", "test:billing:aia"],
    ["Role/capability parity", "test:roles"],
    ["Schedule spine", "test:schedule"],
    ["Schedule import", "test:schedule:import"],
    ["CPM responsive layout", "test:cpm:layout"],
    ["CPM print", "test:cpm:print"],
  ]) {
    completed.push(run(name, npm, ["run", script]));
  }

  if (profile === "live") {
    await proveLovablePublication();
    completed.push(
      run("Published Daily WIP deployment coherence", npm, ["run", "verify:daily-wip:live"], {
        env: {
          OVERWATCH_DEPLOY_BASE_URL:
            process.env.OVERWATCH_CUSTOM_DOMAIN ?? "https://overwatch.alpcontractorcircle.com",
          OVERWATCH_EXPECTED_COMMIT: currentGitCommit(),
        },
      }),
    );
    completed.push(
      run("Published custom-domain Phase 0", npm, ["run", "smoke:phase0:live"], {
        env: {
          OVERWATCH_EXPECTED_COMMIT: currentGitCommit(),
          OVERWATCH_SMOKE_URL:
            process.env.OVERWATCH_CUSTOM_DOMAIN ?? "https://overwatch.alpcontractorcircle.com",
        },
      }),
    );
  }
} catch (error) {
  console.error(`\nRelease gate failed: ${error.message}`);
  process.exit(error.exitCode || 1);
}

const totalSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);
console.log(`\nRelease gate passed (${profile}) in ${totalSeconds}s:`);
for (const item of completed) console.log(`- ${item}`);
