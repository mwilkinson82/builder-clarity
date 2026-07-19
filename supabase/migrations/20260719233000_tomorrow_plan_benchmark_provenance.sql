alter table public.tomorrow_plan_items
  add column if not exists benchmark_rate numeric
    check (benchmark_rate is null or benchmark_rate > 0),
  add column if not exists benchmark_source text not null default ''
    check (benchmark_source in ('', 'subcontract_buyout', 'approved_history')),
  add column if not exists benchmark_source_id uuid
    references public.subcontract_allocations(id) on delete set null;

comment on column public.tomorrow_plan_items.benchmark_rate is
  'Snapshot of the authoritative production benchmark when the commitment was made.';
comment on column public.tomorrow_plan_items.benchmark_source is
  'Provenance for the locked production baseline. The daily target may override it without rewriting it.';
comment on column public.tomorrow_plan_items.benchmark_source_id is
  'Source buyout allocation when benchmark_source is subcontract_buyout.';

create index if not exists tomorrow_plan_items_benchmark_source_idx
  on public.tomorrow_plan_items(benchmark_source_id)
  where benchmark_source_id is not null;

notify pgrst, 'reload schema';
