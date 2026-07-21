// Receivables cockpit server functions (GETTINGPAID1 Task 0/2).
//
// The biller's working view: every open invoice with its status chain
// (sent -> viewed -> paid), aging, collections cues, the payment activity
// feed, and approved change orders carried with their own billed percent.
// Reads are RLS-scoped — the cockpit shows exactly the projects the caller
// can read. All money sums run in integer cents.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { centsToDollars, dollarsToCents } from "@/lib/payments-domain";
import { DEFAULT_COLLECTIONS_OVERDUE_DAYS, invoiceOpenBalanceCents } from "@/lib/receivables";

type DynamicSupabaseError = { code?: string; message: string };
type DynamicSupabaseResult<T = unknown> = { data: T | null; error: DynamicSupabaseError | null };
type DynamicSupabaseQuery = PromiseLike<DynamicSupabaseResult> & {
  select(columns?: string): DynamicSupabaseQuery;
  update(values: unknown): DynamicSupabaseQuery;
  eq(column: string, value: unknown): DynamicSupabaseQuery;
  is(column: string, value: unknown): DynamicSupabaseQuery;
  in(column: string, values: readonly string[]): DynamicSupabaseQuery;
  gt(column: string, value: unknown): DynamicSupabaseQuery;
  order(column: string, options?: { ascending?: boolean }): DynamicSupabaseQuery;
  limit(count: number): DynamicSupabaseQuery;
  single(): Promise<DynamicSupabaseResult>;
  maybeSingle(): Promise<DynamicSupabaseResult>;
};
type ServerContext = {
  supabase: {
    from(relation: string): DynamicSupabaseQuery;
    rpc(fn: string, args?: Record<string, unknown>): Promise<DynamicSupabaseResult>;
  };
  userId: string;
};

const table = (context: ServerContext, relation: string) => context.supabase.from(relation);
const num = (value: unknown) => (typeof value === "number" ? value : Number(value ?? 0));
const str = (value: unknown, fallback = "") => (typeof value === "string" ? value : fallback);

function isMissingSchema(error: DynamicSupabaseError | null) {
  const message = (error?.message ?? "").toLowerCase();
  return (
    error?.code === "42P01" ||
    error?.code === "PGRST205" ||
    error?.code === "PGRST204" ||
    error?.code === "42703" ||
    message.includes("does not exist") ||
    message.includes("could not find") ||
    message.includes("schema cache")
  );
}

export interface ReceivableInvoiceRow {
  id: string;
  project_id: string;
  project_name: string;
  // Owning company — lets the portfolio receivables list tell apart invoices
  // that share a project name/number across companies (null at company level
  // when the org can't be resolved).
  company_name: string | null;
  invoice_number: string;
  title: string;
  status: string;
  client_recipients: string[];
  total_due: number;
  paid_amount: number;
  open_balance: number;
  issue_date: string | null;
  due_date: string | null;
  sent_at: string | null;
  sent_recipients: string[];
  first_viewed_at: string | null;
  last_viewed_at: string | null;
  view_count: number;
  paid_at: string | null;
  collections_log: string;
  last_payment: {
    amount: number;
    method: string;
    processor: string;
    reference: string;
    paid_at: string;
  } | null;
}

export interface PaymentFeedEntry {
  id: string;
  invoice_id: string;
  invoice_label: string;
  project_name: string;
  amount: number;
  method: string;
  processor: string;
  reference: string;
  status: string;
  paid_at: string;
}

export interface CockpitChangeOrder {
  id: string;
  project_id: string;
  project_name: string;
  number: string;
  description: string;
  value: number;
  allocated: number;
  billed: number;
  remaining: number;
  unallocated: boolean;
}

export interface ReceivablesCockpitData {
  invoices: ReceivableInvoiceRow[];
  feed: PaymentFeedEntry[];
  changeOrders: CockpitChangeOrder[];
  collectionsOverdueDays: number;
  trackingReady: boolean;
}

const cockpitInput = z.object({ projectId: z.string().uuid().optional() });

export const getReceivablesCockpit = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof cockpitInput> | undefined) =>
    cockpitInput.parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as ServerContext;

    let projectQuery = table(ctx, "projects")
      .select("id,name,organization_id")
      .is("archived_at", null);
    if (data.projectId) projectQuery = projectQuery.eq("id", data.projectId);
    const projectRes = await projectQuery;
    if (projectRes.error) throw new Error(projectRes.error.message);
    const projects = ((projectRes.data ?? []) as Record<string, unknown>[]).map((row) => ({
      id: String(row.id),
      name: str(row.name),
      organization_id: (row.organization_id as string | null) ?? null,
    }));
    if (projects.length === 0) {
      return {
        invoices: [],
        feed: [],
        changeOrders: [],
        collectionsOverdueDays: DEFAULT_COLLECTIONS_OVERDUE_DAYS,
        trackingReady: true,
      } satisfies ReceivablesCockpitData;
    }
    const projectIds = projects.map((project) => project.id);
    const projectNames = new Map(projects.map((project) => [project.id, project.name]));

    // Resolve each project's owning company so the portfolio receivables list
    // can label rows that share a name/number across companies (e.g. a demo
    // seeded into several orgs). Degrades to no label if orgs aren't readable
    // — which, post-Phase 3, includes callers without the settings/billing/
    // team capabilities (label-only, deliberate).
    const orgIds = [
      ...new Set(
        projects
          .map((project) => project.organization_id)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const companyByOrg = new Map<string, string>();
    if (orgIds.length > 0) {
      const orgRes = await table(ctx, "organizations").select("id,name").in("id", orgIds);
      if (!orgRes.error) {
        for (const row of (orgRes.data ?? []) as Record<string, unknown>[]) {
          const name = str(row.name);
          if (name) companyByOrg.set(String(row.id), name);
        }
      }
    }
    const projectCompanyNames = new Map(
      projects.map((project) => [
        project.id,
        project.organization_id ? (companyByOrg.get(project.organization_id) ?? null) : null,
      ]),
    );

    const [invoiceRes, paymentRes, accessRes, coRes, allocationRes, lineRes, appRes] =
      await Promise.all([
        table(ctx, "billing_invoices").select("*").in("project_id", projectIds),
        table(ctx, "payment_ledger")
          .select(
            "id,invoice_id,project_id,amount,amount_cents,payment_method,processor,reference,processor_payment_id,status,paid_at",
          )
          .in("project_id", projectIds)
          .order("paid_at", { ascending: false })
          .limit(100),
        table(ctx, "project_client_access")
          .select("project_id,email,status,can_view_billing")
          .in("project_id", projectIds),
        table(ctx, "change_orders").select("*").in("project_id", projectIds),
        table(ctx, "change_order_allocations").select("*").in("project_id", projectIds),
        table(ctx, "billing_line_items").select("*").in("project_id", projectIds),
        table(ctx, "billing_applications")
          .select("id,project_id,sort_order")
          .in("project_id", projectIds),
      ]);
    if (invoiceRes.error) throw new Error(`Invoices did not load: ${invoiceRes.error.message}`);
    if (paymentRes.error) {
      throw new Error(`Payment activity did not load: ${paymentRes.error.message}`);
    }
    if (accessRes.error) {
      throw new Error(`Billing recipients did not load: ${accessRes.error.message}`);
    }
    if (coRes.error) throw new Error(`Change orders did not load: ${coRes.error.message}`);
    if (allocationRes.error) {
      throw new Error(`Change-order allocations did not load: ${allocationRes.error.message}`);
    }
    if (lineRes.error) {
      throw new Error(`Billing line detail did not load: ${lineRes.error.message}`);
    }
    if (appRes.error) {
      throw new Error(`Billing applications did not load: ${appRes.error.message}`);
    }

    const invoiceRows = (invoiceRes.data ?? []) as Record<string, unknown>[];
    const paymentRows = (paymentRes.data ?? []) as Record<string, unknown>[];
    const accessRows = (accessRes.data ?? []) as Record<string, unknown>[];
    const coRows = (coRes.data ?? []) as Record<string, unknown>[];
    const allocationRows = (allocationRes.data ?? []) as Record<string, unknown>[];
    const lineRows = (lineRes.data ?? []) as Record<string, unknown>[];
    const appRows = (appRes.data ?? []) as Record<string, unknown>[];

    // Send/view tracking columns arrive with the GETTINGPAID1 migration; the
    // cockpit stays functional (chain shows sent/paid only) until then.
    const trackingReady = invoiceRows.length === 0 || "sent_recipients" in (invoiceRows[0] ?? {});

    const billingRecipientsByProject = new Map<string, string[]>();
    for (const row of accessRows) {
      if (str(row.status) === "revoked" || !row.can_view_billing) continue;
      const email = str(row.email).trim();
      if (!email) continue;
      const projectId = String(row.project_id);
      const list = billingRecipientsByProject.get(projectId) ?? [];
      if (!list.includes(email)) list.push(email);
      billingRecipientsByProject.set(projectId, list);
    }

    const paymentCents = (row: Record<string, unknown>) =>
      num(row.amount_cents) > 0
        ? Math.round(num(row.amount_cents))
        : dollarsToCents(num(row.amount));
    const lastSucceededByInvoice = new Map<string, Record<string, unknown>>();
    for (const row of paymentRows) {
      if (str(row.status, "succeeded") !== "succeeded") continue;
      const invoiceId = String(row.invoice_id);
      const existing = lastSucceededByInvoice.get(invoiceId);
      if (!existing || str(row.paid_at) > str(existing.paid_at)) {
        lastSucceededByInvoice.set(invoiceId, row);
      }
    }

    const invoices: ReceivableInvoiceRow[] = invoiceRows
      .filter((row) => str(row.status) !== "void")
      .map((row) => {
        const projectId = String(row.project_id);
        const totalDue = num(row.total_due);
        const paidAmount = num(row.paid_amount);
        const lastPayment = lastSucceededByInvoice.get(String(row.id)) ?? null;
        return {
          id: String(row.id),
          project_id: projectId,
          project_name: projectNames.get(projectId) ?? "Project",
          company_name: projectCompanyNames.get(projectId) ?? null,
          invoice_number: str(row.invoice_number),
          title: str(row.title),
          status: str(row.status, "draft"),
          client_recipients: billingRecipientsByProject.get(projectId) ?? [],
          total_due: totalDue,
          paid_amount: paidAmount,
          open_balance: centsToDollars(
            invoiceOpenBalanceCents({ total_due: totalDue, paid_amount: paidAmount }),
          ),
          issue_date: (row.issue_date as string | null) ?? null,
          due_date: (row.due_date as string | null) ?? null,
          sent_at: (row.sent_at as string | null) ?? null,
          sent_recipients: Array.isArray(row.sent_recipients)
            ? (row.sent_recipients as unknown[]).map((entry) => str(entry)).filter(Boolean)
            : [],
          first_viewed_at: (row.first_viewed_at as string | null) ?? null,
          last_viewed_at: (row.last_viewed_at as string | null) ?? null,
          view_count: num(row.view_count),
          paid_at: (row.paid_at as string | null) ?? null,
          collections_log: str(row.collections_log),
          last_payment: lastPayment
            ? {
                amount: centsToDollars(paymentCents(lastPayment)),
                method: str(lastPayment.payment_method, "manual"),
                processor: str(lastPayment.processor, "manual"),
                reference: str(lastPayment.reference) || str(lastPayment.processor_payment_id),
                paid_at: str(lastPayment.paid_at),
              }
            : null,
        };
      });

    const invoiceLabelById = new Map(
      invoiceRows.map((row) => [
        String(row.id),
        str(row.invoice_number) || str(row.title) || "Invoice",
      ]),
    );
    const invoiceProjectById = new Map(
      invoiceRows.map((row) => [String(row.id), String(row.project_id)]),
    );
    const feed: PaymentFeedEntry[] = paymentRows
      .filter((row) => ["succeeded", "refunded"].includes(str(row.status, "succeeded")))
      .map((row) => ({
        id: String(row.id),
        invoice_id: String(row.invoice_id),
        invoice_label: invoiceLabelById.get(String(row.invoice_id)) ?? "Invoice",
        project_name:
          projectNames.get(
            invoiceProjectById.get(String(row.invoice_id)) ?? String(row.project_id),
          ) ?? "Project",
        amount: centsToDollars(paymentCents(row)),
        method: str(row.payment_method, "manual"),
        processor: str(row.processor, "manual"),
        reference: str(row.reference) || str(row.processor_payment_id),
        status: str(row.status, "succeeded"),
        paid_at: str(row.paid_at),
      }));

    // Approved change orders carry their own billed percent: each allocated
    // slice bills at its SOV line's completed percent (the existing
    // allocation model), rounded at the line in cents.
    const appRankById = new Map(appRows.map((row) => [String(row.id), num(row.sort_order)]));
    const latestLineByBucket = new Map<string, Record<string, unknown>>();
    for (const line of lineRows) {
      const bucketId = (line.cost_bucket_id as string | null) ?? null;
      if (!bucketId) continue;
      const existing = latestLineByBucket.get(bucketId);
      if (
        !existing ||
        (appRankById.get(String(line.billing_application_id)) ?? 0) >=
          (appRankById.get(String(existing.billing_application_id)) ?? 0)
      ) {
        latestLineByBucket.set(bucketId, line);
      }
    }
    const changeOrders: CockpitChangeOrder[] = coRows
      .filter((row) => str(row.status) === "Approved")
      .map((row) => {
        const coId = String(row.id);
        const valueCents = dollarsToCents(num(row.contract_amount));
        const allocations = allocationRows.filter(
          (allocation) => String(allocation.change_order_id) === coId,
        );
        let allocatedCents = 0;
        let billedCents = 0;
        for (const allocation of allocations) {
          const allocationCents = dollarsToCents(num(allocation.contract_amount));
          allocatedCents += allocationCents;
          const bucketId = (allocation.cost_bucket_id as string | null) ?? null;
          const line = bucketId ? latestLineByBucket.get(bucketId) : null;
          if (!line) continue;
          const lineContractCents =
            Math.round(num(line.scheduled_value_cents)) +
            Math.round(num(line.change_order_value_cents));
          if (lineContractCents <= 0) continue;
          const completedCents = Math.round(num(line.total_completed_and_stored_cents));
          billedCents += Math.round((allocationCents * completedCents) / lineContractCents);
        }
        return {
          id: coId,
          project_id: String(row.project_id),
          project_name: projectNames.get(String(row.project_id)) ?? "Project",
          number: str(row.number, "CO"),
          description: str(row.description),
          value: centsToDollars(valueCents),
          allocated: centsToDollars(allocatedCents),
          billed: centsToDollars(billedCents),
          remaining: centsToDollars(Math.max(0, valueCents - billedCents)),
          unallocated: allocatedCents < valueCents,
        };
      });

    // Collections threshold from the company payment profile (default 15).
    let collectionsOverdueDays = DEFAULT_COLLECTIONS_OVERDUE_DAYS;
    const organizationId = projects.find((project) => project.organization_id)?.organization_id;
    if (organizationId) {
      const profileRes = await table(ctx, "organization_payment_profiles")
        .select("collections_overdue_days")
        .eq("organization_id", organizationId)
        .maybeSingle();
      if (!profileRes.error) {
        const days = num(
          (profileRes.data as Record<string, unknown> | null)?.collections_overdue_days,
        );
        if (days > 0) collectionsOverdueDays = days;
      }
    }

    return {
      invoices,
      feed,
      changeOrders,
      collectionsOverdueDays,
      trackingReady,
    } satisfies ReceivablesCockpitData;
  });

/**
 * Lightweight pulse for the billing nav badge: how many payments landed
 * since the caller last opened the feed. In-app only by design — email
 * notifications belong to the future notifications module.
 */
export const getBillingFeedPulse = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { sinceIso?: string } | undefined) =>
    z.object({ sinceIso: z.string().max(40).optional() }).parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as ServerContext;
    let query = table(ctx, "payment_ledger")
      .select("id,paid_at,status")
      .order("paid_at", { ascending: false })
      .limit(50);
    if (data.sinceIso) query = query.gt("paid_at", data.sinceIso);
    const res = await query;
    if (res.error) {
      if (isMissingSchema(res.error)) return { unseenCount: 0, latestPaidAtIso: null };
      throw new Error(res.error.message);
    }
    const rows = ((res.data ?? []) as Record<string, unknown>[]).filter(
      (row) => str(row.status, "succeeded") === "succeeded",
    );
    return {
      unseenCount: rows.length,
      latestPaidAtIso: rows.length > 0 ? str(rows[0].paid_at) : null,
    };
  });

const collectionsNoteInput = z.object({
  invoiceId: z.string().uuid(),
  note: z.string().min(1).max(500),
  idempotency_key: z.string().trim().min(1).max(200),
});

/**
 * Append one line to an invoice's collections log ("called 7/12, promised
 * payment"). Plain text, newest first, no CRM machinery by design.
 */
export const appendInvoiceCollectionsNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof collectionsNoteInput>) =>
    collectionsNoteInput.parse(input),
  )
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as ServerContext;
    const result = await ctx.supabase.rpc("append_invoice_collections_note_atomic", {
      p_billing_invoice_id: data.invoiceId,
      p_note: data.note,
      p_idempotency_key: data.idempotency_key,
    });
    if (result.error) {
      if (isMissingSchema(result.error)) {
        throw new Error("Collections notes aren't available yet. Try again in a few minutes.");
      }
      throw new Error(result.error.message);
    }
    const command = (result.data ?? {}) as Record<string, unknown>;
    return {
      ok: true,
      collections_log: str(command.collectionsLog),
      deduplicated: Boolean(command.deduplicated),
    };
  });
