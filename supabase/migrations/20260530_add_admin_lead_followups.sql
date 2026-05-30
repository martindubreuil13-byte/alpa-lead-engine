create table if not exists public.follow_up_settings (
  id uuid primary key default gen_random_uuid(),
  follow_up_delay_days integer not null default 3,
  coupon_code text null,
  discount_label text null,
  email_subject text not null default 'Still need fresh leads? Use {{coupon_code}}',
  email_body_template text not null default 'Hi,\n\nYou generated {{lead_count}} lead{{lead_count_plural}} for "{{search_query}}" in "{{location}}".\n\nIf you want to keep prospecting with ALPA, use coupon code {{coupon_code}} for {{discount_label}}.\n\nBest,\nMartin',
  send_copy_to_admin boolean not null default true,
  admin_notification_email text null,
  exclusion_patterns text[] not null default array['martin@', 'test@', 'admin@', '@mindrasolutions.com'],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.lead_follow_ups (
  id uuid primary key default gen_random_uuid(),
  source_activity_id uuid null references public.activity_logs(id) on delete set null,
  session_id text null,
  user_id uuid null references auth.users(id) on delete set null,
  email text not null,
  search_query text null,
  location text null,
  lead_count integer not null default 0,
  followup_sent boolean not null default false,
  status text not null default 'pending',
  converted boolean not null default false,
  converted_at timestamptz null,
  email_subject text null,
  email_body text null,
  email_html text null,
  provider_message_id text null,
  last_error text null,
  created_at timestamptz not null default now(),
  follow_up_sent_at timestamptz null,
  updated_at timestamptz not null default now(),
  constraint lead_follow_ups_status_check check (status in ('pending', 'sent', 'failed'))
);

create unique index if not exists lead_follow_ups_source_activity_id_idx
  on public.lead_follow_ups (source_activity_id)
  where source_activity_id is not null;

create index if not exists lead_follow_ups_email_idx
  on public.lead_follow_ups (email);

create index if not exists lead_follow_ups_status_idx
  on public.lead_follow_ups (status);

create index if not exists lead_follow_ups_created_at_idx
  on public.lead_follow_ups (created_at desc);

alter table public.follow_up_settings enable row level security;
alter table public.lead_follow_ups enable row level security;
