import type { SelectionApprovalGateType } from "@/lib/selections.functions";

export const selectionProcurementPathCopy = {
  owner_selection: {
    eyebrow: "Selection options",
    heading: "What does the client need to choose?",
    budget: "Allowance / budget",
    item: "Option",
    add: "Add option",
    recommendation: "Contractor recommended",
  },
  submittal: {
    eyebrow: "Proposed material / product",
    heading: "What product is being submitted for approval?",
    budget: "Budget / committed cost",
    item: "Product",
    add: "Add alternate",
    recommendation: "Basis of design / specified product",
  },
  rfi: {
    eyebrow: "RFI-directed procurement",
    heading: "What material or scope is affected by the RFI?",
    budget: "Potential cost impact",
    item: "Proposed resolution",
    add: "Add alternate",
    recommendation: "Recommended response",
  },
} satisfies Record<SelectionApprovalGateType, Record<string, string>>;
