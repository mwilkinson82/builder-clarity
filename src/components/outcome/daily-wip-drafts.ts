import type { CostLineItem } from "@/lib/daily-wip";

export interface DraftCostItem extends CostLineItem {
  clientId: string;
}

let costItemSequence = 0;

export function createDraftCostItem(item?: Partial<CostLineItem>): DraftCostItem {
  costItemSequence += 1;
  return {
    clientId: `wip-cost-item-${costItemSequence}`,
    description: item?.description ?? "",
    amount: item?.amount ?? 0,
    quantity: item?.quantity ?? 0,
    unit: item?.unit ?? "",
  };
}
