create table if not exists public.guest_lead_captures (
  id uuid primary key default gen_random_uuid(),
  guest_session_id text not null unique,
  email text not null,
  lead_count integer not null default 0,
  preview_count integer not null default 0,
  last_trigger text not null default 'export',
  last_preview_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists guest_lead_captures_email_idx
  on public.guest_lead_captures (email);

alter table public.guest_lead_captures enable row level security;
