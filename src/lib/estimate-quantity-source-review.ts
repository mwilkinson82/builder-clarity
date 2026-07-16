export type EstimateQuantitySourceIssueStatus =
  "unverified_scale" | "stale" | "review_required" | "assembly_stale";

export interface EstimateQuantitySourceReviewItem {
  id: string;
  source_type: "takeoff" | "assembly";
  measurement_id: string;
  estimate_line_item_id: string | null;
  source_label: string;
  source_quantity: number;
  source_unit: string;
  status: EstimateQuantitySourceIssueStatus;
  sheet_number: string;
  sheet_name: string;
  line_description: string;
  formula_version: string | null;
  changed_at: string;
}

export interface EstimateQuantitySourceReview {
  ready: boolean;
  total_source_count: number;
  current_count: number;
  review_count: number;
  linked_review_count: number;
  unlinked_review_count: number;
  items: EstimateQuantitySourceReviewItem[];
}

export interface EstimateTakeoffReviewSource {
  id: string;
  estimate_line_item_id: string | null;
  plan_sheet_id: string;
  label: string;
  unit: string;
  quantity: number;
  calculation_status: "current" | "unverified_scale" | "stale" | "review_required";
  updated_at: string;
}

export interface EstimateAssemblyReviewSource {
  link_id: string;
  measurement_id: string;
  estimate_line_item_id: string;
  output_label: string;
  output_unit: string;
  output_quantity: number;
  formula_version: string;
  status: "current" | "stale";
  last_synced_at: string;
  stale_at: string | null;
}

interface QuantitySourceReviewInput {
  ready?: boolean;
  takeoffs: EstimateTakeoffReviewSource[];
  assemblies: EstimateAssemblyReviewSource[];
  lines: Array<{ id: string; description: string }>;
  sheets: Array<{ id: string; sheet_number: string; sheet_name: string }>;
}

const issuePriority: Record<EstimateQuantitySourceIssueStatus, number> = {
  assembly_stale: 0,
  stale: 1,
  review_required: 2,
  unverified_scale: 3,
};

export function quantitySourceIssueLabel(status: EstimateQuantitySourceIssueStatus) {
  switch (status) {
    case "unverified_scale":
      return "Verify scale";
    case "stale":
      return "Scale changed";
    case "review_required":
      return "Recalculate";
    case "assembly_stale":
      return "Assembly changed";
  }
}

export function quantitySourceIssueDetail(status: EstimateQuantitySourceIssueStatus) {
  switch (status) {
    case "unverified_scale":
      return "The sheet scale has not passed Scale Assurance.";
    case "stale":
      return "The sheet scale changed after this quantity was calculated.";
    case "review_required":
      return "This takeoff must be reviewed and recalculated before it is trusted.";
    case "assembly_stale":
      return "The confirmed assembly or source quantity changed; Overwatch did not resync the row.";
  }
}

export function buildEstimateQuantitySourceReview({
  ready = true,
  takeoffs,
  assemblies,
  lines,
  sheets,
}: QuantitySourceReviewInput): EstimateQuantitySourceReview {
  const lineById = new Map(lines.map((line) => [line.id, line.description]));
  const sheetById = new Map(sheets.map((sheet) => [sheet.id, sheet]));
  const takeoffById = new Map(takeoffs.map((takeoff) => [takeoff.id, takeoff]));
  const items: EstimateQuantitySourceReviewItem[] = [];

  for (const takeoff of takeoffs) {
    if (takeoff.calculation_status === "current") continue;
    const sheet = sheetById.get(takeoff.plan_sheet_id);
    items.push({
      id: `takeoff:${takeoff.id}`,
      source_type: "takeoff",
      measurement_id: takeoff.id,
      estimate_line_item_id: takeoff.estimate_line_item_id,
      source_label: takeoff.label,
      source_quantity: takeoff.quantity,
      source_unit: takeoff.unit,
      status: takeoff.calculation_status,
      sheet_number: sheet?.sheet_number ?? "",
      sheet_name: sheet?.sheet_name ?? "",
      line_description: takeoff.estimate_line_item_id
        ? (lineById.get(takeoff.estimate_line_item_id) ?? "")
        : "",
      formula_version: null,
      changed_at: takeoff.updated_at,
    });
  }

  for (const assembly of assemblies) {
    if (assembly.status === "current") continue;
    const takeoff = takeoffById.get(assembly.measurement_id);
    const sheet = takeoff ? sheetById.get(takeoff.plan_sheet_id) : undefined;
    items.push({
      id: `assembly:${assembly.link_id}`,
      source_type: "assembly",
      measurement_id: assembly.measurement_id,
      estimate_line_item_id: assembly.estimate_line_item_id,
      source_label: assembly.output_label,
      source_quantity: assembly.output_quantity,
      source_unit: assembly.output_unit,
      status: "assembly_stale",
      sheet_number: sheet?.sheet_number ?? "",
      sheet_name: sheet?.sheet_name ?? "",
      line_description: lineById.get(assembly.estimate_line_item_id) ?? "",
      formula_version: assembly.formula_version,
      changed_at: assembly.stale_at ?? assembly.last_synced_at,
    });
  }

  items.sort((left, right) => {
    const linkedDifference =
      Number(Boolean(right.estimate_line_item_id)) - Number(Boolean(left.estimate_line_item_id));
    if (linkedDifference !== 0) return linkedDifference;
    const statusDifference = issuePriority[left.status] - issuePriority[right.status];
    if (statusDifference !== 0) return statusDifference;
    return right.changed_at.localeCompare(left.changed_at);
  });

  const currentTakeoffs = takeoffs.filter(
    (takeoff) => takeoff.calculation_status === "current",
  ).length;
  const currentAssemblies = assemblies.filter((assembly) => assembly.status === "current").length;
  const linkedReviewCount = items.filter((item) => item.estimate_line_item_id).length;

  return {
    ready,
    total_source_count: takeoffs.length + assemblies.length,
    current_count: currentTakeoffs + currentAssemblies,
    review_count: items.length,
    linked_review_count: linkedReviewCount,
    unlinked_review_count: items.length - linkedReviewCount,
    items,
  };
}

export const emptyEstimateQuantitySourceReview = (ready = false): EstimateQuantitySourceReview => ({
  ready,
  total_source_count: 0,
  current_count: 0,
  review_count: 0,
  linked_review_count: 0,
  unlinked_review_count: 0,
  items: [],
});
