begin;
alter table public.guest_trials add column owner_user_id uuid references auth.users(id) on delete set null;
create index guest_trials_owner_idx on public.guest_trials(owner_user_id, created_at desc) where owner_user_id is not null;
commit;
