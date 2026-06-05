alter table public.activity_logs
  add column if not exists search_id uuid null,
  add column if not exists source_page text null,
  add column if not exists utm_source text null,
  add column if not exists utm_medium text null,
  add column if not exists utm_campaign text null,
  add column if not exists utm_content text null,
  add column if not exists utm_term text null,
  add column if not exists referrer text null,
  add column if not exists first_landing_page text null,
  add column if not exists device_type text null,
  add column if not exists browser text null,
  add column if not exists operating_system text null;

alter table public.users
  add column if not exists analytics_excluded boolean not null default false,
  add column if not exists signup_date timestamptz null,
  add column if not exists first_search_date timestamptz null,
  add column if not exists first_export_date timestamptz null,
  add column if not exists first_upgrade_click_date timestamptz null,
  add column if not exists paid_conversion_date timestamptz null;

update public.users
set
  analytics_excluded = true
where
  lower(coalesce(email, '')) = 'martin@mindrasolutions.com'
  or lower(coalesce(email, '')) like '%@mindrasolutions.com';

update public.users
set signup_date = coalesce(signup_date, created_at)
where signup_date is null;

create index if not exists activity_logs_event_created_idx
  on public.activity_logs (event, created_at desc);

create index if not exists activity_logs_user_created_idx
  on public.activity_logs (user_id, created_at desc)
  where user_id is not null;

create index if not exists activity_logs_session_created_idx
  on public.activity_logs (session_id, created_at desc);

create index if not exists activity_logs_search_id_idx
  on public.activity_logs (search_id)
  where search_id is not null;

create table if not exists public.user_attribution (
  id uuid primary key default gen_random_uuid(),
  session_id text not null,
  user_id uuid null references auth.users(id) on delete set null,
  email text null,
  utm_source text null,
  utm_medium text null,
  utm_campaign text null,
  utm_content text null,
  utm_term text null,
  referrer text null,
  first_landing_page text null,
  device_type text null,
  browser text null,
  operating_system text null,
  analytics_excluded boolean not null default false,
  signup_date timestamptz null,
  first_search_date timestamptz null,
  first_export_date timestamptz null,
  first_upgrade_click_date timestamptz null,
  paid_conversion_date timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_attribution_session_unique unique (session_id)
);

create index if not exists user_attribution_user_created_idx
  on public.user_attribution (user_id, created_at desc)
  where user_id is not null;

create index if not exists user_attribution_email_idx
  on public.user_attribution (lower(email))
  where email is not null;

create table if not exists public.search_analytics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid null references auth.users(id) on delete set null,
  session_id text null,
  email text null,
  search_query text null,
  business_type text null,
  location text null,
  filters_used jsonb null,
  number_of_results_returned integer not null default 0,
  number_of_results_with_email integer not null default 0,
  number_of_results_with_phone integer not null default 0,
  number_of_results_with_website integer not null default 0,
  search_duration_ms integer null,
  error_message text null,
  no_results boolean not null default false,
  device_type text null,
  browser text null,
  operating_system text null,
  source_page text null,
  utm_source text null,
  utm_medium text null,
  utm_campaign text null,
  utm_content text null,
  utm_term text null,
  referrer text null,
  first_landing_page text null,
  viewed_results boolean not null default false,
  opened_lead_detail boolean not null default false,
  downloaded_csv_after_search boolean not null default false,
  email_exported_after_search boolean not null default false,
  performed_another_search boolean not null default false,
  viewed_pricing_after_search boolean not null default false,
  clicked_upgrade_after_search boolean not null default false,
  started_checkout_after_search boolean not null default false,
  paid_after_search boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists search_analytics_user_created_idx
  on public.search_analytics (user_id, created_at desc)
  where user_id is not null;

create index if not exists search_analytics_session_created_idx
  on public.search_analytics (session_id, created_at desc)
  where session_id is not null;

create index if not exists search_analytics_created_idx
  on public.search_analytics (created_at desc);

alter table public.user_attribution enable row level security;
alter table public.search_analytics enable row level security;

drop policy if exists "Allow authenticated admin users to access user_attribution" on public.user_attribution;
create policy "Allow authenticated admin users to access user_attribution"
on public.user_attribution
for select
to authenticated
using (
  exists (
    select 1 from public.users
    where users.id = auth.uid()
      and (users.plan = 'admin' or users.role = 'admin')
  )
);

drop policy if exists "Allow authenticated admin users to access search_analytics" on public.search_analytics;
create policy "Allow authenticated admin users to access search_analytics"
on public.search_analytics
for select
to authenticated
using (
  exists (
    select 1 from public.users
    where users.id = auth.uid()
      and (users.plan = 'admin' or users.role = 'admin')
  )
);
