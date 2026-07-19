export type HarborProductionScopeKey = "concrete" | "drywall" | "electrical";

export interface HarborProductionLine {
  key: HarborProductionScopeKey;
  activity: string;
  workArea: string;
  scheduleActivityCode: string;
  costCode: string;
  crews: number;
  peoplePerCrew: number;
  hours: number;
  quantity: number;
  unit: "CY" | "SF" | "LF";
  targetRate: number;
  percent: number;
  materialCost: number;
  equipmentCost: number;
  note: string;
}

export interface HarborProductionDay {
  date: string;
  weather: string;
  lines: HarborProductionLine[];
}

const WORKING_DATES = [
  "2026-06-08",
  "2026-06-09",
  "2026-06-10",
  "2026-06-11",
  "2026-06-12",
  "2026-06-15",
  "2026-06-16",
  "2026-06-17",
  "2026-06-18",
  "2026-06-19",
  "2026-06-22",
  "2026-06-23",
  "2026-06-24",
  "2026-06-25",
  "2026-06-26",
  "2026-06-29",
  "2026-06-30",
  "2026-07-01",
  "2026-07-02",
  "2026-07-03",
  "2026-07-06",
  "2026-07-07",
  "2026-07-08",
  "2026-07-09",
  "2026-07-10",
  "2026-07-13",
  "2026-07-14",
  "2026-07-15",
  "2026-07-16",
  "2026-07-17",
] as const;

const concreteQuantities = [72, 76, 78, 82, 84, 80, 86, 88, 92, 90] as const;
const drywallQuantities = [
  690, 735, 760, 780, 810, 825, 845, 860, 875, 830, 790, 715, 620, 540, 610, 690, 750, 805, 835,
  860, 880, 895, 910,
] as const;
const electricalQuantities = [
  305, 320, 335, 350, 365, 380, 395, 410, 390, 355, 315, 275, 260, 300, 335, 365, 390, 405, 420,
  430,
] as const;

const weatherByIndex = (index: number) => {
  if (index === 12 || index === 21) return "Morning rain; clear after 10 AM";
  if (index === 18 || index === 19) return "Hot and humid; heat protocol active";
  return index % 3 === 0 ? "Clear, 82F" : index % 3 === 1 ? "Partly cloudy, 80F" : "Clear, 84F";
};

const concreteLine = (index: number): HarborProductionLine => ({
  key: "concrete",
  activity: "Exterior terrace walls and site concrete",
  workArea: index < 5 ? "South terrace" : "Pool court and garden walls",
  scheduleActivityCode: "03-010",
  costCode: "0300",
  crews: 2,
  peoplePerCrew: 4,
  hours: 8,
  quantity: concreteQuantities[index],
  unit: "CY",
  targetRate: 1.25,
  percent: Math.min(50, (index + 1) * 5),
  materialCost: 4200,
  equipmentCost: 850,
  note: "Ironclad placed, consolidated, and finished the planned concrete work.",
});

const drywallLine = (dayIndex: number): HarborProductionLine => {
  const scopeIndex = dayIndex - 7;
  const inConstraintWindow = dayIndex >= 18 && dayIndex <= 22;
  return {
    key: "drywall",
    activity:
      dayIndex < 17 ? "Hang and finish second-floor drywall" : "Finish and sand interior drywall",
    workArea: dayIndex < 17 ? "Second floor" : "Main level and stair hall",
    scheduleActivityCode: "09-020",
    costCode: "0900",
    crews: 1,
    peoplePerCrew: 4,
    hours: 8,
    quantity: drywallQuantities[scopeIndex],
    unit: "SF",
    targetRate: 25,
    percent: Math.min(69, (scopeIndex + 1) * 3),
    materialCost: dayIndex % 5 === 0 ? 1800 : 0,
    equipmentCost: 0,
    note: inConstraintWindow
      ? "Output fell below target while the crew waited on MEP penetration closeout and reworked finish quality."
      : "Summit Drywall advanced the released work area and logged installed square footage.",
  };
};

const electricalLine = (dayIndex: number): HarborProductionLine => {
  const scopeIndex = dayIndex - 10;
  const inConstraintWindow = dayIndex >= 20 && dayIndex <= 23;
  return {
    key: "electrical",
    activity:
      dayIndex < 21
        ? "Electrical rough-in — main lobby and east wing"
        : "Branch wiring and device rough-in",
    workArea: dayIndex < 21 ? "Main lobby and east wing" : "Second floor and service corridor",
    scheduleActivityCode: "26-010",
    costCode: "1500",
    crews: 2,
    peoplePerCrew: 3,
    hours: 8,
    quantity: electricalQuantities[scopeIndex],
    unit: "LF",
    targetRate: 7.5,
    percent: Math.min(60, (scopeIndex + 1) * 3),
    materialCost: dayIndex % 4 === 0 ? 2500 : 0,
    equipmentCost: dayIndex % 7 === 0 ? 1000 : 0,
    note: inConstraintWindow
      ? "Production slowed while the foreman resolved lighting-control information and access conflicts."
      : "ALP Electric advanced conduit and wire with quantity and labor-hours captured from the field.",
  };
};

export const HARBOR_DEMO_PRODUCTION_DAYS: readonly HarborProductionDay[] = WORKING_DATES.map(
  (date, index) => {
    const lines: HarborProductionLine[] = [];
    if (index < 10) lines.push(concreteLine(index));
    if (index >= 7) lines.push(drywallLine(index));
    if (index >= 10) lines.push(electricalLine(index));
    return { date, weather: weatherByIndex(index), lines };
  },
);

export const HARBOR_DEMO_TOMORROW_PLAN_DATE = "2026-07-20";
