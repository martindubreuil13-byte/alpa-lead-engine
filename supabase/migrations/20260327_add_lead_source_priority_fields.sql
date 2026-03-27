alter table public.leads
  add column if not exists source text,
  add column if not exists cost_estimate numeric(10,4);

update public.leads
set source = coalesce(source, 'serper')
where source is null;

update public.leads
set cost_estimate = coalesce(cost_estimate, 0)
where cost_estimate is null;

create index if not exists leads_source_idx
  on public.leads (source);
