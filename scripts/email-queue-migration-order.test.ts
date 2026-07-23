import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = join(__dirname, "..", "supabase", "migrations");

const CONTAINMENT_MIGRATION = "20260723020530_8e9a7991-1172-4c7a-9623-de237e683949.sql";
const RUNTIME_MIGRATION = "20260723023551_021aedf3-e703-4cec-999b-b9d5465604eb.sql";

function readMigration(name: string): string {
  return readFileSync(join(MIGRATIONS_DIR, name), "utf8");
}

function chronologicalOrder(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

describe("email queue containment migrations — chronological clean replay", () => {
  it("orders 20530 (containment) strictly before 23551 (runtime definitions)", () => {
    const order = chronologicalOrder();
    const containmentIdx = order.indexOf(CONTAINMENT_MIGRATION);
    const runtimeIdx = order.indexOf(RUNTIME_MIGRATION);
    expect(containmentIdx).toBeGreaterThanOrEqual(0);
    expect(runtimeIdx).toBeGreaterThanOrEqual(0);
    expect(containmentIdx).toBeLessThan(runtimeIdx);
  });

  it("20530 never REVOKEs or GRANTs on dispatch/wake without a to_regprocedure guard", () => {
    const sql = readMigration(CONTAINMENT_MIGRATION);
    // Find every block that mentions dispatch/wake signatures.
    const dispatchWakePattern = /email_queue_(dispatch|wake)\s*\(\s*\)/g;
    const matches = sql.match(dispatchWakePattern) ?? [];
    expect(matches.length).toBeGreaterThan(0);

    // Any REVOKE/GRANT on those signatures must be inside a block that
    // guards with to_regprocedure(sig) IS NULL / CONTINUE.
    // Enforce this structurally: split into DO blocks and check each block
    // that references dispatch/wake also contains a to_regprocedure guard.
    const doBlocks = sql.split(/DO \$\$/).slice(1);
    for (const block of doBlocks) {
      if (!/email_queue_(dispatch|wake)/.test(block)) continue;
      expect(block, "dispatch/wake block missing to_regprocedure guard").toMatch(
        /to_regprocedure\s*\(\s*sig\s*\)\s+IS\s+NULL/i,
      );
    }
  });

  it("20530 keeps unconditional strict containment for the four always-present RPCs", () => {
    const sql = readMigration(CONTAINMENT_MIGRATION);
    for (const fn of [
      "enqueue_email",
      "read_email_batch",
      "delete_email",
      "move_to_dlq",
    ]) {
      expect(sql).toContain(`public.${fn}`);
    }
    // The strict block must NOT be gated by to_regprocedure — assertions
    // fail-closed on missing functions.
    const strictBlock = sql
      .split(/DO \$\$/)
      .slice(1)
      .find(
        (b) =>
          b.includes("enqueue_email") &&
          b.includes("read_email_batch") &&
          !b.includes("email_queue_dispatch"),
      );
    expect(strictBlock, "strict RPC block not found").toBeDefined();
    expect(strictBlock!).not.toMatch(/to_regprocedure\s*\(\s*sig\s*\)\s+IS\s+NULL[\s\S]{0,40}CONTINUE/i);
  });

  it("23551 owns creation of dispatch/wake and both statement triggers", () => {
    const sql = readMigration(RUNTIME_MIGRATION);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION\s+public\.email_queue_dispatch\s*\(\s*\)/);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION\s+public\.email_queue_wake\s*\(\s*\)/);
    expect(sql).toMatch(/CREATE TRIGGER email_queue_wake_auth[\s\S]+pgmq\.q_auth_emails/);
    expect(sql).toMatch(
      /CREATE TRIGGER email_queue_wake_transactional[\s\S]+pgmq\.q_transactional_emails/,
    );
  });

  it("23551 revokes PUBLIC/anon/authenticated/sandbox_exec and grants only service_role for dispatch/wake", () => {
    const sql = readMigration(RUNTIME_MIGRATION);
    for (const role of ["PUBLIC", "anon", "authenticated", "sandbox_exec"]) {
      expect(sql).toMatch(new RegExp(`REVOKE ALL ON FUNCTION %s FROM ${role}`));
    }
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION %s TO service_role/);
    // Assertion posture is present.
    expect(sql).toMatch(/assertion failed: privilege posture wrong/);
    expect(sql).toMatch(/assertion failed: trigger email_queue_wake_auth missing/);
    expect(sql).toMatch(/assertion failed: trigger email_queue_wake_transactional missing/);
  });

  it("23551 comment no longer claims it lets 20530 reach assertions", () => {
    const sql = readMigration(RUNTIME_MIGRATION);
    expect(sql).not.toMatch(/so the 20260723020530 containment migration\s*\n--\s*reaches its ACL assertions/);
    expect(sql).toMatch(/runs AFTER 20260723020530/);
  });
});
