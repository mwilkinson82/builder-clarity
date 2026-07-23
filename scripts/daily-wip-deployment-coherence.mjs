import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ASSET_NAME = /^projects\._projectId-[A-Za-z0-9_-]{6,}\.js$/;
const SERVER_EXTENSIONS = /\.(?:[cm]?js)$/;
const EXPECTED_COMMIT = /^[0-9a-f]{7,40}$/i;
const MIN_IMMUTABLE_MAX_AGE_SECONDS = 31_536_000;

const RPC_CONTRACTS = [
  {
    name: "save_daily_wip_entry_atomic",
    pattern:
      /\.rpc\(\s*["']save_daily_wip_entry_atomic["']\s*,\s*\{[\s\S]{0,800}?p_expected_version\s*:[\s\S]{0,400}?p_operation_key\s*:/,
  },
  {
    name: "void_daily_wip_entry_atomic",
    pattern:
      /\.rpc\(\s*["']void_daily_wip_entry_atomic["']\s*,\s*\{[\s\S]{0,800}?p_expected_version\s*:[\s\S]{0,400}?p_operation_key\s*:/,
  },
];

const CLIENT_SAVE_CONTRACT =
  /projectId:[^,}{]+,id:[^,}{]+,expected_version:[^,}{]+,operation_key:[^,}{]+,entry_date:/;
const CLIENT_VOID_CONTRACT =
  /projectId:[^,}{]+,id:[^,}{]+,expected_version:[^,}{]+,reason:[^,}{]+,operation_key:[^,}{]+/;

function listFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? listFiles(target) : [target];
  });
}

function relativeLabel(file) {
  return path.relative(process.cwd(), file) || file;
}

function isDailyWipProjectAsset(source) {
  const costingWorkspace =
    source.includes("Day's work recorded") && source.includes("Could not remove the entry");
  const dailyLog =
    source.includes("Work line added to the log") && source.includes("Work line removed");
  return costingWorkspace || dailyLog;
}

export function verifyProjectClientContract(source, label = "project client asset") {
  if (!isDailyWipProjectAsset(source)) {
    throw new Error(`${label} does not contain the Daily WIP customer workflow.`);
  }
  if (!CLIENT_SAVE_CONTRACT.test(source)) {
    throw new Error(
      `${label} does not send both expected_version and operation_key on Daily WIP save.`,
    );
  }
  if (!CLIENT_VOID_CONTRACT.test(source)) {
    throw new Error(
      `${label} does not send both expected_version and operation_key on Daily WIP void.`,
    );
  }
}

function resolveBuildLayout(outputRoot) {
  const roots = outputRoot
    ? [path.resolve(outputRoot)]
    : [path.resolve(".output"), path.resolve("dist")];
  const layouts = roots.flatMap((root) => {
    const serverDirectory = path.join(root, "server");
    const assetsDirectory = [
      path.join(root, "public", "assets"),
      path.join(root, "client", "assets"),
    ].find((directory) => existsSync(directory));
    return existsSync(serverDirectory) && assetsDirectory
      ? [{ root, serverDirectory, assetsDirectory }]
      : [];
  });
  if (layouts.length === 0) {
    throw new Error(
      `Production build output is missing a supported server/client layout under ` +
        `${roots.map(relativeLabel).join(" or ")}.`,
    );
  }
  if (layouts.length > 1) {
    throw new Error(
      `Production build output is ambiguous across ${layouts
        .map((layout) => relativeLabel(layout.root))
        .join(" and ")}; run the gate from a clean checkout.`,
    );
  }
  return layouts[0];
}

export function verifyBuiltDeploymentContract(outputRoot) {
  const { serverDirectory, assetsDirectory } = resolveBuildLayout(outputRoot);

  const serverFiles = listFiles(serverDirectory).filter((file) => SERVER_EXTENSIONS.test(file));
  const commandArtifacts = [];
  for (const file of serverFiles) {
    const source = readFileSync(file, "utf8");
    if (RPC_CONTRACTS.every((contract) => contract.pattern.test(source))) {
      commandArtifacts.push({ file, source });
    }
  }
  if (commandArtifacts.length !== 1) {
    throw new Error(
      `Expected exactly one built server artifact to invoke both audited Daily WIP RPCs; ` +
        `found ${commandArtifacts.length}.`,
    );
  }

  const commandArtifact = commandArtifacts[0];
  const directWrite = /\.(?:insert|update|upsert|delete)\s*\(/.exec(commandArtifact.source);
  if (directWrite) {
    throw new Error(
      `${relativeLabel(commandArtifact.file)} still contains a direct table-write method ` +
        `(${directWrite[0]}); Daily WIP writes must use the audited RPCs only.`,
    );
  }

  const projectAssets = readdirSync(assetsDirectory)
    .filter((name) => PROJECT_ASSET_NAME.test(name))
    .map((name) => path.join(assetsDirectory, name));
  const dailyWipAssets = projectAssets.filter((file) =>
    isDailyWipProjectAsset(readFileSync(file, "utf8")),
  );
  if (dailyWipAssets.length !== 1) {
    throw new Error(
      `Expected exactly one built project client asset containing Daily WIP; ` +
        `found ${dailyWipAssets.length}.`,
    );
  }
  const projectAsset = dailyWipAssets[0];
  verifyProjectClientContract(readFileSync(projectAsset, "utf8"), relativeLabel(projectAsset));

  return {
    serverArtifact: relativeLabel(commandArtifact.file),
    projectAsset: relativeLabel(projectAsset),
    serverFilesScanned: serverFiles.length,
  };
}

function verifiedBaseUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:") {
    throw new Error(`Deployment contract URL must use HTTPS: ${url}`);
  }
  if (/(?:^|\.)vercel\.app$/i.test(url.hostname) || /vercel/i.test(url.hostname)) {
    throw new Error(`Deployment contract URL points at Vercel, not Lovable: ${url.hostname}`);
  }
  return url;
}

function assertExpectedCommit(expected, served) {
  const expectedCommit = expected.trim().toLowerCase();
  const servedCommit = served.trim().toLowerCase();
  if (!EXPECTED_COMMIT.test(expectedCommit)) {
    throw new Error(`Expected deployment commit is invalid: ${expected || "(empty)"}`);
  }
  if (!EXPECTED_COMMIT.test(servedCommit)) {
    throw new Error(`Published data-commit-sha is invalid: ${served || "(empty)"}`);
  }
  if (!expectedCommit.startsWith(servedCommit) && !servedCommit.startsWith(expectedCommit)) {
    throw new Error(
      `Published data-commit-sha ${servedCommit} does not match expected ${expectedCommit}.`,
    );
  }
}

async function fetchText(fetchImpl, url, label) {
  const response = await fetchImpl(url, {
    cache: "no-store",
    redirect: "follow",
  });
  if (!response.ok) {
    throw new Error(`${label} returned HTTP ${response.status} at ${url}.`);
  }
  return { response, text: await response.text() };
}

function immutableMaxAge(cacheControl) {
  return Number(cacheControl.match(/(?:^|,)\s*max-age=(\d+)/i)?.[1] ?? 0);
}

export async function verifyPublicDeploymentContract({
  baseUrl,
  expectedCommit,
  fetchImpl = fetch,
}) {
  const base = verifiedBaseUrl(baseUrl);
  const route = new URL("/projects/deployment-coherence-probe?tab=daily-wip", base);
  const { response: pageResponse, text: html } = await fetchText(
    fetchImpl,
    route,
    "Public project route",
  );
  const servedCommit =
    html.match(/data-commit-sha=["']([0-9a-f]{7,40})["']/i)?.[1]?.toLowerCase() ?? "";
  assertExpectedCommit(expectedCommit, servedCommit);

  const finalPageUrl = new URL(pageResponse.url || route);
  const assetPaths = [
    ...new Set(
      [
        ...html.matchAll(/(?:src|href)=["']([^"']*\/assets\/projects\._projectId-[^"']+\.js)["']/g),
      ].map((match) => match[1]),
    ),
  ];
  if (assetPaths.length === 0) {
    throw new Error(`Public project route did not reference a hashed project client asset.`);
  }

  const dailyWipAssets = [];
  for (const assetPath of assetPaths) {
    const assetUrl = new URL(assetPath, finalPageUrl);
    if (
      assetUrl.origin !== finalPageUrl.origin ||
      !PROJECT_ASSET_NAME.test(path.basename(assetUrl.pathname))
    ) {
      throw new Error(`Public project route referenced a non-immutable project asset: ${assetUrl}`);
    }
    const { response, text } = await fetchText(fetchImpl, assetUrl, "Project client asset");
    const cacheControl = response.headers.get("cache-control") ?? "";
    if (
      !/\bimmutable\b/i.test(cacheControl) ||
      immutableMaxAge(cacheControl) < MIN_IMMUTABLE_MAX_AGE_SECONDS
    ) {
      throw new Error(
        `${assetUrl} is not a one-year immutable asset (cache-control: ${cacheControl || "none"}).`,
      );
    }
    if (isDailyWipProjectAsset(text)) {
      verifyProjectClientContract(text, assetUrl.toString());
      dailyWipAssets.push(assetUrl.toString());
    }
  }

  if (dailyWipAssets.length !== 1) {
    throw new Error(
      `Expected exactly one published project asset containing Daily WIP; ` +
        `found ${dailyWipAssets.length}.`,
    );
  }

  return {
    baseUrl: finalPageUrl.origin,
    servedCommit,
    deploymentId: pageResponse.headers.get("x-deployment-id") ?? "not exposed",
    projectAsset: dailyWipAssets[0],
  };
}

function option(name) {
  const prefix = `${name}=`;
  const inline = process.argv.find((argument) => argument.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
}

function gitCommit() {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

async function main() {
  const profile = option("--profile") || "build";
  if (profile === "build") {
    const result = verifyBuiltDeploymentContract(
      option("--output-dir") || process.env.OVERWATCH_BUILD_OUTPUT || undefined,
    );
    console.log("Built Daily WIP deployment contract verified:");
    console.log(`- server artifact: ${result.serverArtifact}`);
    console.log(`- project client asset: ${result.projectAsset}`);
    console.log(`- server files scanned: ${result.serverFilesScanned}`);
    return;
  }
  if (profile === "public") {
    const result = await verifyPublicDeploymentContract({
      baseUrl:
        option("--base-url") ||
        process.env.OVERWATCH_DEPLOY_BASE_URL ||
        "https://overwatch.alpcontractorcircle.com",
      expectedCommit:
        option("--expected-sha") || process.env.OVERWATCH_EXPECTED_COMMIT || gitCommit(),
    });
    console.log("Published Daily WIP deployment contract verified:");
    console.log(`- public origin: ${result.baseUrl}`);
    console.log(`- data-commit-sha: ${result.servedCommit}`);
    console.log(`- deployment id: ${result.deploymentId}`);
    console.log(`- immutable project asset: ${result.projectAsset}`);
    return;
  }
  throw new Error(`Unknown deployment-coherence profile: ${profile}`);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath) {
  main().catch((error) => {
    console.error(`Daily WIP deployment contract failed: ${error.message}`);
    process.exit(1);
  });
}
