do $$
begin
  create type public.email_confidence as enum ('high', 'medium', 'low');
exception
  when duplicate_object then null;
end $$;

alter table public.leads
  add column if not exists email_source text,
  add column if not exists email_confidence public.email_confidence,
  add column if not exists is_generic_email boolean;

update public.leads
set is_generic_email = false
where is_generic_email is null;

alter table public.leads
  alter column is_generic_email set default false;

with normalized as (
  select
    id,
    lower(trim(email)) as normalized_email,
    split_part(lower(trim(email)), '@', 1) as local_part,
    split_part(lower(trim(email)), '@', 2) as email_domain,
    regexp_replace(
      split_part(
        split_part(
          regexp_replace(lower(coalesce(website, '')), '^https?://', ''),
          '/',
          1
        ),
        ':',
        1
      ),
      '^www\.',
      ''
    ) as website_host
  from public.leads
  where email is not null
)
update public.leads as leads
set
  email_source = coalesce(leads.email_source, 'legacy_import'),
  is_generic_email = coalesce(
    leads.is_generic_email,
    normalized.local_part in ('info', 'contact', 'hello', 'admin', 'support', 'sales', 'office')
  ),
  email_confidence = coalesce(
    leads.email_confidence,
    case
      when normalized.email_domain = '' then null
      when normalized.website_host <> ''
        and (
          normalized.email_domain = normalized.website_host
          or normalized.website_host like '%.' || normalized.email_domain
          or normalized.email_domain like '%.' || normalized.website_host
        )
      then case
        when normalized.local_part in ('info', 'contact', 'hello', 'admin', 'support', 'sales', 'office')
          then 'medium'::public.email_confidence
        else 'high'::public.email_confidence
      end
      else 'low'::public.email_confidence
    end
  )
from normalized
where leads.id = normalized.id;

create index if not exists leads_status_email_confidence_idx
  on public.leads (status, email_confidence);
