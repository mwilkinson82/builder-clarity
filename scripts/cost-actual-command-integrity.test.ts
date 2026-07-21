import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260720172000_cost_actual_command_integrity.sql"),
  "utf8",
);
const source = readFileSync(join(process.cwd(), "src/lib/billing.functions.ts"), "utf8");

function sqlFunctionBlock(name: string) {
  const marker = new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\s*\\(`, "i");
  const match = marker.exec(migration);
  expect(match, `missing SQL function: ${name}`).not.toBeNull();
  const startAt = match!.index;
  const remainder = migration.slice(startAt + match![0].length);
  const next = /\ncreate\s+or\s+replace\s+function\s+public\./i.exec(remainder);
  return migration.slice(startAt, next ? startAt + match![0].length + next.index : undefined);
}

function sourceBlock(start: string, end: string) {
  const startAt = source.indexOf(start);
  const endAt = source.indexOf(end, startAt + start.length);
  expect(startAt, `missing source marker: ${start}`).toBeGreaterThanOrEqual(0);
  expect(endAt, `missing source marker: ${end}`).toBeGreaterThan(startAt);
  return source.slice(startAt, endAt);
}

function sqlArgumentNames(name: string) {
  const signature = new RegExp(
    `create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\s*\\(([\\s\\S]*?)\\)\\s*returns`,
    "i",
  ).exec(migration)?.[1];
  expect(signature, `missing SQL signature: ${name}`).toBeDefined();
  return [...signature!.matchAll(/^\s*(p_[a-z0-9_]+)\s+/gim)].map((match) => match[1]).sort();
}

function clientRpcArgumentNames(name: string, block: string) {
  const body = new RegExp(`\\.rpc\\("${name}"\\s*,\\s*\\{([\\s\\S]*?)\\n\\s*\\}\\);`, "i").exec(
    block,
  )?.[1];
  expect(body, `missing client RPC call: ${name}`).toBeDefined();
  return [...body!.matchAll(/^\s*(p_[a-z0-9_]+)\s*:/gim)].map((match) => match[1]).sort();
}

type CostState = "draft" | "committed" | "approved" | "paid" | "void";

type ModelCost = {
  id: string;
  projectId: string;
  bucketId: string;
  amountCents: number;
  status: CostState;
  creditAppliesToId?: string | null;
};

type CommandReceipt = {
  fingerprint: string;
  result: Record<string, unknown>;
};

/**
 * Executable specification for the SQL command boundary below. Static checks
 * tie these semantics to the real migration; this model makes the retry,
 * concurrency, and rollback failure stories deterministic in Vitest without
 * adding a database emulator dependency to the application.
 */
class CostCommandModel {
  readonly validBuckets = new Set(["bucket-1"]);
  readonly costs = new Map<string, ModelCost>();
  readonly payments: Array<{
    costId: string;
    amountCents: number;
    operationKey: string;
  }> = [];
  readonly batches: Array<{ id: string; operationKey: string }> = [];
  readonly receipts = new Map<string, CommandReceipt>();
  private readonly lockTails = new Map<string, Promise<void>>();

  seed(cost: ModelCost) {
    this.costs.set(cost.id, { ...cost });
  }

  private requireCents(value: number) {
    if (!Number.isSafeInteger(value)) throw new Error("amount must be integer cents");
  }

  private receipt(projectId: string, operationKey: string, fingerprint: string) {
    const existing = this.receipts.get(`${projectId}:${operationKey}`);
    if (!existing) return null;
    if (existing.fingerprint !== fingerprint) {
      throw new Error("operation key was already used for different details");
    }
    return existing.result;
  }

  private saveReceipt(
    projectId: string,
    operationKey: string,
    fingerprint: string,
    result: Record<string, unknown>,
  ) {
    this.receipts.set(`${projectId}:${operationKey}`, { fingerprint, result });
  }

  private async withCostLock<T>(costId: string, action: () => T | Promise<T>): Promise<T> {
    const previous = this.lockTails.get(costId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.lockTails.set(
      costId,
      previous.then(() => current),
    );
    await previous;
    try {
      // Yield while holding the lock so the test genuinely queues a competing
      // command instead of merely calling two synchronous methods in sequence.
      await Promise.resolve();
      return await action();
    } finally {
      release();
    }
  }

  private async withCostLocks<T>(costIds: string[], action: () => T | Promise<T>): Promise<T> {
    const orderedIds = [...new Set(costIds.filter(Boolean))].sort();
    const acquire = (index: number): Promise<T> => {
      if (index === orderedIds.length) return Promise.resolve(action());
      return this.withCostLock(orderedIds[index], () => acquire(index + 1));
    };
    return acquire(0);
  }

  private cashPaidCents(costId: string) {
    return this.payments
      .filter((payment) => payment.costId === costId)
      .reduce((total, payment) => total + payment.amountCents, 0);
  }

  private recognizedCreditCents(costId: string, excludingCreditId?: string) {
    return [...this.costs.values()]
      .filter(
        (cost) =>
          cost.id !== excludingCreditId &&
          cost.creditAppliesToId === costId &&
          cost.amountCents < 0 &&
          ["committed", "approved", "paid"].includes(cost.status),
      )
      .reduce((total, credit) => total + Math.abs(credit.amountCents), 0);
  }

  private hasUnresolvedLinkedCredit(costId: string) {
    return [...this.costs.values()].some(
      (credit) => credit.creditAppliesToId === costId && credit.status !== "void",
    );
  }

  private requireCreditCapacity(
    projectId: string,
    targetId: string,
    creditCents: number,
    excludingCreditId?: string,
  ) {
    this.requireCents(creditCents);
    const target = this.costs.get(targetId);
    if (
      !target ||
      target.projectId !== projectId ||
      target.amountCents <= 0 ||
      target.status === "paid" ||
      target.status === "void"
    ) {
      throw new Error("credit target is unavailable or terminal");
    }
    const settled =
      this.cashPaidCents(targetId) + this.recognizedCreditCents(targetId, excludingCreditId);
    if (settled + Math.abs(creditCents) > target.amountCents) {
      throw new Error("credit exceeds remaining balance");
    }
  }

  async recordPayment(input: {
    projectId: string;
    costId: string;
    amountCents: number;
    operationKey: string;
    loseResponseAfterCommit?: boolean;
  }) {
    this.requireCents(input.amountCents);
    const fingerprint = JSON.stringify({
      command: "payment",
      costId: input.costId,
      amountCents: input.amountCents,
    });
    const prior = this.receipt(input.projectId, input.operationKey, fingerprint);
    if (prior) return { ...prior, deduplicated: true };

    const result = await this.withCostLock(input.costId, () => {
      const retried = this.receipt(input.projectId, input.operationKey, fingerprint);
      if (retried) return { ...retried, deduplicated: true };
      const cost = this.costs.get(input.costId);
      if (!cost || cost.projectId !== input.projectId) throw new Error("cost not found");
      if (cost.status === "paid" || cost.status === "void") throw new Error("terminal cost");
      const paid = this.cashPaidCents(cost.id);
      const credited = this.recognizedCreditCents(cost.id);
      if (input.amountCents <= 0 || paid + credited + input.amountCents > cost.amountCents) {
        throw new Error("invalid payment amount");
      }
      this.payments.push({
        costId: cost.id,
        amountCents: input.amountCents,
        operationKey: input.operationKey,
      });
      if (paid + credited + input.amountCents === cost.amountCents) cost.status = "paid";
      const commandResult = {
        cost_id: cost.id,
        remaining_cents: cost.amountCents - paid - credited - input.amountCents,
      };
      this.saveReceipt(input.projectId, input.operationKey, fingerprint, commandResult);
      return commandResult;
    });

    if (input.loseResponseAfterCommit) throw new Error("response lost after commit");
    return result;
  }

  async createLinkedCredit(input: {
    projectId: string;
    creditId: string;
    targetId: string;
    amountCents: number;
  }) {
    if (input.amountCents >= 0) throw new Error("credit must be negative cents");
    return this.withCostLocks([input.creditId, input.targetId], () => {
      this.requireCreditCapacity(input.projectId, input.targetId, input.amountCents);
      if (this.costs.has(input.creditId)) throw new Error("credit already exists");
      this.costs.set(input.creditId, {
        id: input.creditId,
        projectId: input.projectId,
        bucketId: "bucket-1",
        amountCents: input.amountCents,
        status: "committed",
        creditAppliesToId: input.targetId,
      });
      return { credit_id: input.creditId };
    });
  }

  async updateLinkedCredit(input: { projectId: string; creditId: string; amountCents: number }) {
    const current = this.costs.get(input.creditId);
    if (!current?.creditAppliesToId) throw new Error("linked credit not found");
    const targetId = current.creditAppliesToId;
    return this.withCostLocks([input.creditId, targetId], () => {
      const credit = this.costs.get(input.creditId);
      if (!credit || credit.status === "paid" || credit.status === "void") {
        throw new Error("terminal credit");
      }
      this.requireCreditCapacity(input.projectId, targetId, input.amountCents, input.creditId);
      credit.amountCents = input.amountCents;
      return { credit_id: credit.id };
    });
  }

  async approveLinkedCredit(input: { projectId: string; creditId: string }) {
    const current = this.costs.get(input.creditId);
    if (!current?.creditAppliesToId) throw new Error("linked credit not found");
    const targetId = current.creditAppliesToId;
    return this.withCostLocks([input.creditId, targetId], () => {
      const credit = this.costs.get(input.creditId);
      if (!credit || credit.status !== "draft") throw new Error("credit is not a draft");
      this.requireCreditCapacity(input.projectId, targetId, credit.amountCents, input.creditId);
      credit.status = "approved";
      return { credit_id: credit.id, status: credit.status };
    });
  }

  async voidLinkedCredit(input: { projectId: string; creditId: string }) {
    const current = this.costs.get(input.creditId);
    if (!current?.creditAppliesToId) throw new Error("linked credit not found");
    const targetId = current.creditAppliesToId;
    return this.withCostLocks([input.creditId, targetId], () => {
      const credit = this.costs.get(input.creditId);
      const target = this.costs.get(targetId);
      if (!credit || !target || target.projectId !== input.projectId) {
        throw new Error("linked credit target not found");
      }
      if (credit.status === "paid" || credit.status === "void") throw new Error("terminal credit");
      const settledWithoutCredit =
        this.cashPaidCents(targetId) + this.recognizedCreditCents(targetId, credit.id);
      if (target.status === "paid" && settledWithoutCredit < target.amountCents) {
        throw new Error("void would under-settle a paid cost");
      }
      credit.status = "void";
      return { credit_id: credit.id, status: credit.status };
    });
  }

  async updateCostAmount(input: { projectId: string; costId: string; amountCents: number }) {
    this.requireCents(input.amountCents);
    return this.withCostLock(input.costId, () => {
      const cost = this.costs.get(input.costId);
      if (!cost || cost.projectId !== input.projectId) throw new Error("cost not found");
      if (cost.status === "paid" || cost.status === "void") throw new Error("terminal cost");
      if (this.hasUnresolvedLinkedCredit(cost.id)) throw new Error("linked credit is unresolved");
      cost.amountCents = input.amountCents;
      return { cost_id: cost.id, amount_cents: cost.amountCents };
    });
  }

  async voidCost(input: { projectId: string; costId: string; operationKey: string }) {
    const fingerprint = JSON.stringify({ command: "void", costId: input.costId });
    const prior = this.receipt(input.projectId, input.operationKey, fingerprint);
    if (prior) return { ...prior, deduplicated: true };
    return this.withCostLock(input.costId, () => {
      const retried = this.receipt(input.projectId, input.operationKey, fingerprint);
      if (retried) return { ...retried, deduplicated: true };
      const cost = this.costs.get(input.costId);
      if (!cost || cost.projectId !== input.projectId) throw new Error("cost not found");
      if (cost.status === "paid" || cost.status === "void") throw new Error("terminal cost");
      if (this.hasUnresolvedLinkedCredit(cost.id)) throw new Error("linked credit is unresolved");
      cost.status = "void";
      const result = { cost_id: cost.id, status: cost.status };
      this.saveReceipt(input.projectId, input.operationKey, fingerprint, result);
      return result;
    });
  }

  importCsv(input: {
    projectId: string;
    operationKey: string;
    rows: Array<{ id: string; bucketId: string; amountCents: number }>;
  }) {
    const fingerprint = JSON.stringify({ command: "import", rows: input.rows });
    const prior = this.receipt(input.projectId, input.operationKey, fingerprint);
    if (prior) return { ...prior, deduplicated: true };

    // Snapshot the transaction so a failure after the batch header or any row
    // insert restores every table, exactly as one PostgreSQL RPC transaction does.
    const batchSnapshot = this.batches.map((batch) => ({ ...batch }));
    const costSnapshot = new Map([...this.costs].map(([id, cost]) => [id, { ...cost }] as const));
    try {
      this.batches.push({
        id: `batch-${this.batches.length + 1}`,
        operationKey: input.operationKey,
      });
      for (const row of input.rows) {
        this.requireCents(row.amountCents);
        if (!this.validBuckets.has(row.bucketId)) throw new Error("unmatched cost bucket");
        if (this.costs.has(row.id)) throw new Error("duplicate source row");
        this.costs.set(row.id, {
          id: row.id,
          projectId: input.projectId,
          bucketId: row.bucketId,
          amountCents: row.amountCents,
          status: "committed",
        });
      }
      const result = { imported_count: input.rows.length };
      this.saveReceipt(input.projectId, input.operationKey, fingerprint, result);
      return result;
    } catch (error) {
      this.batches.splice(0, this.batches.length, ...batchSnapshot);
      this.costs.clear();
      for (const [id, cost] of costSnapshot) this.costs.set(id, cost);
      throw error;
    }
  }
}

describe("executable cost-command failure stories", () => {
  it("deduplicates a payment retry after the first response is lost", async () => {
    const model = new CostCommandModel();
    model.seed({
      id: "cost-1",
      projectId: "project-1",
      bucketId: "bucket-1",
      amountCents: 12_345,
      status: "approved",
    });
    const command = {
      projectId: "project-1",
      costId: "cost-1",
      amountCents: 12_345,
      operationKey: "payment-attempt-1",
    };

    await expect(
      model.recordPayment({ ...command, loseResponseAfterCommit: true }),
    ).rejects.toThrow("response lost after commit");
    await expect(model.recordPayment(command)).resolves.toMatchObject({
      remaining_cents: 0,
      deduplicated: true,
    });
    expect(model.payments).toHaveLength(1);
    expect(model.costs.get("cost-1")?.status).toBe("paid");
  });

  it("serializes a paid-versus-void race and cannot regress the winning terminal state", async () => {
    const model = new CostCommandModel();
    model.seed({
      id: "cost-1",
      projectId: "project-1",
      bucketId: "bucket-1",
      amountCents: 10_000,
      status: "approved",
    });

    const outcomes = await Promise.allSettled([
      model.recordPayment({
        projectId: "project-1",
        costId: "cost-1",
        amountCents: 10_000,
        operationKey: "pay-race",
      }),
      model.voidCost({
        projectId: "project-1",
        costId: "cost-1",
        operationKey: "void-race",
      }),
    ]);

    expect(outcomes.map((outcome) => outcome.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(model.costs.get("cost-1")?.status).toBe("paid");
    expect(model.payments).toHaveLength(1);
    await expect(
      model.voidCost({
        projectId: "project-1",
        costId: "cost-1",
        operationKey: "void-after-paid",
      }),
    ).rejects.toThrow("terminal cost");
  });

  it("serializes full payment against creation of a linked supplier credit", async () => {
    const model = new CostCommandModel();
    model.seed({
      id: "invoice-1",
      projectId: "project-1",
      bucketId: "bucket-1",
      amountCents: 10_000,
      status: "approved",
    });

    const outcomes = await Promise.allSettled([
      model.recordPayment({
        projectId: "project-1",
        costId: "invoice-1",
        amountCents: 10_000,
        operationKey: "cash-vs-credit-create",
      }),
      model.createLinkedCredit({
        projectId: "project-1",
        creditId: "credit-new",
        targetId: "invoice-1",
        amountCents: -4_000,
      }),
    ]);

    expect(outcomes.map((outcome) => outcome.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(model.costs.get("invoice-1")?.status).toBe("paid");
    expect(model.costs.has("credit-new")).toBe(false);
  });

  it("serializes payment against editing or approving a linked supplier credit", async () => {
    const editModel = new CostCommandModel();
    editModel.seed({
      id: "invoice-edit",
      projectId: "project-1",
      bucketId: "bucket-1",
      amountCents: 10_000,
      status: "approved",
    });
    editModel.seed({
      id: "credit-edit",
      projectId: "project-1",
      bucketId: "bucket-1",
      amountCents: -1_000,
      status: "committed",
      creditAppliesToId: "invoice-edit",
    });

    const editOutcomes = await Promise.allSettled([
      editModel.recordPayment({
        projectId: "project-1",
        costId: "invoice-edit",
        amountCents: 9_000,
        operationKey: "cash-vs-credit-edit",
      }),
      editModel.updateLinkedCredit({
        projectId: "project-1",
        creditId: "credit-edit",
        amountCents: -2_000,
      }),
    ]);
    expect(editOutcomes.map((outcome) => outcome.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(editModel.costs.get("invoice-edit")?.status).toBe("paid");
    expect(editModel.costs.get("credit-edit")?.amountCents).toBe(-1_000);

    const approveModel = new CostCommandModel();
    approveModel.seed({
      id: "invoice-approve",
      projectId: "project-1",
      bucketId: "bucket-1",
      amountCents: 10_000,
      status: "approved",
    });
    approveModel.seed({
      id: "credit-approve",
      projectId: "project-1",
      bucketId: "bucket-1",
      amountCents: -2_000,
      status: "draft",
      creditAppliesToId: "invoice-approve",
    });
    const approveOutcomes = await Promise.allSettled([
      approveModel.recordPayment({
        projectId: "project-1",
        costId: "invoice-approve",
        amountCents: 10_000,
        operationKey: "cash-vs-credit-approve",
      }),
      approveModel.approveLinkedCredit({
        projectId: "project-1",
        creditId: "credit-approve",
      }),
    ]);
    expect(approveOutcomes.map((outcome) => outcome.status).sort()).toEqual([
      "fulfilled",
      "rejected",
    ]);
    expect(approveModel.costs.get("invoice-approve")?.status).toBe("paid");
    expect(approveModel.costs.get("credit-approve")?.status).toBe("draft");
  });

  it("cannot void the credit that made a concurrently paid invoice whole", async () => {
    const model = new CostCommandModel();
    model.seed({
      id: "invoice-void-credit",
      projectId: "project-1",
      bucketId: "bucket-1",
      amountCents: 10_000,
      status: "approved",
    });
    model.seed({
      id: "credit-void",
      projectId: "project-1",
      bucketId: "bucket-1",
      amountCents: -4_000,
      status: "approved",
      creditAppliesToId: "invoice-void-credit",
    });

    const outcomes = await Promise.allSettled([
      model.recordPayment({
        projectId: "project-1",
        costId: "invoice-void-credit",
        amountCents: 6_000,
        operationKey: "cash-vs-credit-void",
      }),
      model.voidLinkedCredit({ projectId: "project-1", creditId: "credit-void" }),
    ]);

    expect(outcomes.map((outcome) => outcome.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(model.costs.get("invoice-void-credit")?.status).toBe("paid");
    expect(model.costs.get("credit-void")?.status).toBe("approved");
    expect(model.payments).toHaveLength(1);
  });

  it("keeps draft-credit cleanup reachable before changing its target", async () => {
    const model = new CostCommandModel();
    model.seed({
      id: "invoice-with-draft-credit",
      projectId: "project-1",
      bucketId: "bucket-1",
      amountCents: 10_000,
      status: "approved",
    });
    model.seed({
      id: "draft-credit",
      projectId: "project-1",
      bucketId: "bucket-1",
      amountCents: -1_000,
      status: "draft",
      creditAppliesToId: "invoice-with-draft-credit",
    });

    await expect(
      model.updateCostAmount({
        projectId: "project-1",
        costId: "invoice-with-draft-credit",
        amountCents: 9_000,
      }),
    ).rejects.toThrow("linked credit is unresolved");
    await expect(
      model.voidCost({
        projectId: "project-1",
        costId: "invoice-with-draft-credit",
        operationKey: "void-target-before-credit",
      }),
    ).rejects.toThrow("linked credit is unresolved");

    await expect(
      model.voidLinkedCredit({ projectId: "project-1", creditId: "draft-credit" }),
    ).resolves.toMatchObject({ status: "void" });
    await expect(
      model.updateCostAmount({
        projectId: "project-1",
        costId: "invoice-with-draft-credit",
        amountCents: 9_000,
      }),
    ).resolves.toMatchObject({ amount_cents: 9_000 });
    await expect(
      model.voidCost({
        projectId: "project-1",
        costId: "invoice-with-draft-credit",
        operationKey: "void-target-after-credit",
      }),
    ).resolves.toMatchObject({ status: "void" });
  });

  it("can void a linked draft after its target is paid or void, but not reverse recognized settlement", async () => {
    const paidModel = new CostCommandModel();
    paidModel.seed({
      id: "paid-target",
      projectId: "project-1",
      bucketId: "bucket-1",
      amountCents: 10_000,
      status: "approved",
    });
    paidModel.seed({
      id: "draft-after-payment",
      projectId: "project-1",
      bucketId: "bucket-1",
      amountCents: -1_000,
      status: "draft",
      creditAppliesToId: "paid-target",
    });
    await paidModel.recordPayment({
      projectId: "project-1",
      costId: "paid-target",
      amountCents: 10_000,
      operationKey: "pay-with-linked-draft",
    });
    await expect(
      paidModel.voidLinkedCredit({ projectId: "project-1", creditId: "draft-after-payment" }),
    ).resolves.toMatchObject({ status: "void" });

    const legacyVoidModel = new CostCommandModel();
    legacyVoidModel.seed({
      id: "void-target",
      projectId: "project-1",
      bucketId: "bucket-1",
      amountCents: 10_000,
      status: "void",
    });
    legacyVoidModel.seed({
      id: "draft-after-void",
      projectId: "project-1",
      bucketId: "bucket-1",
      amountCents: -1_000,
      status: "draft",
      creditAppliesToId: "void-target",
    });
    await expect(
      legacyVoidModel.voidLinkedCredit({
        projectId: "project-1",
        creditId: "draft-after-void",
      }),
    ).resolves.toMatchObject({ status: "void" });

    const recognizedModel = new CostCommandModel();
    recognizedModel.seed({
      id: "paid-by-cash-and-credit",
      projectId: "project-1",
      bucketId: "bucket-1",
      amountCents: 10_000,
      status: "paid",
    });
    recognizedModel.seed({
      id: "recognized-credit",
      projectId: "project-1",
      bucketId: "bucket-1",
      amountCents: -4_000,
      status: "approved",
      creditAppliesToId: "paid-by-cash-and-credit",
    });
    recognizedModel.payments.push({
      costId: "paid-by-cash-and-credit",
      amountCents: 6_000,
      operationKey: "legacy-paid-split",
    });
    await expect(
      recognizedModel.voidLinkedCredit({
        projectId: "project-1",
        creditId: "recognized-credit",
      }),
    ).rejects.toThrow("under-settle a paid cost");
  });

  it("rolls back the CSV batch header and all prior rows when one row is invalid", () => {
    const model = new CostCommandModel();

    expect(() =>
      model.importCsv({
        projectId: "project-1",
        operationKey: "import-attempt-1",
        rows: [
          { id: "valid-row", bucketId: "bucket-1", amountCents: 1_025 },
          { id: "invalid-row", bucketId: "missing-bucket", amountCents: 2_500 },
        ],
      }),
    ).toThrow("unmatched cost bucket");
    expect(model.batches).toHaveLength(0);
    expect(model.costs.size).toBe(0);
    expect(model.receipts.size).toBe(0);
  });

  it("rejects fractional cents and operation-key reuse for different payment facts", async () => {
    const model = new CostCommandModel();
    model.seed({
      id: "cost-1",
      projectId: "project-1",
      bucketId: "bucket-1",
      amountCents: 5_000,
      status: "approved",
    });
    await expect(
      model.recordPayment({
        projectId: "project-1",
        costId: "cost-1",
        amountCents: 10.5,
        operationKey: "fractional-cents",
      }),
    ).rejects.toThrow("integer cents");
    await model.recordPayment({
      projectId: "project-1",
      costId: "cost-1",
      amountCents: 1_000,
      operationKey: "stable-payment-key",
    });
    await expect(
      model.recordPayment({
        projectId: "project-1",
        costId: "cost-1",
        amountCents: 2_000,
        operationKey: "stable-payment-key",
      }),
    ).rejects.toThrow("different details");
    expect(model.payments).toHaveLength(1);
  });
});

describe("cost-actual exact-cent authority", () => {
  it("fails closed on malformed payment cents instead of rounding ledger facts", () => {
    const normalizePayment = sourceBlock(
      "const normalizeCostActualPayment",
      "const normalizeCostBudgetItem",
    );
    expect(normalizePayment).toMatch(/Number\.isSafeInteger\(amountCents\)/);
    expect(normalizePayment).toMatch(/amountCents\s*<=\s*0/);
    expect(normalizePayment).toMatch(/throw\s+new\s+Error/);
    expect(normalizePayment).toMatch(/amount_cents:\s*amountCents/);
    expect(normalizePayment).not.toMatch(/Math\.round|toFixed/);
  });

  it("persists one canonical integer-cent amount and rejects fractional-cent writes", () => {
    expect(migration).toMatch(
      /alter\s+table\s+public\.cost_actuals[\s\S]*add\s+column\s+if\s+not\s+exists\s+amount_cents\s+bigint/i,
    );
    expect(migration).toMatch(
      /update\s+public\.cost_actuals[\s\S]*amount_cents\s*=\s*round\([^)]*amount\s*\*\s*100/i,
    );
    expect(migration).toMatch(
      /cost_actuals[^\n]*(?:exact|cent)[\s\S]*amount\s*=\s*amount_cents::numeric\s*\/\s*100(?:\.0)?/i,
    );
    expect(migration).toMatch(
      /actual\.amount\s*\*\s*100\s*<>\s*trunc\(actual\.amount\s*\*\s*100\)/i,
    );
  });

  it("accepts cents, never floating-dollar amounts, at every money command boundary", () => {
    for (const name of ["create_cost_actual_atomic", "update_cost_actual_atomic"]) {
      const fn = sqlFunctionBlock(name);
      expect(fn).toMatch(/p_payload\s+jsonb/i);
      expect(fn).toMatch(/p_payload\s*->>\s*'amount_cents'/i);
      expect(fn).toMatch(/amount_cents[\s\S]{0,120}(?:::bigint|cast\([^)]*as\s+bigint)/i);
      expect(fn).not.toMatch(/p_amount\s+numeric/i);
      expect(fn).not.toMatch(/p_payload\s*->>\s*'amount'/i);
    }

    const paymentFn = sqlFunctionBlock("record_cost_actual_payment_atomic");
    expect(paymentFn).toMatch(/p_amount_cents\s+bigint/i);
    expect(paymentFn).not.toMatch(/p_amount\s+numeric/i);

    const importFn = sqlFunctionBlock("import_cost_actuals_atomic");
    expect(importFn).toMatch(/amount_cents/i);
    expect(importFn).not.toMatch(/->>\s*'amount'\s*\)::numeric/i);
  });

  it("converts validated UI dollars to safe integer cents before every RPC", () => {
    expect(source).toMatch(
      /(?:exact|safe)[A-Za-z]*(?:Cent|Money)[A-Za-z]*[\s\S]{0,800}Number\.isSafeInteger/i,
    );
    expect(source).toMatch(/const\s+scaled\s*=\s*value\s*\*\s*100/i);
    expect(source).toMatch(/Number\.isSafeInteger\(cents\)/i);
    expect(source).toMatch(/Math\.abs\(scaled\s*-\s*cents\)\s*>/i);

    for (const [start, end] of [
      ["export const recordCostActualPayment", "const saveCostBudgetItemInput"],
      ["export const createCostActual", "const updateCostActualInput"],
      ["export const updateCostActual", "const setCostActualStatusInput"],
      ["export const importCostActuals", "const voidCostActualInput"],
    ] as const) {
      const block = sourceBlock(start, end);
      expect(block).toContain("amount_cents");
    }
  });
});

describe("cost command idempotency and attribution", () => {
  it("keeps each command definition free of duplicated SQL clauses", () => {
    const commands = [
      "create_cost_actual_atomic",
      "update_cost_actual_atomic",
      "transition_cost_actual_atomic",
      "void_cost_actual_atomic",
      "import_cost_actuals_atomic",
      "record_cost_actual_payment_atomic",
    ] as const;

    for (const name of commands) {
      const block = sqlFunctionBlock(name);
      expect(block, `${name} has a duplicated FROM clause`).not.toMatch(
        /from\s+private\.cost_actual_command_operations\s+operation\s+from\s+private\.cost_actual_command_operations\s+operation/i,
      );
    }
  });

  it("journals project-scoped operation keys and rejects cross-payload reuse", () => {
    expect(migration).toMatch(
      /create\s+table(?:\s+if\s+not\s+exists)?\s+private\.cost_actual_command_operations/i,
    );
    expect(migration).toMatch(
      /(?:primary\s+key|unique)\s*\(\s*project_id\s*,\s*(?:operation|idempotency)_key\s*\)/i,
    );
    expect(migration).toMatch(/(?:payload|idempotency)_fingerprint/i);
    expect(migration).toMatch(
      /fingerprint\s*(?:<>|is\s+distinct\s+from)\s*v_fingerprint|v_fingerprint\s*(?:<>|is\s+distinct\s+from)\s*[^\n]*fingerprint/i,
    );
    expect(migration).toMatch(
      /already\s+used[\s\S]{0,160}(?:different|other)[\s\S]{0,80}(?:detail|payload)/i,
    );
    expect(migration).toMatch(
      /create\s+trigger\s+cost_actual_command_operations_immutable[\s\S]{0,180}before\s+update\s+or\s+delete\s+on\s+private\.cost_actual_command_operations/i,
    );
    expect(migration).toMatch(
      /revoke\s+all\s+on\s+table\s+private\.cost_actual_command_operations[\s\S]{0,120}authenticated[\s\S]{0,80}service_role/i,
    );
  });

  it("exposes only the audited command boundary to application roles", () => {
    for (const name of [
      "create_cost_actual_atomic",
      "update_cost_actual_atomic",
      "transition_cost_actual_atomic",
      "void_cost_actual_atomic",
      "import_cost_actuals_atomic",
      "record_cost_actual_payment_atomic",
    ]) {
      expect(migration).toMatch(
        new RegExp(`revoke\\s+all\\s+on\\s+function\\s+public\\.${name}\\s*\\(`, "i"),
      );
      expect(migration).toMatch(
        new RegExp(
          `grant\\s+execute\\s+on\\s+function\\s+public\\.${name}\\s*\\([\\s\\S]{0,180}?to\\s+authenticated\\s*,\\s*service_role`,
          "i",
        ),
      );
    }
    expect(migration).toMatch(
      /revoke\s+all\s+on\s+function\s+public\.record_cost_actual_payment\s*\(/i,
    );
    for (const table of ["cost_actuals", "cost_actual_payments", "cost_actual_import_batches"]) {
      expect(migration).toMatch(
        new RegExp(
          `revoke\\s+insert\\s*,\\s*update\\s*,\\s*delete\\s+on\\s+public\\.${table}[\\s\\S]{0,100}authenticated[\\s\\S]{0,60}service_role`,
          "i",
        ),
      );
    }
  });

  it("requires a caller-stable operation key on all six write commands", () => {
    const commands = [
      [
        "record_cost_actual_payment_atomic",
        "export const recordCostActualPayment",
        "const saveCostBudgetItemInput",
      ],
      ["create_cost_actual_atomic", "export const createCostActual", "const updateCostActualInput"],
      [
        "update_cost_actual_atomic",
        "export const updateCostActual",
        "const setCostActualStatusInput",
      ],
      [
        "transition_cost_actual_atomic",
        "export const setCostActualStatus",
        "const importCostActualsInput",
      ],
      ["import_cost_actuals_atomic", "export const importCostActuals", "const voidCostActualInput"],
      [
        "void_cost_actual_atomic",
        "export const voidCostActual",
        "export const listPortfolioBilling",
      ],
    ] as const;

    for (const [name, sourceStart, sourceEnd] of commands) {
      const fn = sqlFunctionBlock(name);
      const clientBlock = sourceBlock(sourceStart, sourceEnd);
      expect(fn).toMatch(/p_(?:operation|idempotency)_key\s+text/i);
      expect(fn).toMatch(/cost_actual_command_operations/i);
      expect(fn).toMatch(/(?:payload|idempotency)_fingerprint/i);
      expect(fn).toMatch(/security\s+definer/i);
      expect(fn).toMatch(/set\s+search_path\s*=\s*''/i);

      // PostgREST RPC arguments are name-bound. The migration and TypeScript
      // can both compile while every live request fails on one renamed field.
      expect(
        clientRpcArgumentNames(name, clientBlock),
        `${name} client arguments must exactly match its SQL named arguments`,
      ).toEqual(sqlArgumentNames(name));

      const sqlKey = /\b(p_(?:operation|idempotency)_key)\s+text/i.exec(fn)?.[1];
      const clientKey = /\b(p_(?:operation|idempotency)_key)\s*:\s*data\.operation_key/i.exec(
        clientBlock,
      )?.[1];
      expect(clientKey, `${name} client key must match its SQL named argument`).toBe(sqlKey);
    }
  });

  it("fails closed when a cost code, bucket, or linked attribution is not in the project", () => {
    const create = sqlFunctionBlock("create_cost_actual_atomic");
    const update = sqlFunctionBlock("update_cost_actual_atomic");
    const importFn = sqlFunctionBlock("import_cost_actuals_atomic");

    for (const fn of [create, update, importFn]) {
      expect(fn).toMatch(/public\.cost_buckets/i);
      expect(fn).toMatch(/project_id/i);
      expect(fn).toMatch(/raise\s+exception/i);
    }
    expect(create).toMatch(/(?:exposure|subcontract_change_order|subcontract_payment)_id/i);
    expect(create).toMatch(
      /(?:does not belong|belongs? to another project|must belong|same project|attribution)/i,
    );
    expect(source).not.toMatch(
      /still save during that window|retry without it so the edit still lands/i,
    );
  });
});

describe("cost payment retry and lifecycle concurrency", () => {
  it("keeps linked-credit cleanup reachable before target edit or void", () => {
    const update = sqlFunctionBlock("update_cost_actual_atomic");
    const voidFn = sqlFunctionBlock("void_cost_actual_atomic");

    expect(update).toMatch(
      /credit\.credit_applies_to_id\s*=\s*p_cost_actual_id[\s\S]{0,180}credit\.status\s*<>\s*'void'/i,
    );
    expect(voidFn).toMatch(
      /credit\.credit_applies_to_id\s*=\s*v_actual\.id[\s\S]{0,180}credit\.status\s*<>\s*'void'/i,
    );
    expect(voidFn).toMatch(
      /if\s+v_actual\.status\s*=\s*'draft'\s+then[\s\S]{0,500}from\s+public\.cost_actuals\s+target[\s\S]{0,240}for\s+update[\s\S]{0,120}else[\s\S]{0,500}target\.status\s+not\s+in\s*\(\s*'draft'\s*,\s*'paid'\s*,\s*'void'\s*\)/i,
    );

    // The legacy credit-link trigger also runs on status updates. It must let
    // an unrecognized draft become void even after its target became terminal.
    const validator = sqlFunctionBlock("validate_cost_actual_credit_link");
    expect(validator).toMatch(/new\.status\s*=\s*'void'[\s\S]{0,180}return\s+new/i);
  });

  it("uses the positive-cost target as the shared lock for every linked-credit mutation", () => {
    const paths = [
      ["create_cost_actual_atomic", /insert\s+into\s+public\.cost_actuals/i],
      ["update_cost_actual_atomic", /update\s+public\.cost_actuals\s+actual\s+set/i],
      ["transition_cost_actual_atomic", /update\s+public\.cost_actuals\s+actual\s+set/i],
      ["void_cost_actual_atomic", /update\s+public\.cost_actuals\s+actual\s+set/i],
    ] as const;

    for (const [name, writePattern] of paths) {
      const fn = sqlFunctionBlock(name);
      const targetLockAt = fn.search(
        /from\s+public\.cost_actuals\s+target[\s\S]{0,260}target\.id\s*=\s*(?:v_credit_id|v_actual\.credit_applies_to_id)[\s\S]{0,260}for\s+update/i,
      );
      const writeAt = fn.search(writePattern);
      expect(
        targetLockAt,
        `${name} must lock the linked positive-cost target`,
      ).toBeGreaterThanOrEqual(0);
      expect(writeAt, `${name} must acquire the target lock before its cost write`).toBeGreaterThan(
        targetLockAt,
      );
    }
  });

  it("turns a lost-response payment retry into one settlement row", () => {
    const payment = sqlFunctionBlock("record_cost_actual_payment_atomic");
    const dedupeAt = payment.search(/from\s+private\.cost_actual_command_operations/i);
    const paymentInsertAt = payment.search(/insert\s+into\s+public\.cost_actual_payments/i);
    const receiptInsertAt = payment.search(
      /insert\s+into\s+private\.cost_actual_command_operations/i,
    );

    expect(dedupeAt).toBeGreaterThanOrEqual(0);
    expect(paymentInsertAt).toBeGreaterThan(dedupeAt);
    expect(receiptInsertAt).toBeGreaterThan(paymentInsertAt);
    expect(payment).toMatch(/from\s+public\.cost_actuals[\s\S]*for\s+update/i);
    expect(migration).toMatch(
      /private\.cost_actual_command_operations[\s\S]{0,500}primary\s+key\s*\(\s*project_id\s*,\s*operation_key\s*\)/i,
    );
  });

  it("serializes lifecycle decisions and makes paid and void terminal", () => {
    const transition = sqlFunctionBlock("transition_cost_actual_atomic");
    const voidFn = sqlFunctionBlock("void_cost_actual_atomic");

    for (const fn of [transition, voidFn]) {
      const lockAt = fn.search(/from\s+public\.cost_actuals[\s\S]{0,400}for\s+update/i);
      const writeAt = fn.search(/update\s+public\.cost_actuals/i);
      expect(lockAt).toBeGreaterThanOrEqual(0);
      expect(writeAt).toBeGreaterThan(lockAt);
    }
    expect(transition).toMatch(
      /status\s+in\s*\(\s*'paid'\s*,\s*'void'\s*\)|status\s*=\s*'paid'[\s\S]*status\s*=\s*'void'/i,
    );
    expect(transition).toMatch(/(?:terminal|cannot|can't|not allowed)/i);
    expect(voidFn).toMatch(
      /status\s+in\s*\(\s*'paid'\s*,\s*'void'\s*\)[\s\S]{0,300}(?:cannot|can't|not allowed|terminal)/i,
    );

    // Direct table updates are guarded too; an older client cannot bypass the RPC.
    expect(migration).toMatch(/old\.status\s+in\s*\(\s*'paid'\s*,\s*'void'\s*\)/i);
    expect(migration).toMatch(/old\.status\s+is\s+not\s+distinct\s+from\s+new\.status/i);
    expect(migration).toMatch(
      /create\s+trigger[\s\S]{0,180}before\s+update(?:\s+of\s+[^\n;]*\bstatus\b)?\s+on\s+public\.cost_actuals/i,
    );
  });
});

describe("atomic cost CSV import", () => {
  it("validates the complete payload and writes batch plus rows in one RPC transaction", () => {
    const importFn = sqlFunctionBlock("import_cost_actuals_atomic");
    expect(importFn).toMatch(/jsonb_array_elements/i);
    expect(importFn).toMatch(/amount_cents/i);
    expect(importFn).toMatch(/public\.cost_buckets/i);
    expect(importFn).toMatch(/raise\s+exception/i);
    expect(importFn).toMatch(/insert\s+into\s+public\.cost_actual_import_batches/i);
    expect(importFn).toMatch(/insert\s+into\s+public\.cost_actuals/i);
    const catchBlocks = [...importFn.matchAll(/exception\s+when\s+others\s+then([\s\S]*?)end;/gi)];
    for (const [, body] of catchBlocks) {
      expect(
        body,
        "import exception handlers must rethrow instead of returning partial success",
      ).toMatch(/raise\s+exception/i);
    }
  });

  it("has no split browser-side batch/row write that could leave a partial import", () => {
    const importSource = sourceBlock("export const importCostActuals", "const voidCostActualInput");
    expect(importSource).toContain('"import_cost_actuals_atomic"');
    expect(importSource).not.toMatch(/cost_actual_import_batches[\s\S]*\.insert/);
    expect(importSource).not.toMatch(/cost_actuals[\s\S]*\.insert/);
  });
});
