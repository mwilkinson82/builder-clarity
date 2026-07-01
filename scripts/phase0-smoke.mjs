#!/usr/bin/env node

import { readFile, readdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";

const root = process.cwd();
const live = process.argv.includes("--live");
const liveBaseUrl = process.env.OVERWATCH_SMOKE_URL ?? "https://overwatch.alpcontractorcircle.com";
const execFileAsync = promisify(execFile);

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

async function expectNotContains(relPath, patterns, label) {
  let text;
  try {
    text = await read(relPath);
  } catch (error) {
    fail(label, `${relPath}: ${error.message}`);
    return;
  }

  const present = patterns.filter((pattern) => pattern.test(text));
  if (present.length === 0) {
    pass(label);
  } else {
    fail(
      label,
      `Unexpected: ${present.map((pattern) => pattern.toString()).join(", ")} in ${relPath}`,
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

async function currentGitCommit() {
  if (process.env.OVERWATCH_EXPECTED_COMMIT) {
    return process.env.OVERWATCH_EXPECTED_COMMIT.trim();
  }
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: root });
    return stdout.trim();
  } catch (error) {
    fail("current Git commit can be resolved", error.message);
    return "";
  }
}

async function expectLiveCommit(urlPath, label) {
  const expectedCommit = await currentGitCommit();
  if (!expectedCommit) return;
  const url = new URL(urlPath, liveBaseUrl);
  try {
    const response = await fetch(url, { redirect: "follow" });
    if (!response.ok) {
      fail(label, `${url} returned ${response.status}; expected a readable app shell`);
      return;
    }
    const html = await response.text();
    const deployedCommit = html.match(/data-commit-sha="([0-9a-f]{7,40})"/i)?.[1] ?? "";
    if (!deployedCommit) {
      fail(label, `${url} did not expose data-commit-sha`);
      return;
    }
    const expectedPrefix = expectedCommit.slice(0, 8);
    if (deployedCommit.startsWith(expectedPrefix)) {
      pass(label, `${url} is serving ${deployedCommit}`);
    } else {
      fail(label, `${url} is serving ${deployedCommit}; expected ${expectedCommit}`);
    }
  } catch (error) {
    fail(label, `${url}: ${error.message}`);
  }
}

await expectFile("src/routes/auth.tsx", "magic-link auth route");
await expectFile("src/routes/auth.callback.tsx", "auth callback route");
await expectFile("src/routes/api/auth/magic-link.ts", "Overwatch-owned magic-link sender route");
await expectFile("src/lib/auth/magic-link.ts", "magic-link sender client helper");
await expectFile("src/routes/_authenticated/index.tsx", "portfolio route");
await expectFile("src/routes/_authenticated/projects.$projectId.tsx", "project route");
await expectFile("src/routes/_authenticated/client.projects.$projectId.tsx", "client portal route");
await expectFile("src/routes/_authenticated/team.tsx", "company workspace route");
await expectFile("src/routes/_authenticated/estimates.tsx", "estimates route");
await expectFile("src/routes/_authenticated/estimate-masters.tsx", "estimate master sheets route");
await expectFile("src/routes/_authenticated/estimates.$estimateId.tsx", "estimate workspace route");
await expectFile("src/routes/_authenticated/cost-library.tsx", "cost library route");
await expectFile("src/components/estimates/EstimateWorkspace.tsx", "estimate workspace component");
await expectFile("src/components/pipeline/PipelineWorkspace.tsx", "CRM pipeline workspace");
await expectFile("src/components/pipeline/OpportunityDetail.tsx", "CRM opportunity detail modal");
await expectFile("src/lib/estimate-import.ts", "estimating import parser");
await expectFile("src/lib/daily-report-packet-pdf.ts", "daily report packet PDF generator");
await expectFile("src/lib/invoice-pdf.ts", "invoice PDF generator");
await expectFile("src/lib/email-templates/invoice-notification.tsx", "invoice email template");
await expectFile(
  "src/lib/email-templates/ior-report-notification.tsx",
  "IOR report email template",
);
await expectFile("src/lib/stripe.server.ts", "Stripe server helper");
await expectFile(
  "src/routes/api/stripe/connect/account-link.ts",
  "Stripe Connect onboarding route",
);
await expectFile("src/routes/api/stripe/checkout/invoice.ts", "invoice Stripe Checkout route");
await expectFile(
  "src/routes/api/stripe/checkout/subscription.ts",
  "subscription Stripe Checkout route",
);
await expectFile("src/routes/api/stripe/webhook.ts", "Stripe webhook route");

await expectContains(
  "src/routeTree.gen.ts",
  [
    /fullPath:\s*'\/auth'/,
    /fullPath:\s*'\/auth\/callback'/,
    /fullPath:\s*'\/api\/auth\/magic-link'/,
    /fullPath:\s*'\/team'/,
    /fullPath:\s*'\/projects\/\$projectId'/,
    /fullPath:\s*'\/client\/projects\/\$projectId'/,
    /fullPath:\s*'\/api\/stripe\/connect\/account-link'/,
    /fullPath:\s*'\/api\/stripe\/checkout\/invoice'/,
    /fullPath:\s*'\/api\/stripe\/checkout\/subscription'/,
    /fullPath:\s*'\/api\/stripe\/webhook'/,
  ],
  "generated route tree includes auth, app-owned magic links, company workspace, project, client portal, and Stripe API routes",
);

await expectContains(
  "src/routeTree.gen.ts",
  [/fullPath:\s*'\/estimates'/, /fullPath:\s*'\/estimate-masters'/, /fullPath:\s*'\/cost-library'/],
  "generated route tree includes estimating workspace, master sheets, and cost library routes",
);

await expectContains(
  "src/styles.css",
  [
    /--accent:\s*#1b7a6e/,
    /--ring:\s*rgb\(27 122 110 \/ 0\.4\)/,
    /--accent:\s*#2aa99a/,
    /--ring:\s*rgb\(42 169 154 \/ 0\.55\)/,
  ],
  "global highlight accent uses the deep teal trial palette",
);

await expectContains(
  "src/routes/auth.tsx",
  [/sendOverwatchMagicLink/, /context:\s*"login"/],
  "public auth page sends magic links through Overwatch email route",
);

await expectContains(
  "src/components/outcome/ClientPortalWorkspace.tsx",
  [/sendOverwatchMagicLink/, /context:\s*"client_portal"/],
  "client portal access sends magic links through Overwatch email route",
);

await expectContains(
  "src/routes/_authenticated/index.tsx",
  [
    /createProject/,
    /seedDemoIfEmpty/,
    /getCompanyWorkspaceContext/,
    /company-workspace-context/,
    /toast\.loading\("Creating project/,
    /toast\.success\("Project created/,
    /data-testid="portfolio-project-ledger"/,
    /PROJECT_LEDGER_GRID_CLASS/,
    /href=\{projectHref\}/,
  ],
  "portfolio route supports member project creation, responsive project ledger navigation, and company-scoped header identity",
);

await expectNotContains(
  "src/routes/_authenticated/index.tsx",
  [/min-w-\[1420px\]/, /from "@\/components\/ui\/table"/],
  "portfolio project ledger does not use the old forced-width table",
);

await expectContains(
  "src/lib/team.functions.ts",
  [
    /getCompanyWorkspaceContext/,
    /name: organization\.name \|\| "Company"/,
    /logo_url: organizationLogoUrl\(context\.supabase, organization\)/,
  ],
  "company workspace context exposes the user's company name and logo for app headers",
);

await expectContains(
  "src/routes/_authenticated/estimates.tsx",
  [/getCompanyWorkspaceContext/, /company-workspace-context/, /\{companyName\}/],
  "estimates workspace header uses the user's company name",
);

await expectContains(
  "src/routes/_authenticated/cost-library.tsx",
  [/getCompanyWorkspaceContext/, /company-workspace-context/, /\{companyName\}/],
  "cost library workspace header uses the user's company name",
);

await expectContains(
  "src/routes/_authenticated/billing.tsx",
  [/getCompanyWorkspaceContext/, /company-workspace-context/, /\{companyName\}/],
  "billing workspace header uses the user's company name",
);

await expectContains(
  "src/components/pipeline/PipelineWorkspace.tsx",
  [
    /createEstimate/,
    /createEstimateMutation/,
    /opportunity_id: opportunity\.id/,
    /\/estimates\/\$\{result\.id\}/,
  ],
  "CRM opportunities can start linked estimates before project conversion",
);

await expectContains(
  "src/components/pipeline/OpportunityDetail.tsx",
  [/Create Estimate/, /isCreatingEstimate/, /onCreateEstimate/],
  "CRM opportunity detail exposes the create-estimate handoff action",
);

await expectContains(
  "src/lib/projects.functions.ts",
  [
    /HARBOR_DEMO_CPM_ACTIVITIES/,
    /activity_id:\s*"01-010"/,
    /activity_id:\s*"99-010"/,
    /predecessor_activity_ids/,
    /successor_activity_ids/,
    /seedHarborDemoCpmActivities/,
    /ensureHarborDemoCpmActivitiesForProject/,
    /harborDemoInspections/,
    /seedHarborDemoInspections/,
    /HARBOR_DEMO_PROJECT_MANAGER/,
    /Marshall Wilkinson/,
    /ensureHarborDemoProjectManager/,
    /HARBOR_DEMO_FIRST_CPM_ACTIVITY_ID/,
    /isHarborDemoProject/,
    /getHarborDemoCpmActivityRows/,
    /job_number/,
    /client/,
    /includes\(HARBOR_DEMO_NAME\.toLowerCase\(\)\)/,
  ],
  "Harbor Residence demo seeds Marshall Wilkinson as PM and self-detects a full CPM activity plan with predecessor and successor logic",
);

await expectContains(
  "src/lib/schedule.functions.ts",
  [
    /ensureHarborDemoCpmActivitiesForProject/,
    /getHarborDemoCpmActivityRows/,
    /hasHarborDemoCpmRows/,
    /refreshedActivities/,
  ],
  "Schedule loader self-heals missing Harbor Residence CPM demo rows",
);

await expectContains(
  "supabase/migrations/20260630170000_harbor_demo_pm_identity.sql",
  [
    /Marshall Wilkinson/,
    /Overwatch Demo PM/,
    /public\.projects/,
    /public\.daily_reports/,
    /public\.reviews/,
  ],
  "existing Harbor Residence demo PM, daily report, and review identities are backfilled",
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
    /createInspection/,
    /updateInspection/,
    /deleteInspection/,
    /InspectionsWorkspace/,
    /createBillingApplication/,
    /createBillingInvoice/,
    /recordInvoicePayment/,
    /importCostBuckets/,
    /saveSovMappingProfile/,
    /DailyReportsWorkspace/,
    /ClientPortalWorkspace/,
    /Invoice & payment ledger/,
    /Client payment readiness/,
    /Record payment/,
    /ledgerEarnedToDate/,
    /unbilledEarnedToDate/,
    /generateInvoicePdf/,
    /Invoice PDF downloaded/,
    /enqueueInvoiceEmail/,
    /invoice-notification/,
    /Billing recipients/,
    /exposureCategoryFromChangeOrder/,
    /toast\.success\("CO sent to risk tally/,
    /toast\.success\("Inspection logged/,
    /shared risk ledger until the inspection table is available/,
    /toast\.success\("Inspection sent to risk tally/,
    /Finish payment setup/,
    /Invoice email queued/,
    /toast\.success\("Linked to-do created/,
    /toast\.success\("Risk deleted/,
    /toast\.success\("Pay app added/,
    /toast\.success\("Invoice created/,
    /toast\.success\("Payment recorded/,
    /toast\.success\("Payment link ready/,
    /Enable online pay/,
    /Client can pay online/,
    /Manual\/email only/,
    /toast\.success\("SOV mapping saved/,
    /toast\.success\("SOV imported/,
  ],
  "project route wires core Phase 0 write paths and success toasts",
);

await expectContains(
  "src/routes/_authenticated/projects.$projectId.tsx",
  [
    /const COMPACT_PROJECT_NAV_TABS = new Set<ProjectTabValue>/,
    /"schedule"[\s\S]*"inspections"[\s\S]*"risk-tally"[\s\S]*"todos"[\s\S]*"sov"[\s\S]*"billing"[\s\S]*"change-orders"[\s\S]*"client-portal"[\s\S]*"ior-report"[\s\S]*"daily-reports"/,
    /const compactProjectNav = COMPACT_PROJECT_NAV_TABS\.has\(activeProjectTab\)/,
    /const companyName = project\.organization_name \|\| "Overwatch company"/,
    /const headerStats = \[/,
    /"Original Contract"[\s\S]*"Forecasted Final"/,
    /bg-surface-elevated\/95 shadow-\[0_10px_30px_rgb/,
    /flex max-w-\[1760px\] flex-col gap-2 px-4 py-2\.5/,
    /max-w-\[1760px\]/,
    /lg:grid-cols-\[76px_minmax\(0,1fr\)\]/,
    /PROJECT_NAV_RAIL_CLASS[\s\S]*bg-accent\/\[0\.07\][\s\S]*shadow-\[0_18px_42px_rgb/,
    /projectNavItemClass/,
    /const isActive = activeProjectTab === item\.value/,
    /active: isActive/,
    /ProjectNavTooltip/,
    /TooltipProvider delayDuration=\{120\}/,
    /aria-label=\{`\$\{item\.label\}: \$\{item\.detail\}`\}/,
    /title=\{`\$\{item\.label\}: \$\{item\.detail\}`\}/,
    /BILLING_WORKSPACE_TAB_TRIGGER_CLASS[\s\S]*data-\[state=active\]:bg-accent/,
    /BILLING_WORKSPACE_TAB_TRIGGER_CLASS[\s\S]*data-\[state=active\]:border-accent/,
    /border border-accent\/25 bg-accent\/5 p-1\.5 shadow-card ring-1 ring-accent\/10/,
    /Pay App Detail/,
    /Cost Ledger/,
    /WIP Analysis/,
    /Pay App Ledger/,
    /Invoices & Payments/,
    /Pending Change Orders/,
    /renderEnhancedBillingPanel/,
    /BillingLineItemsPanel/,
    /ProjectCostTrackingPanel/,
    /WipAnalysisPanel/,
  ],
  "workspace-heavy project tabs open a wide rail layout with labeled icon tooltips",
);

await expectContains(
  "src/components/outcome/InspectionsWorkspace.tsx",
  [
    /export function InspectionsWorkspace/,
    /InspectionDraft/,
    /Reinspection/,
    /Send to risk/,
    /Inspection risk posture/,
    /required_reinspection/,
    /cost_impact/,
    /schedule_impact_weeks/,
  ],
  "inspections workspace tracks pass/fail attempts, reinspections, impacts, and risk handoff",
);

await expectContains(
  "src/lib/projects.functions.ts",
  [
    /INSPECTION_FALLBACK_MARKER/,
    /fallbackInspectionFromExposure/,
    /createFallbackInspectionExposure/,
    /updateFallbackInspectionExposure/,
    /deleteFallbackInspectionExposure/,
    /isProjectInspectionsSchemaError\(error\)[\s\S]*createFallbackInspectionExposure/,
    /const fallbackInspections = exposures[\s\S]*\.map\(fallbackInspectionFromExposure\)/,
  ],
  "inspection writes use a shared fallback when the project inspections table is missing",
);

await expectContains(
  "src/components/billing/BillingEnhancements.tsx",
  [
    /billingDocumentLabel/,
    /Pay application line detail/,
    /Continuation sheet detail/,
    /Download pay app package/,
    /Cost ledger \/ project costs/,
    /SOV sets the billable schedule of values/,
    /Export function|export function BillingLineItemsPanel/i,
    /export function ProjectCostTrackingPanel/,
    /export function WipAnalysisPanel/,
  ],
  "billing enhancement panels expose pay app detail, project cost tracking, and WIP sections with production wording",
);

await expectContains(
  "src/lib/billing-labels.ts",
  [/normalizeBillingNumberLabel/, /LEADING_ZERO_NUMBER_TOKEN/, /billingDocumentLabel/],
  "billing document labels normalize generated-looking leading zeroes before rendering or export",
);

await expectContains(
  "src/lib/aia-pdf.ts",
  [
    /billingDocumentLabel/,
    /APPLICATION AND CERTIFICATE FOR PAYMENT/,
    /CONTINUATION SHEET/,
    /Owner \/ Company/,
    /CONTRACT SUMMARY/,
    /CONTRACTOR CERTIFICATION/,
    /hasRetainage/,
    /Total earned to date/,
    /computePreviousCertificateCents/,
    /Less previous certificates for payment/,
    /getContinuationColumns/,
    /drawContinuationColumnHeader/,
    /PCT_TEXT_X/,
    /aia-pay-application-package\.pdf/,
  ],
  "pay app PDF generator creates a cover sheet and continuation sheet package",
);

await expectContains(
  "src/components/outcome/ChangeOrdersTable.tsx",
  [/onCreateRisk/, /creatingRiskId/, /Send to risk tally/],
  "change order table exposes a risk-tally action",
);

await expectContains(
  "src/routes/_authenticated/team.tsx",
  [
    /data-testid="company-command-center"/,
    /data-testid="company-users-access"/,
    /data-testid="client-access-priority-panel"/,
    /data-testid="project-asset-access-assignments"/,
    /data-testid="company-profile-record"/,
    /PlanReadinessPanel/,
    /Plan and payment readiness/,
    /Commercial setup/,
    /Payment readiness/,
    /Overwatch subscription/,
    /Client invoice payments/,
    /Billing contact/,
    /stripeConnectMutation/,
    /Connect Stripe/,
    /stripe\/connect\/account-link/,
    /stripe=return/,
    /Checkout Sessions/,
    /usageStatus/,
    /Contractor Circle grant keeps this company working/,
    /Invite company users/,
    /Company users and roles/,
    /Client project access/,
    /Project access assignments/,
    /SummaryMetric/,
    /Storage and attachments/,
  ],
  "company workspace prioritizes access, team seats, client portal access, plan readiness, and profile controls",
);

await expectContains(
  "src/components/outcome/RiskAllocationWorkbench.tsx",
  [
    /grid-cols-\[minmax\(0,1\.15fr\)_minmax\(0,0\.85fr\)\]/,
    /<div className="grid min-w-0 gap-5">/,
    /aria-label="Risk tally workspace"/,
  ],
  "risk tally layout gives the open ledger full workspace width instead of adding a side rail",
);

await expectContains(
  "src/components/outcome/ExposuresTable.tsx",
  [
    /w-full min-w-0 max-w-full overflow-hidden rounded-lg border border-hairline bg-card/,
    /lg:grid-cols-\[minmax\(280px,1\.35fr\)_minmax\(156px,0\.46fr\)_minmax\(210px,0\.62fr\)_minmax\(170px,0\.5fr\)_96px\]/,
    /role="button"/,
    /onClick=\{\(\) => onView\(exposure\)\}/,
    /Risk detail/,
  ],
  "risk exposure table fits desktop presentations and opens row-level detail",
);

await expectContains(
  "src/components/ui/table.tsx",
  [/w-full min-w-0 max-w-full overflow-auto/],
  "shared table wrapper cannot force page-level horizontal overflow",
);

await expectContains(
  "src/lib/team.functions.ts",
  [
    /CONTRACTOR_CIRCLE_GRANT_LIMITS/,
    /seats:\s*10/,
    /ORGANIZATION_COMMERCIAL_COLUMNS/,
    /billing_email/,
    /billing_contact_name/,
    /stripe_customer_id/,
    /stripe_subscription_id/,
    /stripe_connect_account_id/,
    /payment_processor_ready/,
    /missingCommercialOrganizationColumn/,
  ],
  "company workspace server functions expose commercial billing readiness with schema-cache fallback",
);

await expectContains(
  "src/lib/invoice-pdf.ts",
  [/PDFDocument/, /OVERWATCH BILLING/, /Billing summary/, /Payment history/, /Job #/],
  "invoice PDF generator includes branded invoice summary and payment history",
);

await expectContains(
  "src/lib/email-templates/registry.ts",
  [
    /invoice-notification/,
    /invoiceNotification/,
    /ior-report-notification/,
    /iorReportNotification/,
  ],
  "transactional invoice and IOR report email templates are registered",
);

await expectContains(
  "src/lib/email-templates/invoice-notification.tsx",
  [/OVERWATCH BILLING/, /Pay invoice online/, /paymentUrl/, /totalDue/, /openBalance/],
  "invoice notification email includes payment CTA and billing totals",
);

await expectContains(
  "src/components/outcome/ReviewsTab.tsx",
  [
    /EmailReviewDialog/,
    /sendTransactionalEmail/,
    /ior-report-notification/,
    /Send through Overwatch/,
  ],
  "IOR report emails queue through Overwatch instead of external mail clients",
);

await expectContains(
  "src/lib/stripe.server.ts",
  [
    /STRIPE_API_VERSION/,
    /2026-02-25\.clover/,
    /STRIPE_SECRET_KEY/,
    /STRIPE_WEBHOOK_SECRET/,
    /https:\/\/api\.stripe\.com\/v1\//,
    /verifyStripeWebhookPayload/,
    /stripePost/,
    /stripeGet/,
    /createSupabaseAdminClient/,
    /isMissingSupabaseColumn/,
    /PGRST204/,
    /requireAuthedStripeContext/,
    /can_manage_project/,
    /can_manage_org/,
  ],
  "Stripe server helper keeps secrets server-side, detects schema drift, and verifies project/org access",
);

await expectContains(
  "src/routes/api/stripe/connect/account-link.ts",
  [
    /createFileRoute\("\/api\/stripe\/connect\/account-link"\)/,
    /account_links/,
    /account_onboarding/,
    /controller\[fees\]\[payer\]/,
    /controller\[stripe_dashboard\]\[type\]/,
    /capabilities\[card_payments\]\[requested\]/,
    /capabilities\[transfers\]\[requested\]/,
    /stripe_connect_account_id/,
    /payment_processor_ready/,
    /CONNECT_SELECT_WITHOUT_BILLING_EMAIL/,
    /stripe_schema_not_ready/,
    /isMissingSupabaseColumn/,
    /status:\s*"pending"/,
    /requireCanManageOrganization/,
  ],
  "Stripe Connect onboarding route handles billing-email schema drift, creates account links, and updates company readiness",
);

await expectContains(
  "src/routes/api/stripe/webhook.ts",
  [/account\.updated/, /stripe_schema_not_ready/, /status:\s*"pending"/],
  "Stripe webhook route keeps Connect status values aligned to the database constraint",
);

await expectContains(
  "src/routes/api/stripe/checkout/invoice.ts",
  [
    /mode",\s*"payment"/,
    /payment_enabled/,
    /payment_url/,
    /stripe_checkout_session_id/,
    /online_payment_status/,
    /payment_link_sent_at/,
    /payment_intent_data\[metadata\]\[invoice_id\]/,
    /stripe_connect_not_ready/,
    /payment_processor_ready/,
    /payment_intent_data\[transfer_data\]\[destination\]/,
    /payment_intent_data\[application_fee_amount\]/,
  ],
  "invoice checkout route creates guarded Connect payment sessions and records payment link state",
);

await expectContains(
  "src/routes/api/stripe/checkout/subscription.ts",
  [
    /mode",\s*"subscription"/,
    /subscription_plans/,
    /checkout_enabled/,
    /stripe_price_id/,
    /billing_status/,
    /checkout_pending/,
  ],
  "subscription checkout route uses configured Stripe prices and updates billing posture",
);

await expectContains(
  "src/routes/api/stripe/webhook.ts",
  [
    /checkout\.session\.completed/,
    /checkout\.session\.expired/,
    /payment_intent\.payment_failed/,
    /charge\.refunded/,
    /customer\.subscription\.updated/,
    /payment_ledger/,
    /online_payment_status/,
    /stripe_checkout_session_id/,
    /stripe_payment_intent_id/,
    /overwatch_fee_amount_cents/,
    /overwatch_fee/,
    /net_payout/,
    /account\.updated/,
    /charges_enabled/,
    /payouts_enabled/,
    /details_submitted/,
  ],
  "Stripe webhook route records invoice, payment ledger, refund, and subscription outcomes",
);

await expectContains(
  "src/routes/_authenticated/projects.$projectId.schedule.tsx",
  [
    /createScheduleActivity/,
    /updateScheduleActivity/,
    /deleteScheduleActivity/,
    /onAddActivity/,
    /onPatchActivity/,
    /onDeleteActivity/,
  ],
  "dedicated schedule route wires CPM activity create, update, and delete mutations",
);

await expectContains(
  "src/components/outcome/ScheduleRisk.tsx",
  [
    /createScheduleUpdate/,
    /createScheduleRisk/,
    /createExposure/,
    /Baseline vs schedule updates/,
    /Data date/,
    /Money exposure in update/,
    /schedule_money_exposure/,
    /Construction schedule/,
    /CPM schedule workbench/,
    /Activity table \+ Gantt/,
    /Build from milestones/,
    /CPM activity detail/,
    /Dependency readout/,
    /Gantt chart/,
    /predecessor_activity_ids/,
    /successor_activity_ids/,
    /Add activity/,
    /Baseline vs current milestone plan/,
    /MilestoneViewSelect/,
    /SchedulePlanRow/,
    /toast\.success\("Risk allocation created/,
    /toast\.success\("Schedule update saved/,
  ],
  "schedule workspace creates data-date updates with money movement and pushes schedule risk into risk tally",
);

await expectContains(
  "src/routes/_authenticated/projects.$projectId.schedule.tsx",
  [
    /createScheduleActivity/,
    /updateScheduleActivity/,
    /deleteScheduleActivity/,
    /createScheduleWbsSection/,
    /reorderScheduleWbsSections/,
    /project\?\.organization_name \|\| "Company"/,
    /Activity added/,
    /CPM rows created/,
  ],
  "dedicated schedule workspace route creates and edits CPM activities",
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
    /Pay invoice online/,
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
    /Contextual mapping assistant/,
    /skippedRowReasons/,
    /columnSuggestions/,
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
    /DESCRIPTION_BUCKET_HEADERS/,
    /isCsiDivisionHeaderRow/,
    /explainColumnMapping/,
    /ColumnMappingSuggestion/,
    /SkippedRowSummary/,
    /CSI division header/,
    /cost_code/,
    /confidence/,
  ],
  "SOV intake supports messy contractor spreadsheets and mapping confidence",
);

await expectContains(
  "src/lib/estimate-import.ts",
  [
    /parseCostLibraryRows/,
    /parseEstimateLineRows/,
    /costLibraryTemplateCsv/,
    /estimateLineTemplateCsv/,
    /Material \$\/Unit/,
    /Labor \$\/Unit/,
    /warning/,
  ],
  "estimating import parser supports paste, CSV, and spreadsheet row staging",
);

await expectContains(
  "src/lib/estimates.functions.ts",
  [
    /importCostLibraryItems/,
    /importEstimateLineItems/,
    /source:\s*"imported"/,
    /keyFor/,
    /updated_count/,
    /str\(row\.source\) !== "system"/,
    /mode:\s*z\.enum\(\["append", "replace"\]\)/,
    /System library items are read-only/,
    /HARBOR_DEMO_ESTIMATE_NAME/,
    /Harbor Residence - Sample Estimate/,
    /HARBOR_SAMPLE_MASTER_SHEET_NAME/,
    /Harbor Residence - Sample Master Sheet/,
    /ensureHarborDemoEstimate/,
    /ensureHarborSampleMasterSheet/,
    /createBlankLineItems/,
    /ESTIMATE_FOLDERS/,
    /deleteEstimate/,
    /folder:\s*estimateFolderSchema\.optional/,
    /recalculateEstimateTotalsInternal/,
  ],
  "estimating server functions import contractor costs, protect system rows, seed Harbor samples, folder estimates, delete estimates, and create blank rows in bulk",
);

await expectContains(
  "src/routes/_authenticated/cost-library.tsx",
  [
    /Import My Costs/,
    /Download Import Format/,
    /Overwatch Library/,
    /My Cost Library/,
    /All Costs/,
    /Material/,
    /Labor/,
    /Installed/,
    /Crew \/ Production/,
    /Material \$\/Unit/,
    /Labor \$\/Unit/,
    /not per worker/,
    /CostRateDisplay/,
    /CostMoneyInput/,
    /Production \/ Hour/,
    /Build your estimating price book/,
    /Add to My Cost Library/,
    /parseCostLibraryRows/,
    /parseCsv/,
    /parseXlsx/,
    /parsePaste/,
    /Import My Costs/,
    /validRows/,
    /copyMutation/,
    /cost items added/,
    /updated/,
    /source === "system"/,
    /aria-label="Save cost"/,
    /aria-label="Delete cost"/,
    /aria-label="Add to My Cost Library"/,
  ],
  "cost library UI can copy system rows and bulk import custom contractor pricing",
);

await expectContains(
  "src/components/estimates/EstimateWorkspace.tsx",
  [
    /Cost Library matches/,
    /Use row/,
    /Mat only/,
    /Labor only/,
    /CostApplyMode/,
    /shouldReplacePlaceholderDescription/,
  ],
  "estimate workspace can apply full, material-only, and labor-only library costs",
);

await expectContains(
  "src/routes/_authenticated/estimates.tsx",
  [
    /Outlet/,
    /useLocation/,
    /\^\\\/estimates\\\/\[\^\/\]\+/,
    /Back to portfolio/,
    /Master Sheets/,
    /MASTER_ESTIMATE_PROJECT_TYPE/,
    /Estimate Folders/,
    /ESTIMATE_FOLDERS/,
    /folderCounts/,
    /deleteEstimate/,
    /Delete Estimate/,
  ],
  "estimate detail route renders its workspace and project estimates stay separate from master sheets with folders and delete controls",
);

await expectContains(
  "src/routes/_authenticated/estimate-masters.tsx",
  [
    /Master Estimate Sheets/,
    /MASTER_ESTIMATE_PROJECT_TYPE/,
    /New Master Sheet/,
    /Project Estimates/,
    /Start with blank rows/,
    /createBlankLineItems/,
    /Create Master Sheet/,
    /window\.location\.assign\(`\/estimates\/\$\{result\.id\}`\)/,
    /window\.location\.assign\(`\/estimates\/\$\{estimate\.id\}`\)/,
  ],
  "estimate master sheets route provides a separate prep workspace",
);

await expectContains(
  "src/components/estimates/EstimateWorkspace.tsx",
  [
    /Import Master Sheet/,
    /Download Import Format/,
    /Excel example \+ instructions/,
    /Add Rows/,
    /\[1,\s*5,\s*10,\s*15\]/,
    /blank rows/,
    /Replace this worksheet/,
    /Add to this worksheet/,
    /createBlankLineItems/,
    /MASTER_ESTIMATE_PROJECT_TYPE/,
    /Create Estimate From Master/,
    /ESTIMATE_FOLDERS/,
    /deleteEstimate/,
    /Delete Estimate/,
    /Delete Master Sheet/,
    /titleRows/,
    /permanently removes/,
    /does not move it to Archived/i,
    /parseEstimateLineRows/,
    /parseCsv/,
    /parseXlsx/,
    /parsePaste/,
    /estimateLineTemplateCsv/,
    /estimateLineTemplateRows/,
    /materialTotal/,
    /laborTotal/,
    /direct/,
    /min-w-\[1720px\] table-fixed/,
    /data-estimate-grid-cell/,
    /handleGridKeyDown/,
    /ArrowDown/,
    /onCreateNextRow/,
  ],
  "estimate workspace UI can bulk import master sheets, move/delete estimates, and keeps the worksheet grid readable",
);

const sql = await readAllMigrationSql();

expectSql(
  sql,
  [
    /alter table public\.estimates[\s\S]*folder varchar\(48\)/i,
    /estimates_folder_check/i,
    /'sales_process'/,
    /'won'/,
    /'not_won'/,
    /idx_estimates_org_folder_updated/i,
    /NOTIFY pgrst, 'reload schema'/i,
  ],
  "estimate folders migration exists for won, not-won, active, and archived bid cleanup",
);

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
    /alter table public\.schedule_updates[\s\S]*data_date/i,
    /schedule_money_exposure/i,
    /tg_schedule_updates_data_date_money/i,
  ],
  "schedule updates and schedule-risk linkage migrations exist with RLS/grants",
);

expectSql(
  sql,
  [
    /create table if not exists public\.schedule_activities/i,
    /activity_id text not null/i,
    /predecessor_activity_ids text\[\]/i,
    /successor_activity_ids text\[\]/i,
    /grant select, insert, update, delete on public\.schedule_activities to authenticated/i,
    /alter table public\.schedule_activities enable row level security/i,
    /schedule_activities_team_select/i,
  ],
  "CPM activity schedule table exists with dependencies, grants, and RLS",
);

expectSql(
  sql,
  [
    /lower\(name\) = 'harbor residence'/i,
    /lower\(coalesce\(name, ''\)\) like '%harbor residence%'/i,
    /lower\(coalesce\(job_number, ''\)\) like '%harbor%'/i,
    /lower\(coalesce\(client, ''\)\) like '%private luxury residence%'/i,
    /activity_id,\s*name,\s*division,\s*start_date,\s*finish_date/i,
    /'01-010'/,
    /'99-010'/,
    /predecessor_activity_ids/i,
    /successor_activity_ids/i,
    /cross join demo_activities/i,
  ],
  "existing Harbor Residence demo projects are backfilled with CPM activities",
);

expectSql(
  sql,
  [
    /create table if not exists public\.project_inspections/i,
    /parent_inspection_id uuid references public\.project_inspections/i,
    /risk_exposure_id uuid references public\.exposures/i,
    /grant select, insert, update, delete on public\.project_inspections to authenticated/i,
    /alter table public\.project_inspections enable row level security/i,
    /project_inspections_team_select/i,
    /public\.can_read_project\(project_id\)/i,
    /public\.can_manage_project\(project_id\)/i,
    /harbor-demo:inspection:electrical-rough-fail/i,
    /harbor-demo:inspection:electrical-rough-reinspection-pass/i,
    /cross join demo_inspections/i,
  ],
  "project inspections table exists with reinspection linkage, RLS/grants, and Harbor backfill rows",
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
    /harbor-beta-cost:sitework:ap-1007/i,
    /harbor-beta-cost:mep:com-221/i,
    /bucket_adjustments/i,
    /actual_to_date = GREATEST\(0, COALESCE\(cb\.actual_to_date, 0\) - ba\.amount\)/i,
    /INSERT INTO public\.cost_actuals/i,
  ],
  "Harbor billing beta sample cost actuals are seeded without inflating WIP totals",
);

expectSql(
  sql,
  [
    /alter table public\.subscription_plans[\s\S]*stripe_price_id/i,
    /alter table public\.organizations[\s\S]*billing_email/i,
    /alter table public\.organizations[\s\S]*stripe_connect_account_id/i,
    /alter table public\.organizations[\s\S]*payment_processor_ready/i,
    /alter table public\.billing_invoices[\s\S]*payment_url/i,
    /alter table public\.billing_invoices[\s\S]*stripe_checkout_session_id/i,
    /alter table public\.payment_ledger[\s\S]*stripe_payment_intent_id/i,
    /repair the Stripe commercial readiness schema/i,
    /stripe_connect_status IN \('not_connected', 'pending', 'active', 'restricted', 'disabled'\)/i,
    /onboarding_started', 'pending_review/i,
    /Stripe Price ID used by Checkout Sessions/i,
    /Contractor Circle users working/i,
  ],
  "Stripe commercial readiness migration stages subscription and invoice payment fields",
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
  "company workspace and non-blocking Contractor Circle grant foundation exists",
);

if (live) {
  await expectLiveRoute("/", [200, 302, 307, 308], "custom domain root responds");
  await expectLiveRoute("/auth", [200, 302, 307, 308], "custom domain auth route responds");
  await expectLiveCommit("/estimates", "custom domain is serving the current Git commit");
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
