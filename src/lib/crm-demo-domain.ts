export const HARBOR_CRM_DEMO_MODULE_KEY = "crm-workflow";
export const HARBOR_CRM_DEMO_VERSION = 1;
export const HARBOR_CRM_DEMO_MARKER = "OverWatch Harbor CRM demo";

export type HarborCrmDemoFixture = {
  key: string;
  name: string;
  client: string;
  contactName: string;
  contactTitle: string;
  contactEmail: string;
  contactPhone: string;
  stage:
    | "lead"
    | "qualifying"
    | "estimating"
    | "bid_submitted"
    | "negotiating"
    | "won"
    | "lost"
    | "no_bid";
  contract: number;
  cost: number;
  probability: number;
  source: string;
  projectType: string;
  marketSector: string;
  bidDueOffset: number;
  decisionOffset: number;
  bidDecision: "undecided" | "bid" | "no_bid";
  scope: string;
  accountHealth: "strong" | "steady" | "watch" | "unknown";
  relationshipStage: string;
  actionTitle: string;
  actionDueOffset: number;
  actionPriority: "low" | "normal" | "high";
  actionType: string;
  linkToHarborProject?: boolean;
  enrollInFollowup?: boolean;
};

export const HARBOR_CRM_DEMO_FIXTURES: readonly HarborCrmDemoFixture[] = [
  {
    key: "harbor-preconstruction",
    name: "Harbor Residence Preconstruction",
    client: "Private Luxury Residence",
    contactName: "Evelyn Harbor",
    contactTitle: "Owner Representative",
    contactEmail: "evelyn.harbor@demo.overwatch.example",
    contactPhone: "(555) 014-2601",
    stage: "won",
    contract: 3_200_000,
    cost: 2_720_000,
    probability: 100,
    source: "Repeat client",
    projectType: "Residential",
    marketSector: "Private luxury residential",
    bidDueOffset: -68,
    decisionOffset: -56,
    bidDecision: "bid",
    scope:
      "Luxury residential renovation and addition with schedule-sensitive owner selections, custom cabinetry, and exterior living scope.",
    accountHealth: "strong",
    relationshipStage: "active client",
    actionTitle: "Review CRM handoff notes against the active IOR risk ledger",
    actionDueOffset: 1,
    actionPriority: "high",
    actionType: "handoff_review",
    linkToHarborProject: true,
  },
  {
    key: "bayview-townhomes",
    name: "Bayview Townhomes Phase II",
    client: "Seaside Development Group",
    contactName: "Darren Ellis",
    contactTitle: "VP Development",
    contactEmail: "darren.ellis@demo.overwatch.example",
    contactPhone: "(555) 014-4470",
    stage: "negotiating",
    contract: 5_400_000,
    cost: 4_590_000,
    probability: 72,
    source: "Referral",
    projectType: "Residential",
    marketSector: "Multifamily",
    bidDueOffset: -6,
    decisionOffset: 9,
    bidDecision: "bid",
    scope:
      "Second phase of coastal townhomes. The owner is asking for schedule-compression options and alternates before award.",
    accountHealth: "steady",
    relationshipStage: "proposal",
    actionTitle: "Send the value-engineering alternate log and revised schedule narrative",
    actionDueOffset: 0,
    actionPriority: "high",
    actionType: "proposal_follow_up",
    enrollInFollowup: true,
  },
  {
    key: "lakeside-medical",
    name: "Lakeside Medical Buildout",
    client: "Lakeside Health Group",
    contactName: "Priya Shah",
    contactTitle: "Facilities Director",
    contactEmail: "priya.shah@demo.overwatch.example",
    contactPhone: "(555) 014-8821",
    stage: "bid_submitted",
    contract: 1_850_000,
    cost: 1_562_000,
    probability: 58,
    source: "Architect relationship",
    projectType: "Commercial",
    marketSector: "Healthcare",
    bidDueOffset: -2,
    decisionOffset: 5,
    bidDecision: "bid",
    scope:
      "Occupied medical-office renovation with phasing constraints, infection-control protection, and after-hours work allowances.",
    accountHealth: "watch",
    relationshipStage: "shortlist",
    actionTitle: "Confirm the decision-committee timeline with the facilities director",
    actionDueOffset: 1,
    actionPriority: "normal",
    actionType: "call",
  },
  {
    key: "north-ridge-clubhouse",
    name: "North Ridge Clubhouse Renovation",
    client: "North Ridge HOA",
    contactName: "Marisa Chen",
    contactTitle: "Board President",
    contactEmail: "marisa.chen@demo.overwatch.example",
    contactPhone: "(555) 014-3308",
    stage: "estimating",
    contract: 2_400_000,
    cost: 2_030_000,
    probability: 42,
    source: "Plan room",
    projectType: "Commercial",
    marketSector: "Community / amenity",
    bidDueOffset: 6,
    decisionOffset: 21,
    bidDecision: "undecided",
    scope:
      "Clubhouse interior renovation, pool-deck repairs, a new service bar, and ADA restroom upgrades.",
    accountHealth: "unknown",
    relationshipStage: "estimating",
    actionTitle: "Confirm the pool-deck allowance and board approval rules before final bid",
    actionDueOffset: 3,
    actionPriority: "normal",
    actionType: "scope_clarification",
  },
  {
    key: "oak-pine-retail",
    name: "Oak & Pine Retail Shell",
    client: "Oak & Pine Holdings",
    contactName: "Nolan Briggs",
    contactTitle: "Asset Manager",
    contactEmail: "nolan.briggs@demo.overwatch.example",
    contactPhone: "(555) 014-1184",
    stage: "qualifying",
    contract: 980_000,
    cost: 842_000,
    probability: 28,
    source: "Broker introduction",
    projectType: "Commercial",
    marketSector: "Retail",
    bidDueOffset: 12,
    decisionOffset: 30,
    bidDecision: "undecided",
    scope:
      "Warm-shell conversion for two retail tenants. The budget is early and the landlord work letter still needs definition.",
    accountHealth: "unknown",
    relationshipStage: "qualifying",
    actionTitle: "Run the bid/no-bid screen for tenant readiness and design completeness",
    actionDueOffset: 2,
    actionPriority: "normal",
    actionType: "qualification",
  },
  {
    key: "city-works-storage",
    name: "City Works Storage Addition",
    client: "City Works Operations",
    contactName: "Rafael Ortiz",
    contactTitle: "Operations Manager",
    contactEmail: "rafael.ortiz@demo.overwatch.example",
    contactPhone: "(555) 014-7790",
    stage: "no_bid",
    contract: 760_000,
    cost: 714_000,
    probability: 0,
    source: "Municipal bid board",
    projectType: "Industrial",
    marketSector: "Public works",
    bidDueOffset: -11,
    decisionOffset: -9,
    bidDecision: "no_bid",
    scope:
      "Small equipment-storage addition. Schedule liquidated damages and incomplete drawings made the risk/reward profile poor.",
    accountHealth: "watch",
    relationshipStage: "no-bid",
    actionTitle: "Log the no-bid reason and watch for a cleaner future release",
    actionDueOffset: 7,
    actionPriority: "low",
    actionType: "relationship_note",
  },
];

export const harborCrmDemoMarker = (key: string) => `${HARBOR_CRM_DEMO_MARKER} · ${key}`;

export function harborCrmDemoDate(offsetDays: number, today = new Date()) {
  const value = new Date(today);
  value.setUTCHours(12, 0, 0, 0);
  value.setUTCDate(value.getUTCDate() + offsetDays);
  return value.toISOString().slice(0, 10);
}

export function isHarborCrmDemoOpportunityName(name: string) {
  return HARBOR_CRM_DEMO_FIXTURES.some((fixture) => fixture.name === name);
}

export const HARBOR_CRM_DEMO_MEETING_BRIEF = {
  title: "Harbor Residence · operations kickoff brief",
  meetingGoal:
    "Carry every promise, exclusion, approval path, and known risk from preconstruction into the project team before mobilization.",
  data: {
    executive_summary:
      "Harbor Residence is awarded. The kickoff must protect the owner experience without losing the estimate assumptions, decision deadlines, or commercial controls that made the job viable.",
    relationship_context: [
      "Evelyn Harbor is the owner representative and the day-to-day decision coordinator.",
      "The client values a calm process, visible decisions, and advance notice before cost or schedule pressure becomes urgent.",
    ],
    desired_outcomes: [
      "Confirm who can approve scope, cost, and schedule decisions.",
      "Transfer estimate assumptions and exclusions to the delivery team.",
      "Agree on the first 30-day communication and decision cadence.",
    ],
    questions_to_ask: [
      "Which decisions must go directly to the owner, and which can Evelyn approve?",
      "Which selections can threaten the critical path during the first 30 days?",
      "What information does the owner expect before approving a change?",
    ],
    risks_to_surface: [
      "Custom cabinetry and owner selections can delay release dates.",
      "Exterior-living scope still carries coordination exposure.",
      "Promises made during preconstruction must be visible in the project handoff.",
    ],
    value_to_bring: [
      "A one-page decision map with owner, PM, and design authority.",
      "The initial risk tally and long-lead release list.",
    ],
    next_step_options: [
      "Schedule the client kickoff after the internal handoff is complete.",
      "Send the first-30-days roadmap and decision calendar for review.",
    ],
  },
} as const;
