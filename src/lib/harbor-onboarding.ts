import type { HarborDemoModuleKey } from "@/lib/demo-seed";

export type HarborOnboardingRole =
  "Everyone" | "Superintendent" | "Project manager" | "PM + accounting";

export type HarborOnboardingTargetTab =
  | "dashboard"
  | "schedule"
  | "inspections"
  | "risk-tally"
  | "claims"
  | "sov"
  | "billing"
  | "subcontractors"
  | "daily-reports"
  | "daily-wip";

export interface HarborOnboardingLesson {
  moduleKey: HarborDemoModuleKey;
  number: number;
  title: string;
  shortTitle: string;
  role: HarborOnboardingRole;
  duration: string;
  promise: string;
  why: string;
  steps: readonly string[];
  result: string;
  target: {
    tab: HarborOnboardingTargetTab;
    wipView?: "daily" | "production";
    actionLabel: string;
  };
}

export const HARBOR_IOR_FLOW = [
  {
    label: "Field truth",
    owner: "Superintendent",
    detail: "Crews, hours, quantities, delays, and evidence—not guesses.",
  },
  {
    label: "Management control",
    owner: "Project manager",
    detail: "Compare the plan with what the field actually produced.",
  },
  {
    label: "Commercial decision",
    owner: "PM + accounting",
    detail: "Carry cost, risk, schedule, and billing without double-counting.",
  },
  {
    label: "Financial outcome",
    owner: "Leadership",
    detail: "See gross profit movement early enough to do something about it.",
  },
] as const;

export const HARBOR_ONBOARDING_LESSONS: readonly HarborOnboardingLesson[] = [
  {
    moduleKey: "project-foundation",
    number: 1,
    title: "Meet Harbor Residence",
    shortTitle: "Meet the job",
    role: "Everyone",
    duration: "2 min",
    promise: "See the complete job before touching a control.",
    why: "Harbor is a working project, not a slideshow. Every lesson uses the same records a live job uses.",
    steps: [
      "Read the IOR headline before studying individual numbers.",
      "Notice the original plan, current forecast, and protected risk holds.",
      "Use the left rail to follow the same job through every department.",
    ],
    result: "You know where the job stands and which problem deserves attention first.",
    target: { tab: "dashboard", actionLabel: "Open the project IOR" },
  },
  {
    moduleKey: "budget-sov",
    number: 2,
    title: "Set the money map",
    shortTitle: "Budget & SOV",
    role: "Project manager",
    duration: "4 min",
    promise: "Understand cost, owner billing value, markup, and forecast by code.",
    why: "The budget says what the work should cost. The SOV says what the owner pays. Mixing them hides margin.",
    steps: [
      "Open the Budget and find the MEP cost code.",
      "Compare its cost budget with its owner-facing contract value.",
      "Hover the column labels to see Actual, Open, and Forecast definitions.",
    ],
    result: "Every dollar has a cost-code home before commitments and field progress arrive.",
    target: { tab: "sov", actionLabel: "Open Budget & SOV" },
  },
  {
    moduleKey: "subcontract-buyout",
    number: 3,
    title: "Buy out the work",
    shortTitle: "Subcontractors",
    role: "Project manager",
    duration: "5 min",
    promise: "Turn a subcontract into committed cost and a production benchmark.",
    why: "A buyout is more than a contract total. It establishes cost, planned quantity, and the pace required to win.",
    steps: [
      "Open ALP Electric and review the $125,000 buyout.",
      "Find its 25,000 LF planned quantity and $110 labor-equivalent benchmark.",
      "Review the paid application, retainage, and risk-linked change order examples.",
    ],
    result: "The buyout now feeds Budget, Production Control, risk, and payables.",
    target: { tab: "subcontractors", actionLabel: "Open Subcontractors" },
  },
  {
    moduleKey: "daily-reports-wip",
    number: 4,
    title: "Capture field truth",
    shortTitle: "Daily Reports",
    role: "Superintendent",
    duration: "4 min",
    promise: "Record what happened once and reuse it everywhere.",
    why: "Production intelligence is only as good as the daily field record. The superintendent owns the source truth.",
    steps: [
      "Open the July 11–13 electrical reports.",
      "Review crews, people per crew, hours, installed quantities, and delays.",
      "Follow a work line into Daily WIP instead of entering it twice.",
    ],
    result: "Field activity becomes usable cost, progress, schedule, and production evidence.",
    target: { tab: "daily-reports", actionLabel: "Open Daily Reports" },
  },
  {
    moduleKey: "daily-wip-cpm-evidence",
    number: 5,
    title: "Review work in place",
    shortTitle: "Daily WIP",
    role: "Project manager",
    duration: "5 min",
    promise: "Turn field entries into reviewed progress, cost, earned value, and pace.",
    why: "The field reports facts. The PM decides what those facts mean financially before they reach billing or CPM.",
    steps: [
      "Open the reviewed drywall and electrical work lines.",
      "Compare installed quantity, labor-hours, target rate, and percent complete.",
      "Confirm the field evidence before using it in another control.",
    ],
    result: "You have a defensible management position—not an unreviewed field guess.",
    target: { tab: "daily-wip", wipView: "daily", actionLabel: "Open Daily WIP" },
  },
  {
    moduleKey: "cpm-schedule",
    number: 6,
    title: "Choose CPM progress",
    shortTitle: "CPM progress",
    role: "Project manager",
    duration: "4 min",
    promise: "Use reviewed field evidence without surrendering PM judgment.",
    why: "Daily WIP recommends progress. The PM may apply it, keep CPM unchanged, or use a different supported value.",
    steps: [
      "Find drywall activity 09-020 at 40% in CPM.",
      "Review the 52% recommendation from PM-reviewed Daily WIP.",
      "Choose Apply, Keep CPM, or enter a different supported value.",
    ],
    result: "The schedule stays connected to the field without becoming automatic or careless.",
    target: { tab: "schedule", actionLabel: "Open CPM Schedule" },
  },
  {
    moduleKey: "production-control",
    number: 7,
    title: "Control production",
    shortTitle: "Production Control",
    role: "Project manager",
    duration: "6 min",
    promise: "See whether a subcontractor or crew is earning the plan.",
    why: "Production rate connects units installed to labor-hours. Trends expose a bad buyout or weak pace before the job is over.",
    steps: [
      "Open the ALP Electric production series.",
      "Compare actual LF per labor-hour with the 7.5 target.",
      "Switch day, week, and month to see whether the trend is improving.",
    ],
    result: "You can carry a proven unit rate into the next estimate and buyout.",
    target: {
      tab: "daily-wip",
      wipView: "production",
      actionLabel: "Open Production Control",
    },
  },
  {
    moduleKey: "billing-workspace",
    number: 8,
    title: "Hand off billing cleanly",
    shortTitle: "Billing handoff",
    role: "PM + accounting",
    duration: "5 min",
    promise: "Let the PM recommend and accounting control the billing instrument.",
    why: "The PM knows what is earned. Accounting knows how it must be billed. OverWatch bridges both jobs without blurring them.",
    steps: [
      "Review the PM-certified MEP position from Daily WIP.",
      "Open Pay App 2 — Draft and compare the matching SOV line.",
      "Accounting chooses whether to apply the recommendation before submission.",
    ],
    result: "Billing begins with reviewed project truth while accounting keeps final control.",
    target: { tab: "billing", actionLabel: "Open the billing workspace" },
  },
  {
    moduleKey: "ior-commercial-position",
    number: 9,
    title: "Run the IOR",
    shortTitle: "IOR & Risk Tally",
    role: "Project manager",
    duration: "6 min",
    promise: "Convert job problems into owned financial recovery actions.",
    why: "A problem without dollars, an owner, and a next action is only a conversation. IOR makes it manageable.",
    steps: [
      "Open the Weak drywall subcontractor risk.",
      "Separate actual incurred cost from subcontract commitment and remaining exposure.",
      "Choose a recovery path, owner, due date, and release condition.",
    ],
    result: "Leadership sees forecast gross profit after risk—not after the loss is final.",
    target: { tab: "risk-tally", actionLabel: "Open IOR & Risk Tally" },
  },
  {
    moduleKey: "inspections",
    number: 10,
    title: "Close the quality loop",
    shortTitle: "Inspections",
    role: "Project manager",
    duration: "3 min",
    promise: "Connect failed work to reinspection, responsibility, and financial risk.",
    why: "Inspection failures affect cost and schedule. They belong in the operating record, not in a forgotten email.",
    steps: [
      "Open the failed inspection example.",
      "Review the correction, responsible party, and reinspection date.",
      "Create or review the linked risk when money or schedule is exposed.",
    ],
    result: "Quality problems remain visible until the work and its exposure are closed.",
    target: { tab: "inspections", actionLabel: "Open Inspections" },
  },
  {
    moduleKey: "claims",
    number: 11,
    title: "Build the claim record",
    shortTitle: "Claims",
    role: "Project manager",
    duration: "4 min",
    promise: "Keep notice, cause, cost, schedule, and documents in one timeline.",
    why: "A valid claim still fails when the record is scattered. The claim timeline preserves the story while work continues.",
    steps: [
      "Open the active Harbor claim and its event history.",
      "Review notice dates, responsibility, cost, and schedule effect.",
      "Trace the claim back to its related risk and change-order position.",
    ],
    result: "The team can support recovery without reconstructing the project months later.",
    target: { tab: "claims", actionLabel: "Open Claims" },
  },
] as const;
