alter table public.change_orders
  add column if not exists financial_direction text not null default 'addition';

update public.change_orders
set financial_direction = 'credit'
where contract_amount < 0 or cost_amount < 0;

alter table public.change_orders
  drop constraint if exists change_orders_financial_direction_check;
alter table public.change_orders
  add constraint change_orders_financial_direction_check
  check (financial_direction in ('addition', 'credit'));

comment on column public.change_orders.financial_direction is
  'Addition increases the owner contract; credit is a deductive owner change. Amounts remain signed for rollup compatibility.';

alter table public.change_order_allocations
  drop constraint if exists change_order_allocations_amounts_check;
alter table public.change_order_allocations
  drop constraint if exists change_order_allocations_signed_amounts_check;
alter table public.change_order_allocations
  add constraint change_order_allocations_signed_amounts_check
  check (
    (contract_amount >= 0 and cost_amount >= 0)
    or (contract_amount <= 0 and cost_amount <= 0)
  );

comment on constraint change_order_allocations_signed_amounts_check
  on public.change_order_allocations is
  'Additive CO allocations are positive; owner-credit allocations are negative so SOV and budget reductions stay signed.';

notify pgrst, 'reload schema';
