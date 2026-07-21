import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

const ROOT = process.cwd();
const migration = fs.readFileSync(
  path.join(ROOT, "supabase/migrations/20260720174000_invoice_command_integrity.sql"),
  "utf8",
);
const server = fs.readFileSync(path.join(ROOT, "src/lib/projects.functions.ts"), "utf8");
const editor = fs.readFileSync(
  path.join(ROOT, "src/components/project/billing/BillingInvoiceRowEditor.tsx"),
  "utf8",
);
const workspace = fs.readFileSync(
  path.join(ROOT, "src/components/project/billing/BillingWorkspace.tsx"),
  "utf8",
);
const projectRoute = fs.readFileSync(
  path.join(ROOT, "src/routes/_authenticated/projects.$projectId.tsx"),
  "utf8",
);
const receivablesServer = fs.readFileSync(
  path.join(ROOT, "src/lib/receivables.functions.ts"),
  "utf8",
);
const receivablesUi = fs.readFileSync(
  path.join(ROOT, "src/components/billing/ReceivablesCockpit.tsx"),
  "utf8",
);

describe("invoice command integrity", () => {
  test("revokes authenticated invoice DML and exposes serialized commands", () => {
    expect(migration).toContain(
      "revoke insert, update, delete on public.billing_invoices from authenticated",
    );
    for (const command of [
      "create_billing_invoice_atomic",
      "update_billing_invoice_atomic",
      "transition_billing_invoice_atomic",
      "delete_billing_invoice_draft_atomic",
      "correct_billing_invoice_atomic",
    ]) {
      expect(migration).toContain(`function public.${command}`);
      expect(server).toContain(`"${command}"`);
    }
  });

  test("derives invoice totals, caps linked invoices, and rejects stale edits", () => {
    expect(migration).toContain("total_due = round(subtotal - retainage, 2)");
    expect(migration).toContain("v_total_due := round(v_subtotal - v_retainage, 2)");
    expect(migration).toContain("v_subtotal > v_application.amount_billed");
    expect(migration).toContain("v_invoice.updated_at is distinct from p_expected_updated_at");
    expect(migration).toContain("This invoice changed after you opened it");
    expect(projectRoute).toContain("const invoiceCommittedVersions = useRef");
    expect(projectRoute).toContain("invoiceCommittedVersions.current.set(id, updatedAt)");
  });

  test("uses one project-first lock order for invoice mutation commands", () => {
    const deleteCommand = migration.slice(
      migration.indexOf("create or replace function public.delete_billing_invoice_draft_atomic"),
      migration.indexOf("create or replace function public.correct_billing_invoice_atomic"),
    );
    expect(deleteCommand.indexOf("from public.projects project")).toBeGreaterThan(-1);
    expect(
      deleteCommand.indexOf(
        "from public.billing_invoices invoice\n  where invoice.id = p_billing_invoice_id\n    and invoice.project_id = v_project_id\n  for update",
      ),
    ).toBeGreaterThan(deleteCommand.indexOf("from public.projects project"));
  });

  test("keeps issued history immutable and limits deletion to pristine drafts", () => {
    expect(migration).toContain("Issued, paid, and void invoice financial history is immutable");
    expect(migration).toContain("Only an unsent, cash-free invoice draft");
    expect(migration).toContain("correction_of_invoice_id");
    expect(editor).toContain("const historyLocked =");
    expect(editor).toContain("canDeleteDraft ?");
    expect(editor).toContain("Void invoice");
  });

  test("saves send state before queueing email with a stable retry identity", () => {
    const transitionIndex = editor.indexOf("const transitioned = await onPatch");
    const queueIndex = editor.indexOf("const results = await Promise.allSettled");
    expect(transitionIndex).toBeGreaterThan(-1);
    expect(queueIndex).toBeGreaterThan(transitionIndex);
    expect(editor).toContain(
      'emailOperationKeyRef.current ?? newInvoiceOperationKey(invoice.id, "send")',
    );
    expect(editor).toContain("idempotencyKey: `${operationKey}:${recipientEmail.toLowerCase()}`");
    expect(editor).not.toContain("recipientEmail}:${Date.now()}");
    expect(workspace).toContain("onCreateInvoice(draft)");
    expect(workspace).not.toContain('status: "sent" as const');
  });

  test("preserves an omitted payment timestamp across retry", () => {
    expect(server).toContain(
      "const paidAt = data.paid_at ? new Date(data.paid_at).toISOString() : null",
    );
    expect(migration).toContain("v_effective_paid_at := coalesce(");
    expect(migration).toContain("v_existing_paid_at");
    expect(migration).toContain("clock_timestamp()");
  });

  test("blocks manual payment while Stripe checkout is pending", () => {
    expect(editor).toContain("pendingLock.locked ||");
    expect(editor).toContain("A Stripe checkout is pending");
  });

  test("keeps collections notes working after direct invoice DML is revoked", () => {
    expect(migration).toContain("function public.append_invoice_collections_note_atomic");
    expect(receivablesServer).toContain('rpc("append_invoice_collections_note_atomic"');
    expect(receivablesServer).not.toMatch(
      /from\("billing_invoices"\)[\s\S]{0,300}\.update\(\{ collections_log:/,
    );
    expect(receivablesUi).toContain("collectionsRetryKeys");
    expect(receivablesUi).toContain("if (saved) setNote");
  });
});
