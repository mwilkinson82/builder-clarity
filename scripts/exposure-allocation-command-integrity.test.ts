import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260720194500_exposure_allocation_command_integrity.sql",
  ),
  "utf8",
);
const server = readFileSync(
  join(process.cwd(), "src/lib/exposure-allocations.functions.ts"),
  "utf8",
);
const component = readFileSync(
  join(process.cwd(), "src/components/project/ExposureAllocationPanel.tsx"),
  "utf8",
);
const route = readFileSync(
  join(process.cwd(), "src/routes/_authenticated/projects.$projectId.tsx"),
  "utf8",
);

function block(source: string, start: string, end: string) {
  const startAt = source.indexOf(start);
  const endAt = source.indexOf(end, startAt + start.length);
  expect(startAt, `missing source marker: ${start}`).toBeGreaterThanOrEqual(0);
  expect(endAt, `missing source marker: ${end}`).toBeGreaterThan(startAt);
  return source.slice(startAt, endAt);
}

describe("exposure allocation command authority", () => {
  it("serializes on the project, exposure, allocation rows, and sibling set", () => {
    for (const command of [
      block(
        migration,
        "create or replace function public.create_exposure_allocation_atomic",
        "create or replace function public.update_exposure_allocation_atomic",
      ),
      block(
        migration,
        "create or replace function public.update_exposure_allocation_atomic",
        "create or replace function public.delete_exposure_allocation_atomic",
      ),
      block(
        migration,
        "create or replace function public.delete_exposure_allocation_atomic",
        "revoke all on function public.create_exposure_allocation_atomic",
      ),
    ]) {
      expect(command).toMatch(/from public\.projects project[\s\S]*for update/i);
      expect(command).toMatch(/from public\.exposures exposure[\s\S]*for update/i);
      expect(command).toMatch(
        /from public\.exposure_allocations allocation[\s\S]*order by allocation\.id[\s\S]*for update/i,
      );
    }
  });

  it("enforces same-project cost codes, safe cents, and the authoritative exposure cap", () => {
    expect(migration).toContain("assert_safe_accounting_cents");
    expect(migration).toContain("9007199254740991");
    expect(migration).toMatch(/v_bucket\.project_id <> p_project_id/i);
    expect(migration).toMatch(/v_bucket\.project_id <> v_project_id/i);
    expect(migration).toContain(
      "Total allocations cannot exceed the authoritative exposure value.",
    );
    expect(migration).toContain(
      "Exposure value cannot be lower than its current cost-code allocations.",
    );
  });

  it("requires optimistic versions and makes replay evidence immutable", () => {
    expect(migration).toMatch(/p_expected_version bigint/g);
    expect(migration).toMatch(/v_before\.version <> p_expected_version/g);
    expect(migration).toContain("exposure_allocation_operations_actor_key_unique");
    expect(migration).toContain("exposure_allocation_operations_immutable");
    expect(migration).toContain("reject_financial_journal_mutation");
    expect(migration).toMatch(/request_fingerprint <> v_fingerprint/g);
    expect(migration).toMatch(
      /return v_existing\.result \|\| jsonb_build_object\('deduplicated', true\)/g,
    );
  });

  it("revokes raw allocation DML from both application roles", () => {
    expect(migration).toMatch(
      /revoke insert, update, delete on table public\.exposure_allocations[\s\S]*from authenticated, service_role/i,
    );
    expect(migration).toMatch(
      /grant execute on function public\.create_exposure_allocation_atomic[\s\S]*to authenticated/i,
    );
    expect(migration).not.toMatch(
      /grant execute on function public\.create_exposure_allocation_atomic[\s\S]{0,300}to service_role/i,
    );
  });
});

describe("exposure allocation server and UI completion", () => {
  it("routes create, update, and delete only through the atomic RPCs", () => {
    for (const rpc of [
      "create_exposure_allocation_atomic",
      "update_exposure_allocation_atomic",
      "delete_exposure_allocation_atomic",
    ]) {
      expect(server).toContain(`"${rpc}"`);
    }
    expect(server).not.toMatch(
      /from\("exposure_allocations"\)[\s\S]{0,120}\.(insert|update|delete)\(/,
    );
    expect(server).toContain("p_expected_version: data.expectedVersion");
    expect(server).toContain("p_operation_key: data.operationKey");
  });

  it("awaits every UI command and clears drafts only inside success paths", () => {
    expect(component).toMatch(/await onAllocate\(/);
    expect(component).toMatch(/await onUpdateAllocation\(/);
    expect(component).toMatch(/await onRemoveAllocation\(/);
    expect(component).toContain('role="alert"');
    expect(component).toContain("operationKey");
    expect(component).toContain("expectedVersion: allocation.version");

    const create = block(component, "const submit = async", "const beginEdit");
    expect(create.indexOf("await onAllocate")).toBeLessThan(create.indexOf('setBucketId("")'));
    expect(create.indexOf("catch")).toBeGreaterThan(create.indexOf('setBucketId("")'));
    expect(create).not.toMatch(/catch[\s\S]{0,300}setOperationKey/);
  });

  it("uses mutateAsync at the route boundary so child awaits are real", () => {
    expect(route).toMatch(/onAllocate=[\s\S]{0,120}exposureAllocate\.mutateAsync/);
    expect(route).toMatch(/onUpdateAllocation=[\s\S]{0,160}exposureAllocationUpdate\.mutateAsync/);
    expect(route).toMatch(/onRemoveAllocation=[\s\S]{0,160}exposureAllocationRemove\.mutateAsync/);
  });
});
