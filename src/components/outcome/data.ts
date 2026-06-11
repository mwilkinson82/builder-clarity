// Demo seed data for the Buyout / Change Orders / Decisions / Schedule tabs.
// Project + hold data now lives in Lovable Cloud; these tabs are wired in a later phase.

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
