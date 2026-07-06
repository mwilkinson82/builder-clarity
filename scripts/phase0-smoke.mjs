#!/usr/bin/env node

import { readFile, readdir, stat } from "node:fs/promises";
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
  const target = path.join(root, relPath);
  const stats = await stat(target);
  if (!stats.isDirectory()) return readFile(target, "utf8");
  const entries = await readdir(target);
  const sources = await Promise.all(
    entries
      .filter((entry) => entry.endsWith(".ts") || entry.endsWith(".tsx"))
      .sort()
      .map((entry) => readFile(path.join(target, entry), "utf8")),
  );
  return sources.join("\n");
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
await expectFile("src/routes/_authenticated/admin.tsx", "Marshall-only admin route");
await expectFile("src/routes/_authenticated/estimates.tsx", "estimates route");
await expectFile("src/routes/_authenticated/estimate-masters.tsx", "estimate master sheets route");
await expectFile("src/routes/_authenticated/estimates.$estimateId.tsx", "estimate workspace route");
await expectFile(
  "src/routes/_authenticated/estimates.$estimateId.plan-room.tsx",
  "estimate plan room route",
);
await expectFile("src/routes/_authenticated/cost-library.tsx", "cost library route");
await expectFile("src/components/estimates/EstimateWorkspace.tsx", "estimate workspace component");
await expectFile(
  "src/components/estimates/plan-room/PlanRoomWorkspace.tsx",
  "plan room workspace component",
);
await expectFile("src/lib/plan-room.functions.ts", "plan room server functions");
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
await expectFile("src/lib/capabilities.ts", "roles capability model");
await expectFile("src/components/team/CapabilityPicker.tsx", "capability picker component");
await expectFile("src/lib/admin.functions.ts", "admin server functions");
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
    /fullPath:\s*'\/admin'/,
    /fullPath:\s*'\/team'/,
    /fullPath:\s*'\/projects\/\$projectId'/,
    /fullPath:\s*'\/client\/projects\/\$projectId'/,
    /fullPath:\s*'\/api\/stripe\/connect\/account-link'/,
    /fullPath:\s*'\/api\/stripe\/checkout\/invoice'/,
    /fullPath:\s*'\/api\/stripe\/checkout\/subscription'/,
    /fullPath:\s*'\/api\/stripe\/webhook'/,
  ],
  "generated route tree includes auth, app-owned magic links, admin, company workspace, project, client portal, and Stripe API routes",
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
    /Portfolio Control Room/,
    /Company-wide IOR posture/,
    /Pipeline intake/,
    /CRM before project control/,
    /Project worklist/,
    /max-w-\[1760px\]/,
    /companyInitials\(headerCompanyName\)/,
  ],
  "portfolio route supports member project creation, responsive ledger navigation, company-scoped identity, and command-center first viewport",
);

await expectNotContains(
  "src/routes/_authenticated/index.tsx",
  [/min-w-\[1420px\]/, /from "@\/components\/ui\/table"/],
  "portfolio project ledger does not use the old forced-width table",
);

await expectContains(
  "src/routes/_authenticated/index.tsx",
  [/readDemoOpportunityRemovals/, /pruneRemovedDemoCrm/, /visibleOpportunities/, /prunedSnapshot/],
  "portfolio Pipeline intake prunes locally-removed sample CRM data so deletions carry through the rollup",
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
  "supabase/migrations/20260705180000_crm_conversion_ior_contingency_seed.sql",
  [
    /FUNCTION public\.seed_project_award_contingency/,
    /'C-Hold'::public\.hold_class/,
    /'other'::public\.exposure_category/,
    /WHERE NOT EXISTS/,
    /PERFORM public\.seed_project_award_contingency/,
  ],
  "CRM conversion seeds the IOR register with an award contingency (CRMCARRY1)",
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
  "src/components/pipeline/OpportunityDetail.tsx",
  [
    /AlertDialogTitle>Delete this opportunity\?/,
    /Remove this sample opportunity\?/,
    /\{opportunity\.name\}/,
    /onDelete/,
    /isDeleting/,
  ],
  "CRM opportunity delete confirms with a dialog that names the record and archives instead of erasing",
);

await expectContains(
  "src/lib/pipeline.functions.ts",
  [
    /planCrmDemoSeed/,
    /select\("id,archived_at"\)/,
    /demo_opted_out/,
    /HARBOR_DEMO_JOB_NUMBER/,
    /Opportunity not found\./,
  ],
  "CRM demo seeder respects the archived Harbor demo opt-out and delete verifies the row before archiving",
);

await expectContains(
  "src/lib/pipeline-demo-seed.ts",
  [/harborDemoSeedAction/, /planCrmDemoSeed/, /archived_at/],
  "CRM demo seed decision lives in a pure module the CRM smoke can unit-test",
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
    /harborDemoSeedAction/,
    /@\/lib\/demo-seed/,
  ],
  "Harbor Residence demo seeds Marshall Wilkinson as PM and self-detects a full CPM activity plan with predecessor and successor logic",
);

// Hotfix (demo hides on delete, never reseeds): the demo identity matchers
// moved to the pure module so the smoke harness can unit-test the opt-out.
await expectContains(
  "src/lib/demo-seed.ts",
  [
    /HARBOR_DEMO_JOB_NUMBER = "DEMO-HARBOR"/,
    /includes\(HARBOR_DEMO_NAME\.toLowerCase\(\)\)/,
    /isHarborDemoProject/,
    /harborDemoSeedAction/,
    /findHarborDemoProject/,
    /archived_at/,
  ],
  "demo opt-out decision lives in the pure demo-seed module (archived demo = seed nothing)",
);

await expectContains(
  "src/lib/projects.functions.ts",
  [
    /select\("id,archived_at"\)/,
    /demoArchived: true/,
    /harborDemoSeedAction\(existingDemo\) === "skip"/,
  ],
  "deleting the Harbor demo archives it and seedDemoIfEmpty respects the archived opt-out",
);

await expectContains(
  "src/lib/projects.functions.ts",
  [
    /listProjects/,
    /ensure_current_user_account/,
    /context\.supabase[\s\S]*\.from\("projects"\)[\s\S]*\.select\("\*"\)/,
    /\.is\("archived_at", null\)/,
  ],
  "portfolio project list uses the authenticated Supabase client so project RLS controls visibility",
);

await expectContains(
  "supabase/migrations/20260623161515_6bcf2ee5-6878-4010-a528-371bff10cc5f.sql",
  [
    /app_super_admins/,
    /public\.is_super_admin\(\)/,
    /CREATE OR REPLACE FUNCTION public\.can_read_project/,
    /p\.owner_id=auth\.uid\(\)/,
    /m\.role IN \('owner','admin','executive'\)/,
    /project_memberships pm/,
    /pm\.status='active'/,
    /Super admins can read all projects/,
  ],
  "project visibility lets Marshall super-admin see all projects while normal users stay owner/org-exec/project-member scoped",
);

await expectContains(
  "supabase/migrations/20260621213000_team_membership_foundation.sql",
  [/CREATE POLICY projects_team_select/, /USING \(public\.can_read_project\(id\)\)/],
  "projects table SELECT policy delegates to can_read_project",
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
    /notifyLogin/,
    /login-notification/,
    /wilkinson\.marshall@gmail\.com/,
    /idempotencyKey:\s*`login-\$\{session\.user\.id\}-/,
  ],
  "auth callback supports code/hash magic links, used-link recovery, and login email notifications",
);

await expectContains(
  "src/lib/email-templates/login-notification.tsx",
  [
    /LOGIN ACTIVITY/,
    /Someone just logged in/,
    /userEmail/,
    /loginAt/,
    /wilkinson\.marshall@gmail\.com/,
  ],
  "login notification email template sends Marshall user, time, method, and device context",
);

await expectContains(
  "src/routes/_authenticated/route.tsx",
  [
    /getSession/,
    /getUser/,
    /continuing with restored session/,
    /sessionData\.session\.user/,
    /recordUserActivity/,
    /ACTIVITY_HEARTBEAT_MS/,
    /overwatch_activity_session_id/,
    /useRouterState/,
    /visibilitychange/,
  ],
  "authenticated route lets restored browser sessions survive refresh and records live activity heartbeats",
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
    /exposureCategoryFromChangeOrder/,
    /toast\.success\("CO sent to risk tally/,
    /toast\.success\("Inspection logged/,
    /shared risk ledger until the inspection table is available/,
    /toast\.success\("Inspection sent to risk tally/,
    /toast\.success\("Linked to-do created/,
    /toast\.success\("Risk deleted/,
    /toast\.success\("Application created/,
    /toast\.success\("Invoice created/,
    /toast\.success\("Payment recorded/,
    /toast\.success\("SOV mapping saved/,
    /toast\.success\("Budget imported/,
  ],
  "project route wires core Phase 0 write paths and success toasts",
);

// PROJECTDECOMP1: the invoice row editor (extracted from the project route)
// owns the invoice write paths — record payment, PDF download, email queue,
// and the online-pay readiness copy. Behavior unchanged, new home.
await expectContains(
  "src/components/project/billing/BillingInvoiceRowEditor.tsx",
  [
    /export function BillingInvoiceRowEditor/,
    /Record payment/,
    /generateInvoicePdf/,
    /Invoice PDF downloaded/,
    /enqueueInvoiceEmail/,
    /invoice-notification/,
    /Invoice email queued/,
    /Client can pay online/,
    /Manual\/email only/,
  ],
  "extracted invoice row editor owns the invoice write paths and readiness copy",
);

await expectNotContains(
  "src/routes/_authenticated/projects.$projectId.tsx",
  [
    /Finish payment setup/,
    /Enable online pay/,
    /Online pay links unlock after Stripe Connect/,
    /invoice\.payment_enabled &&\s*invoice\.payment_url/,
  ],
  "pre-Phase-1 payment vestiges stay removed from the billing workspace (BILLINGBATCH1)",
);

// GETTINGPAID2: the portal Viewed stamp fires only on an explicit invoice
// open through the shared hook — the recording path must never fall back to
// the display-default invoice, and internal-team sessions never count.
await expectContains(
  "src/routes/_authenticated/client.projects.$projectId.tsx",
  [/useInvoiceViewSignal\(/, /selectedInvoiceId,/],
  "portal viewed signal records through the explicit-open hook (GETTINGPAID2)",
);
await expectNotContains(
  "src/routes/_authenticated/client.projects.$projectId.tsx",
  [/visibleInvoices\[0\]/, /viewedInvoiceId/],
  "portal viewed recording never falls back to the display-default invoice (GETTINGPAID2)",
);
await expectContains(
  "src/lib/client-portal.functions.ts",
  [
    /recordInvoicePortalView/,
    /can_view_client_billing/,
    /if \(clientBillingRes\.error \|\| !clientBillingRes\.data\) return \{ ok: true, recorded: false \};/,
    /if \(!internalRes\.error && internalRes\.data\) return \{ ok: true, recorded: false \};/,
  ],
  "portal view recording counts only genuine client sessions, never internal team views",
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
    // Billing is lazy-loaded (PROJECTDECOMP1 part 3): the rail hosts a Suspense
    // boundary and the workspace itself lives in its own module (pinned below).
    /const BillingWorkspace = lazy\(/,
    /<Suspense/,
  ],
  "workspace-heavy project tabs open a wide rail layout with labeled icon tooltips",
);

// PROJECTDECOMP1 part 3: the billing workspace — stage rail (overview / costs /
// pay apps / WIP), the enhanced-panel gate, the ledgers, and the invoice write
// paths — lives in its own lazy-loaded module. Behavior unchanged, new home.
await expectContains(
  "src/components/project/billing/BillingWorkspace.tsx",
  [
    /export function BillingWorkspace/,
    /BillingStageRail/,
    /value=\{billingStage\}/,
    /stages=\{billingStages\}/,
    /title: "Overview"/,
    /title: "Costs"/,
    /title: "Pay Applications"/,
    /title: "WIP"/,
    /Invoices & Payments/,
    /Pending COs/,
    /Pending change orders: not billable yet/,
    /ChangeOrderAllocationPanel/,
    /A\/R Ledger/,
    /renderEnhancedBillingPanel/,
    /BillingLineItemsPanel/,
    /ProjectCostTrackingPanel/,
    /WipAnalysisPanel/,
    /Client payment readiness/,
    /Billing recipients/,
    /methodAvailability\(/,
    /resolveEnabledMethods\(/,
    /changeOrderAllocations/,
  ],
  "lazy-loaded billing workspace owns the stage rail, ledgers, and invoice write paths",
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
    /Applications: progress billing/,
    /Complete to date %/,
    /Change orders in this application/,
    // GETTINGPAID3: the AIA path is a persistent stepper, and overbilled
    // lines are flagged at entry (soft warning, not a block).
    /AiaApplicationStepper/,
    /overbilledLines/,
    /lenders typically reject lines over/,
    // BILLING P1a: the prior-billing memory is named — this bill is carried
    // forward from the previous application, so the biller can trust it.
    /Carried forward from/,
    /Overwatch remembers the rest/,
    /Cost ledger: job-cost backup/,
    /Cost code health/,
    /Cost transaction backup/,
    /WIP review \(Work in Progress\)/,
    /Revenue timing/,
    /Profit forecast/,
    /Export function|export function BillingLineItemsPanel/i,
    /export function ProjectCostTrackingPanel/,
    /export function WipAnalysisPanel/,
  ],
  "billing enhancement panels expose application progress, project cost tracking, and WIP sections with production wording",
);

await expectContains(
  "src/lib/billing-labels.ts",
  [/normalizeBillingNumberLabel/, /LEADING_ZERO_NUMBER_TOKEN/, /billingDocumentLabel/],
  "billing document labels normalize generated-looking leading zeroes before rendering or export",
);

// GETTINGPAID3: the builder guides with a persistent stepper — every step
// present, disabled-with-reason, never absent — and the generate gate lives
// in a pure, shared module.
await expectContains(
  "src/components/billing/AiaApplicationStepper.tsx",
  [
    /aiaBuilderSteps/,
    /aiaGenerateGate/,
    /routeToBlockingStep/,
    /Confirm & download anyway/,
    /Import from SOV/,
    /Go to step/,
    // BILLING P1b: finalize + email the package to the client from the flow.
    /Email to client/,
    // BILLING P1c: the SOV step cues the biller to bill the contract schedule,
    // not the cost budget — so a budget-generated SOV isn't billed at cost.
    /contract schedule of values/,
  ],
  "AIA application stepper keeps every step visible and routes blocked generate clicks",
);
// BILLING P1b: email the finalized application to the client via the same proven
// transactional-send path invoices use (portal link now, PDF attachment next).
await expectContains(
  "src/components/billing/BillingEnhancements.tsx",
  [/sendTransactionalEmail/, /invoice-notification/, /Application emailed/, /recipientEmails/],
  "pay-app flow can email the finalized package to the client billing contact",
);
await expectContains(
  "src/lib/aia-builder-steps.ts",
  [/aiaGenerateGate/, /blockingStep/, /Import your schedule of values first/],
  "AIA builder gate is a pure module shared by the stepper and the tests",
);

// GETTINGPAID1: the AIA package is lender-grade — G702 face with lines 1-9
// including the retainage split, certification + notary + architect blocks,
// and the full G703 column set, all reconciling through aia-math.
await expectContains(
  "src/lib/aia-pdf.ts",
  [
    /billingDocumentLabel/,
    /APPLICATION AND CERTIFICATE FOR PAYMENT/,
    /CONTINUATION SHEET/,
    /To \(Owner\)/,
    /From \(Contractor\)/,
    /Via \(Architect\)/,
    /CONTRACTOR'S APPLICATION FOR PAYMENT/,
    /Of completed work/,
    /Of stored material/,
    /Total earned less retainage \(4 - 5\)/,
    /Less previous certificates for payment/,
    /Balance to finish, incl\. retainage \(3 - 6\)/,
    /CHANGE ORDER SUMMARY/,
    /CONTRACTOR'S CERTIFICATION/,
    /NOTARY/,
    /My commission expires/,
    /ARCHITECT'S CERTIFICATE FOR PAYMENT/,
    /AMOUNT CERTIFIED/,
    /computeG702Face/,
    /computeG703Rows/,
    /computePreviousCertificatesCents/,
    // GETTINGPAID3 Task 3: the from-previous column letter is "D" (the
    // standard form's G = D+E+F), not "D+E".
    /letter: "D",/,
    /Materials Presently Stored/,
    /GRAND TOTALS/,
    /getContinuationColumns/,
    /aia-pay-application-package\.pdf/,
  ],
  "application PDF generator produces the lender-grade G702/G703 package",
);
await expectNotContains(
  "src/lib/aia-pdf.ts",
  [/letter: "D\+E"/],
  "G703 from-previous column uses the standard letter D, not D+E (GETTINGPAID3)",
);

// The AIA-download field bug: revoking the blob URL synchronously after
// anchor.click() silently cancels the download in Safari/iOS. Every download
// helper must delegate to the shared safe path, and that path must revoke on
// a delay. Do not let a "cleanup" reintroduce the race.
await expectContains(
  "src/lib/download-file.ts",
  [
    /setTimeout\(\(\) => URL\.revokeObjectURL\(url\), REVOKE_DELAY_MS\)/,
    /REVOKE_DELAY_MS = 60_000/,
  ],
  "shared download helper revokes blob URLs on a delay (Safari/iOS download fix)",
);
await expectContains(
  "src/lib/aia-pdf.ts",
  [/downloadFileBytes\(bytes, filename, "application\/pdf"\)/],
  "AIA package download delegates to the shared safe download path",
);

await expectContains(
  "src/lib/aia-math.ts",
  [
    /computeG703Row/,
    /computeG703Totals/,
    /computeG702Face/,
    /retainageCompletedWorkCents/,
    /retainageStoredMaterialCents/,
    /percentOfCents/,
    // GETTINGPAID3: overbilling detection (G > C) lives in the same module.
    /export function overbilledLines/,
  ],
  "AIA arithmetic is a pure cents module shared by the PDF and the tests",
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
    /team\?\.isSuperAdmin/,
    /<Link to="\/admin">/,
    /CapabilityPicker/,
    /accessLabelForMember/,
    /ROLE_PRESETS/,
    /PlanReadinessPanel/,
    /Plan and payment readiness/,
    /Commercial setup/,
    /Payments are managed in Getting Paid/,
    /Overwatch subscription/,
    /billingContactMutation/,
    /stripeConnectMutation/,
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

await expectNotContains(
  "src/routes/_authenticated/team.tsx",
  [/data-testid="company-live-activity"/, /CompanyActivityPanel/, /TeamActivitySession/],
  "company workspace does not expose the live activity roster",
);

await expectNotContains(
  "src/routes/_authenticated/team.tsx",
  [/Payment readiness/, /Contractor payout account/, /CommerceReadinessItem/],
  "legacy payment readiness panel stays consolidated into the Getting Paid section",
);

await expectContains(
  "src/routes/_authenticated/admin.tsx",
  [
    /createFileRoute\("\/_authenticated\/admin"\)/,
    /getIsSuperAdmin/,
    /getOverwatchAdminWorkspace/,
    /data-testid="overwatch-admin-live-activity"/,
    /refetchInterval:\s*30_000/,
    /Active users/,
  ],
  "super-admin-only admin page shows live site activity",
);

await expectNotContains(
  "src/routes/_authenticated/admin.tsx",
  [/isOverwatchAdminEmail/],
  "admin route asks the database's is_super_admin instead of a client-side email list",
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
    /recordUserActivity/,
    /user_activity_presence/,
    /schema_missing/,
  ],
  "company workspace server functions expose billing readiness and keep heartbeat recording with schema-cache fallback",
);

await expectContains(
  "src/lib/capabilities.ts",
  [
    /projects\.view_assigned/,
    /projects\.view_all/,
    /projects\.manage/,
    /financials\.view/,
    /company\.manage_team/,
    /company\.manage_settings/,
    /ROLE_PRESETS/,
    /seedCapabilitiesForRole/,
    /accessLabelForMember/,
    /Custom \(based on/,
  ],
  "capability model defines the twelve flags, role presets, and custom labeling",
);

await expectContains(
  "src/lib/admin.functions.ts",
  [
    /requireOverwatchAdmin/,
    /is_super_admin/,
    /getIsSuperAdmin/,
    /supabaseAdmin/,
    /user_activity_presence/,
    /schemaReady/,
    /activeWindowSeconds/,
  ],
  "admin server function gates service-role activity reads behind the database super-admin list",
);

await expectContains(
  "supabase/migrations/20260703070000_roles_capabilities_foundation.sql",
  [
    /ADD COLUMN IF NOT EXISTS capabilities jsonb NOT NULL DEFAULT '\{\}'::jsonb/,
    /role_preset_capabilities/,
    /tg_membership_capabilities_default/,
    /\|\| jsonb_build_object\('projects\.view_all', true\)/,
    /WHERE capabilities = '\{\}'::jsonb/,
  ],
  "capabilities foundation migration stores flags, presets, and the behavior-preserving seed",
);

await expectContains(
  "supabase/migrations/20260703070100_roles_capability_enforcement.sql",
  [
    /has_org_capability/,
    /can_view_financials/,
    /'projects\.view_all'/,
    /'projects\.view_assigned'/,
    /'projects\.manage'/,
    /"company\.manage_team": true/,
    /NULLIF\(v_invite\.capabilities, '\{\}'::jsonb\)/,
  ],
  "capability enforcement migration rewrites access helpers without touching any RLS policy",
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
    // Payments Phase 1: sessions became DIRECT charges created on the
    // connected account (Stripe-Account header) per the spec and Stripe's
    // Connect docs, replacing the destination-charge transfer_data pin.
    /stripe_connect_account_id/,
    /Stripe-Account header/,
    /payment_intent_data\[application_fee_amount\]/,
  ],
  "invoice checkout route creates guarded direct-charge sessions on the connected account and records payment link state",
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

// ---------------- Payments Phase 1: direct remittance + Stripe tiers ----------------

await expectFile("src/lib/payments-domain.ts", "payments domain module (pure money logic)");
await expectFile("src/lib/payments.functions.ts", "company payment profile server functions");
await expectFile("src/components/billing/GettingPaidSection.tsx", "Getting paid settings section");
await expectFile("src/components/billing/HowToPayBlock.tsx", "client-facing How to pay block");
await expectFile(
  "src/components/billing/InvoicePaymentMethodToggles.tsx",
  "per-invoice payment method toggles",
);
await expectFile("src/components/billing/StripeConnectNudge.tsx", "billing dashboard Stripe nudge");
await expectFile("scripts/billing-payments-smoke.ts", "billing payments unit suite");
await expectFile("docs/phases/STRIPEPHASE1.md", "Payments Phase 1 spec");

await expectContains(
  "src/lib/payments-domain.ts",
  [
    /initialPaymentState/,
    /canTransitionPayment/,
    /invoicePaymentTotals/,
    /isOverRecording/,
    /methodAvailability/,
    /resolveEnabledMethods/,
    /renderRemittanceMemo/,
    /maskAccountTail/,
    /estimatedCardFeeCents/,
    /planCheckoutCompletion/,
    /DEFAULT_STRIPE_AMOUNT_THRESHOLD_CENTS/,
    /2_500_000/,
  ],
  "payments domain keeps the state machine, cents math, availability matrix, and $25k guardrail pure and testable",
);

await expectContains(
  "src/lib/payments.functions.ts",
  [
    /organization_payment_profiles/,
    /billing\.manage/,
    /company\.manage_settings/,
    /getCompanyPaymentProfile/,
    /revealCompanyPaymentProfile/,
    /saveCompanyPaymentProfile/,
    /getInvoiceRemittance/,
    /getPaymentMethodContext/,
  ],
  "payment profile server functions gate on billing/settings capabilities and keep bank numbers masked by default",
);

await expectContains(
  "src/components/billing/GettingPaidSection.tsx",
  [
    /Getting paid/,
    /Stripe verifies new businesses/,
    /Reveal saved numbers/,
    /Direct bank transfer details/,
    /Ready for card & bank-debit payments/,
    /Verification in progress/,
    /Not connected/,
    /Connect Stripe/,
    /Billing contact/,
    /Save billing contact/,
    /subscriptionNote/,
    /id="getting-paid"/,
  ],
  "Getting paid section is the single payments home: remittance entry, masked reveal, honest Connect states, billing contact, and the founder's expectation copy",
);

await expectContains(
  "src/routes/api/stripe/webhook.ts",
  [
    /stripe_webhook_events/,
    /claimWebhookEvent/,
    /releaseWebhookEvent/,
    /duplicate: true/,
    /planCheckoutCompletion/,
    /surcharge_cents/,
    // ACH debits settle asynchronously: completed-but-unpaid sessions wait
    // for async_payment_succeeded before any payment is booked.
    /checkout\.session\.async_payment_succeeded/,
    /checkout\.session\.async_payment_failed/,
    /checkoutSessionOutcome/,
  ],
  "Stripe webhook stores processed event ids, no-ops duplicates with 2xx, books payments through the domain plan, and waits out async ACH settlement",
);

await expectContains(
  "src/lib/stripe.server.ts",
  [/STRIPE_CONNECT_WEBHOOK_SECRET/, /STRIPE_WEBHOOK_TOLERANCE_SECONDS/, /Stripe-Account/],
  "Stripe server helper verifies both endpoint scopes' signing secrets, enforces replay tolerance, and supports direct charges",
);

await expectContains(
  "src/routes/api/stripe/checkout/invoice.ts",
  [
    /payment_method_types/,
    /us_bank_account/,
    /can_view_client_billing/,
    /payment_method_not_available/,
    /Card processing fee \(estimated\)/,
    /resolveEnabledMethods/,
    /methodAvailability/,
  ],
  "invoice checkout honors per-invoice method toggles and the amount guardrail, and lets billing-visible clients pay",
);

await expectContains(
  "src/routes/_authenticated/client.projects.$projectId.tsx",
  [/HowToPayBlock/, /startInvoiceCheckout/, /invoicePaymentOptions/],
  "client portal renders the How to pay block and starts Stripe checkout server-side",
);

await expectContains(
  "src/routes/_authenticated/billing.tsx",
  [/StripeConnectNudge/],
  "billing dashboard nudges early Stripe connection while none is connected",
);

await expectContains(
  "src/lib/invoice-pdf.ts",
  [/How to pay - direct bank transfer/, /InvoicePdfRemittance/, /Payment reference/i],
  "invoice PDF carries the direct bank remittance block when enabled",
);

await expectContains(
  "package.json",
  [/"test:billing":/],
  "billing payments unit suite is wired into the gate",
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
  "src/components/schedule",
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
    // Payments Phase 1: the payment CTA moved from an inline "Pay invoice
    // online" link into the HowToPayBlock component (remittance + Stripe).
    /HowToPayBlock/,
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
    /table-fixed/,
    /colSpan=\{5\}/,
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

await expectNotContains(
  "src/routes/_authenticated/cost-library.tsx",
  [/min-w-\[1480px\]/],
  "cost library main table avoids forced horizontal scrolling",
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
  "src/routes/_authenticated/estimates.$estimateId.tsx",
  [/useChildMatches/, /<Outlet \/>/, /EstimateDetailRoute/, /EstimateWorkspace/],
  "estimate detail route renders nested estimate workspaces such as Plan Room",
);

await expectContains(
  "src/routes/_authenticated/estimates.tsx",
  [
    /Outlet/,
    /useLocation/,
    /\^\\\/estimates\\\/\[\^\/\]\+/,
    /Back to portfolio/,
    /Master Sheets/,
    /filters master sheets out server-side/,
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
    /listMasterSheets/,
    /kind: "master_sheet"/,
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
    /Plan Room/,
    /\/estimates\/\$estimateId\/plan-room/,
    /Import Master Sheet/,
    /Download Import Format/,
    /Excel example \+ instructions/,
    /Add Rows/,
    /\[1,\s*5,\s*10,\s*15\]/,
    /blank rows/,
    /Replace this worksheet/,
    /Add to this worksheet/,
    /createBlankLineItems/,
    /kind === "master_sheet"/,
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

await expectContains(
  "src/routes/_authenticated/estimates.$estimateId.plan-room.tsx",
  [
    /createFileRoute\("\/_authenticated\/estimates\/\$estimateId\/plan-room"\)/,
    /getEstimate/,
    /getPlanRoom/,
    /PlanRoomWorkspace/,
    /schemaReady/,
    /schemaMessage/,
  ],
  "estimate plan room route loads the estimate, takeoff data, and workspace",
);

await expectContains(
  "src/components/estimates/plan-room/PlanRoomWorkspace.tsx",
  [
    /Upload Plans/,
    /Area/,
    /Count/,
    /Command Center/,
    /plan-command-center-toggle/,
    /plan-cockpit-room-controls/,
    /plan-cockpit-status-badges/,
    /plan-cockpit-drawings-toggle/,
    /plan-cockpit-tools-toggle/,
    /plan-cockpit-show-panels/,
    /plan-cockpit-hide-panels/,
    /plan-cockpit-focus-toggle/,
    /plan-cockpit-controls-restore/,
    /plan-cockpit-sheet-strip/,
    /plan-cockpit-prev-sheet/,
    /plan-cockpit-sheet-select/,
    /plan-cockpit-next-sheet/,
    /plan-cockpit-sheet-scale-status/,
    /plan-cockpit-sheet-mark-count/,
    /plan-cockpit-drawings-close/,
    /plan-cockpit-tools-close/,
    /plan-cockpit-drawings-drag/,
    /plan-cockpit-tools-drag/,
    /plan-cockpit-drawings-reset/,
    /plan-cockpit-tools-reset/,
    /plan-cockpit-drawings-resize/,
    /plan-cockpit-tools-resize/,
    /readCockpitPanelLayoutStorage/,
    /COCKPIT_CHROME_PANEL_TOP_GAP/,
    /TakeoffLayerVisibility/,
    /measurementMatchesTakeoffLayers/,
    /takeoff-layer-controls/,
    /takeoff-layer-summary/,
    /takeoff-layer-show-all/,
    /takeoff-layer-hide-all/,
    /plan-room-main/,
    /plan-cockpit-drawing-stage/,
    /fixed inset-0 z-50 min-h-0 overflow-hidden/,
    /absolute inset-0 grid-cols-1 overflow-hidden p-0/,
    /Clean view/,
    /CockpitFloatingPanelHeader/,
    /Revision Overlay/,
    /plan-revision-overlay-select/,
    /plan-revision-opacity/,
    /plan-revision-mode-controls/,
    /Selected Takeoff/,
    /selected-takeoff-inspector/,
    /selected-takeoff-edit-guidance/,
    /selected-takeoff-quantity-input/,
    /selected-takeoff-recalculate/,
    /selected-takeoff-unit-input/,
    /selected-takeoff-color-picker/,
    /selected-takeoff-save-details/,
    /calibration-distance-presets/,
    /Save Details/,
    /copyTextToClipboard/,
    /downloadTakeoffCsv/,
    /copyTakeoffSummary/,
    /supabase\.storage[\s\S]*\.from\(planRoomBucket\)[\s\S]*\.upload/,
    /calculateQuantity/,
    /createTakeoffMeasurement/,
    /syncTakeoffToEstimateLine/,
    /schemaReady/,
    /Plan Room backend is still coming online/,
  ],
  "plan room workspace supports upload, zoom, scale, takeoff tools, source markup, and estimate sync (PlanRoomWorkspace shell)",
);

await expectContains(
  "src/components/estimates/plan-room/PdfSheetViewer.tsx",
  [
    /plan-viewport/,
    /plan-zoom-in/,
    /plan-fit-sheet/,
    /plan-zoom-window/,
    /plan-fit-width/,
    /plan-fit-height/,
    /plan-zoom-slider/,
    /plan-zoom-window-draft/,
    /plan-render-quality/,
    /plan-minimap/,
    /plan-minimap-toggle/,
    /plan-cockpit-command-deck/,
    /plan-cockpit-sheet-controls/,
    /plan-cockpit-floating-controls/,
    /plan-cockpit-floating-takeoff-tools/,
    /PdfDetailMode/,
    /DEFAULT_PDF_DETAIL_MODE/,
    /PDF_DETAIL_OPTIONS/,
    /plan-pdf-detail-controls/,
    /absolute inset-x-2 top-2 z-30/,
    /handleKeyboard/,
    /PageUp/,
    /PageDown/,
    /PDF_HIGH_DETAIL_RENDER_MAX_PIXELS/,
    /PDF_INSPECTION_RENDER_MULTIPLIER/,
    /plan-pdf-inspection-mode/,
    /plan-open-original-pdf/,
    /Open Source PDF/,
    /pdfRenderLimits/,
    /pdfRenderScaleFor/,
    /pdfRenderWidth/,
    /cursor-grab/,
    /plan-revision-overlay-layer/,
    /pdfjs-dist\/build\/pdf\.worker\.min\.mjs\?url/,
    /HARBOR RESIDENCE/,
  ],
  "plan room workspace supports upload, zoom, scale, takeoff tools, source markup, and estimate sync (PdfSheetViewer)",
);

await expectContains(
  "src/components/estimates/plan-room/TakeoffTools.tsx",
  [
    /takeoff-measurement-shape/,
    /data-takeoff-tool/,
    /data-takeoff-linked/,
    /takeoff-draft-hud/,
    /takeoff-draft-live-quantity/,
    /takeoff-draft-point-label/,
    /takeoff-draft-segment-label/,
    /takeoff-draft-command-label/,
    /takeoff-edit-handles/,
    /takeoff-edit-handle/,
    /takeoff-undo-point/,
    /takeoff-clear-points/,
  ],
  "plan room workspace supports upload, zoom, scale, takeoff tools, source markup, and estimate sync (TakeoffTools)",
);

await expectContains(
  "src/components/estimates/plan-room/TakeoffWorksheet.tsx",
  [
    /Takeoff Worksheet/,
    /takeoff-report-actions/,
    /takeoff-copy-summary/,
    /takeoff-copy-fallback/,
    /takeoff-export-csv/,
    /takeoff-navigator/,
    /takeoff-search/,
    /takeoff-filter-controls/,
    /takeoff-filter-unlinked/,
    /takeoff-navigator-row/,
    /takeoff-open-on-plan/,
    /centers\s+the markup/,
    /Estimate Sync/,
    /Send Total Qty to Estimate/,
  ],
  "plan room workspace supports upload, zoom, scale, takeoff tools, source markup, and estimate sync (TakeoffWorksheet)",
);

await expectContains(
  "src/components/estimates/plan-room/SheetSidebar.tsx",
  [
    /plan-minimap-frame/,
    /plan-minimap-drag-handle/,
    /plan-minimap-move/,
    /plan-minimap-dock/,
    /plan-minimap-collapse/,
    /plan-minimap-collapsed/,
    /plan-sheet-finder/,
    /plan-sheet-search/,
    /plan-sheet-filter-controls/,
    /plan-sheet-filter-needs-scale/,
    /plan-sheet-filter-has-takeoff/,
    /plan-sheet-row/,
    /Sheet Map/,
    /Show Map/,
    /Corner/,
  ],
  "plan room workspace supports upload, zoom, scale, takeoff tools, source markup, and estimate sync (SheetSidebar)",
);

await expectContains(
  "src/components/estimates/plan-room/ReadinessPanel.tsx",
  [
    /takeoff-readiness-checklist/,
    /takeoff-readiness-ready/,
    /takeoff-readiness-issues/,
    /takeoff-readiness-open-unscaled/,
    /takeoff-readiness-show-unlinked/,
    /takeoff-readiness-show-markups/,
  ],
  "plan room workspace supports upload, zoom, scale, takeoff tools, source markup, and estimate sync (ReadinessPanel)",
);

await expectContains(
  "src/components/estimates/plan-room/planRoomShared.ts",
  [
    /Set Scale/,
    /Linear/,
    /takeoff-layer-linear/,
    /takeoff-layer-area/,
    /takeoff-layer-count/,
    /takeoff-layer-linked/,
    /takeoff-layer-unlinked/,
    /plan-pdf-detail-fast/,
    /plan-pdf-detail-sharp/,
    /plan-pdf-detail-max/,
    /Finish Linear/,
    /Finish Count/,
    /Sharp PDF/,
    /buildTakeoffCsvRows/,
  ],
  "plan room workspace supports upload, zoom, scale, takeoff tools, source markup, and estimate sync (planRoomShared)",
);

await expectNotContains(
  "src/components/estimates/plan-room/PlanRoomWorkspace.tsx",
  [/plan-cockpit-header/],
  "plan room command center does not render a separate page header over the drawing (PlanRoomWorkspace shell)",
);

await expectNotContains(
  "src/components/estimates/plan-room/PdfSheetViewer.tsx",
  [/plan-cockpit-header/],
  "plan room command center does not render a separate page header over the drawing (PdfSheetViewer)",
);

await expectNotContains(
  "src/components/estimates/plan-room/TakeoffTools.tsx",
  [/plan-cockpit-header/],
  "plan room command center does not render a separate page header over the drawing (TakeoffTools)",
);

await expectNotContains(
  "src/components/estimates/plan-room/TakeoffWorksheet.tsx",
  [/plan-cockpit-header/],
  "plan room command center does not render a separate page header over the drawing (TakeoffWorksheet)",
);

await expectNotContains(
  "src/components/estimates/plan-room/SheetSidebar.tsx",
  [/plan-cockpit-header/],
  "plan room command center does not render a separate page header over the drawing (SheetSidebar)",
);

await expectNotContains(
  "src/components/estimates/plan-room/ReadinessPanel.tsx",
  [/plan-cockpit-header/],
  "plan room command center does not render a separate page header over the drawing (ReadinessPanel)",
);

await expectNotContains(
  "src/components/estimates/plan-room/planRoomShared.ts",
  [/plan-cockpit-header/],
  "plan room command center does not render a separate page header over the drawing (planRoomShared)",
);

await expectContains(
  "src/lib/plan-room.functions.ts",
  [
    /estimate_plan_sets/,
    /estimate_plan_sheets/,
    /estimate_takeoff_measurements/,
    /ensureHarborPlanRoomDemo/,
    /Harbor Residence - Permit Set/,
    /createPlanSet/,
    /createTakeoffMeasurement/,
    /updatePlanSheet/,
    /previousLineId/,
    /nextLineId/,
    /syncTakeoffQuantityToLine/,
    /recalculateEstimateTotalsInternal/,
    /calculateEstimateTotals/,
    /isMissingPlanRoomSchemaError/,
    /schema_ready/,
  ],
  "plan room server functions seed Harbor sample drawings and sync takeoff quantities into estimates",
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
    /create table if not exists public\.estimate_plan_sets/i,
    /create table if not exists public\.estimate_plan_sheets/i,
    /create table if not exists public\.estimate_takeoff_measurements/i,
    /estimate_line_item_id uuid references public\.estimate_line_items\(id\) on delete set null/i,
    /grant select, insert, update, delete on public\.estimate_plan_sets to authenticated/i,
    /grant select, insert, update, delete on public\.estimate_takeoff_measurements to authenticated/i,
    /alter table public\.estimate_plan_sets enable row level security/i,
    /alter table public\.estimate_takeoff_measurements enable row level security/i,
    /insert into storage\.buckets[\s\S]*'plan-room'/i,
    /create policy plan_room_storage_team_insert/i,
    /public\.storage_estimate_id\(name\)/i,
    /NOTIFY pgrst, 'reload schema'/i,
  ],
  "plan room migration exists with takeoff tables, estimate-row links, storage bucket, grants, RLS, and schema reload",
);

expectSql(
  sql,
  [
    /create or replace function public\.can_read_estimate\(p_estimate_id uuid\)/i,
    /create or replace function public\.can_manage_estimate\(p_estimate_id uuid\)/i,
    /public\.can_manage_estimate\(estimate_id\)/i,
    /created_by is null or created_by = \(select auth\.uid\(\)\)/i,
    /create policy plan_room_storage_team_insert[\s\S]*public\.can_manage_estimate\(public\.storage_estimate_id\(name\)\)/i,
    /regexp_split_to_array\(coalesce\(p_name, ''\), '\/'\)/i,
  ],
  "plan room RLS allows authorized estimate uploads without weakening bucket scope",
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
    /create table if not exists public\.user_activity_presence/i,
    /client_session_id text not null/i,
    /last_seen_at timestamptz not null default now\(\)/i,
    /user_activity_presence_session_unique/i,
    /grant select, insert, update, delete on public\.user_activity_presence to authenticated/i,
    /alter table public\.user_activity_presence enable row level security/i,
    /user_activity_presence_select_self_or_super_admin/i,
    /public\.is_super_admin\(\)/i,
    /public\.is_org_member\(organization_id\)/i,
    /NOTIFY pgrst, 'reload schema'/i,
  ],
  "user activity presence table exists with heartbeat uniqueness, grants, and admin-scoped roster reads",
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
    /create table if not exists public\.organization_payment_profiles/i,
    /remittance_memo_template/i,
    /stripe_amount_threshold_cents bigint not null default 2500000/i,
    /card_fee_pass_through/i,
    /alter table public\.organization_payment_profiles enable row level security/i,
    /has_org_capability\(organization_id, 'billing\.manage'\)/i,
    /has_org_capability\(organization_id, 'company\.manage_settings'\)/i,
    /alter table public\.payment_ledger[\s\S]*amount_cents bigint not null default 0/i,
    /add column if not exists reference text not null default ''/i,
    /enabled_payment_methods jsonb not null default '\{\}'::jsonb/i,
    /create table if not exists public\.stripe_webhook_events/i,
    /event_id text primary key/i,
  ],
  "Payments Phase 1 migrations stage the payment profile, integer-cents ledger, per-invoice method toggles, and webhook idempotency",
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

// CO-ALLOCATION: approved change orders become billable only once allocated
// to an SOV cost code. The math is a pure, cents-safe, node-loadable module;
// the server fns verify bucket+CO ownership before writing; the panel guides
// the allocate step and refuses uncoded lines.
await expectContains(
  "src/lib/change-order-allocation.ts",
  [
    /allocatedContractByChangeOrder/,
    /unallocatedContract/,
    /summarizeApprovedCo/,
    /fullyAllocated/,
    /dollarsToCents/,
    /from "\.\/payments-domain\.ts"/,
  ],
  "change-order allocation math is a pure, cents-safe, node-loadable module",
);
await expectContains(
  "src/components/billing/ChangeOrderAllocationPanel.tsx",
  [
    /export function ChangeOrderAllocationPanel/,
    /Allocate to cost code/,
    /Add cost codes to your SOV lines first/,
    /to allocate/,
    /G702 line 2/,
    /codedBuckets/,
  ],
  "change-order allocation panel guides the allocate step and blocks uncoded lines",
);
await expectContains(
  "src/lib/projects.functions.ts",
  [
    /allocateChangeOrder/,
    /deleteChangeOrderAllocation/,
    /change_order_allocations/,
    /changeOrderAllocationInput/,
  ],
  "change-order allocation server fns verify ownership and write to change_order_allocations",
);
await expectContains(
  "src/routes/_authenticated/projects.$projectId.tsx",
  [/ChangeOrderAllocationPanel/, /allocateChangeOrderFn/, /deleteChangeOrderAllocationFn/],
  "project billing workspace wires the change-order allocation panel and mutations",
);

// The Harbor demo seed is coherent: cost-coded SOV lines and one approved CO
// already allocated to a cost code, so line 2 is non-zero out of the box.
expectSql(
  sql,
  [
    /CREATE OR REPLACE FUNCTION public\.seed_demo_project/,
    /cost_buckets \(project_id, bucket, cost_code, original_budget/,
    /INSERT INTO public\.change_order_allocations/,
    /CO-002 - Upgraded primary bath stone package/,
  ],
  "Harbor demo seed gives SOV lines cost codes and pre-allocates CO-002 to Finishes",
);

// Billing artifacts created before their bucket was coded get their cost code
// mirrored from the parent SOV line — blank-only, coded-bucket-only, global.
expectSql(
  sql,
  [
    /UPDATE public\.billing_line_items li[\s\S]*SET cost_code = cb\.cost_code/,
    /UPDATE public\.cost_actuals ca[\s\S]*SET cost_code = cb\.cost_code/,
    /COALESCE\(NULLIF\(TRIM\(cb\.cost_code\), ''\), ''\) <> ''/,
  ],
  "cost-code backfill mirrors billing line items and cost actuals from their coded buckets",
);

// POLISH1 Task 4: empty tables teach — one shared EmptyState (icon + what the
// table is for + the action that fills it) across the IOR tables.
await expectContains(
  "src/components/ui/empty-state.tsx",
  [/export function EmptyState/, /icon\?:/, /action\?:/, /title/, /description/],
  "shared EmptyState component gives empty tables an instruction and an action slot",
);
await expectContains(
  "src/components/outcome/ChangeOrdersTable.tsx",
  [/EmptyState/, /No change orders yet/, /Add change order/],
  "change orders table teaches and offers add when empty",
);
await expectContains(
  "src/components/outcome/ExposuresTable.tsx",
  [/EmptyState/, /No risk allocations yet/, /Add risk/],
  "risk table teaches and offers add when empty",
);
await expectContains(
  "src/components/outcome/CostBucketsTable.tsx",
  [/EmptyState/, /No budget lines yet/, /Import budget/],
  "budget lines table teaches the import/add path when empty",
);

// POLISH1 Task 3 (density): the rarely-opened reference tabs (inspections, IOR
// report, daily reports) collapse under a "More" menu so the financial path
// leads the rail; deep links (?tab=…) still resolve to the demoted tabs.
await expectContains(
  "src/routes/_authenticated/projects.$projectId.tsx",
  [
    /SECONDARY_PROJECT_NAV_TABS = new Set<ProjectTabValue>\(\[\s*"inspections",\s*"ior-report",\s*"daily-reports",/,
    /primaryNavItems\.map/,
    /secondaryNavItems\.map/,
    /DropdownMenuTrigger[\s\S]*More project tabs/,
    /onSelect=\{\(\) => setProjectTab\(item\.value\)\}/,
  ],
  "project tab rail collapses rarely-used tabs under a More menu while keeping deep links",
);

// POLISH1 Task 1: one shared state chip (empty / in-progress / complete /
// blocked) instead of each module inventing its own status pill. Adopted in
// ≥2 modules (billing CO allocation + schedule risk items).
await expectContains(
  "src/components/ui/status-chip.tsx",
  [/export function StatusChip/, /StatusTone/, /"in-progress"/, /complete:/, /blocked:/],
  "shared StatusChip carries the one empty/in-progress/complete/blocked vocabulary",
);
await expectContains(
  "src/components/billing/ChangeOrderAllocationPanel.tsx",
  [/StatusChip/, /tone="complete"/, /tone="blocked"/],
  "billing CO allocation uses the shared status chip",
);
await expectContains(
  "src/components/schedule/ScheduleRiskItems.tsx",
  [/StatusChip/, /tone="complete"/],
  "schedule risk items use the shared status chip",
);

// BUDGETENGINE Phase 1: "At Risk goes live" — exposures (E-Holds/C-Holds) become
// allocatable across cost codes, so the budget ledger's At Risk / Contingency
// columns read the live IOR risk register instead of a typed number.
expectSql(
  sql,
  [
    /CREATE TABLE IF NOT EXISTS public\.exposure_allocations/,
    /exposure_id uuid NOT NULL REFERENCES public\.exposures\(id\)/,
    /cost_bucket_id uuid REFERENCES public\.cost_buckets\(id\)/,
    /exposure_allocations_team_insert[\s\S]*can_manage_project/,
  ],
  "exposure_allocations table exists (splittable exposure→cost-code) with team RLS",
);
await expectContains(
  "src/lib/exposure-allocation.ts",
  [
    /allocatedByExposure/,
    /unallocatedExposure/,
    /summarizeExposure/,
    /riskByCostCode/,
    /"E-Hold"/,
    /"C-Hold"/,
    /from "\.\/payments-domain\.ts"/,
  ],
  "exposure allocation math splits E/C holds across cost codes, cents-safe and node-loadable",
);
await expectContains(
  "src/lib/projects.functions.ts",
  [
    /export const allocateExposure/,
    /export const deleteExposureAllocation/,
    /export const listExposureAllocations/,
    /isMissingExposureAllocationsTable/,
    /exposure_allocations/,
  ],
  "exposure allocation server fns verify ownership and degrade gracefully before the migration lands",
);
await expectContains(
  "src/components/project/ExposureAllocationPanel.tsx",
  [
    /export function ExposureAllocationPanel/,
    /Risk holds: allocate to cost codes/,
    /At Risk/,
    /Contingency/,
    /StatusChip/,
  ],
  "exposure allocation panel spreads E/C holds onto cost codes and names the column each feeds",
);
await expectContains(
  "src/routes/_authenticated/projects.$projectId.tsx",
  [/ExposureAllocationPanel/, /exposureAllocationsQuery/, /allocateExposureFn/],
  "risk-tally tab wires the exposure allocation panel and mutations",
);

// BUDGETENGINE Phase 2: the budget-vs-cost ledger — a pure rollup over cost
// buckets (Budget/Actuals/Open) + live exposure allocations (At Risk/Contingency).
// EAC = Actuals + Open; (Over)/Under = Budget − EAC.
await expectContains(
  "src/lib/budget-ledger.ts",
  [
    /export function computeBudgetLedger/,
    /riskByCostCode/,
    /eac/,
    /overUnder/,
    /from "\.\/payments-domain\.ts"/,
  ],
  "budget ledger rollup composes buckets + exposure risk, cents-safe and node-loadable",
);
await expectContains(
  "src/components/project/BudgetLedgerTable.tsx",
  [
    /export function BudgetLedgerTable/,
    /At Risk/,
    /Contingency/,
    // Plain English, no "EAC" jargon; over/under reads itself; columns carry
    // hover help (founder feedback 2026-07-05).
    /Projected cost/,
    /Over \/ under budget/,
    /\? "under" : "over"/,
    /HelpHead/,
  ],
  "budget ledger table renders plain-English columns with self-explaining over/under and hover help",
);
await expectContains(
  "src/routes/_authenticated/projects.$projectId.tsx",
  // Budget-first: the budget-vs-cost ledger leads, the editable cost-code grid
  // ("Edit budget lines") sits below it — not the reverse (no SOV framing on top).
  [/BudgetLedgerTable[\s\S]*?title="Edit budget lines"[\s\S]*?CostBucketsTable/],
  "Budget tab leads with the budget ledger, then the editable budget grid",
);

// BUDGETENGINE Phase 4: fold the budget-vs-cost picture into Billing so the whole
// financial story lives in one place, and rename the standalone tab "Budget"
// (value stays "sov" for deep links). Billing renders the read-only ledger from
// the same buckets + exposure allocations.
await expectContains(
  "src/components/project/billing/BillingWorkspace.tsx",
  [
    /import \{ BudgetLedgerTable \}/,
    /value: "budget", title: "Budget vs Cost"/,
    /<BudgetLedgerTable[\s\S]*?exposures=\{exposures\}[\s\S]*?allocations=\{exposureAllocations\}/,
  ],
  "billing workspace folds in the budget-vs-cost ledger tab",
);
await expectContains(
  "src/routes/_authenticated/projects.$projectId.tsx",
  [/label: "Budget"/, /title="Budget"/, /exposureAllocations=\{exposureAllocationsQuery\.data/],
  "budget tab is renamed from SOV/Costs and feeds Billing its exposures + allocations",
);

// BUDGETENGINE Phase 3: estimate → budget carry. The budget is the estimate's
// line COSTS by cost code (markups are margin); manual entry stays via the
// cost-line editor.
await expectContains(
  "src/lib/estimate-budget.ts",
  [
    /export function aggregateEstimateToBudget/,
    /total_extended_cents/,
    /from "\.\/payments-domain\.ts"/,
  ],
  "estimate→budget aggregation sums line costs by cost code, cents-safe and node-loadable",
);
await expectContains(
  "src/lib/projects.functions.ts",
  [
    /export const buildBudgetFromEstimate/,
    /aggregateEstimateToBudget/,
    /No Overwatch estimate is linked/,
  ],
  "buildBudgetFromEstimate carries estimate line costs onto cost buckets (update match, insert new)",
);
await expectContains(
  "src/routes/_authenticated/projects.$projectId.tsx",
  [
    /buildBudgetFromEstimateFn/,
    /Build budget from estimate/,
    /Build the budget from the estimate\?/,
  ],
  "SOV/Costs tab offers the estimate→budget carry behind a confirm",
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
