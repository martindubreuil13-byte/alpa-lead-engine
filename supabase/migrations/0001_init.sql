-- Enable extensions
create extension if not exists "pgcrypto";

-- Leads table
create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete cascade not null,
  company_name text not null,
  contact_name text,
  email text,
  phone text,
  website text,
  industry text,
  city text,
  source_type text,
  source_url text,
  notes text,
  status text not null default 'new',
  date_added timestamptz not null default now(),
  first_contact_at timestamptz,
  followup_due_at timestamptz,
  last_contact_at timestamptz,
  archived_reason text,
  email_norm text generated always as (lower(trim(email))) stored,
  website_norm text generated always as (lower(trim(website))) stored,
  company_city_norm text generated always as (lower(trim(company_name)) || '|' || lower(coalesce(trim(city), ''))) stored
);

create unique index if not exists leads_unique_email on public.leads (user_id, email_norm) where email_norm is not null;
create unique index if not exists leads_unique_website on public.leads (user_id, website_norm) where website_norm is not null;
create unique index if not exists leads_unique_company_city on public.leads (user_id, company_city_norm);

-- Templates table
create table if not exists public.templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete cascade not null,
  name text not null,
  subject text not null,
  body text not null,
  created_at timestamptz not null default now()
);

-- Scrape jobs table
create table if not exists public.scrape_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete cascade not null,
  mode text not null,
  query text,
  directory_url text,
  status text not null default 'queued',
  total_found integer not null default 0,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  notes text
);

-- App settings table
create table if not exists public.app_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete cascade not null unique,
  smtp_host text,
  smtp_port integer,
  smtp_user text,
  smtp_pass text,
  smtp_secure boolean default false,
  from_name text,
  from_email text,
  signature text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- RLS
alter table public.leads enable row level security;
alter table public.templates enable row level security;
alter table public.scrape_jobs enable row level security;
alter table public.app_settings enable row level security;

create policy "Leads are user scoped" on public.leads
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Templates are user scoped" on public.templates
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Scrape jobs are user scoped" on public.scrape_jobs
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Settings are user scoped" on public.app_settings
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Function to mark followup due
create or replace function public.mark_followup_due(user_id_input uuid)
returns integer
language plpgsql
as $$
declare
  updated_count integer;
begin
  update public.leads
  set status = 'followup_due'
  where user_id = user_id_input
    and status = 'first_contact_sent'
    and followup_due_at is not null
    and followup_due_at <= now();
  get diagnostics updated_count = row_count;
  return updated_count;
end;
$$;
