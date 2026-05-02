alter table public.leads
  add column if not exists last_activity_at timestamptz;

do $$
declare
  has_status_updated_at boolean;
  has_created_at boolean;
  backfill_expression text;
begin
  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'leads'
      and column_name = 'status_updated_at'
  )
  into has_status_updated_at;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'leads'
      and column_name = 'created_at'
  )
  into has_created_at;

  backfill_expression := 'coalesce(last_contact_at, first_contact_at';

  if has_status_updated_at then
    backfill_expression := backfill_expression || ', status_updated_at';
  end if;

  if has_created_at then
    backfill_expression := backfill_expression || ', created_at';
  end if;

  backfill_expression := backfill_expression || ', date_added)';

  execute format(
    'update public.leads set last_activity_at = %s where last_activity_at is null',
    backfill_expression
  );
end $$;

create index if not exists leads_last_activity_at_idx
  on public.leads (last_activity_at desc);
