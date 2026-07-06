export type BillingMethod = "percent" | "unit" | "material";

export interface WIPBucketInput {
  cost_bucket_id: string;
  cost_code: string;
  bucket: string;
  // BUDGETVSCONTRACT1: the line's billable value (what the owner pays).
  // Optional for legacy fixtures; 0/absent = unpriced → contract basis falls
  // back to original_budget (pre-contract_value behavior).
  contract_value?: number;
  original_budget: number;
  change_order_additions: number;
  actual_to_date: number;
  ftc: number;
  // null = the bucket has never had an earned % entered ("not assessed"). An explicit 0
  // is a real assessment and must NOT be confused with null. Never borrow the project
  // roll-up here — a project-level % is not a per-bucket truth.
  earned_percent_complete: number | null;
  billed_to_date: number;
  retainage_held: number;
  retainage_released: number;
}

export interface WIPBucketResult {
  cost_bucket_id: string;
  cost_code: string;
  bucket: string;
  contract_value: number;
  // True when an earned % was explicitly entered for this bucket. When false, the bucket
  // is "not assessed" and earned_revenue / over_under_billing are null — the app must not
  // invent a number it does not have.
  assessed: boolean;
  earned_revenue: number | null;
  billed_to_date: number;
  over_under_billing: number | null;
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
  // Coverage: how many buckets have an explicitly-entered earned % vs. the total. When
  // assessed_bucket_count < bucket_count, total_earned and total_over_under reflect only the
  // assessed buckets — the UI must say so rather than present them as the whole truth.
  assessed_bucket_count: number;
  bucket_count: number;
  buckets: WIPBucketResult[];
}

const clampPercent = (value: number) =>
  Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));

export function computeWIPBucket(input: WIPBucketInput): WIPBucketResult {
  // BUDGETVSCONTRACT1: a priced line's contract basis is its real
  // contract_value (what the owner pays); an unpriced legacy line falls back
  // to the cost budget — the pre-contract_value behavior, kept so existing
  // jobs' WIP doesn't zero out. Budget-as-contract was the user-reported bug.
  const contractBasis =
    (input.contract_value ?? 0) > 0 ? (input.contract_value as number) : input.original_budget;
  const contract_value = contractBasis + input.change_order_additions;
  // An explicit 0 is a real assessment (earns nothing); only null means "not assessed".
  const assessed = input.earned_percent_complete != null;
  const earned_revenue = assessed
    ? contract_value * (clampPercent(input.earned_percent_complete as number) / 100)
    : null;
  const over_under_billing = earned_revenue == null ? null : input.billed_to_date - earned_revenue;
  const estimated_total_cost = input.actual_to_date + input.ftc;
  const estimated_gross_profit = contract_value - estimated_total_cost;
  const gross_profit_pct = contract_value > 0 ? (estimated_gross_profit / contract_value) * 100 : 0;

  return {
    cost_bucket_id: input.cost_bucket_id,
    cost_code: input.cost_code,
    bucket: input.bucket,
    contract_value,
    assessed,
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
  const bucket_count = results.length;
  const assessed_bucket_count = results.filter((bucket) => bucket.assessed).length;
  const total_contract = results.reduce((sum, bucket) => sum + bucket.contract_value, 0);
  // Unassessed buckets contribute no earned revenue — we do not know it, so we do not
  // fabricate it. Coverage counts let the caller flag the total as partial.
  const total_earned = results.reduce((sum, bucket) => sum + (bucket.earned_revenue ?? 0), 0);
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
    assessed_bucket_count,
    bucket_count,
    buckets: results,
  };
}

export function agingBucket(daysPastDue: number) {
  if (daysPastDue <= 0) return "current" as const;
  if (daysPastDue <= 30) return "days_30" as const;
  if (daysPastDue <= 60) return "days_60" as const;
  return "days_90" as const;
}
