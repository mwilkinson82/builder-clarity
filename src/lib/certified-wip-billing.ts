import type { BillingLineItemRow } from "@/lib/billing.functions";
import type { ProductionSovCertificationRow } from "@/lib/production-forecast.functions";

export type CertifiedWipBillingBlock =
  | "already_applied"
  | "missing_line"
  | "not_draft"
  | "stale"
  | "below_prior"
  | "stored_materials_exceed_target"
  | "no_contract_value";

export interface CertifiedWipBillingPreview {
  contractValueCents: number;
  targetTotalCents: number;
  priorCompletedAndStoredCents: number;
  currentStoredMaterialsCents: number;
  currentDraftWorkCents: number;
  proposedWorkThisPeriodCents: number;
  currentDraftTotalCents: number;
  deltaCents: number;
  block: CertifiedWipBillingBlock | null;
}

export function previewCertifiedWipBillingHandoff({
  certification,
  line,
  applicationStatus,
  stale,
  alreadyApplied,
}: {
  certification: ProductionSovCertificationRow;
  line: BillingLineItemRow | null;
  applicationStatus: string | null;
  stale: boolean;
  alreadyApplied: boolean;
}): CertifiedWipBillingPreview {
  if (!line) {
    return {
      contractValueCents: 0,
      targetTotalCents: 0,
      priorCompletedAndStoredCents: 0,
      currentStoredMaterialsCents: 0,
      currentDraftWorkCents: 0,
      proposedWorkThisPeriodCents: 0,
      currentDraftTotalCents: 0,
      deltaCents: 0,
      block: "missing_line",
    };
  }

  const contractValueCents = Math.max(
    0,
    line.scheduled_value_cents + line.change_order_value_cents,
  );
  const targetTotalCents = Math.round(
    contractValueCents * (Math.min(100, Math.max(0, certification.certified_percent)) / 100),
  );
  const priorCompletedAndStoredCents =
    line.work_completed_previous_cents + line.materials_stored_previous_cents;
  const currentStoredMaterialsCents = line.materials_stored_this_period_cents;
  const currentDraftWorkCents = line.work_completed_this_period_cents;
  const proposedWorkThisPeriodCents = Math.max(
    0,
    targetTotalCents - priorCompletedAndStoredCents - currentStoredMaterialsCents,
  );
  const currentDraftTotalCents =
    priorCompletedAndStoredCents + currentStoredMaterialsCents + currentDraftWorkCents;

  let block: CertifiedWipBillingBlock | null = null;
  if (alreadyApplied) block = "already_applied";
  else if (applicationStatus !== "draft") block = "not_draft";
  else if (stale) block = "stale";
  else if (contractValueCents <= 0) block = "no_contract_value";
  else if (targetTotalCents < priorCompletedAndStoredCents) block = "below_prior";
  else if (targetTotalCents < priorCompletedAndStoredCents + currentStoredMaterialsCents) {
    block = "stored_materials_exceed_target";
  }

  return {
    contractValueCents,
    targetTotalCents,
    priorCompletedAndStoredCents,
    currentStoredMaterialsCents,
    currentDraftWorkCents,
    proposedWorkThisPeriodCents,
    currentDraftTotalCents,
    deltaCents: proposedWorkThisPeriodCents - currentDraftWorkCents,
    block,
  };
}

export function certifiedWipBillingBlockLabel(block: CertifiedWipBillingBlock): string {
  switch (block) {
    case "already_applied":
      return "Already handed off";
    case "missing_line":
      return "Import SOV first";
    case "not_draft":
      return "Select a draft";
    case "stale":
      return "PM refresh required";
    case "below_prior":
      return "Below prior certified";
    case "stored_materials_exceed_target":
      return "Review stored materials";
    case "no_contract_value":
      return "No contract value";
  }
}
