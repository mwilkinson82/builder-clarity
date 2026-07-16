export const ESTIMATE_REVIEW_ACTIVITY_TYPES = [
  "signoff",
  "override_export_csv",
  "override_export_pdf",
  "override_push_project",
] as const;

export type EstimateReviewActivityType = (typeof ESTIMATE_REVIEW_ACTIVITY_TYPES)[number];
export type EstimateReviewSignoffStatus = "current" | "stale" | "unsigned" | "unavailable";

export interface EstimateReviewActivity {
  id: string;
  estimate_id: string;
  sequence: number;
  activity_type: EstimateReviewActivityType;
  note: string;
  snapshot_hash: string;
  blocker_count: number;
  follow_up_count: number;
  total_cents: number;
  reviewed_by: string;
  reviewed_by_name: string;
  reviewed_at: string;
  created_at: string;
}

export interface EstimateReviewActivityState {
  ready: boolean;
  status: EstimateReviewSignoffStatus;
  current_snapshot_hash: string;
  blocker_count: number;
  follow_up_count: number;
  latest_signoff_id: string | null;
  latest_signoff_sequence: number | null;
  latest_signoff_hash: string | null;
  latest_signoff_reviewed_by: string | null;
  latest_signoff_reviewed_at: string | null;
  latest_signoff_note: string;
  latest_signoff_reviewed_by_name: string;
  activities: EstimateReviewActivity[];
}

export const emptyEstimateReviewActivityState = (): EstimateReviewActivityState => ({
  ready: false,
  status: "unavailable",
  current_snapshot_hash: "",
  blocker_count: 0,
  follow_up_count: 0,
  latest_signoff_id: null,
  latest_signoff_sequence: null,
  latest_signoff_hash: null,
  latest_signoff_reviewed_by: null,
  latest_signoff_reviewed_at: null,
  latest_signoff_note: "",
  latest_signoff_reviewed_by_name: "Team member",
  activities: [],
});

export const estimateReviewActivityLabel = (type: EstimateReviewActivityType) => {
  if (type === "signoff") return "Estimator sign-off";
  if (type === "override_export_csv") return "CSV export override";
  if (type === "override_export_pdf") return "PDF export override";
  return "Project push override";
};

export const estimateReviewStatusLabel = (status: EstimateReviewSignoffStatus) => {
  if (status === "current") return "Current sign-off";
  if (status === "stale") return "Sign-off is stale";
  if (status === "unsigned") return "Not signed off";
  return "Sign-off unavailable";
};

export const estimateReleaseNeedsOverride = (state: EstimateReviewActivityState | undefined) =>
  !state || !state.ready || state.status !== "current";
