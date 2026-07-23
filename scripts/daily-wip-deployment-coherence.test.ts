import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  verifyBuiltDeploymentContract,
  verifyPublicDeploymentContract,
} from "./daily-wip-deployment-coherence.mjs";

const serverContract = `
  await supabase.rpc("save_daily_wip_entry_atomic", {
    p_expected_version: input.expected_version,
    p_operation_key: input.operation_key
  });
  await supabase.rpc("void_daily_wip_entry_atomic", {
    p_expected_version: input.expected_version,
    p_operation_key: input.operation_key
  });
`;

const projectContract = `
  const saved = {projectId:p,id:e.id,expected_version:e.version,operation_key:k,entry_date:d};
  const removed = {projectId:p,id:e.id,expected_version:e.version,reason:r,operation_key:v};
  toast("Day's work recorded");
  fail("Could not remove the entry");
`;

function buildFixture({
  server = serverContract,
  client = projectContract,
  clientDirectory = "public",
}: {
  server?: string;
  client?: string;
  clientDirectory?: "public" | "client";
} = {}) {
  const output = mkdtempSync(join(tmpdir(), "overwatch-deployment-contract-"));
  const serverDirectory = join(output, "server", "_ssr");
  const assetsDirectory = join(output, clientDirectory, "assets");
  mkdirSync(serverDirectory, { recursive: true });
  mkdirSync(assetsDirectory, { recursive: true });
  writeFileSync(join(serverDirectory, "daily-wip.functions-ABC123.mjs"), server);
  writeFileSync(join(assetsDirectory, "projects._projectId-ABC123.js"), client);
  writeFileSync(join(assetsDirectory, "projects._projectId-ROUTE1.js"), "export default {}");
  return output;
}

function response({
  body,
  url,
  cacheControl = "",
  deploymentId = "",
}: {
  body: string;
  url: string;
  cacheControl?: string;
  deploymentId?: string;
}) {
  return {
    ok: true,
    status: 200,
    url,
    headers: new Headers({
      "cache-control": cacheControl,
      ...(deploymentId ? { "x-deployment-id": deploymentId } : {}),
    }),
    text: async () => body,
  } as Response;
}

describe("Daily WIP built deployment coherence", () => {
  it("proves the audited server commands and versioned client payloads", () => {
    const result = verifyBuiltDeploymentContract(buildFixture());
    expect(result.serverArtifact).toContain("daily-wip.functions-ABC123.mjs");
    expect(result.projectAsset).toContain("projects._projectId-ABC123.js");
  });

  it("supports the Lovable dist/server plus dist/client build layout", () => {
    const result = verifyBuiltDeploymentContract(buildFixture({ clientDirectory: "client" }));
    expect(result.serverArtifact).toContain("daily-wip.functions-ABC123.mjs");
    expect(result.projectAsset).toContain("projects._projectId-ABC123.js");
  });

  it("rejects a stale direct-DML worker even if RPC names were added elsewhere", () => {
    const output = buildFixture({
      server: `${serverContract}\nconst result = table.update(payload);`,
    });
    expect(() => verifyBuiltDeploymentContract(output)).toThrow(/direct table-write method/);
  });

  it("rejects the pre-command client payload that omitted expected_version", () => {
    const output = buildFixture({
      client: projectContract.replaceAll("expected_version:e.version,", ""),
    });
    expect(() => verifyBuiltDeploymentContract(output)).toThrow(
      /expected_version and operation_key/,
    );
  });
});

describe("Daily WIP published deployment coherence", () => {
  it("proves the public SHA and one-year immutable project asset without authentication", async () => {
    const baseUrl = "https://overwatch.example.test";
    const expectedCommit = "a".repeat(40);
    const pageUrl = `${baseUrl}/projects/deployment-coherence-probe?tab=daily-wip`;
    const assetUrl = `${baseUrl}/assets/projects._projectId-ABC123.js`;
    const routeAssetUrl = `${baseUrl}/assets/projects._projectId-ROUTE1.js`;
    const html = `
      <html data-commit-sha="${expectedCommit}">
        <script src="/assets/projects._projectId-ROUTE1.js"></script>
        <script src="/assets/projects._projectId-ABC123.js"></script>
      </html>
    `;
    const fetchImpl = async (input: string | URL | Request) => {
      const url = String(input);
      if (url === pageUrl) {
        return response({ body: html, url, deploymentId: "deployment-123" });
      }
      if (url === routeAssetUrl) {
        return response({
          body: "export default {}",
          url,
          cacheControl: "public, max-age=31536000, immutable",
        });
      }
      if (url === assetUrl) {
        return response({
          body: projectContract,
          url,
          cacheControl: "public, max-age=31536000, immutable",
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    };

    await expect(
      verifyPublicDeploymentContract({ baseUrl, expectedCommit, fetchImpl }),
    ).resolves.toMatchObject({
      servedCommit: expectedCommit,
      deploymentId: "deployment-123",
      projectAsset: assetUrl,
    });
  });

  it("rejects matching HTML wrapped around a stale immutable project asset", async () => {
    const baseUrl = "https://overwatch.example.test";
    const expectedCommit = "b".repeat(40);
    const pageUrl = `${baseUrl}/projects/deployment-coherence-probe?tab=daily-wip`;
    const assetUrl = `${baseUrl}/assets/projects._projectId-STALE1.js`;
    const staleClient = projectContract.replaceAll("expected_version:e.version,", "");
    const fetchImpl = async (input: string | URL | Request) => {
      const url = String(input);
      return url === pageUrl
        ? response({
            body: `<html data-commit-sha="${expectedCommit}"><script src="${assetUrl}"></script></html>`,
            url,
          })
        : response({
            body: staleClient,
            url,
            cacheControl: "public, max-age=31536000, immutable",
          });
    };

    await expect(
      verifyPublicDeploymentContract({ baseUrl, expectedCommit, fetchImpl }),
    ).rejects.toThrow(/expected_version and operation_key/);
  });
});
