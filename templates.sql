create table if not exists public.templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  tag text,
  subject text not null,
  body text not null,
  signature text,
  created_at timestamp with time zone default now()
);

alter table public.templates add column if not exists tag text;

alter table public.templates enable row level security;

drop policy if exists "Users can view their templates" on public.templates;
create policy "Users can view their templates"
on public.templates
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Users can create their templates" on public.templates;
create policy "Users can create their templates"
on public.templates
for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their templates" on public.templates;
create policy "Users can update their templates"
on public.templates
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete their templates" on public.templates;
create policy "Users can delete their templates"
on public.templates
for delete
to authenticated
using ((select auth.uid()) = user_id);

create or replace function public.create_default_templates()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1
    from public.templates
    where user_id = new.id
  ) then
    return new;
  end if;

  insert into public.templates (user_id, name, subject, body, signature)
  values
    (
      new.id,
      'First Outreach',
      'Quick question about your business',
      '<p>Hi {{name}},</p><p>I came across your business and wanted to reach out.</p>',
      'Best regards,<br />Martin'
    ),
    (
      new.id,
      'Follow Up',
      'Following up',
      '<p>Hi {{name}},</p><p>Just following up on my previous message.</p>',
      'Best regards,<br />Martin'
    ),
    (
      new.id,
      'Final Attempt',
      'Last follow-up',
      '<p>Hi {{name}},</p><p>This will be my last message.</p>',
      'Best regards,<br />Martin'
    );

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
after insert on auth.users
for each row
execute function public.create_default_templates();

-- Optional one-time backfill for existing users who do not have templates yet:
-- insert into public.templates (user_id, name, subject, body, signature)
-- select
--   users.id,
--   starter.name,
--   starter.subject,
--   starter.body,
--   starter.signature
-- from auth.users as users
-- cross join (
--   values
--     (
--       'First Outreach',
--       'Quick question about your business',
--       '<p>Hi {{name}},</p><p>I came across your business and wanted to reach out.</p>',
--       'Best regards,<br />Martin'
--     ),
--     (
--       'Follow Up',
--       'Following up',
--       '<p>Hi {{name}},</p><p>Just following up on my previous message.</p>',
--       'Best regards,<br />Martin'
--     ),
--     (
--       'Final Attempt',
--       'Last follow-up',
--       '<p>Hi {{name}},</p><p>This will be my last message.</p>',
--       'Best regards,<br />Martin'
--     )
-- ) as starter(name, subject, body, signature)
-- where not exists (
--   select 1
--   from public.templates
--   where templates.user_id = users.id
-- );
