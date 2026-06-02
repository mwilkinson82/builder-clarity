export const project = {
  name: "Harbor Residence",
  client: "Private Luxury Residence",
  originalContract: 3_200_000,
  approvedCOs: 210_000,
  pendingCOs: 135_000,
  originalCostBudget: 2_720_000,
  forecastedFinalContract: 3_545_000,
  forecastedFinalCostBeforeHolds: 3_140_000,
  scheduleVarianceWeeks: 6,
  originalCompletion: "Mar 14, 2026",
  forecastCompletion: "Apr 25, 2026",
};

export type HoldStatus = "Active" | "Released" | "Escalated";
export type HoldType = "E-Hold" | "C-Hold";

export type Hold = {
  id: string;
  type: HoldType;
  description: string;
  amount: number;
  reason: string;
  owner: string;
  releaseCondition: string;
  status: HoldStatus;
};

export const initialHolds: Hold[] = [
  { id: "h1", type: "E-Hold", description: "Window delivery delay", amount: 18_000, reason: "Manufacturer pushed ship date 5 weeks; risk of acceleration cost.", owner: "K. Alvarez", releaseCondition: "Windows delivered and inspected on site", status: "Active" },
  { id: "h2", type: "E-Hold", description: "Lighting allowance overrun", amount: 22_000, reason: "Owner selections trending 30% over allowance.", owner: "M. Chen", releaseCondition: "Final lighting package signed and POs issued", status: "Active" },
  { id: "h3", type: "E-Hold", description: "Unapproved electrical changes", amount: 9_500, reason: "Field changes not yet captured in COs.", owner: "J. Patel", releaseCondition: "CO package submitted and approved", status: "Escalated" },
  { id: "h4", type: "E-Hold", description: "Weak drywall subcontractor", amount: 15_000, reason: "Quality issues may require supplemental crew.", owner: "R. Singh", releaseCondition: "Punchlist cleared on level 2 hangs", status: "Active" },
  { id: "h5", type: "E-Hold", description: "Late appliance selection", amount: 12_000, reason: "Selection delay threatens MEP rough-in sequence.", owner: "K. Alvarez", releaseCondition: "Appliance package locked & released", status: "Active" },
  { id: "h6", type: "C-Hold", description: "Remaining finish-phase uncertainty", amount: 65_000, reason: "General contingency for trim, paint, and closeout variability.", owner: "PM", releaseCondition: "Substantial completion + punch", status: "Active" },
];

export type Buyout = {
  scope: string;
  budget: number;
  committed: number;
  forecastRemaining: number;
  status: "Bought" | "In Negotiation" | "Open" | "At Risk";
  notes: string;
};

export const buyouts: Buyout[] = [
  { scope: "Excavation", budget: 110_000, committed: 108_500, forecastRemaining: 0, status: "Bought", notes: "Complete; minor punch only." },
  { scope: "Foundation", budget: 220_000, committed: 224_000, forecastRemaining: 0, status: "Bought", notes: "Slight overage absorbed in CO #103." },
  { scope: "Framing", budget: 410_000, committed: 412_000, forecastRemaining: 8_000, status: "Bought", notes: "Closing out backcharges." },
  { scope: "Windows", budget: 285_000, committed: 285_000, forecastRemaining: 18_000, status: "At Risk", notes: "Delivery delay — see E-Hold." },
  { scope: "Roofing", budget: 145_000, committed: 142_000, forecastRemaining: 0, status: "Bought", notes: "Final inspection scheduled." },
  { scope: "HVAC", budget: 195_000, committed: 198_500, forecastRemaining: 4_500, status: "Bought", notes: "Commissioning pending." },
  { scope: "Electrical", budget: 240_000, committed: 232_000, forecastRemaining: 22_000, status: "At Risk", notes: "Unapproved field changes accumulating." },
  { scope: "Plumbing", budget: 165_000, committed: 162_500, forecastRemaining: 6_000, status: "Bought", notes: "Trim phase upcoming." },
  { scope: "Millwork", budget: 340_000, committed: 320_000, forecastRemaining: 35_000, status: "In Negotiation", notes: "Awaiting final shop drawings." },
  { scope: "Tile", budget: 125_000, committed: 118_000, forecastRemaining: 10_000, status: "In Negotiation", notes: "Two bath selections outstanding." },
  { scope: "Lighting", budget: 95_000, committed: 78_000, forecastRemaining: 22_000, status: "At Risk", notes: "Allowance overrun trending." },
  { scope: "Landscaping", budget: 180_000, committed: 0, forecastRemaining: 180_000, status: "Open", notes: "Buyout in Q1." },
  { scope: "General Conditions", budget: 220_000, committed: 220_000, forecastRemaining: 38_000, status: "At Risk", notes: "Extended duration from 6-week slip." },
];

export type ChangeOrder = {
  id: string;
  description: string;
  amount: number;
  status: "Approved" | "Pending" | "Unpriced" | "Disputed" | "Submitted";
  ageDays: number;
  owner: string;
  nextAction: string;
};

export const changeOrders: ChangeOrder[] = [
  { id: "CO-101", description: "Owner-added wine room buildout", amount: 84_000, status: "Approved", ageDays: 62, owner: "K. Alvarez", nextAction: "Closed" },
  { id: "CO-102", description: "Upgraded primary bath stone package", amount: 46_000, status: "Approved", ageDays: 45, owner: "M. Chen", nextAction: "Closed" },
  { id: "CO-103", description: "Foundation rock removal", amount: 80_000, status: "Approved", ageDays: 110, owner: "R. Singh", nextAction: "Closed" },
  { id: "CO-104", description: "Smart home control system upgrade", amount: 58_000, status: "Pending", ageDays: 18, owner: "K. Alvarez", nextAction: "Owner signature" },
  { id: "CO-105", description: "Electrical field changes package", amount: 42_000, status: "Unpriced", ageDays: 24, owner: "J. Patel", nextAction: "Price from sub due Fri" },
  { id: "CO-106", description: "Custom steel railing system", amount: 35_000, status: "Submitted", ageDays: 9, owner: "M. Chen", nextAction: "Awaiting owner review" },
  { id: "CO-107", description: "Roof scope: copper valley upgrade", amount: 12_500, status: "Disputed", ageDays: 31, owner: "R. Singh", nextAction: "Meeting with architect" },
];

export type Decision = {
  id: string;
  decision: string;
  impact: string;
  owner: string;
  dueDate: string;
  status: "Open" | "In Progress" | "Resolved" | "Overdue";
};

export const decisions: Decision[] = [
  { id: "d1", decision: "Submit electrical CO package", impact: "Releases $9.5k E-Hold", owner: "J. Patel", dueDate: "Jun 12", status: "In Progress" },
  { id: "d2", decision: "Escalate appliance selection to owner", impact: "Unblocks MEP sequence; protects 2 weeks", owner: "K. Alvarez", dueDate: "Jun 06", status: "Overdue" },
  { id: "d3", decision: "Reforecast general conditions through revised completion", impact: "Confirms $38k GC exposure", owner: "PM", dueDate: "Jun 14", status: "Open" },
  { id: "d4", decision: "Decide whether to supplement drywall manpower", impact: "Mitigates 3-week finish slip", owner: "R. Singh", dueDate: "Jun 09", status: "Open" },
  { id: "d5", decision: "Hold contingency until millwork installation complete", impact: "Preserves $65k C-Hold", owner: "Executive", dueDate: "Aug 30", status: "Open" },
];
