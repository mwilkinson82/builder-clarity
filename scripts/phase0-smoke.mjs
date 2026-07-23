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
await expectFile("src/lib/email-templates/selection-notification.tsx", "selection email template");
await expectFile("src/components/outcome/SelectionsWorkspace.tsx", "selections workspace");
await expectFile("src/components/outcome/ClientSelectionsPanel.tsx", "client selections panel");
await expectFile("src/lib/selections.functions.ts", "selection server functions");
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
    // ALP house skin, Brand Kit v2 (docs/THEMING.md): warm clay accent for
    // active/selected states, coral signal focus ring. Coral is rationed to
    // the Button variant="signal" CTA, never the global accent.
    /--accent:\s*#c36e4f/,
    /--ring:\s*rgb\(217 119 87 \/ 0\.5\)/,
    /--signal:\s*#d97757/,
    /--ring:\s*rgb\(217 119 87 \/ 0\.55\)/,
  ],
  "global highlight accent uses the ALP house v2 palette (clay accent, coral signal focus)",
);

await expectContains(
  "src/routes/auth.tsx",
  [
    /sendOverwatchMagicLink/,
    /context:\s*"login"/,
    /onSubmit=\{onMagicLinkSubmit\}/,
    /Email me a sign-in link/,
    /No[\s\n]+password needed/,
  ],
  "public auth page uses magic links as its single primary sign-in path",
);

await expectNotContains(
  "src/routes/auth.tsx",
  [/signInWithPassword/, /supabase\.auth\.signUp/, /Continue with Google/, /Forgot password/],
  "public auth page does not advertise password, self-signup, or unconfigured Google flows",
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
    // Ledger rows navigate client-side via TanStack Link (no full page reload)
    // instead of the former raw <a href={projectHref}>.
    /to="\/projects\/\$projectId"/,
    /params=\{\{ projectId: project\.id \}\}/,
    /Project worklist/,
    /max-w-\[1760px\]/,
    // Company identity in the header is now owned by the shared PortfolioTopBar
    // (b6 CRM reskin); the old hand-rolled companyInitials(headerCompanyName)
    // header block was replaced by <PortfolioTopBar active="crm" />.
    /PortfolioTopBar/,
    /active=\{portfolioTab === "pipeline" \? "crm" : "projects"\}/,
  ],
  "portfolio route supports member project creation, responsive ledger navigation, company-scoped identity, and command-center first viewport",
);

await expectContains(
  "src/components/home/PortfolioHome.tsx",
  [
    /const PROJECTS_HREF = "\/\?tab=projects"/,
    // Header nav now uses InternalLink (client-side left-click nav, real <a href>
    // preserved for middle/cmd-click) instead of a plain reloading <a href>.
    /<InternalLink href=\{PROJECTS_HREF\}>Projects<\/InternalLink>/,
    /<button type="button" className="ow-btn ow-btn--signal" onClick=\{onNewProject\}>/,
    /<Link to="\/team">Team<\/Link>/,
    /import \{ AppFooter \} from "@\/components\/layout\/AppFooter"/,
    /<AppFooter context=\{`\$\{identity\.companyName\} · Portfolio`\} \/>/,
  ],
  "portfolio home header links directly to the project catalog and team settings and uses the shared app footer",
);

await expectContains(
  "src/routes/_authenticated/index.tsx",
  [
    /showTrigger=\{false\}/,
    /<PortfolioHome onNewProject=\{\(\) => setCreateProjectOpen\(true\)\} \/>/,
  ],
  "portfolio home opens the existing new-project dialog directly without detouring through the project catalog",
);

await expectNotContains(
  "src/components/home/PortfolioHome.tsx",
  [/function HomeFooter\(/, /ow-footer-brand/, /ow-footer-bar/],
  "portfolio home does not maintain a competing one-off footer",
);

await expectContains(
  "src/components/layout/PortfolioTopBar.tsx",
  [
    /type NavKey[\s\S]*"portfolio"[\s\S]*"projects"/,
    /search=\{\{ tab: "projects" \}\} className=\{navItemClass\("projects"\)\}/,
  ],
  "shared portfolio header keeps the project catalog in its primary navigation",
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
    /logo_path: str\(row\.logo_path\)/,
    /const logoPath = organization\.logo_path;[\s\S]*if \(!logoPath\) return "";/,
  ],
  "company workspace context exposes configured branding without probing a missing logo object",
);

await expectNotContains(
  "src/lib/team.functions.ts",
  [/companyLogoPath\(/],
  "company workspace branding never synthesizes an unconfigured logo path",
);

await expectContains(
  "src/lib/projects.functions.ts",
  [
    /const logoPath = str\(organization\.logo_path\)/,
    /if \(!organizationId \|\| !logoPath\) return "";/,
    /getPublicUrl\(logoPath\)/,
    /select\("id,name,logo_url,logo_path,updated_at"\)/,
  ],
  "project list and detail branding require and preserve configured logo metadata",
);

await expectNotContains(
  "src/lib/projects.functions.ts",
  [/companyLogoPath\(/],
  "project branding never synthesizes an unconfigured logo path",
);

await expectContains(
  "src/lib/submittal-log.functions.ts",
  [
    /const logoPath = str\(o\.logo_path\)/,
    /if \(!logoUrl && logoPath\)/,
    /getPublicUrl\(logoPath\)/,
  ],
  "project letterheads only resolve a stored logo path",
);

await expectNotContains(
  "src/lib/submittal-log.functions.ts",
  [/companyLogoPath\(/],
  "project letterheads never synthesize an unconfigured logo path",
);

await expectContains(
  "src/routes/_authenticated/team.tsx",
  [
    /const logoPath = team\?\.organization\.logo_path;/,
    /if \(!logoPath\) return "";/,
    /getPublicUrl\(logoPath\)/,
  ],
  "team logo preview stays empty until logo metadata exists",
);

await expectNotContains(
  "src/routes/_authenticated/team.tsx",
  [/companyLogoPath\(/],
  "team logo preview never synthesizes an unconfigured logo path",
);

await expectContains(
  "src/components/layout/AppFooter.tsx",
  [/className="hidden sm:inline">— an ALP product<\/span>/],
  "shared app footer keeps its mobile wordmark inside the viewport",
);

await expectContains(
  "supabase/migrations/20260722235000_backfill_company_logo_paths.sql",
  [
    /UPDATE public\.organizations AS organization/,
    /storage\.objects AS object/,
    /object\.bucket_id = 'company-assets'/,
    /object\.name = organization\.id::text \|\| '\/logo'/,
    /coalesce\(nullif\(btrim\(organization\.logo_path\), ''\), ''\) = ''/,
    /RAISE EXCEPTION 'canonical company logo path backfill did not converge'/,
  ],
  "company logo metadata is backfilled only where a canonical stored object exists",
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
  [
    /getCompanyWorkspaceContext/,
    /company-workspace-context/,
    /\{companyName\}/,
    /<PortfolioTopBar active="billing" \/>/,
    /flex w-full max-w-full gap-2 overflow-x-auto border-b border-hairline/,
    /TabsList className="flex h-auto w-full max-w-full items-stretch justify-start gap-2 overflow-x-auto/,
    /-mb-px shrink-0 flex-col items-start.*focus-visible:ring-inset focus-visible:ring-offset-0/,
  ],
  "billing workspace header uses the user's company name, shared portfolio navigation, and contained mobile tab strips",
);

await expectContains(
  "src/components/billing/portfolio/CashForecastTab.tsx",
  [/min-w-0 max-w-full break-all.*text-\[clamp\(1\.5rem,7\.5vw,2\.125rem\)\]/],
  "cash forecast keeps large financial values inside the mobile panel",
);

await expectContains(
  "src/components/billing/ReceivablesCockpit.tsx",
  [
    /function ChangeOrderSection[\s\S]*?className="min-w-0 rounded-lg border border-hairline bg-card p-5 shadow-card"/,
    /grid min-w-0 gap-4 xl:grid-cols-\[1\.2fr_0\.8fr\]/,
    /<section className="min-w-0 rounded-lg border border-hairline bg-card p-5 shadow-card">[\s\S]*?Payment activity/,
  ],
  "receivables cards cannot force their implicit grid track beyond the mobile billing panel",
);

await expectContains(
  "src/routes/_authenticated/reports.tsx",
  [/<PortfolioTopBar active="reports" \/>/, /<div data-print-hide>/],
  "reports workspace uses the shared portfolio navigation and hides it when printing",
);

await expectContains(
  "src/routes/_authenticated/team.tsx",
  [/<PortfolioTopBar/, /active="team"/, /actions=\{/],
  "company workspace uses the shared portfolio navigation and keeps admin actions in its action slot",
);

await expectContains(
  "src/components/layout/PortfolioTopBar.tsx",
  [/\| "reports"/, /<Link to="\/reports" className=\{navItemClass\("reports"\)\}>/],
  "shared portfolio navigation exposes Reports as a first-class destination",
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

// CRM feedback (DB3T 2026-07-09): moving a deal to a decided stage settles its
// probability, and the Client field is a pick-or-add dropdown off the account
// directory instead of a free-text box.
await expectContains(
  "src/components/pipeline/PipelineWorkspace.tsx",
  [
    /stage === "won"\) patch\.probability = 100/,
    /stage === "lost" \|\| stage === "no_bid"\) patch\.probability = 0/,
    /const accountNames = useMemo/,
    /accounts={accountNames}/,
  ],
  "CRM: Won auto-sets 100% / Lost+No-bid 0%, and the account directory feeds the client picker",
);
await expectContains(
  "src/components/pipeline/OpportunityDetail.tsx",
  [/settledProbability/, /nextStage === "won"/, /AccountPicker/],
  "CRM detail: changing stage settles probability + client field is a picker",
);
await expectContains(
  "src/components/pipeline/AccountPicker.tsx",
  [
    /export function AccountPicker/,
    /shouldFilter={false}/,
    /Add “\{trimmed\}”/,
    /accounts: string\[\]/,
  ],
  "AccountPicker offers existing clients + add-new from typed text",
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
    // Financial hardening: delete = archive for every project (journals RESTRICT
    // parent deletion); the demo flag is derived from the row, not hardcoded.
    /demoArchived: isHarborDemoProject/,
    /Archive is therefore the supported lifecycle/,
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
    /detectSessionInUrl:\s*false/,
  ],
  "browser Supabase client reads env without crashing on process.env",
);

await expectContains(
  "src/routes/auth.tsx",
  [
    /Outlet/,
    /AuthForm/,
    /checkExistingSession/,
    /getSession/,
    /getUser/,
    /INVALID_SAVED_SESSION_MESSAGE/,
    /Your saved sign-in could not be verified/,
    /signOut\(\{ scope: "local" \}\)/,
    /setError/,
  ],
  "auth page authoritatively verifies saved sessions and fails closed without blanking",
);

await expectNotContains(
  "src/routes/auth.tsx",
  [/Could not check current session/, /err instanceof Error \? err\.message/],
  "auth page does not expose raw session-check failures",
);

await expectContains(
  "src/routes/auth.callback.tsx",
  [
    /establishSessionFromUrl/,
    /exchangeCodeForSession/,
    /setSession/,
    /access_token/,
    /refresh_token/,
    // P0 sign-in correction: navigate to the resolved exact
    // destination (invite / client-portal / login) so users always
    // land on their exact resource, never a stale default.
    /navigate\(\{ to: destination as never, replace: true \}\)/,
    // Fail-closed on any callback failure: local signOut then
    // recovery UI, no getSession() rescue that could keep a stale
    // session alive.
    /failClosed/,
    /supabase\.auth\.signOut\(\{ scope: "local" \}\)/,
    /finalize_client_access/,
    /finalize_invite_acceptance/,
    /requiresExplicitMagicLinkConfirmation/,
    /Continue to Overwatch/,
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
    // P0 sign-in correction: fail-closed gate on getUser() — no
    // getSession() restore path that would resurrect a stale session
    // for a disabled/revoked user.
    /supabase\.auth\.getUser\(\)/,
    /supabase\.auth\.signOut\(\{ scope: "local" \}\)/,
    /throw redirect/,
    /recordUserActivity/,
    /ACTIVITY_HEARTBEAT_MS/,
    /overwatch_activity_session_id/,
    /useRouterState/,
    /visibilitychange/,
    // Mid-session re-resolution so a revoked seat loses access on
    // tab return and on Supabase auth-state changes.
    /setReloadKey/,
    /onAuthStateChange/,
  ],
  "authenticated route fails closed on gate rejection and re-resolves access mid-session",
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
    // NAVLABELS: the rail leads with the text label (not an icon-only compact
    // collapse) and groups the project destinations around the IOR workflow.
    /const PROJECT_NAV_GROUPS: ProjectNavGroup\[\] = \[/,
    /label: "IOR"[\s\S]*label: "Plan & Procurement"[\s\S]*label: "Commercial"[\s\S]*label: "Field"[\s\S]*label: "Client & Records"/,
    /"dashboard", "risk-tally", "todos", "claims", "ior-report"/,
    /"schedule", "selections", "rfi-submittals"/,
    /"sov", "subcontractors", "change-orders", "billing"/,
    /"daily-reports", "tomorrow-plan", "daily-wip", "inspections"/,
    /"client-portal", "file-room"/,
    /const companyName = project\.organization_name \|\| "Overwatch company"/,
    // v2 shell: mobile slim top bar; on desktop the rail head carries company +
    // project switcher and a visible Portfolio link before the nav groups.
    /border-hairline bg-wash px-4 py-2 lg:hidden/,
    /aria-label="Switch project"/,
    /<ArrowLeft className="h-4 w-4" \/>/,
    /<ChevronRight[\s\S]*className="h-5 w-5/,
    /<ChevronDown[\s\S]*className="h-5 w-5/,
    // Close/Archive/Delete live behind the "···" overflow; one controlled state
    // drives the three confirm dialogs (they must all remain reachable).
    /aria-label="More project actions"/,
    /setConfirmAction\("close"\)/,
    /setConfirmAction\("archive"\)/,
    /setConfirmAction\("delete"\)/,
    // Grouped vertical rail (labels are the default; no icon-only collapse).
    /lg:grid-cols-\[248px_minmax\(0,1fr\)\]/,
    // v2 floating rail: rounded paper card with the one soft wide glow.
    /PROJECT_NAV_RAIL_CLASS[\s\S]*rounded-\[15px\][\s\S]*shadow-nav/,
    // MULTI-EXPAND: each group toggles independently. A destination opens its
    // group without deleting the user's previously expanded group keys.
    /const isActiveGroup = group\.key === activeNavGroup\?\.key/,
    /const isExpanded = expandedNavGroupKeys\.has\(group\.key\)/,
    // NAVDISCOVERY1: every group is visible on first paint; users may still
    // collapse any group independently after the initial render.
    /new Set\(PROJECT_NAV_GROUPS\.map\(\(group\) => group\.key\)\)/,
    /setExpandedNavGroupKeys\(\(current\) => \{/,
    /next\.add\(activeGroupKey\)/,
    /navGroupHint/,
    /onClick=\{\(\) => toggleNavGroup\(group\.key\)\}/,
    /aria-expanded="true"/,
    /aria-expanded="false"/,
    /const isActive = activeProjectTab === item\.value/,
    // Active tab = quiet paper2 fill + a clay dot (Radix data-state wins over the
    // shadcn TabsTrigger base).
    /data-\[state=active\]:bg-secondary data-\[state=active\]:font-semibold data-\[state=active\]:text-foreground/,
    // Persistent "you are here" section title (group · label) atop the stage.
    /\{activeNavGroup\.label\} · \{activeNavItem\.label\}/,
    /aria-label=\{`\$\{item\.label\}: \$\{item\.detail\}`\}/,
    /title=\{`\$\{item\.label\}: \$\{item\.detail\}`\}/,
    // Estimating is reachable directly from the project rail; no portfolio
    // detour is required.
    /onClick=\{\(\) => navigate\(\{ to: "\/estimates" \}\)\}/,
    /aria-label="Estimating: Estimates and Plan Room"/,
    // Billing is lazy-loaded (PROJECTDECOMP1 part 3): the rail hosts a Suspense
    // boundary and the workspace itself lives in its own module (pinned below).
    /const BillingWorkspace = lazy\(/,
    /<Suspense/,
  ],
  "project nav rail leads with IOR-first labels and independently expandable groups (NAVLABELS)",
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
    // v2 notebook reskin (project-billing): stages relabeled to the mock's
    // four numbered steps (values unchanged) + secondary "More views" chips.
    /title: "Billing position"/,
    /title: "Costs"/,
    /title: "Pay applications"/,
    /title: "WIP \/ over-under"/,
    /Invoices & Payments/,
    /Pending COs/,
    /Pending change orders: not billable yet/,
    /ChangeOrderAllocationPanel/,
    /A\/R ledger/,
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
    /Inspection risk posture/,
    /required_reinspection/,
    /cost_impact/,
    /schedule_impact_weeks/,
  ],
  "inspections workspace tracks pass/fail attempts, reinspections, impacts, and risk handoff",
);
await expectContains(
  "src/components/outcome/InspectionsBoard.tsx",
  // v2 split: the inspection card row (incl. the send-to-risk action) lives in
  // the board module shared by list + kanban views.
  [/InspectionLogRow/, /Send to risk/],
  "inspection cards keep the send-to-risk handoff after the v2 list/board split",
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
    // The compact cost view replaces the six-card health matrix with the four
    // operational numbers and an expandable planned sub-cost breakdown.
    /CostCodeBreakdownManager/,
    /Open to pay/,
    /Cash paid/,
    /Cost transaction backup/,
    /Record payment/,
    /settlement\.settledCents/,
    /credit_applies_to_id/,
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
  "src/components/billing/CostCodeBreakdownManager.tsx",
  [/What makes up each budget code\?/, /planned_amount/, /left to plan/, /saveCostBudgetItem/],
  "billing cost plan expands each code into editable planned sub-costs",
);

await expectContains(
  "supabase/migrations/20260714023911_billing_cost_settlements.sql",
  [
    /credit_applies_to_id/,
    /CREATE TABLE IF NOT EXISTS public\.cost_actual_payments/,
    /CREATE OR REPLACE FUNCTION public\.record_cost_actual_payment/,
    /FOR UPDATE/,
    /can_manage_project/,
  ],
  "cost settlement migration links credits and records concurrency-safe partial payments",
);

await expectContains(
  "supabase/migrations/20260714023925_billing_cost_breakdowns.sql",
  [
    /CREATE TABLE IF NOT EXISTS public\.cost_budget_items/,
    /planned_amount_cents bigint/,
    /ENABLE ROW LEVEL SECURITY/,
    /can_manage_project/,
  ],
  "cost plan migration stores RLS-protected budget sub-costs in integer cents",
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
// FIELD FIX (save all lines): every changed pay-app line saves in one action and
// syncs each application once, so entered work reliably rolls up into the totals
// (the "save all lines would be nice" / "not rolling up" field reports).
await expectContains(
  "src/lib/billing.functions.ts",
  [/export const updateBillingLineItems/, /buildBillingLineDbPatch/, /saved_count/],
  "save-all batch server fn commits every line and syncs the application once",
);
await expectContains(
  "src/components/billing/BillingEnhancements.tsx",
  [/onSaveAllLines/, /Save all lines/, /with unsaved entries/],
  "pay-app panel offers a Save all lines action for changed lines",
);
await expectContains(
  "src/lib/aia-builder-steps.ts",
  [/aiaGenerateGate/, /blockingStep/, /Import your schedule of values first/],
  "AIA builder gate is a pure module shared by the stepper and the tests",
);
// The pay application IS the owner's bill: one terminal "Bill the owner"
// action, no separate generate/certify step. Sending stays an explicit
// recipient-confirmed command from Receivables.
await expectContains(
  "src/lib/aia-builder-steps.ts",
  [/"bill"/, /Bill the owner/, /Owner billed/, /Receivables/, /hasInvoice/],
  "pay-app stepper closes into one Bill-the-owner action with an explicit send step",
);
await expectContains(
  "src/components/billing/AiaApplicationStepper.tsx",
  [/onBillOwner/, /Bill the owner/, /Receivables/],
  "stepper renders one Bill-the-owner action; the G702/G703 is its printed copy",
);
// Creating from the pay-app step must stay draft-only; the separate Send
// command owns client visibility, recipient evidence, and A/R aging.
await expectContains(
  "src/components/project/billing/BillingWorkspace.tsx",
  [
    /onCreateInvoiceForApp/,
    /onCreateInvoice\(draft\)/,
    /audited Send command/,
    /confirms recipients/,
  ],
  "pay-app invoice creation stays draft-only until the audited Send command",
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

// CO ↔ RISK TWO-WAY LINK (Claims/CO/Risk arc — slice 1): a change order and a
// risk-tally exposure cross-reference both ways (tag either as the other), with
// a dup guard and a value prompt. Reference only — no rollup math changes.
await expectContains(
  "supabase/migrations/20260709160000_co_risk_two_way_link.sql",
  [
    /ALTER TABLE public\.change_orders\s+ADD COLUMN IF NOT EXISTS linked_exposure_id uuid/,
    /ALTER TABLE public\.exposures\s+ADD COLUMN IF NOT EXISTS linked_change_order_id uuid/,
    /ON DELETE SET NULL/,
  ],
  "CO↔risk migration adds the two-way link columns (desk applies)",
);
await expectContains(
  "src/lib/projects.functions.ts",
  [
    /export const linkChangeOrderExposure/,
    /export const unlinkChangeOrderExposure/,
    /linked_change_order_id: \(e\.linked_change_order_id/,
    /linked_exposure_id: \(o\.linked_exposure_id/,
  ],
  "server layer links a change order and an exposure both ways",
);
await expectContains(
  "src/components/outcome/ChangeOrdersTable.tsx",
  [/c\.linked_exposure_id/, /Already in the risk tally/],
  "change order table shows the linked state (dup guard)",
);
await expectContains(
  "src/components/outcome/ExposuresTable.tsx",
  [
    /onCreateChangeOrder/,
    /Tag as change order/,
    /linked_change_order_id/,
    /Already in change orders/,
  ],
  "risk tally exposes the reverse tag-as-change-order action + linked state",
);
await expectContains(
  "src/routes/_authenticated/projects.$projectId.tsx",
  [
    /handleCreateChangeOrderFromExposure/,
    /changeOrderTypeFromExposure/,
    /setCoRiskPrompt/,
    /Carry the full change-order value/,
    /Add to risk tally/,
  ],
  "project route wires the two-way link handlers + the carry-value prompt",
);

// CLAIMS MODULE (Claims/CO/Risk arc — slice 2): a dispute-resolution record with
// its own pipeline status, money/time sought vs. awarded, and outgoing links to
// the risk it came from + the CO it may resolve into.
await expectContains(
  "supabase/migrations/20260709170000_project_claims.sql",
  [
    /CREATE TABLE IF NOT EXISTS public\.project_claims/,
    /claim_type text NOT NULL DEFAULT 'delay'/,
    /status text NOT NULL DEFAULT 'in_preparation'/,
    /project_claims_status_check/,
    /risk_exposure_id uuid REFERENCES public\.exposures\(id\) ON DELETE SET NULL/,
    /change_order_id uuid REFERENCES public\.change_orders\(id\) ON DELETE SET NULL/,
    /public\.can_manage_project\(project_id\)/,
  ],
  "claims migration ships project_claims with pipeline status + risk/CO links (desk applies)",
);
await expectContains(
  "src/lib/projects.functions.ts",
  [
    /export interface ClaimRow/,
    /const normalizeClaim/,
    /export const createClaim/,
    /export const updateClaim/,
    /export const deleteClaim/,
    /project_claims/,
    /claims,/,
  ],
  "server layer defines claim CRUD + folds claims into getProject",
);
await expectContains(
  "src/components/outcome/ClaimsWorkspace.tsx",
  [
    /export function ClaimsWorkspace/,
    /Extension of time/,
    /Delay damages/,
    /In preparation/,
    /Amount sought/,
    /Time sought/,
  ],
  "claims workspace renders the claim list + create/edit dialog with type/status/amounts",
);
await expectContains(
  "src/routes/_authenticated/projects.$projectId.tsx",
  [/ClaimsWorkspace/, /claimCreate/, /claimUpdate/, /claimDelete/, /openClaimCount/, /"claims"/],
  "project route wires the Claims tab + CRUD mutations",
);
// CLAIMS demo parity: the Harbor demo project is seeded at runtime per-org, so
// claims need a runtime seeder next to seedHarborDemoInspections (the migration
// seed only covers static harbor rows, which don't exist on prod).
await expectContains(
  "src/lib/projects.functions.ts",
  [
    /const harborDemoClaims = \[/,
    /const seedHarborDemoClaims = async/,
    /seed_key: "harbor-demo:claim:electrical-delay"/,
    /seed_key: "harbor-demo:claim:weather-delay"/,
    /claims: \(\) => seedHarborDemoClaims\(supabase, projectId, seedWarnings\)/,
    /const demoEngine = await ensureVersionedHarborDemoModules\(/,
  ],
  "Harbor demo project seeds claims through the versioned runtime engine",
);

// CLAIM CYCLE LOG (Claims/CO/Risk arc — slice 3): the dated back-and-forth on a
// claim (submitted → received → reviewed → meeting → returned → resubmitted →
// resolved), one row per event, with revision numbers.
await expectContains(
  "supabase/migrations/20260709200000_project_claim_events.sql",
  [
    /CREATE TABLE IF NOT EXISTS public\.project_claim_events/,
    /claim_id uuid NOT NULL REFERENCES public\.project_claims\(id\) ON DELETE CASCADE/,
    /revision_number integer NOT NULL DEFAULT 0/,
    /project_claim_events_type_check/,
    /returned_for_revision/,
    /public\.can_manage_project\(project_id\)/,
  ],
  "claim cycle-log migration ships project_claim_events with the event pipeline (desk applies)",
);
await expectContains(
  "src/lib/projects.functions.ts",
  [
    /export interface ClaimEventRow/,
    /const normalizeClaimEvent/,
    /export const createClaimEvent/,
    /export const deleteClaimEvent/,
    /claimEvents,/,
    /const seedHarborDemoClaimEvents/,
  ],
  "server layer defines claim-event CRUD + folds claimEvents into getProject + seeds the demo cycle",
);
await expectContains(
  "src/components/outcome/ClaimsWorkspace.tsx",
  [/ClaimCycleLogDialog/, /onCreateEvent/, /onDeleteEvent/, /setCycleLogClaimId/],
  "claims workspace opens a per-claim cycle log with add/delete events",
);
await expectContains(
  "src/components/outcome/ClaimCycleLogDialog.tsx",
  [/export function ClaimCycleLogDialog/, /Returned for revision/, /Log an event/],
  "claim cycle-log dialog renders the event timeline + log-an-event form",
);
await expectContains(
  "src/routes/_authenticated/projects.$projectId.tsx",
  [/claimEventCreate/, /claimEventDelete/, /events={claimEvents}/],
  "project route wires the claim cycle-log mutations into the Claims tab",
);

// CLAIM DOCUMENTS (Claims/CO/Risk arc — slice 4): attach the claim package +
// supporting docs to a private 'claim-docs' bucket, recorded per-claim.
await expectContains(
  "supabase/migrations/20260709210000_project_claim_documents.sql",
  [
    /CREATE TABLE IF NOT EXISTS public\.project_claim_documents/,
    /claim_id uuid NOT NULL REFERENCES public\.project_claims\(id\) ON DELETE CASCADE/,
    /project_claim_documents_type_check/,
    /INSERT INTO storage\.buckets/,
    /'claim-docs'/,
    /claim_docs_storage_insert/,
    /public\.can_manage_project\(\(storage\.foldername\(name\)\)\[1\]::uuid\)/,
  ],
  "claim documents migration ships the table + private claim-docs bucket + team storage RLS (desk applies)",
);
await expectContains(
  "src/lib/projects.functions.ts",
  [
    /export interface ClaimDocumentRow/,
    /const normalizeClaimDocument/,
    /export const addClaimDocument/,
    /export const deleteClaimDocument/,
    /claimDocuments,/,
  ],
  "server layer defines claim-document add/delete + folds claimDocuments into getProject",
);
await expectContains(
  "src/components/outcome/ClaimDocumentsDialog.tsx",
  [/export function ClaimDocumentsDialog/, /Attach a document/, /Claim document/, /Supporting/],
  "claim documents dialog uploads/lists/views attachments by type",
);
await expectContains(
  "src/routes/_authenticated/projects.$projectId.tsx",
  [
    /uploadClaimDocument/,
    /viewClaimDocument/,
    /removeClaimDocument/,
    /from\("claim-docs"\)/,
    /createSignedUrl/,
  ],
  "project route wires claim-doc upload/view/remove against the claim-docs bucket",
);

// CLAIM ↔ RISK / CO TWO-WAY TAGGING (Claims/CO/Risk arc — slice 5, final): a
// claim and its risk / change order cross-reference both ways (reverse pointers
// linked_claim_id), same tag-not-math model as slice 1's CO↔risk.
await expectContains(
  "supabase/migrations/20260709230000_claim_risk_co_reverse_links.sql",
  [
    /ALTER TABLE public\.exposures\s+ADD COLUMN IF NOT EXISTS linked_claim_id uuid/,
    /ALTER TABLE public\.change_orders\s+ADD COLUMN IF NOT EXISTS linked_claim_id uuid/,
    /ON DELETE SET NULL/,
  ],
  "claim↔risk/CO migration adds the reverse linked_claim_id pointers (desk applies)",
);
await expectContains(
  "src/lib/projects.functions.ts",
  [
    /export const linkClaimExposure/,
    /export const linkClaimChangeOrder/,
    /linked_claim_id: \(e\.linked_claim_id/,
    /linked_claim_id: \(o\.linked_claim_id/,
  ],
  "server layer links a claim to its risk + change order both ways",
);
await expectContains(
  "src/components/outcome/ExposuresTable.tsx",
  [/onCreateClaim/, /Track as claim/, /linked_claim_id/, /Already tracked as a claim/],
  "risk tally exposes the track-as-claim action + linked state",
);
await expectContains(
  "src/components/outcome/ClaimsWorkspace.tsx",
  [
    /onSendToRisk/,
    /onPromoteToChangeOrder/,
    /Send to risk/,
    /Promote to CO/,
    /In risk tally/,
    /In change orders/,
  ], // v2 relabels (mock)
  "claims workspace offers send-to-risk + promote-to-change-order with linked state",
);
await expectContains(
  "src/routes/_authenticated/projects.$projectId.tsx",
  [
    /handleSendClaimToRisk/,
    /handleTrackExposureAsClaim/,
    /handlePromoteClaimToChangeOrder/,
    /exposureCategoryFromClaim/,
    /setClaimRiskPrompt/,
  ],
  "project route wires the claim↔risk/CO handlers + the carry-value prompt",
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
    /Contractor Circle includes the complete OverWatch Pro allowance/,
    /Upgrade to Pro — \$399\/month/,
    /Everything in OverWatch Pro/,
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
  "src/routes/_authenticated/team.tsx",
  [
    /data-testid="company-users-access"[\s\S]*?className="grid min-w-0 gap-6 2xl:grid-cols-\[minmax\(0,0\.9fr\)_minmax\(0,1\.1fr\)\]"/,
    /className="min-w-0 rounded-lg border border-hairline bg-card p-5 shadow-card"[\s\S]*?Invite company users[\s\S]*?className="min-w-0 rounded-lg border border-hairline bg-card p-5 shadow-card"[\s\S]*?Company users and roles/,
    /grid min-w-0 gap-3 lg:grid-cols-\[minmax\(0,1fr\)_190px_150px\]/,
    /break-words text-xs text-muted-foreground/,
  ],
  "company users and role controls stay inside the Team workspace from mobile through desktop",
);

await expectContains(
  "src/routes/_authenticated/team.tsx",
  [
    /data-testid="plan-readiness-panel" className="grid min-w-0 gap-5"/,
    /className="min-w-0 rounded-lg border border-hairline bg-card shadow-card"/,
    /className="grid min-w-0 grid-cols-\[minmax\(0,1fr\)\] gap-0 2xl:grid-cols-\[minmax\(0,0\.85fr\)_minmax\(0,1\.15fr\)\]"/,
    /className="min-w-0 border-b border-hairline p-5 2xl:border-b-0 2xl:border-r"/,
    /className="mt-4 h-auto min-h-9 w-full min-w-0 whitespace-normal py-2 text-center leading-tight"/,
    /grid min-w-0 grid-cols-\[minmax\(0,0\.8fr\)_minmax\(0,1\.2fr\)\] items-start gap-4/,
    /min-w-0 break-words text-right font-medium text-foreground/,
  ],
  "plan readiness cards, facts, and actions stay inside the Team workspace on narrow mobile screens",
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
    /lg:grid-cols-\[minmax\(0,1fr\)_200px_150px_175px\]/, // v2 4-col reflow
    /role="button"/,
    /Send this risk to →/, // v2: labeled action stack
    /Edit risk allocation/, // v2: row-click opens edit (view dialog folded in)
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
    /ORGANIZATION_COMMERCIAL_COLUMNS/,
    /entitlement_source/,
    /meteredProjectIds/,
    /\.select\("id, seat_limit"\)/,
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
    /Send through OverWatch/, // v2 brand casing
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
    /controller\[fees\]\[payer\]", "account"/,
    /controller\[losses\]\[payments\]", "stripe"/,
    /controller\[stripe_dashboard\]\[type\]", "full"/,
    /controller\[stripe_dashboard\]\[type\]/,
    /capabilities\[card_payments\]\[requested\]/,
    /capabilities\[transfers\]\[requested\]/,
    /stripe_connect_account_id/,
    /stripe_connect_account_id_live/,
    /payment_processor_ready/,
    /CONNECT_SELECT_WITHOUT_BILLING_EMAIL/,
    /stripe_schema_not_ready/,
    /isMissingSupabaseColumn/,
    /action === "status"/,
    /connectDetails/,
    // Phase 3 capability split: Connect ops require company.manage_settings
    // (requireManageSettings), no longer the coarse can_manage_org bundle.
    /requireManageSettings/,
  ],
  "Stripe Connect onboarding route handles billing-email schema drift, creates account links, and updates company readiness",
);

await expectContains(
  "src/routes/api/stripe/webhook.ts",
  [/account\.updated/, /stripe_schema_not_ready/, /stripeConnectDetails/],
  "Stripe webhook route keeps Connect status values aligned to the database constraint",
);

await expectContains(
  "src/lib/stripe-connect-status.ts",
  [/charges_enabled/, /payouts_enabled/, /details_submitted/, /under_review/, /restricted/],
  "Stripe Connect readiness distinguishes review, action-required, restricted, and approved accounts",
);

await expectContains(
  "src/routes/api/stripe/checkout/invoice.ts",
  [
    /mode",\s*"payment"/,
    /payment_enabled/,
    /payment_url/,
    /persistInvoiceCheckoutOrExpire/,
    /update_billing_invoice_processor_state_atomic/,
    /p_checkout_session_id:\s*session\.id/,
    /p_online_payment_status:\s*"pending"/,
    /stripe-checkout:\$\{session\.id\}:pending/,
    /expireStripeCheckoutSession/,
    /online_payment_status/,
    /payment_link_sent_at/,
    /payment_intent_data\[metadata\]\[invoice_id\]/,
    /stripe_connect_not_ready/,
    /stripeConnectionForMode/,
    // Payments Phase 1: sessions became DIRECT charges created on the
    // connected account (Stripe-Account header) per the spec and Stripe's
    // Connect docs, replacing the destination-charge transfer_data pin.
    /stripeConnection\.accountId/,
    /stripeConnection\.mode/,
    /Stripe-Account header/,
    /payment_intent_data\[application_fee_amount\]/,
  ],
  "invoice checkout route creates guarded direct-charge sessions, atomically persists the pending session before returning, and expires an unpersisted session",
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
    /netToStripeBalanceCents/,
    /account\.updated/,
    /stripeConnectDetails/,
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
    /Stripe approved/,
    /Stripe review in progress/,
    /Stripe needs more information/,
    /Set up live Stripe/,
    /Activate live payments/,
    /Billing contact/,
    /Save contact/,
    /Path to \$100,000 payments/,
    /Open Stripe in new tab/,
    /subscriptionNote/,
    /id="getting-paid"/,
  ],
  "Getting paid section is the single payments home: remittance entry, masked reveal, honest Connect states, billing contact, and the founder's expectation copy",
);

await expectContains(
  "src/components/billing/GettingPaidBankPanel.tsx",
  [/Reveal saved numbers/, /Direct bank transfer details/, /Payment reference memo/],
  "Getting Paid keeps masked bank instructions in a focused payment-settings panel",
);

await expectContains(
  "src/routes/_authenticated/team.tsx",
  [
    /section=paid&stripe=return/,
    /section=paid&stripe=refresh/,
    /window\.open/,
    /launches Stripe in a separate tab/,
    /action: "status"/,
    /refetchInterval: 30_000/,
  ],
  "Stripe onboarding preserves Getting Paid, opens separately, and refreshes connected-account status",
);

await expectContains(
  "src/routes/api/stripe/webhook.ts",
  [
    /createSupabaseWebhookEventStore/,
    /claimWebhookEvent/,
    // Idempotency records OUTCOME, not sighting: `processed` is written only
    // after the handler completes, and a still-fresh concurrent claim 409s.
    /markProcessed/,
    /webhook_event_in_flight/,
    /duplicate: true/,
    /planCheckoutCompletion/,
    /surcharge_cents/,
    // ACH debits settle asynchronously: completed-but-unpaid sessions wait
    // for async_payment_succeeded before any payment is booked.
    /checkout\.session\.async_payment_succeeded/,
    /checkout\.session\.async_payment_failed/,
    /checkoutSessionOutcome/,
  ],
  "Stripe webhook records processing OUTCOME (processed only after the handler completes), no-ops true duplicates with 2xx, retries concurrent/failed deliveries, and waits out async ACH settlement",
);

await expectContains(
  "src/lib/stripe-webhook-idempotency.ts",
  [
    // The invariant: a row becomes `processed` only via markProcessed, called
    // only after the handler succeeds. Failures leave it `processing` for the
    // next retry to re-take rather than swallowing the retry as a duplicate.
    /classifyExistingClaim/,
    /already_processed/,
    /retry_stale/,
    /in_flight/,
    /DEFAULT_WEBHOOK_STALE_SECONDS/,
    /ON CONFLICT DO NOTHING/,
  ],
  "Webhook idempotency state machine claims fresh/re-takes stale/skips processed and only marks processed on handler completion",
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
  "src/components/billing/StripeConnectNudge.tsx",
  [
    /className="relative rounded-lg/,
    /flex min-w-0 items-start gap-3 pr-10/,
    /className="min-w-0"/,
    /h-auto max-w-full justify-start whitespace-normal/,
    /absolute right-2 top-2 h-8 w-8 p-0/,
  ],
  "Stripe connection nudge contains its copy and controls on narrow billing screens",
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
    /Annotate or save a schedule update/, // v2: authoring demoted to a collapsed panel
    /Data date/,
    /Money exposure in update/,
    /schedule_money_exposure/,
    /Project completion path/, // v2 relabel
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
    /toast\.success\("Sent to the Risk Tally/, // v2 relabel
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
    /Client seat/, // v2: access ledger reorganized into the seat permission matrix
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
    /takeoffUnitsCompatible\(data\.unit, item\.unit\)/,
  ],
  "estimating server functions import contractor costs, protect system rows, unit-filter assembly destinations, seed Harbor samples, folder estimates, delete estimates, and create blank rows in bulk",
);

await expectContains(
  "src/routes/_authenticated/cost-library.tsx",
  [
    // v2 reskin: import moved into the dialog, the toggle/table chrome changed;
    // these durable anchors still prove copy-system-row + bulk-import behavior.
    /Import My Costs/,
    /CostImportDialog/,
    /My Cost Library/,
    /activeView/,
    /Price book/,
    /Material/,
    /Labor/,
    /Installed/,
    /Division/,
    /csi_division/,
    /copyMutation/,
    /source === "system"/,
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
    // b6b reskin: the hand-rolled header (Back-to-portfolio arrow + "Master
    // Sheets" nav button + "Estimate Folders" explainer card) was replaced by the
    // shared PortfolioTopBar, a segmented cross-link, and folder-filter pills.
    /PortfolioTopBar/,
    /Master sheets/,
    /filters master sheets out server-side/,
    /folderFilter/,
    /ESTIMATE_FOLDERS/,
    /folderCounts/,
    /deleteEstimate/,
    // Financial hardening: estimate removal is an ARCHIVE (worksheet history
    // kept, audit record retained), and the control says so.
    /Archive estimate/,
    /Archive Estimate\?/,
    /worksheet history to Archived/,
  ],
  "estimate detail route renders its workspace and project estimates stay separate from master sheets with folders and archive controls",
);

await expectContains(
  "src/routes/_authenticated/estimate-masters.tsx",
  [
    /Master Estimate Sheets/,
    /listMasterSheets/,
    /kind: "master_sheet"/,
    /New Master Sheet/,
    // b6b reskin: the "Project Estimates" nav button became the shared
    // PortfolioTopBar + segmented control linking back to /estimates.
    /PortfolioTopBar/,
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
    // Financial hardening: workspace removal is an ARCHIVE for estimates and
    // master sheets alike; the dialog states the record + audit history survive.
    /Archive Estimate\?/,
    /Archive Master Sheet\?/,
    /titleRows/,
    /worksheet history to Archived/,
    /financial record and its audit history remain available/i,
    /parseEstimateLineRows/,
    /parseCsv/,
    /parseXlsx/,
    /parsePaste/,
    /estimateLineTemplateCsv/,
    /estimateLineTemplateRows/,
    /materialTotal/,
    /laborTotal/,
    /direct/,
    /min-w-\[1180px\] table-fixed/, // full-width worksheet no longer competes with a side rail
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
    /plan-cockpit-drawings-maximize/,
    /plan-cockpit-tools-maximize/,
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
    /setCockpitPanels\(\{ drawings: false, tools: true \}\)/,
    /CockpitFloatingPanelHeader/,
    /PlanRevisionOverlayPanel/,
    /CommandCenterToolsNav/,
    /EstimatorActivationDialog/,
    /EstimatorActivationChecklist/,
    /useEstimatorActivation/,
    /ScaleDraftEditor/,
    /Selected Takeoff/,
    /selected-takeoff-inspector/,
    /selected-takeoff-edit-guidance/,
    /selected-takeoff-quantity-input/,
    /selected-takeoff-recalculate/,
    /selected-takeoff-unit-input/,
    /selected-takeoff-color-picker/,
    /selected-takeoff-save-details/,
    /plan-canvas-delete-selected/,
    /deleteMeasurementMutation\.mutate\(selectedMeasurement\.id\)/,
    /scaleWorkflowRef/,
    /focusWorkflowTarget\(scaleWorkflowRef\)/,
    /calibration-distance-presets/,
    /Save Details/,
    /copyTextToClipboard/,
    /downloadTakeoffCsv/,
    /copyTakeoffSummary/,
    /supabase\.storage[\s\S]*\.from\(planRoomBucket\)[\s\S]*\.upload/,
    /calculateQuantity/,
    /createTakeoffMeasurement/,
    /syncTakeoffToEstimateLine/,
    /MeasurementAssistantPanel/,
    /extractPdfMeasurementEvidence/,
    /analyzePlanSheetMeasurementNotes/,
    /schemaReady/,
    /Plan Room backend is still coming online/,
  ],
  "plan room workspace supports upload, zoom, scale, takeoff tools, source markup, and estimate sync (PlanRoomWorkspace shell)",
);

await expectContains(
  "src/components/estimates/plan-room/CommandCenterToolsNav.tsx",
  [
    /plan-cockpit-tools-tabs/,
    /plan-cockpit-tools-tab-\$\{view\.value\}/,
    /Read Notes & AI/,
    /Estimate Worksheet/,
  ],
  "command center tools are split into task-focused estimator workspaces",
);

await expectContains(
  "src/components/estimates/plan-room/CockpitFloatingPanelHeader.tsx",
  [
    /Full screen/,
    /Restore/,
    /Minimize/,
    /Drag \$\{title\} left, right, up, or down/,
    /maximizeTestId/,
  ],
  "command center panels can move in every direction, maximize, restore, and minimize",
);

await expectContains(
  "src/components/estimates/plan-room/EstimatorActivationDialog.tsx",
  [
    /What do you want to accomplish first/,
    /Try the guided workflow/,
    /Start a takeoff/,
    /Compare revisions/,
  ],
  "first-time estimators choose one clear job instead of discovering the workbench alone",
);

await expectContains(
  "src/components/estimates/plan-room/EstimatorActivationChecklist.tsx",
  [
    /First trusted takeoff/,
    /Confirm this sheet's scale/,
    /Create a trusted takeoff/,
    /Link the quantity/,
  ],
  "first-session guidance keeps the estimator on one trusted takeoff path",
);

await expectContains(
  "src/components/estimates/plan-room/TakeoffWorksheet.tsx",
  [
    /data-layout=\{expanded \? "expanded" : "panel"\}/,
    /takeoff-workspace-records/,
    /workspaceExpanded=\{expanded\}/,
    /xl:grid-cols-\[minmax\(0,1\.7fr\)_minmax\(320px,0\.65fr\)\]/,
    /xl:grid-cols-2 2xl:grid-cols-3/,
  ],
  "the worksheet expands into a wide command-center workspace without nested record scrolling",
);

await expectContains(
  "src/components/estimates/plan-room/TakeoffClassify.tsx",
  [/workspaceExpanded/, /workspaceExpanded[\s\S]*?\? "space-y-1"/],
  "full-screen takeoff classification expands into the workspace instead of adding a card scroller",
);

await expectContains(
  "src/components/estimates/plan-room/PlanRoomWorkspace.tsx",
  [
    /overflow-y-auto overscroll-contain rounded-\[15px\]/,
    /\[scrollbar-gutter:stable\]/,
    /drawingsWorkspaceMaximized/,
    /toolsWorkspaceMaximized/,
    /expanded=\{drawingsWorkspaceMaximized\}/,
    /expanded=\{toolsWorkspaceMaximized\}/,
  ],
  "maximized estimating panels use one viewport workspace scroller instead of stacked card scrollers",
);

await expectContains(
  "src/components/estimates/plan-room/SheetSidebar.tsx",
  [/data-layout=\{expanded \? "workspace" : "panel"\}/, /drawing-sets-list/, /overflow-visible/],
  "maximized drawing controls spread sheet navigation across the workspace without a nested list scroller",
);

await expectContains(
  "src/components/estimates/plan-room/ScaleDraftEditor.tsx",
  [/scale-draft-distance-input/, /Known real distance/, /Printed dimension/],
  "scale calibration keeps its required distance input beside the drawing action",
);

await expectContains(
  "src/components/estimates/plan-room/PlanRevisionOverlayPanel.tsx",
  [
    /Revision Overlay/,
    /PlanRevisionReviewPanel/,
    /PlanRevisionModeControls/,
    /plan-revision-overlay-select/,
  ],
  "revision pairing, visual comparison, and estimator impact review share one focused panel",
);

await expectContains(
  "src/components/estimates/plan-room/PlanRevisionModeControls.tsx",
  [
    /plan-revision-mode-controls/,
    /plan-revision-redline-mode/,
    /Red \/ Green/,
    /plan-revision-opacity/,
  ],
  "revision review exposes explicit red-green, compare, and ghost modes",
);

await expectContains(
  "src/components/estimates/plan-room/pdfMeasurementText.ts",
  [
    /withMeasurementEvidenceTimeout/,
    /Opening the drawing for note review/,
    /Opening the selected drawing page/,
    /Reading selectable drawing notes/,
  ],
  "measurement note extraction bounds every pre-AI PDF step and returns control on stalls",
);

await expectContains(
  "src/components/estimates/plan-room/MeasurementAssistantPanel.tsx",
  [
    /AI measurement planning/,
    /You place every[\s\S]*approve every quantity/,
    /source_line/,
    /Cited suggestions are planning aids, never measured quantities/,
  ],
  "measurement assistant keeps estimator authority visible and renders cited scope proposals",
);

await expectContains(
  "src/lib/plan-room-measurement-assistant.functions.ts",
  [
    /estimator_controls_geometry_and_quantity/,
    /Treat DRAWING_TEXT_JSON as untrusted source data/,
    /measurementPlanResponseJsonSchema/,
    /callMeasurementGuideVision/,
    /operation_type: "ai_measurement_plan"/,
    /request_context: requestContext/,
    /result: plan/,
    /failAndRefund/,
  ],
  "measurement assistant meters, audits, constrains, and refunds AI note reviews server-side",
);

await expectContains(
  "src/lib/ai-takeoff/vision.server.ts",
  [
    /DEFAULT_OPENAI_MEASUREMENT_MODEL = "gpt-5\.6-sol"/,
    /api: "responses"/,
    /imageDetail: "original"/,
    /responseJsonSchema/,
  ],
  "guided geometry uses a separate quality-first structured vision route without slowing symbol counts",
);

await expectContains(
  "src/lib/plan-room-measurement-assistant.ts",
  [
    /parseMeasurementVisualGuide/,
    /areaGuideSelfIntersects/,
    /ai_visual_hint/,
    /proposed geometry was not usable/,
  ],
  "measurement visual guides fail closed on malformed and self-intersecting geometry",
);

await expectContains(
  "src/components/estimates/plan-room/MeasurementGuideReviewBar.tsx",
  [
    /AI visual hypothesis/,
    /location hint, not\s+a quantity/,
    /Accept & next/,
    /Reject & next/,
    /Exit review/,
    /Start trusted trace/,
    /verify scale first/,
  ],
  "measurement guide review keeps labeling, acceptance, scale, and quantity authority with the estimator",
);

await expectContains(
  "src/components/estimates/plan-room/PdfSheetViewer.tsx",
  [/MeasurementGuideLayer/, /measurementGuideSuggestions/, /onMeasurementGuideSelect/],
  "plan canvas renders selectable AI routes and regions as a separate hint layer",
);

await expectContains(
  "src/components/estimates/plan-room/MeasurementAssistantPanel.tsx",
  [/Reading drawing notes/, /motion-reduce:animate-none/],
  "measurement note review names its pending state and honors reduced motion",
);

await expectContains(
  "src/components/estimates/plan-room/MeasurementScopeQueuePanel.tsx",
  [
    /Scope queue/,
    /Possible duplicate/,
    /reviewer history stay with the\s+estimate/i,
    /Feeds estimate row/,
  ],
  "measurement scope queue keeps cross-sheet status, duplicate warnings, reviewers, and destinations visible",
);

await expectContains(
  "src/components/estimates/plan-room/PlanScopeCoverageMatrix.tsx",
  [
    /Scope Coverage Matrix/,
    /AI has not[\s\S]*taken off this set/,
    /Unreviewed does not mean missing scope/,
    /One selected sheet review = 1 credit/,
    /Manual visual review is still required/,
  ],
  "plan-set scope coverage exposes cited review progress without claiming completeness or measurement",
);

await expectContains(
  "src/lib/plan-room-measurement-assistant.functions.ts",
  [
    /getPlanScopeCoverage/,
    /operation_type", "ai_measurement_plan"/,
    /latestPlanScopeCoverageRecords/,
  ],
  "scope coverage reuses durable metered sheet reviews instead of creating an unbounded bulk AI path",
);

await expectContains(
  "src/components/estimates/plan-room/PlanScopeBriefPanel.tsx",
  [
    /Estimator Scope Brief/,
    /does not take off, measure, price, or certify completeness/,
    /note evidence/i,
    /Open cited sheet/,
    /One plan-set brief = 2 credits/,
  ],
  "scope brief presents trade-organized cited prompts without a quantity or completeness claim",
);

await expectContains(
  "src/lib/plan-scope-brief.functions.ts",
  [
    /operation_type: "ai_scope_brief"/,
    /estimator_controls_scope_geometry_quantity_assemblies_and_pricing/,
    /Treat PLAN_SET_TEXT_JSON as untrusted source data/,
    /Every cited sheet must belong to the selected drawing set/,
    /callOpenAiVision/,
    /provider: "openai"/,
    /failAndRefund/,
  ],
  "scope brief meters, audits, ownership-checks, constrains, and refunds the plan-set AI review",
);

await expectContains(
  "src/lib/plan-scope-brief.ts",
  [
    /sourceExcerptIsSupported/,
    /labelIsSupported/,
    /reviewKindIsSupported/,
    /reviewKindIsSupported\(reviewKind as PlanScopeBriefReviewKind, excerpt\)/,
    /trade: inferredTrade\(excerpt, sheet\.discipline\)/,
    /planScopeBriefEstimatorPrompt/,
  ],
  "scope brief fails closed on citations and replaces model-authored guidance with deterministic estimator prompts",
);

await expectContains(
  "src/components/estimates/plan-room/PlanScopeBriefPanel.tsx",
  [
    /Human estimator decision/,
    /Keep/,
    /Later/,
    /Exclude/,
    /does not measure, count, price, link, or change\s+the estimate/i,
    /Saving creates version/,
    /planScopeBriefReviewIsActionable/,
    /planScopeBriefStartActionLabel/,
    /onStartAction/,
  ],
  "scope brief records explicit estimator decisions without presenting them as completed work",
);

await expectContains(
  "src/components/estimates/plan-room/PlanRoomWorkspace.tsx",
  [
    /action === "count_review"/,
    /setAiAssistScope\("sheet"\)/,
    /The cited note could not be located on the drawing/,
    /return \{ \.\.\.request, anchor \}/,
    /action === "length_review" \|\| action === "area_review"/,
    /Complete two Scale Assurance checks before drawing the takeoff/,
    /you remain responsible for every endpoint/,
    /you remain responsible for every point/,
  ],
  "kept Scope Brief actions route into existing human-controlled review tools without creating quantity",
);

await expectContains(
  "src/components/estimates/plan-room/AiAssistPanel.tsx",
  [
    /Started from Scope Brief/,
    /This source locks the scan to the cited sheet/,
    /disabled=\{Boolean\(ai\.scopeBriefSource\)\}/,
    /Cited handoffs cannot expand into a multi-sheet scan/,
  ],
  "cited count handoffs keep their human decision visible and cannot broaden scan scope",
);

await expectContains(
  "src/lib/ai-takeoff/ai-takeoff.functions.ts",
  [
    /scope_brief_review_id: z\.string\(\)\.uuid\(\)\.optional\(\)/,
    /loadScopeBriefCountRequestContext/,
    /scopeBriefCountReviewSourceError/,
    /request_context: requestContext/,
    /before charging/,
  ],
  "count scans rebuild cited Scope Brief provenance server-side before charging",
);

await expectContains(
  "src/lib/ai-takeoff/ai-count-source-provenance.ts",
  [
    /review\.id !== latestReviewId/,
    /review\.status !== "accepted" \|\| review\.next_action !== "count_review"/,
    /sheetIds\.length !== 1 \|\| sheetIds\[0\] !== review\.plan_sheet_id/,
    /source_kind: "scope_brief"/,
    /scope_brief_review_version/,
  ],
  "Scope Brief count provenance rejects stale routes and binds one cited sheet",
);

await expectContains(
  "src/lib/plan-room.functions.ts",
  [
    /scope_brief_review_id: z\.string\(\)\.uuid\(\)\.nullable\(\)\.optional\(\)/,
    /validateScopeBriefTakeoffSource/,
    /scopeBriefTakeoffSourceError/,
    /scope_brief_review_id: data\.scope_brief_review_id \?\? null/,
    /mutate_estimate_takeoff_measurement_atomic/,
  ],
  "manual LF/SF takeoffs validate and retain their exact Scope Brief review provenance",
);

await expectContains(
  "src/components/estimates/plan-room/PlanScopeBriefPanel.tsx",
  [
    /getPlanScopeBriefWorkOperations/,
    /derivePlanScopeBriefWorkStatus/,
    /scopeBriefWorkStatusLabel/,
    /scopeBriefWorkStatusDetail/,
    /scope-brief-work-/,
  ],
  "Scope Brief derives visible downstream work state from operations and real takeoffs",
);

await expectContains(
  "supabase/migrations/20260716025000_scope_brief_takeoff_provenance.sql",
  [
    /ADD COLUMN IF NOT EXISTS scope_brief_review_id uuid/,
    /REFERENCES public\.estimate_scope_brief_reviews\(id\) ON DELETE RESTRICT/,
    /Scope Brief takeoff provenance is immutable/,
    /v_latest_review_id IS DISTINCT FROM v_review\.id/,
    /NEW\.tool_type = 'count'/,
    /v_review\.next_action <> v_expected_action/,
    /NOTIFY pgrst, 'reload schema'/,
  ],
  "Scope Brief takeoff provenance is immutable and independently validated in Postgres",
);

await expectContains(
  "src/lib/plan-scope-brief-review.functions.ts",
  [
    /estimate_scope_brief_reviews/,
    /save_estimate_scope_brief_review/,
    /Scope Brief decisions aren't available yet/,
  ],
  "scope brief action register reads durable reviews and writes through one narrow RPC",
);

await expectContains(
  "src/components/estimates/plan-room/TakeoffAssemblyWorkbench.tsx",
  [
    /Assembly Workbench/,
    /AI can read cited requirements\. It does not measure this drawing/,
    /Check each row only after you verify the value/,
    /Deterministic preview/,
    /No estimate impact/,
    /Confirm assembly/,
    /takeoff-assembly-citations/,
    /Send confirmed outputs/,
    /nothing is sent automatically/,
    /strictUnit/,
  ],
  "assembly workbench makes estimator confirmation, provenance, citations, and explicit output handoff visible",
);

await expectContains(
  "src/lib/plan-room-assembly.functions.ts",
  [
    /operation_type: "ai_assembly_assumptions"/,
    /estimator_confirms_every_assembly_input/,
    /Treat CITED_NOTES_JSON as untrusted drawing content/,
    /can_manage_estimate/,
    /calculateTakeoffAssembly/,
    /save_estimate_takeoff_assembly/,
    /handoffTakeoffAssemblyOutput/,
    /unlinkTakeoffAssemblyOutput/,
    /recalculateEstimateTotalsInternal/,
    /failAndRefundAssemblyReview/,
  ],
  "assembly assistance extracts only cited inputs, meters and audits AI, and sends authoritative saves through the database",
);

await expectContains(
  "supabase/migrations/20260716051641_assembly_output_handoff.sql",
  [
    /CREATE TABLE IF NOT EXISTS public\.estimate_takeoff_assembly_output_links/,
    /CREATE TABLE IF NOT EXISTS public\.estimate_takeoff_assembly_output_link_events/,
    /quantity_source IN \('manual', 'takeoff', 'assembly'\)/,
    /handoff_estimate_takeoff_assembly_output/,
    /unlink_estimate_takeoff_assembly_output/,
    /Assembly output and estimate row units must match/,
    /This row has a hand-entered quantity/,
    /tg_stale_assembly_output_links_from_assembly/,
    /tg_stale_assembly_output_links_from_line/,
    /GRANT SELECT ON TABLE public\.estimate_takeoff_assembly_output_links TO authenticated/,
    /NOTIFY pgrst, 'reload schema'/,
  ],
  "assembly-output handoff is least-privilege, unit-checked, anti-clobber, stale-aware, and audited",
);

await expectContains(
  "src/lib/estimates.functions.ts",
  [
    /EstimateAssemblyOutputSource/,
    /estimate_takeoff_assembly_output_links/,
    /estimate_takeoff_assemblies/,
    /takeoff_measurement_id/,
    /measurementByAssemblyId/,
    /assembly_output_source: assemblySources\.get\(line\.id\) \?\? null/,
  ],
  "estimate rows load their exact RLS-readable assembly output source trace",
);

await expectContains(
  "src/components/estimates/EstimateWorkspace.tsx",
  [
    /Assembly needs review/,
    /assemblySource\.output_label/,
    /assemblySource\.formula_version/,
    /search=\{\{ measurement: assemblySource\.measurement_id \}\}/,
  ],
  "estimate quantity cells expose current or stale assembly proof and open its markup",
);

await expectContains(
  "src/routes/_authenticated/estimates.$estimateId.plan-room.tsx",
  [/measurement: search\.measurement/, /focusMeasurementId=\{focusMeasurementId\}/],
  "plan room accepts an exact measurement source-trace target",
);

await expectContains(
  "src/components/estimates/plan-room/PlanRoomWorkspace.tsx",
  [
    /focusMeasurementId\?: string/,
    /measurements\.find\(\(item\) => item\.id === focusMeasurementId\)/,
    /setSelectedMeasurementId\(measurement\.id\)/,
    /setSelectedSheetId\(measurement\.plan_sheet_id\)/,
  ],
  "assembly source traces focus the originating takeoff and sheet without mutating them",
);

await expectContains(
  "src/lib/estimate-quantity-source-review.ts",
  [
    /EstimateQuantitySourceIssueStatus/,
    /unverified_scale/,
    /assembly_stale/,
    /linked_review_count/,
    /buildEstimateQuantitySourceReview/,
  ],
  "quantity source review derives current, linked, unlinked, takeoff, and assembly trust states",
);

await expectContains(
  "src/lib/estimates.functions.ts",
  [
    /loadEstimateQuantitySourceReview/,
    /estimate_takeoff_measurements/,
    /estimate_plan_sheets/,
    /quantity_source_review/,
    /emptyEstimateQuantitySourceReview\(false\)/,
  ],
  "estimate loading exposes a read-only quantity trust queue without blocking pre-migration workspaces",
);

await expectContains(
  "src/components/estimates/EstimateQuantitySourceReview.tsx",
  [
    /Quantity Source Review/,
    /Nothing here changes\s+or\s+resyncs a worksheet row automatically/,
    /Plan Room only\. This quantity does not feed the estimate/,
    /Review markup/,
    /search=\{\{ measurement: item\.measurement_id \}\}/,
  ],
  "estimate-wide quantity review names trust issues and routes only to exact evidence",
);

await expectContains(
  "src/components/estimates/EstimateWorkspace.tsx",
  [/Takeoff needs review/, /takeoffIssueByLineId/, /review=\{quantitySourceReview\}/],
  "takeoff-fed worksheet rows warn when their source quantity needs review",
);

await expectContains(
  "src/lib/estimate-review-gate.ts",
  [
    /buildEstimateReviewGate/,
    /linked_quantity_blockers/,
    /unpriced_active_rows/,
    /zero_quantity_rows/,
    /plan_room_follow_ups/,
  ],
  "estimate review gate derives blockers and follow-ups without claiming bid certification",
);

await expectContains(
  "src/components/estimates/EstimateReviewGate.tsx",
  [
    /Estimate Review Gate/,
    /does not certify/,
    /Human sign-off remains required/,
    /estimate-review-gate/,
  ],
  "estimate review gate keeps estimator authority and names its limited proof surface",
);

await expectContains(
  "src/components/estimates/EstimateWorkspace.tsx",
  [
    /buildEstimateReviewGate/,
    /<EstimateReviewGate/,
    /id="estimate-line-items"/,
    /<EstimateQuantitySourceReview/,
  ],
  "estimate workspace places the review gate ahead of source detail and line items",
);

await expectContains(
  "src/components/estimates/EstimateReviewActivity.tsx",
  [
    /Estimate Sign-off/,
    /Any later change makes the sign-off\s+stale/,
    /not an AI certification/,
    /estimate-signoff-submit/,
    /Recent sign-off activity/,
  ],
  "estimate sign-off keeps estimator accountability, stale-state meaning, and history visible",
);

await expectContains(
  "src/components/estimates/EstimateWorkspace.tsx",
  [
    /<EstimateReviewActivity/,
    /estimateReleaseNeedsOverride/,
    /override_export_csv/,
    /override_export_pdf/,
    /override_push_project/,
    /Record Override & Continue/,
  ],
  "estimate exports and project push require current sign-off or an audited reason",
);

await expectContains(
  "src/lib/takeoff-assembly.ts",
  [
    /assembly-engine-v1/,
    /interior_wall/,
    /continuous_footing/,
    /mep_linear_run/,
    /surface_finish/,
    /parseTakeoffAssemblyInputProposals/,
    /rounded up/,
  ],
  "assembly domain provides versioned deterministic formulas and evidence-filtered AI proposals",
);

await expectContains(
  "src/components/estimates/plan-room/PlanRevisionReviewPanel.tsx",
  [
    /Estimator-controlled sheet matching/,
    /metadata only/,
    /No geometry comparison/,
    /Accept pair/,
    /Reject suggestion/,
    /No prior match/,
    /No takeoffs, scales, or estimate values changed/,
  ],
  "revision review keeps metadata evidence, estimator decisions, and no-impact authority visible",
);

await expectContains(
  "src/lib/plan-revision-match.functions.ts",
  [
    /Match identity, not geometry/,
    /operation_type: "ai_revision_match"/,
    /Choose only an allowed base_sheet_id/,
    /save_estimate_plan_revision_decisions/,
    /failAndRefund/,
  ],
  "revision matching constrains, meters, audits, and refunds metadata-only AI review",
);

await expectContains(
  "supabase/migrations/20260715205000_plan_revision_matching.sql",
  [
    /estimate_plan_revision_matches/,
    /estimate_plan_revision_match_events/,
    /save_estimate_plan_revision_decisions/,
    /can_manage_estimate/,
    /created_at < v_set\.created_at/,
    /review_action = 'accepted'/,
    /GRANT SELECT ON TABLE public\.estimate_plan_revision_matches TO authenticated/i,
    /NOTIFY pgrst, 'reload schema'/i,
  ],
  "revision decisions are manager-validated, prior-set constrained, read-only, and append-only audited",
);

await expectContains(
  "src/components/estimates/plan-room/PlanRevisionImpactRegister.tsx",
  [
    /Revision impact register/,
    /AI may surface cited note differences, but it does not determine the delta/,
    /append-only review version/,
    /does\s+not transfer takeoffs, retain scale, or\s+change the estimate/,
    /revisionImpactActions/,
    /revisionImpactActionLabel/,
  ],
  "revision delta triage keeps impact conclusions and follow-up actions under estimator control",
);

await expectContains(
  "supabase/migrations/20260715210251_933f23c0-f9bd-40da-b4ca-8cc3c4b2580e.sql",
  [
    /estimate_plan_revision_impact_reviews/,
    /save_estimate_plan_revision_impact_review/,
    /review_action <> 'accepted'/,
    /can_manage_estimate/,
    /GRANT SELECT ON TABLE public\.estimate_plan_revision_impact_reviews TO authenticated/i,
    /REVOKE ALL ON FUNCTION public\.save_estimate_plan_revision_impact_review[\s\S]*FROM PUBLIC/i,
    /NOTIFY pgrst, 'reload schema'/i,
  ],
  "revision impact reviews are append-only, accepted-pair-bound, manager-authored, and read-only through the Data API",
);

await expectContains(
  "src/lib/plan-revision-scope-assistant.ts",
  [
    /sourceExcerptIsSupported/,
    /CONSTRUCTION_SCOPE_PATTERN/,
    /AI compared selectable note text only/,
    /category: "unknown"/,
    /required_action: "scope_review"/,
    /ai_revision_scope_review/,
  ],
  "revision note AI is citation-gated and can only create an unclassified estimator review task",
);

await expectContains(
  "supabase/migrations/20260715213051_c90abab6-08c4-4b95-a5b9-f1af7f1148cb.sql",
  [
    /ai_revision_scope_review/,
    /operation\.sheet_ids @> ARRAY\[v_match\.revision_sheet_id, v_match\.base_sheet_id\]/,
    /candidate\.value ->> 'id' = v_ai_candidate_id/,
    /review_action <> 'accepted'/,
    /can_manage_estimate/,
    /ai_provenance/,
    /REVOKE ALL ON FUNCTION public\.save_estimate_plan_revision_impact_review[\s\S]*FROM PUBLIC/i,
    /NOTIFY pgrst, 'reload schema'/i,
  ],
  "AI revision candidates retain completed-operation citations through the estimator-authored impact review",
);

await expectContains(
  "src/components/estimates/plan-room/PdfSheetViewer.tsx",
  [/measurement-evidence-highlight/, /cited note/, /evidenceFocus/],
  "measurement evidence navigation highlights and centers the cited PDF note",
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
    /plan-revision-new-layer/,
    /plan-revision-redline-legend/,
    /revision-new-green/,
    /revision-old-red/,
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
    /takeoff-draft-hud-cancel/,
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
    /COCKPIT_PANEL_MOVE_RESERVE/,
    /overwatch\.plan-room\.cockpit-panels\.v3/,
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
    /mutate_estimate_takeoff_measurement_atomic/,
    /recalculate_estimate_takeoff_sheet_atomic/,
    /syncTakeoffQuantityToLine/,
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
    /add column if not exists scale_revision integer not null default 1/i,
    /calculation_method varchar\(32\) not null default 'legacy'/i,
    /calculation_status varchar\(32\) not null default 'review_required'/i,
    /ai_operation_id uuid references public\.ai_operations\(id\) on delete set null/i,
    /create or replace function public\.tg_plan_sheet_takeoff_trust\(\)/i,
    /new\.scale_revision := old\.scale_revision \+ 1/i,
    /create or replace function public\.tg_invalidate_takeoffs_for_sheet_scale\(\)/i,
    /calculation_status = case[\s\S]*when calculation_method = 'manual_override' then 'review_required'[\s\S]*else 'stale'/i,
    /notify pgrst, 'reload schema'/i,
  ],
  "takeoff trust migration versions scales, invalidates dependent work, records AI review, and refreshes the API schema",
);

expectSql(
  sql,
  [
    /create table if not exists public\.estimate_review_activities/i,
    /activity_type in[\s\S]*'signoff'[\s\S]*'override_export_csv'[\s\S]*'override_push_project'/i,
    /grant select on table public\.estimate_review_activities to authenticated/i,
    /create policy estimate_review_activities_team_select/i,
    /using \(public\.can_read_estimate\(estimate_id\)\)/i,
    /create or replace function public\.build_estimate_review_snapshot/i,
    /create or replace function public\.get_estimate_review_state/i,
    /create or replace function public\.record_estimate_review_activity/i,
    /not public\.can_manage_estimate\(p_estimate_id\)/i,
    /resolve every blocking review item before signing off this estimate/i,
    /revoke all on function public\.build_estimate_review_snapshot\(uuid\)[\s\S]*from public, anon, authenticated, service_role/i,
    /revoke all on function public\.record_estimate_review_activity\(uuid, text, text\)[\s\S]*from public, anon, authenticated, service_role/i,
    /notify pgrst, 'reload schema'/i,
  ],
  "estimate sign-off is append-only, manager-authored, snapshot-bound, RLS-readable, and override-audited",
);

expectSql(
  sql,
  [
    /revoke all on table public\.estimate_scale_assessments from authenticated/i,
    /grant select, insert on table public\.estimate_scale_assessments to authenticated/i,
    /ai_measurement_plan/i,
    /add column if not exists request_context jsonb not null default '\{\}'::jsonb/i,
    /add column if not exists result jsonb not null default '\{\}'::jsonb/i,
    /notify pgrst, 'reload schema'/i,
  ],
  "guided measurement migration preserves scale evidence least privilege and adds audited AI planning",
);

expectSql(
  sql,
  [
    /ai_scope_brief/i,
    /drop constraint if exists credit_ledger_reason_check/i,
    /drop constraint if exists ai_operations_operation_type_check/i,
    /notify pgrst, 'reload schema'/i,
  ],
  "estimator scope brief migration registers the audited operation and credit reason without a new write surface",
);

expectSql(
  sql,
  [
    /create table if not exists public\.estimate_scope_brief_reviews/i,
    /status in \('accepted', 'deferred', 'excluded'\)/i,
    /grant select on table public\.estimate_scope_brief_reviews to authenticated/i,
    /create policy estimate_scope_brief_reviews_team_select/i,
    /create or replace function public\.save_estimate_scope_brief_review/i,
    /operation_type <> 'ai_scope_brief'/i,
    /not public\.can_manage_estimate\(v_operation\.estimate_id\)/i,
    /the cited prompt is not retained in this completed scope brief/i,
    /explain why this cited scope is excluded/i,
    /explain why the next action differs from the cited review type/i,
    /security definer[\s\S]*set search_path = ''/i,
    /revoke all on function public\.save_estimate_scope_brief_review[\s\S]*from public, anon/i,
    /notify pgrst, 'reload schema'/i,
  ],
  "scope brief decisions are append-only, operation-bound, manager-authored, and read-only through the Data API",
);

expectSql(
  sql,
  [
    /create table if not exists public\.estimate_measurement_scope_items/i,
    /create table if not exists public\.estimate_measurement_scope_events/i,
    /status in \('accepted', 'rejected', 'deferred', 'completed'\)/i,
    /grant select on table public\.estimate_measurement_scope_items to authenticated/i,
    /grant select on table public\.estimate_measurement_scope_events to authenticated/i,
    /create policy estimate_measurement_scope_items_team_select/i,
    /create policy estimate_measurement_scope_events_team_select/i,
    /create or replace function public\.record_estimate_measurement_scope_decision/i,
    /create or replace function public\.complete_estimate_measurement_scope_item/i,
    /only queued scope can be completed/i,
    /security definer[\s\S]*set search_path = ''/i,
    /notify pgrst, 'reload schema'/i,
  ],
  "measurement scope queue is durable, least-privilege, reviewer-owned, and RLS protected",
);

expectSql(
  sql,
  [
    /create table if not exists public\.estimate_takeoff_assemblies/i,
    /create table if not exists public\.estimate_takeoff_assembly_outputs/i,
    /create table if not exists public\.estimate_takeoff_assembly_events/i,
    /grant select on table public\.estimate_takeoff_assemblies to authenticated/i,
    /create policy estimate_takeoff_assemblies_team_select/i,
    /create or replace function public\.calculate_takeoff_assembly_outputs/i,
    /create or replace function public\.save_estimate_takeoff_assembly/i,
    /a current trusted linear or area takeoff is required/i,
    /create or replace function public\.tg_invalidate_takeoff_assembly/i,
    /action in \('saved_draft', 'confirmed', 'invalidated'\)/i,
    /security definer[\s\S]*set search_path = ''/i,
    /ai_assembly_assumptions/i,
    /notify pgrst, 'reload schema'/i,
  ],
  "takeoff assemblies are database-calculated, least-privilege, cited, versioned, and invalidated when geometry trust changes",
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
    /stripe_connect_account_id_test/i,
    /stripe_connect_status_test/i,
    /stripe_connect_account_id_live/i,
    /stripe_connect_status_live/i,
    /stripe_webhook_events[\s\S]*livemode boolean/i,
  ],
  "Stripe live cutover keeps sandbox/live connected accounts separate and tags webhook mode",
);

expectSql(
  sql,
  [
    /stripe_payment_limit_cents bigint not null default 2500000/i,
    /create table if not exists public\.stripe_limit_requests/i,
    /stripe_limit_requests_one_open_per_org_idx/i,
    /alter table public\.stripe_limit_requests enable row level security/i,
    /alter table public\.notifications[\s\S]*add column if not exists dedupe_key text/i,
    /notifications_recipient_dedupe_key_idx/i,
  ],
  "Stripe payment guardrails cap each company, track increase requests, and dedupe paid notifications",
);

await expectContains(
  "src/components/notifications/NotificationBell.tsx",
  [/billing\.paid/, /mark_all_notifications_read/, /Notifications/],
  "authenticated headers expose the in-app notification inbox",
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
    // STRIPEIDEMPOTENCY1: record processing OUTCOME, not just the sighting.
    /add column if not exists status text not null default 'processed'[\s\S]*check \(status in \('processing', 'processed'\)\)/i,
    /add column if not exists claimed_at timestamptz not null default now\(\)/i,
    /idx_stripe_webhook_events_status_claimed_at/i,
  ],
  "Webhook idempotency gains a processing-state column (default 'processed' so legacy rows still skip) plus a stale-claim sweep index",
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
    /create table if not exists public\.project_selections/i,
    /create table if not exists public\.project_selection_options/i,
    /create table if not exists public\.project_selection_decisions/i,
    /can_view_client_selections/i,
    /record_client_selection_decision/i,
    /grant select, insert, update, delete on public\.project_selections to authenticated/i,
    /enable row level security/i,
  ],
  "selections migration ships CPM-linked packages, client audit decisions, grants, and RLS",
);

await expectContains(
  "src/components/outcome/SelectionsWorkspace.tsx",
  [/listProjectSelections/, /sendSelectionForClientDecision/, /selection-notification/],
  "internal selections board loads, sends, and advances procurement",
);

await expectContains(
  "src/components/outcome/ClientSelectionsPanel.tsx",
  [/listClientSelections/, /recordClientSelectionDecision/, /Approve selected option/],
  "client portal renders immutable selection decisions",
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

await expectContains(
  "supabase/migrations/20260714223256_commercial_entitlements.sql",
  [
    /\('free', 'OverWatch Free', 0, 1, 2, 1024, 50, 50/,
    /\('pro', 'OverWatch Pro', 39900, 25, 10, 25600, 1000, 500/,
    /prod_Ut3G95JuhW8x9i/,
    /price_1TtHC6JGLltOYaii8jAmLwbx/,
    /ensure_monthly_ai_credit_grant/,
    /projects_enforce_organization_limit/,
    /entitlement_source/,
    /tg_organizations_signup_credits/,
  ],
  "commercial entitlements migration defines Free, Pro, Circle inclusion, monthly AI credits, and project enforcement",
);

await expectContains(
  "src/lib/contractor-circle-entitlements.server.ts",
  [
    /CONTRACTOR_CIRCLE_SHARED_SECRET/,
    /x-overwatch-signature/,
    /status: "unavailable"/,
    /existing rollout grant remains protected/i,
    /entitlement_source: hasActiveProSubscription \? "stripe" : "free"/,
  ],
  "Contractor Circle membership sync is signed, fail-open, and restores Pro or Free safely",
);

await expectContains(
  "src/lib/team.functions.ts",
  [
    /refreshContractorCircleEntitlement/,
    /reconcileContractorCircleEntitlement/,
    /automatic entitlement refresh failed open/i,
  ],
  "company settings automatically and manually reconcile Contractor Circle included access",
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
  "src/components/project/BudgetLedgerTable.tsx",
  [/No budget lines yet/, /Add line/],
  "budget ledger teaches the import/add path when empty",
);

// NAVLABELS: the "More" overflow menu is retired — every destination lives on
// the labeled, grouped rail. Reviews & Reports sits in the IOR cluster; deep
// links (?tab=…) still resolve via setProjectTab / the search-sync effect.
await expectContains(
  "src/routes/_authenticated/projects.$projectId.tsx",
  [
    // Every destination is rendered from its group; nothing is demoted to "More".
    /group\.values\.map\(\(value\) => \{/,
    /const item = navItemByValue\.get\(value\);/,
    /key: "ior"[\s\S]*values: \["dashboard", "risk-tally", "todos", "claims", "ior-report"\]/,
    /label: "Reviews & Reports"/,
    // Deep-link resolution is unchanged.
    /if \(search\.tab\) setProjectTab\(search\.tab\)/,
  ],
  "project nav rail renders every tab from its group; IOR reports stay with IOR and deep links still resolve (NAVLABELS)",
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
expectSql(
  sql,
  [
    /CREATE TABLE IF NOT EXISTS public\.exposure_allocation_operations/i,
    /create or replace function public\.create_exposure_allocation_atomic/i,
    /create or replace function public\.update_exposure_allocation_atomic/i,
    /create or replace function public\.delete_exposure_allocation_atomic/i,
    /Total allocations cannot exceed the authoritative exposure value/,
    /revoke insert, update, delete on table public\.exposure_allocations[\s\S]*from authenticated, service_role/i,
  ],
  "exposure allocation commands serialize financial truth, cap risk dollars, and revoke raw writes",
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
  "src/lib/exposure-allocations.functions.ts",
  [
    /export const createExposureAllocation/,
    /export const updateExposureAllocation/,
    /export const deleteExposureAllocation/,
    /export const listExposureAllocations/,
    /create_exposure_allocation_atomic/,
    /update_exposure_allocation_atomic/,
    /delete_exposure_allocation_atomic/,
    /p_expected_version/,
    /p_operation_key/,
  ],
  "exposure allocation server fns use versioned, idempotent financial commands and fail closed",
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
  [
    /ExposureAllocationPanel/,
    /exposureAllocationsQuery/,
    /createExposureAllocationFn/,
    /updateExposureAllocationFn/,
    /\.mutateAsync\(input\)/,
  ],
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
  // BUDGETCONSOLIDATE1: the Budget tab is ONE table — the budget-vs-cost ledger,
  // made clickable — and its line editor drawer. The old redundant "Edit budget
  // lines" grid is gone; you open a line to edit it.
  [/<BudgetLedgerTable[\s\S]*?onOpenLine=[\s\S]*?<BudgetLineDrawer/],
  "Budget tab is one clickable ledger with a line-editor drawer",
);

// BILLINGSOV1 (founder decision 2026-07-14): Billing starts with the owner-facing
// Schedule of Values, never the internal build budget. The standalone Budget
// workspace keeps the budget-vs-cost ledger; Billing renders a contract-only SOV
// table from line contract values and approved change-order allocations.
await expectContains(
  "src/components/project/billing/BillingWorkspace.tsx",
  [
    /import \{ BillingSovTable \}/,
    // The technical key stays "budget" so existing deep links remain valid;
    // the user-facing stage and panel are SOV throughout.
    /value: "budget",[\s\S]*?title: "SOV",/,
    /budget: \{[\s\S]*?title: "Schedule of values",/,
    /<BillingSovTable[\s\S]*?buckets=\{buckets\}[\s\S]*?changeOrders=\{changeOrders\}[\s\S]*?changeOrderAllocations=/,
  ],
  "billing workspace starts with the owner-facing SOV stage",
);
await expectContains(
  "src/components/project/billing/BillingSovTable.tsx",
  [/Original SOV/, /Approved COs/, /Revised SOV/, /Owner-facing contract value/],
  "billing SOV separates owner contract value from the internal build budget",
);
await expectContains(
  "src/routes/_authenticated/projects.$projectId.tsx",
  [/label: "Budget"/, /title="Budget"/, /<BudgetLedgerTable[\s\S]*?onOpenLine=/],
  "standalone Budget remains the internal editable cost ledger",
);

// BUDGETLOCK1 (founder decision 2026-07-06): the budget is a locked baseline —
// the ONLY thing that moves it is an approved change order's budgeted cost.
// Financial hardening moved enforcement from client-side checks into the
// database commands: the lock is an atomic verified RPC, and every baseline
// write path refuses when budget_locked_at is set. The enforcement (and the
// first-pay-app auto-lock) must never quietly disappear.
await expectContains(
  "src/lib/projects.functions.ts",
  [
    /export const lockProjectBudget/,
    /lock_project_budget_atomic/,
    /readProjectBudgetLock/,
    /No baseline mutation is permitted until the locked state is confirmed/,
  ],
  "budget lock is an atomic database command whose commit is verified (BUDGETLOCK1)",
);
await expectContains(
  "supabase/migrations/20260720183243_budget_sov_authority_commands.sql",
  [
    /The budget is locked\. Baseline money changes must flow through approved change orders\./,
    /The budget is locked\. A priced or budgeted SOV line cannot be deleted\./,
    /The budget is locked\. Replace or append imports cannot rewrite the frozen baseline\./,
  ],
  "locked budgets refuse baseline money changes at the database (BUDGETLOCK1)",
);
await expectContains(
  "supabase/migrations/20260720170500_billing_application_command_integrity.sql",
  [
    // The first pay application freezes the baseline.
    /set budget_locked_at = coalesce\(budget_locked_at, now\(\)\)/,
  ],
  "the first pay application auto-locks the budget inside the pay-app command (BUDGETLOCK1)",
);
await expectContains(
  "src/lib/budget-ledger.ts",
  [/changeOrderBudget/, /status === "Approved"/, /Change orders \(unallocated\)/],
  "budget ledger layers approved change-order cost onto the frozen baseline (BUDGETLOCK1)",
);

// BUDGETVSCONTRACT1 (founder decision 2026-07-06, from a live user report):
// every SOV line carries BOTH numbers — contract_value (what the owner pays)
// and original_budget (our cost) — and the delta is the margin. An unpriced
// line must never masquerade as zero margin, and the SOV import must bill the
// contract, never the budget.
await expectContains(
  "src/lib/budget-ledger.ts",
  [
    /contract_value: number/,
    /contractValue/,
    /export function ledgerLineMargin/,
    /priced: boolean/,
    // The contract column must NEVER fall back to budget.
    /NEVER falls back to budget/,
  ],
  "budget ledger carries contract value + margin per line, with an explicit unpriced state",
);
await expectContains(
  "src/lib/billing-line-generation.ts",
  [/lineScheduledBasis/, /contract_value/],
  "SOV import bills the line's contract value, not the cost budget (BUDGETVSCONTRACT1)",
);
await expectContains(
  "src/components/outcome/BudgetLineDrawer.tsx",
  [/Contract value/, /patch\.contract_value = contractValue/],
  "budget line editor captures contract value and budget as two clearly-labeled fields",
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
    // Financial hardening: the carry is a single atomic, retry-keyed database
    // command; the server no longer stitches buckets together client-side.
    /export const buildBudgetFromEstimate/,
    /build_budget_from_estimate_atomic/,
    /p_operation_key: data\.operation_key/,
  ],
  "buildBudgetFromEstimate is an atomic retry-keyed carry command",
);
await expectContains(
  "supabase/migrations/20260720183243_budget_sov_authority_commands.sql",
  [
    /No Overwatch estimate is linked to this project\. Enter the budget manually\./,
    /The linked estimate has no line items to carry into the budget\./,
  ],
  "the carry command refuses honestly when no estimate or no lines exist",
);
await expectContains(
  "src/routes/_authenticated/projects.$projectId.tsx",
  [
    /buildBudgetFromEstimateFn/,
    /Build from estimate/, // v2 relabel (mock)
    /Build the budget from the estimate\?/,
  ],
  "SOV/Costs tab offers the estimate→budget carry behind a confirm",
);

// BUDGETVSCONTRACT2 (founder decision 2026-07-07): the estimate carry lets the
// user CHOOSE how contract value gets set — auto-price (pro-rata markup
// distribution, editable) or leave unpriced for manual entry. Auto never
// fabricates a contract equal to cost.
await expectContains(
  "src/lib/estimate-budget.ts",
  [/estimateHasDistributableMarkup/, /contractTotalCents/, /contractValue/],
  "estimate carry can propose per-line contract by distributing markup pro-rata (BUDGETVSCONTRACT2)",
);
await expectContains(
  "src/lib/projects.functions.ts",
  [/pricing: z\.enum\(\["unpriced", "auto"\]\)/],
  "buildBudgetFromEstimate takes a pricing mode (BUDGETVSCONTRACT2)",
);
await expectContains(
  "supabase/migrations/20260720183243_budget_sov_authority_commands.sql",
  [
    // Auto-price only when the estimate carries REAL markup above cost — the
    // command never fabricates a contract equal to cost.
    /v_priced := p_pricing = 'auto'[\s\S]{0,120}v_contract_total_cents > v_subtotal_cents/,
    /v_remainder_cents := v_contract_total_cents - v_assigned_cents/,
  ],
  "auto-price distributes real markup pro-rata inside the carry command, cents-exact (BUDGETVSCONTRACT2)",
);
await expectContains(
  "src/routes/_authenticated/projects.$projectId.tsx",
  [/Auto-price from the estimate/, /I'll enter contract values myself/],
  "the estimate-carry dialog offers auto-price vs manual contract entry (BUDGETVSCONTRACT2)",
);

// SUBCONTRACTORS Slice 1 (founder green-lit 2026-07-07): buyouts are committed
// cost, payments are actual cost, folded into the budget ledger ADDITIVELY
// (nothing touches cost_actuals or the shared trigger).
await expectContains(
  "src/lib/subcontract-budget.ts",
  [/summarizeSubCostByBucket/, /committed/, /paid/, /open/, /distributeCents/],
  "subcontract layer summarizes committed/paid/open per bucket, cents-safe",
);
await expectContains(
  "src/lib/budget-ledger.ts",
  [
    /subCostByBucket/,
    /subCost\.paid/,
    /subCost\.open/,
    /selfPerformFtcCents/,
    /subCost\.committed/,
  ],
  "computeBudgetLedger folds the sub layer with the buyout DISPLACING (not stacking on) the code's forecast",
);
await expectContains(
  "src/components/project/SubcontractorsWorkspace.tsx",
  [/summarizeSubPayments/, /Buy out/, /SubcontractCard/],
  "Subcontractors workspace: directory, buyout, and the per-sub card",
);
await expectContains(
  "src/components/project/SubcontractCard.tsx",
  [
    /Record pay app/, // v2: new-pay-app form relocated into a modal
    /Retainage held/,
    /New commitment/,
    /onUpdatePayment/,
    /onEditBuyout/,
    /Upload amendment \/ new version/,
    /Make active/,
  ],
  "Subcontract card: versioned contracts, payments (date + description), edit-in-place, change-the-commitment",
);
await expectContains(
  "src/routes/_authenticated/projects.$projectId.tsx",
  [/"subcontractors"/, /SubcontractorsWorkspace/, /summarizeSubCostByBucket/],
  "project route wires the Subcontractors tab and feeds the sub layer into the Budget ledger",
);
await expectContains(
  "supabase/migrations/20260708000000_subcontractors.sql",
  [
    /CREATE TABLE IF NOT EXISTS public\.subcontractors/,
    /CREATE TABLE IF NOT EXISTS public\.subcontracts/,
    /CREATE TABLE IF NOT EXISTS public\.subcontract_allocations/,
    /CREATE TABLE IF NOT EXISTS public\.subcontract_payments/,
  ],
  "subcontractors migration ships all four tables (desk applies)",
);
// SUBCONTRACTORS Slice 2 (founder 2026-07-08): executed-contract upload +
// daily-WIP × subs data link. (The daily-WIP dropdown UI is a fast-follow after
// the parallel daily-WIP PR settles, to avoid a merge collision.)
await expectContains(
  "supabase/migrations/20260708060000_subcontracts_slice2.sql",
  [
    /executed_contract_path text/,
    /storage\.buckets/,
    /'subcontract-docs'/,
    /ALTER TABLE public\.daily_wip_entries[\s\S]*subcontractor_id uuid/,
  ],
  "Slice 2 migration ships the executed-contract bucket + daily_wip subcontractor link (desk applies)",
);
// SUBCONTRACTORS Slice 3 (founder 2026-07-08): versioned contract paper trail —
// many documents per subcontract, one active, prior versions kept for reference.
await expectContains(
  "supabase/migrations/20260708150000_subcontract_documents.sql",
  [
    /CREATE TABLE IF NOT EXISTS public\.subcontract_documents/,
    /is_active boolean/,
    /public\.can_read_project\(project_id\)/,
    /INSERT INTO public\.subcontract_documents/,
  ],
  "Slice 3 migration ships the versioned subcontract_documents table (desk applies)",
);
await expectContains(
  "src/lib/subcontracts.functions.ts",
  [
    /addSubcontractDocument/,
    /setActiveSubcontractDocument/,
    /deleteSubcontractDocument/,
    /documents:/,
  ],
  "subcontract server fns manage the versioned contract paper trail",
);
await expectContains(
  "src/components/project/SubcontractorsWorkspace.tsx",
  [/subcontract-docs/, /createSignedUrl/],
  "Subcontractors workspace uploads + views the contract versions (storage side)",
);
await expectContains(
  "src/lib/daily-wip.functions.ts",
  [/subcontractor_id: z\.string\(\)\.uuid\(\)\.nullable\(\)/],
  "daily-WIP entry accepts a subcontractor link (self-perform ↔ sub)",
);
await expectContains(
  "src/components/outcome/DailyWipWorkspace.tsx",
  [/PerformedByField/, /draft\.subcontractor_id/, /subOptions/],
  "daily-WIP workspace has the performed-by picker (self-perform ↔ sub)",
);
await expectContains(
  "supabase/migrations/20260713205235_daily_wip_unmatched_vendor_name.sql",
  [
    /ADD COLUMN IF NOT EXISTS unmatched_vendor_name text/,
    /daily_wip_entries_performed_by_check/,
    /subcontractor_id IS NOT NULL/,
  ],
  "daily-WIP migration preserves unlisted field vendors without conflicting with canonical subcontractor links",
);
await expectContains(
  "src/components/outcome/DailyLogWorkLines.tsx",
  [/PerformedByField/, /listProjectSubcontracts/, /unmatched_vendor_name/],
  "daily log offers bought-out project subcontractors plus a durable unlisted-vendor fallback",
);
await expectContains(
  "src/components/outcome/DailyWipWorkspace.tsx",
  [/PerformedByField/, /unmatched_vendor_name/, /Match vendor/],
  "daily-WIP flags unlisted vendors and lets the PM replace them with a project subcontractor",
);
await expectContains(
  "src/components/outcome/PerformedByField.tsx",
  [/Performed by subcontractor/, /Vendor not listed\? Enter the company name/, /flagUnmatched/],
  "shared performed-by field keeps canonical project subs and unlisted vendor entry mutually exclusive",
);
await expectContains(
  "supabase/migrations/20260714172833_daily_wip_production_targets.sql",
  [
    /people_per_crew smallint not null default 2/,
    /target_production_rate numeric/,
    /daily_wip_people_per_crew_check/,
    /daily_wip_target_production_rate_check/,
  ],
  "daily-WIP production target migration stores bounded crew sizing and optional pace targets",
);
await expectContains(
  "src/components/outcome/DailyLogWorkLines.tsx",
  [/people_per_crew/, /People per crew/, /target_production_rate: money\?\.target_production_rate/],
  "daily log records actual crew size while preserving the PM production target",
);
await expectContains(
  "src/components/outcome/DailyWipWorkspace.tsx",
  [
    /Production rate setup/,
    /Choose production measure/,
    /Target pace/,
    /installed output divided by total labor-hours/,
    /max-w-5xl/,
    /effectiveProductionTargetFor/,
    /productionPace\(/,
    /No target set/,
  ],
  "daily WIP compares actual production with the derived subcontract or explicit PM target",
);
await expectContains(
  "supabase/migrations/20260715010910_b080292c-8a1b-44b3-ad19-c16402ee2e23.sql",
  [/planned_quantity/, /benchmark_labor_rate/, /subcontract_allocations/],
  "subcontract allocations persist the physical scope and GC labor-equivalent benchmark",
);
await expectContains(
  "src/components/project/SubcontractCard.tsx",
  [/Set production benchmark/, /Planned scope quantity/, /GC loaded benchmark/],
  "subcontract buyout allocations expose the production benchmark setup",
);

// SUB CO → BUDGET FOLD (field feedback 2026-07-09: "change orders didnt roll up
// to the dashboards"): a coded sub CO folds into that code's committed in
// summarizeSubCostByBucket, and every call site (grid, dashboard, portfolio,
// job-cost report) feeds the change-order rows in.
await expectContains(
  "src/lib/subcontract-budget.ts",
  [
    /SubChangeOrderBudgetLike/,
    /changeOrders: SubChangeOrderBudgetLike\[\] = \[\]/,
    /for \(const co of changeOrders\)/,
  ],
  "sub budget layer folds coded change orders into committed",
);
await expectContains(
  "src/lib/projects.functions.ts",
  [/subcontract_change_orders/],
  "dashboard + portfolio rollups fetch sub change orders for the committed fold",
);
await expectContains(
  "src/lib/billing.functions.ts",
  [/subcontract_change_orders/, /subCosByProject/],
  "job-cost reporting folds sub change orders the same way",
);
await expectContains(
  "src/components/project/SubcontractCard.tsx",
  [/carries into that code(&apos;|')s committed/],
  "the CO register copy explains coded COs auto-carry into the budget",
);

// PER-PAYMENT COST-CODE SPLIT (field feedback 2026-07-09: "for progress
// payments i dont see where to add which cost code it goes to"): the payment's
// split is now EDITABLE — explicit rows replace the pro-rata derivation, must
// sum cents-exact to the payment, and drive the budget's paid-per-code.
await expectContains(
  "supabase/migrations/20260710003000_subcontract_payment_allocations.sql",
  [
    /CREATE TABLE IF NOT EXISTS public\.subcontract_payment_allocations/,
    /payment_id uuid NOT NULL REFERENCES public\.subcontract_payments\(id\) ON DELETE CASCADE/,
    /tg_set_updated_at/,
    /public\.can_manage_project\(project_id\)/,
  ],
  "payment-split migration ships the explicit split table + trigger + team RLS (desk applies)",
);
await expectContains(
  "src/lib/subcontracts.functions.ts",
  [
    /export const setSubcontractPaymentSplit/,
    /replace_subcontract_payment_allocations_atomic/,
    /payment_allocations: paymentAllocations\.map\(normalizePaymentAllocation\)/,
  ],
  "server replaces a payment's split atomically and enforces the cents-exact sum",
);
await expectContains(
  "supabase/migrations/20260720153030_financial_integrity_atomic_subcontract_and_estimate_import.sql",
  [
    /The split must add up to the payment amount exactly/,
    /CREATE OR REPLACE FUNCTION public\.replace_subcontract_payment_allocations_atomic/,
    /CREATE OR REPLACE FUNCTION public\.tg_recalculate_estimate_line_totals/,
    /AFTER INSERT ON public\.estimate_line_items/,
    /AFTER UPDATE ON public\.estimate_line_items/,
    /AFTER DELETE ON public\.estimate_line_items/,
  ],
  "database atomically validates payment splits and recalculates estimate totals after line changes",
);
await expectContains(
  "src/lib/subcontract-budget.ts",
  [/PaymentSplitLike/, /explicitlySplitIds/, /paymentSplits: PaymentSplitLike\[\] = \[\]/],
  "budget layer routes explicitly-coded payments verbatim and pro-rates the rest",
);
await expectContains(
  "src/components/project/PaymentSplitEditor.tsx",
  [/export function PaymentSplitEditor/, /Reset to automatic/, /left to code/, /Save split/],
  "payment split editor edits lines, balances to the payment, and can reset to auto",
);
await expectContains(
  "src/components/project/SubcontractorsWorkspace.tsx",
  [/setSubcontractPaymentSplit/, /paymentSplits={/, /onSaveSplit=/],
  "subcontractors workspace wires the split editor save path",
);

// PROJECTFILEROOM1: the project file room — one home for the job's paper. Storage
// mirrors subcontract-docs (private bucket, client upload + signed URL); the
// server fn owns the metadata row; the tab is wired onto the project nav rail.
await expectContains(
  "src/lib/project-documents.functions.ts",
  [
    /export const listProjectDocuments/,
    /export const recordProjectDocument/,
    /export const archiveProjectDocument/,
    /PROJECT_DOC_CATEGORIES/,
    /projectDocCategorySchema/,
    /category: projectDocCategorySchema/,
  ],
  "file room server fns accept validated preset or user-created categories",
);
await expectNotContains(
  "src/lib/project-documents.functions.ts",
  [/category: z\.enum\(PROJECT_DOC_CATEGORIES\)/],
  "file room server fns do not restrict documents to the preset category vocabulary",
);
await expectContains(
  "src/components/project/ProjectFileRoom.tsx",
  [
    /project-docs/,
    /createSignedUrl/,
    /Upload document/,
    /prime_contract/,
    /Create a category…/,
    /New category name/,
    /categoryOptions\.map/,
  ],
  "file room uploads privately and creates, reuses, and filters custom categories",
);
await expectContains(
  "src/routes/_authenticated/projects.$projectId.tsx",
  [/value: "file-room"/, /<ProjectFileRoom projectId=\{projectId\}/, /label: "Client & Records"/],
  "file-room tab is wired onto the project nav rail",
);

// COSTINVOICEATTACH1: a supplier invoice image/PDF can be attached at the
// individual cost-entry front door, persists on the cost actual, and opens from
// the ledger through a short-lived URL in the existing private project bucket.
await expectContains(
  "supabase/migrations/20260714014231_cost_actual_invoice_attachments.sql",
  [
    /invoice_attachment_path text NOT NULL DEFAULT ''/,
    /invoice_attachment_name text NOT NULL DEFAULT ''/,
    /invoice_attachment_size bigint NOT NULL DEFAULT 0/,
  ],
  "cost actual migration stores private invoice attachment metadata",
);
await expectContains(
  "src/components/billing/BillingEnhancements.tsx",
  [
    /CostActualInvoiceAttachmentPicker/,
    /project-docs/,
    /cost-actuals/,
    /CostActualInvoiceAttachmentLink/,
  ],
  "cost entry uploads invoice backup and exposes it from the ledger",
);
await expectContains(
  "src/components/billing/CostActualInvoiceAttachmentLink.tsx",
  [/createSignedUrl\(attachment\.path, 600\)/, /noopener,noreferrer/],
  "cost invoice backup opens through a short-lived private signed URL",
);

// COSTDOCUMENTRISK1: one supplier invoice can retain multiple cost-code rows
// while rendering as one document, and recognized cost can be attributed to a
// same-project risk without changing the cost-code/WIP accounting path.
await expectContains(
  "supabase/migrations/20260714122936_cost_documents_and_risk_links.sql",
  [
    /ADD COLUMN IF NOT EXISTS cost_document_id uuid/,
    /attachment_groups[\s\S]*reference_groups/,
    /ALTER COLUMN cost_document_id SET DEFAULT gen_random_uuid\(\)[\s\S]*ALTER COLUMN cost_document_id SET NOT NULL/,
    /exposure_id uuid/,
    /FOREIGN KEY \(exposure_id\)[\s\S]*REFERENCES public\.exposures\(id\)/,
    /validate_cost_actual_exposure_link/,
    /linked_project_id <> NEW\.project_id/,
  ],
  "cost-document and risk-link migration preserves allocation rows and enforces project scope",
);
await expectContains(
  "supabase/migrations/20260714124530_backfill_legacy_cost_documents.sql",
  [
    /cost_document_id = id/,
    /date_trunc\('second', created_at\)/,
    /grouped\.line_count > 1/,
    /created_at < timestamptz '2026-07-14 16:43:01\+00'/,
  ],
  "legacy multi-line invoices are narrowly regrouped by their same-second save signature",
);
await expectContains(
  "src/components/billing/BillingEnhancements.tsx",
  [
    /groupCostActualsByDocument/,
    /Document total/,
    /\{document\.lines\.length\} allocation/,
    /document\.lines\.length === 1 \? "line" : "lines"/,
    /Risk tally attribution \(optional\)/,
    /Actual incurred →/,
  ],
  "cost ledger renders one invoice document with allocation lines and optional risk attribution",
);
await expectContains(
  "src/components/outcome/ExposuresTable.tsx",
  [
    /Actual incurred/,
    /Linked costs \+ paid apps/,
    /Sub committed/,
    /actualIncurredByExposure/,
    /subcontractCommittedByExposure/,
  ],
  "risk tally separates recognized and paid actuals from subcontract commitments",
);
await expectContains(
  "supabase/migrations/20260714203742_subcontract_risk_and_cost_open_relief.sql",
  [
    /budget_open_relief numeric NOT NULL DEFAULT 0/,
    /tg_prepare_cost_actual_open_relief/,
    /SELECT GREATEST\(0, COALESCE\(ftc, 0\) \+ restored_old_relief\)[\s\S]*FOR UPDATE/,
    /ftc = GREATEST\([\s\S]*old_relief - new_relief/,
    /subcontract_change_orders[\s\S]*exposure_id uuid/,
    /subcontract_payments[\s\S]*exposure_id uuid/,
    /tg_validate_subcontract_exposure_project/,
  ],
  "recognized direct costs relieve Budget Open reversibly and subcontract records link to same-project risks",
);
await expectContains(
  "src/routes/_authenticated/projects.$projectId.tsx",
  [/cursor-pointer[\s\S]*hover:bg-secondary[\s\S]*hover:text-foreground/, /hover:shadow-sm/],
  "project navigation restores obvious pointer and hover feedback",
);

// PRODUCTIONCONTROL1: project production history is packaged as weighted,
// comparable field intelligence without ever averaging unlike units together.
await expectContains(
  "src/lib/production-analytics.ts",
  [
    /canonicalProductionUnit/,
    /earnedLaborHours \/ coveredLaborHours/,
    /aggregateProductionSeries/,
    /summarizeProductionScopes/,
  ],
  "production analytics weights rates by labor-hours and rolls unlike units through earned hours",
);
await expectContains(
  "src/components/outcome/ProductionControlView.tsx",
  [
    /Production Control/,
    /Production pulse/,
    /Weighted production trend/,
    /Scope performance ledger/,
    /earned buyout value/,
  ],
  "project production control exposes trend, pace, coverage, and scope-level economics",
);
await expectContains(
  "src/components/outcome/DailyWipWorkspace.tsx",
  [/ProductionControlView/, /productionRows/, /setWorkspaceMode\("production"\)/],
  "Daily WIP opens the project production-control workspace from the same field records",
);
await expectContains(
  "src/lib/production-forecast.ts",
  [
    /remainingQuantity/,
    /workingDaysRemaining/,
    /requiredDailyPace/,
    /buildSovCompletionRecommendations/,
    /wip_reviewed_at/,
  ],
  "production forecast separates remaining scope, required field pace, and PM-reviewed SOV evidence",
);
await expectContains(
  "src/components/outcome/PaceToForecastPanel.tsx",
  [
    /Pace to forecast/,
    /Recent field pace/,
    /Required by billing/,
    /Reviewed WIP → SOV recommendation/,
    /does not create a pay application or edit the billing SOV/,
  ],
  "project production control packages pace-to-billing and guarded SOV certification",
);
await expectContains(
  "src/components/outcome/CpmProgressReviewPanel.tsx",
  [
    /Daily WIP → CPM/,
    /What controls this activity\?/,
    /Accept recommendation/,
    /Keep CPM as-is/,
    /Apply different CPM %/,
    /without changing the[\s\S]*schedule or asking for an explanation/,
  ],
  "project production control requires an explicit PM decision before Daily WIP reaches CPM",
);
await expectContains(
  "supabase/migrations/20260715195710_reviewable_cpm_progress.sql",
  [
    /create table if not exists public\.schedule_activity_progress_controls/,
    /create table if not exists public\.schedule_activity_progress_reviews/,
    /apply_wip_schedule_progress_review/,
    /Schedule progress changed while you were reviewing it/,
    /wip_reviewed_at is not null/,
    /CPM progress decisions require reviewed Daily WIP evidence/,
    /schedule_activity_progress_reviews_override_note_check/,
    /schedule_activity_progress_reviews_source_wip_idx/,
    /decision in \('accepted', 'kept', 'overridden'\)/,
    /if p_decision <> 'kept' then/,
    /grant select, insert on table public\.schedule_activity_progress_reviews to authenticated/,
    /revoke all on table public\.schedule_activity_progress_reviews from public, anon/,
    /revoke all on function public\.apply_wip_schedule_progress_review\([\s\S]*from public, anon/,
  ],
  "CPM progress decisions are atomic, stale-guarded, append-only, and tied to reviewed WIP evidence",
);
await expectContains(
  "supabase/migrations/20260715143424_production_sov_certifications.sql",
  [
    /create table if not exists public\.production_sov_certifications/,
    /source_wip_entry_id/,
    /tg_validate_production_sov_certification_project/,
    /for select[\s\S]*can_read_project/,
    /for insert[\s\S]*can_manage_project/,
    /grant select, insert/,
  ],
  "SOV certifications are append-only, project-scoped, and tied to reviewed WIP evidence",
);
await expectContains(
  "supabase/migrations/20260715180124_certified_wip_billing_handoff.sql",
  [
    /create table if not exists public\.production_sov_billing_handoffs/,
    /apply_production_sov_certification_to_billing/,
    /v_app\.status <> 'draft'/,
    /wip\.wip_reviewed_at > v_cert\.certified_at/,
    /v_target_total_cents < v_prior_total_cents/,
    /perform public\.sync_billing_application_from_lines/,
    /pm_certification_applied/,
    /grant select on table public\.production_sov_billing_handoffs to authenticated/,
  ],
  "certified WIP reaches only an explicit draft billing handoff with stale, floor, and audit guards",
);
await expectContains(
  "supabase/migrations/20260715190552_restrict_certified_wip_handoff_execution.sql",
  [
    /revoke execute on function public\.apply_production_sov_certification_to_billing\(uuid, uuid\)[\s\S]*from public, anon/,
    /grant execute on function public\.apply_production_sov_certification_to_billing\(uuid, uuid\)[\s\S]*to authenticated, service_role/,
    /notify pgrst, 'reload schema'/,
  ],
  "certified WIP billing handoff execution is restricted to signed-in application roles",
);
await expectContains(
  "src/components/billing/BillingEnhancements.tsx",
  [
    /PM billing handoff/,
    /Accounting\s+chooses what enters this draft/,
    /Apply to draft/,
    /application will remain a draft/,
    /fmtUSD\(centsToDollars\(preview\.targetTotalCents\)\)/,
  ],
  "billing presents PM decisions as an optional accounting-native worksheet",
);
await expectContains(
  "src/lib/certified-wip-billing.ts",
  [
    /priorCompletedAndStoredCents/,
    /currentStoredMaterialsCents/,
    /proposedWorkThisPeriodCents/,
    /stored_materials_exceed_target/,
  ],
  "billing handoff preview preserves prior certificates and stored materials",
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
