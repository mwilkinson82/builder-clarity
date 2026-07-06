-- BUDGETLOCK1 — the budget is a locked baseline (founder decision 2026-07-06).
--
-- The budget (cost_buckets.original_budget) is the frozen number the PM steers
-- against. Once a project's budget is locked, the ONLY way the budget moves is
-- through change orders: an approved CO carries its own budgeted cost
-- (change_order_allocations.cost_amount), which layers on top of the frozen
-- original — the original_budget itself never changes.
--
-- budget_locked_at records when the baseline froze. NULL = still in setup
-- (estimate carry / manual entry allowed). It is set by the explicit
-- "Lock budget" action, or automatically when the project's first pay
-- application is created (you don't bill against an unfrozen baseline).
-- There is no unlock in the product — unwinding a lock is a desk operation.

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS budget_locked_at timestamptz;

COMMENT ON COLUMN public.projects.budget_locked_at IS
  'When the cost budget baseline was frozen. NULL = unlocked (setup). Once set, original_budget edits are refused server-side; budget changes flow only through approved change-order cost allocations.';
