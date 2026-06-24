#!/usr/bin/env node

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const live = process.argv.includes("--live");
const liveBaseUrl = process.env.OVERWATCH_SMOKE_URL ?? "https://overwatch.alpcontractorcircle.com";

const checks = [];
const warnings = [];

function pass(name, detail = "") {
  checks.push({ ok: true, name, detail });
}

function fail(name, detail = "") {
  checks.push({ ok: false, name, detail });
}

function warn(name, detail = "") {
  warnings.push({ name, detail });
}

async function read(relPath) {
  return readFile(path.join(root, relPath), "utf8");
}

async function expectFile(relPath, label = relPath) {
  try {
    await read(relPath);
    pass(`${label} exists`);
    return true;
  } catch (error) {
    fail(`${label} exists`, error.message);
    return false;
  }
}

async function expectContains(relPath, patterns, label) {
  let text;
  try {
    text = await read(relPath);
  } catch (error) {
    fail(label, `${relPath}: ${error.message}`);
    return;
  }

  const missing = patterns.filter((pattern) => !pattern.test(text));
  if (missing.length === 0) {
    pass(label);
  } else {
    fail(
      label,
      `Missing: ${missing.map((pattern) => pattern.toString()).join(", ")} in ${relPath}`,
    );
  }
}

async function readAllMigrationSql() {
  const dir = path.join(root, "supabase/migrations");
  const files = (await readdir(dir)).filter((file) => file.endsWith(".sql")).sort();
  const parts = [];
  for (const file of files) {
    const sql = await readFile(path.join(dir, file), "utf8");
    parts.push(`\n-- ${file}\n${sql}`);
  }
  return parts.join("\n");
}

function expectSql(sql, patterns, label) {
  const missing = patterns.filter((pattern) => !pattern.test(sql));
  if (missing.length === 0) {
    pass(label);
  } else {
    fail(
      label,
      `Missing migration token(s): ${missing.map((pattern) => pattern.toString()).join(", ")}`,
    );
  }
}

async function expectLiveRoute(urlPath, expectedStatus, label) {
  const url = new URL(urlPath, liveBaseUrl);
  try {
    const response = await fetch(url, { redirect: "manual" });
    if (expectedStatus.includes(response.status)) {
      pass(label, `${url} returned ${response.status}`);
    } else {
      fail(label, `${url} returned ${response.status}; expected ${expectedStatus.join(" or ")}`);
    }
  } catch (error) {
    fail(label, `${url}: ${error.message}`);
  }
}

await expectFile("src/routes/auth.tsx", "magic-link auth route");
await expectFile("src/routes/auth.callback.tsx", "auth callback route");
await expectFile("src/routes/_authenticated/index.tsx", "portfolio route");
await expectFile("src/routes/_authenticated/projects.$projectId.tsx", "project route");
await expectFile("src/routes/_authenticated/client.projects.$projectId.tsx", "client portal route");
await expectFile("src/routes/_authenticated/team.tsx", "team workspace route");
await expectFile("src/lib/daily-report-packet-pdf.ts", "daily report packet PDF generator");
await expectFile("src/lib/invoice-pdf.ts", "invoice PDF generator");
await expectFile("src/lib/email-templates/invoice-notification.tsx", "invoice email template");

await expectContains(
  "src/routeTree.gen.ts",
  [
    /fullPath:\s*'\/auth'/,
    /fullPath:\s*'\/auth\/callback'/,
    /fullPath:\s*'\/team'/,
    /fullPath:\s*'\/projects\/\$projectId'/,
    /fullPath:\s*'\/client\/projects\/\$projectId'/,
  ],
  "generated route tree includes auth, team, project, and client portal routes",
);

await expectContains(
  "src/routes/_authenticated/index.tsx",
  [
    /createProject/,
    /seedDemoIfEmpty/,
    /toast\.loading\("Creating project/,
    /toast\.success\("Project created/,
    /window\.location\.assign\(`\/projects\/\$\{projectId\}`\)/,
  ],
  "portfolio route supports member project creation and direct project navigation",
);

await expectContains(
  "src/integrations/supabase/client.ts",
  [
    /readRuntimeEnv/,
    /globalThis/,
    /VITE_SUPABASE_URL/,
    /SUPABASE_PUBLISHABLE_KEY/,
    /detectSessionInUrl:\s*true/,
  ],
  "browser Supabase client reads env without crashing on process.env",
);

await expectContains(
  "src/routes/auth.tsx",
  [/Outlet/, /AuthForm/, /checkExistingSession/, /Could not check current session/, /setError/],
  "auth page handles session-check failures without blanking",
);

await expectContains(
  "src/routes/auth.callback.tsx",
  [
    /establishSessionFromUrl/,
    /exchangeCodeForSession/,
    /setSession/,
    /access_token/,
    /refresh_token/,
    /window\.location\.replace\(next\)/,
    /Request fresh magic link/,
    /already used or expired/,
  ],
  "auth callback supports code/hash magic links and used-link recovery",
);

await expectContains(
  "src/routes/_authenticated/route.tsx",
  [/getSession/, /getUser/, /continuing with restored session/, /sessionData\.session\.user/],
  "authenticated route lets restored browser sessions survive refresh",
);

await expectContains(
  "src/routes/_authenticated/projects.$projectId.tsx",
  [
    /createExposure/,
    /deleteExposure/,
    /createDecision/,
    /createBillingApplication/,
    /createBillingInvoice/,
    /recordInvoicePayment/,
    /importCostBuckets/,
    /saveSovMappingProfile/,
    /DailyReportsWorkspace/,
    /ClientPortalWorkspace/,
    /Invoice & payment ledger/,
    /Record payment/,
    /generateInvoicePdf/,
    /Invoice PDF downloaded/,
    /enqueueInvoiceEmail/,
    /invoice-notification/,
    /Billing recipients/,
    /Invoice email queued/,
    /toast\.success\("Linked to-do created/,
    /toast\.success\("Risk deleted/,
    /toast\.success\("Pay app added/,
    /toast\.success\("Invoice created/,
    /toast\.success\("Payment recorded/,
    /toast\.success\("SOV mapping saved/,
    /toast\.success\("SOV imported/,
  ],
  "project route wires core Phase 0 write paths and success toasts",
);

await expectContains(
  "src/routes/_authenticated/team.tsx",
  [
    /PlanReadinessPanel/,
    /Plan and usage controls/,
    /Commercial readiness/,
    /usageStatus/,
    /Contractor Circle grant keeps users working/,
    /Storage and attachments/,
  ],
  "team workspace exposes plan usage controls without blocking Contractor Circle access",
);

await expectContains(
  "src/lib/invoice-pdf.ts",
  [/PDFDocument/, /OVERWATCH BILLING/, /Billing summary/, /Payment history/, /Job #/],
  "invoice PDF generator includes branded invoice summary and payment history",
);

await expectContains(
  "src/lib/email-templates/registry.ts",
  [/invoice-notification/, /invoiceNotification/],
  "transactional invoice email template is registered",
);

await expectContains(
  "src/lib/email-templates/invoice-notification.tsx",
  [/OVERWATCH BILLING/, /Open client portal/, /totalDue/, /openBalance/],
  "invoice notification email includes client portal CTA and billing totals",
);

await expectContains(
  "src/components/outcome/ScheduleRisk.tsx",
  [
    /createScheduleUpdate/,
    /createScheduleRisk/,
    /createExposure/,
    /toast\.success\("Risk allocation created/,
    /toast\.success\("Schedule update saved/,
  ],
  "schedule workspace creates schedule updates and pushes schedule risk into risk tally",
);

await expectContains(
  "src/components/outcome/DailyReportsWorkspace.tsx",
  [
    /supabase\.storage\.from\(BUCKET\)\.upload/,
    /client_visible/,
    /generateDailyReportPacketPdf/,
    /downloadPdfBytes/,
    /Export PDF/,
    /toast\.success\(editingId \? "Daily report updated" : "Daily report saved"/,
    /toast\.success\("Daily report deleted"/,
  ],
  "daily reports support attachments, client visibility, PDF packets, and user feedback",
);

await expectContains(
  "src/routes/_authenticated/client.projects.$projectId.tsx",
  [
    /generateDailyReportPacketPdf/,
    /downloadDailyReportPacket/,
    /Download packet/,
    /billingInvoices/,
    /Invoice total/,
    /Billing shared with client/,
    /Daily reports shared with client/,
  ],
  "client portal exposes shared daily reports, billing, and packet export",
);

await expectContains(
  "src/components/outcome/ClientPortalWorkspace.tsx",
  [
    /Client access ledger/,
    /can_view_change_orders/,
    /can_view_daily_reports/,
    /can_view_billing/,
    /toast\.success\("Client permissions updated"/,
    /toast\.success\("Client magic link sent"/,
  ],
  "client portal workspace controls per-seat module access and magic links",
);

await expectContains(
  "src/components/outcome/ImportSOVSheet.tsx",
  [
    /mappingProfiles/,
    /Apply a saved SOV mapping/,
    /Save this mapping for future imports/,
    /onSaveProfile/,
    /SovMappingProfileDraft/,
  ],
  "SOV intake can save and reuse company mapping profiles",
);

await expectContains(
  "src/lib/sov-import.ts",
  [
    /parseXlsx/,
    /parseCsv/,
    /parsePdf/,
    /guessColumnMap/,
    /applyMapping/,
    /analyzeSovIntake/,
    /cost_code/,
    /confidence/,
  ],
  "SOV intake supports messy contractor spreadsheets and mapping confidence",
);

const sql = await readAllMigrationSql();

expectSql(
  sql,
  [
    /alter table public\.projects[\s\S]*job_number/i,
    /alter table public\.projects[\s\S]*project_manager/i,
    /tg_projects_calculate_schedule_variance/i,
  ],
  "project metadata and calculated schedule variance migration exists",
);

expectSql(
  sql,
  [
    /create table if not exists public\.schedule_updates/i,
    /grant select, insert, update, delete on public\.schedule_updates to authenticated/i,
    /alter table public\.schedule_updates enable row level security/i,
    /schedule_update_id uuid references public\.schedule_updates/i,
  ],
  "schedule updates and schedule-risk linkage migrations exist with RLS/grants",
);

expectSql(
  sql,
  [
    /create table if not exists public\.sov_imports/i,
    /grant select, insert on public\.sov_imports to authenticated/i,
    /alter table public\.sov_imports enable row level security/i,
    /alter table public\.cost_buckets[\s\S]*cost_code/i,
  ],
  "SOV import history and cost-code migrations exist with RLS/grants",
);

expectSql(
  sql,
  [
    /create table if not exists public\.sov_mapping_profiles/i,
    /organization_id uuid not null references public\.organizations/i,
    /grant select, insert, update, delete on public\.sov_mapping_profiles to authenticated/i,
    /alter table public\.sov_mapping_profiles enable row level security/i,
    /sov_mapping_profiles_member_select/i,
    /sov_mapping_profiles_member_insert/i,
  ],
  "SOV mapping profiles migration exists with org-scoped RLS/grants",
);

expectSql(
  sql,
  [
    /create table if not exists public\.billing_applications/i,
    /grant select, insert, update, delete on public\.billing_applications to authenticated/i,
    /alter table public\.billing_applications enable row level security/i,
    /billing_applications_client_select/i,
  ],
  "billing applications exist for internal use and client visibility",
);

expectSql(
  sql,
  [
    /create table if not exists public\.billing_invoices/i,
    /create table if not exists public\.payment_ledger/i,
    /grant select, insert, update, delete on public\.billing_invoices to authenticated/i,
    /grant select, insert, update, delete on public\.payment_ledger to authenticated/i,
    /alter table public\.billing_invoices enable row level security/i,
    /alter table public\.payment_ledger enable row level security/i,
    /billing_invoices_client_select/i,
    /payment_ledger_client_select/i,
  ],
  "invoice/payment ledger foundation exists with client-visible billing policies",
);

expectSql(
  sql,
  [
    /create table if not exists public\.daily_reports/i,
    /client_visible boolean not null default false/i,
    /daily_reports_storage_insert/i,
    /daily_reports_storage_update/i,
    /daily_reports_client_select/i,
  ],
  "daily reports, attachments/storage policies, and client visibility migrations exist",
);

expectSql(
  sql,
  [
    /create table if not exists public\.client_contacts/i,
    /create table if not exists public\.project_client_access/i,
    /create table if not exists public\.change_order_approvals/i,
    /can_read_client_project/i,
    /record_client_change_order_decision/i,
    /can_view_client_change_orders/i,
    /can_view_client_daily_reports/i,
    /can_view_client_billing/i,
  ],
  "client portal tables, approval RPCs, and module permissions exist",
);

expectSql(
  sql,
  [
    /contractor_circle_grant/i,
    /create table if not exists public\.organization_memberships/i,
    /project_limit/i,
    /seat_limit/i,
    /daily_report_limit_per_month/i,
    /storage_limit_mb/i,
  ],
  "team workspace and non-blocking Contractor Circle grant foundation exists",
);

if (live) {
  await expectLiveRoute("/", [200, 302, 307, 308], "custom domain root responds");
  await expectLiveRoute("/auth", [200, 302, 307, 308], "custom domain auth route responds");
  await expectLiveRoute(
    "/client/projects/00000000-0000-0000-0000-000000000000",
    [200, 302, 307, 308, 404],
    "custom domain client route is deployed",
  );
} else {
  warn(
    "live custom-domain checks skipped",
    "Run npm run smoke:phase0:live after Lovable publishes.",
  );
}

const failed = checks.filter((check) => !check.ok);
const passed = checks.filter((check) => check.ok);

for (const check of passed) {
  console.log(`✓ ${check.name}${check.detail ? ` — ${check.detail}` : ""}`);
}
for (const warning of warnings) {
  console.warn(`⚠ ${warning.name}${warning.detail ? ` — ${warning.detail}` : ""}`);
}
for (const check of failed) {
  console.error(`✗ ${check.name}${check.detail ? ` — ${check.detail}` : ""}`);
}

console.log(
  `\nPhase 0 smoke: ${passed.length} passed, ${failed.length} failed, ${warnings.length} warning${warnings.length === 1 ? "" : "s"}.`,
);

if (failed.length > 0) process.exit(1);
