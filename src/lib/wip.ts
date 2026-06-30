export type BillingMethod = "percent" | "unit" | "material";

export interface WIPBucketInput {
  cost_bucket_id: string;
  cost_code: string;
  bucket: string;
  original_budget: number;
  change_order_additions: number;
  actual_to_date: number;
  ftc: number;
  earned_percent_complete: number;
  billed_to_date: number;
  retainage_held: number;
  retainage_released: number;
}

export interface WIPBucketResult {
  cost_bucket_id: string;
  cost_code: string;
  bucket: string;
  contract_value: number;
  earned_revenue: number;
  billed_to_date: number;
  over_under_billing: number;
  cost_to_date: number;
  cost_to_complete: number;
  estimated_total_cost: number;
  estimated_gross_profit: number;
  gross_profit_pct: number;
  net_retainage: number;
}

export interface ProjectWIPResult {
  project_id: string;
  project_name: string;
  total_contract: number;
  total_earned: number;
  total_billed: number;
  total_over_under: number;
  total_cost: number;
  total_cost_to_complete: number;
  estimated_gross_profit: number;
  gross_profit_pct: number;
  total_retainage_net: number;
  open_receivable: number;
  cash_position: number;
  buckets: WIPBucketResult[];
}

const clampPercent = (value: number) =>
  Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));

export function computeWIPBucket(input: WIPBucketInput): WIPBucketResult {
  const contract_value = input.original_budget + input.change_order_additions;
  const earned_revenue = contract_value * (clampPercent(input.earned_percent_complete) / 100);
  const over_under_billing = input.billed_to_date - earned_revenue;
  const estimated_total_cost = input.actual_to_date + input.ftc;
  const estimated_gross_profit = contract_value - estimated_total_cost;
  const gross_profit_pct = contract_value > 0 ? (estimated_gross_profit / contract_value) * 100 : 0;

  return {
    cost_bucket_id: input.cost_bucket_id,
    cost_code: input.cost_code,
    bucket: input.bucket,
    contract_value,
    earned_revenue,
    billed_to_date: input.billed_to_date,
    over_under_billing,
    cost_to_date: input.actual_to_date,
    cost_to_complete: input.ftc,
    estimated_total_cost,
    estimated_gross_profit,
    gross_profit_pct,
    net_retainage: Math.max(0, input.retainage_held - input.retainage_released),
  };
}

export function computeProjectWIP(
  project: { id: string; name: string },
  buckets: WIPBucketInput[],
  paid_to_date: number,
): ProjectWIPResult {
  const results = buckets.map(computeWIPBucket);
  const total_contract = results.reduce((sum, bucket) => sum + bucket.contract_value, 0);
  const total_earned = results.reduce((sum, bucket) => sum + bucket.earned_revenue, 0);
  const total_billed = results.reduce((sum, bucket) => sum + bucket.billed_to_date, 0);
  const total_cost = results.reduce((sum, bucket) => sum + bucket.cost_to_date, 0);
  const total_cost_to_complete = results.reduce((sum, bucket) => sum + bucket.cost_to_complete, 0);
  const estimated_gross_profit = total_contract - (total_cost + total_cost_to_complete);
  const total_retainage_net = results.reduce((sum, bucket) => sum + bucket.net_retainage, 0);

  return {
    project_id: project.id,
    project_name: project.name,
    total_contract,
    total_earned,
    total_billed,
    total_over_under: total_billed - total_earned,
    total_cost,
    total_cost_to_complete,
    estimated_gross_profit,
    gross_profit_pct: total_contract > 0 ? (estimated_gross_profit / total_contract) * 100 : 0,
    total_retainage_net,
    open_receivable: Math.max(0, total_billed - paid_to_date - total_retainage_net),
    cash_position: paid_to_date - total_cost,
    buckets: results,
  };
}

export function agingBucket(daysPastDue: number) {
  if (daysPastDue <= 0) return "current" as const;
  if (daysPastDue <= 30) return "days_30" as const;
  if (daysPastDue <= 60) return "days_60" as const;
  return "days_90" as const;
}
