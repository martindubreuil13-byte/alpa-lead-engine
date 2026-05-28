alter table public.profiles
  add column if not exists stripe_subscription_id text,
  add column if not exists plan_status text,
  add column if not exists cancel_at_period_end boolean not null default false,
  add column if not exists canceled_at timestamptz,
  add column if not exists subscription_tier text;

update public.profiles
set
  plan_status = coalesce(plan_status, subscription_status, case when plan = 'free' then 'free' else 'active' end),
  subscription_tier = coalesce(subscription_tier, plan)
where plan_status is null
   or subscription_tier is null;

create index if not exists profiles_stripe_customer_id_idx
  on public.profiles (stripe_customer_id)
  where stripe_customer_id is not null;

create index if not exists profiles_stripe_subscription_id_idx
  on public.profiles (stripe_subscription_id)
  where stripe_subscription_id is not null;
