alter table public.agent_icp
  add column if not exists is_active boolean not null default false;

create unique index if not exists agent_icp_one_active_per_user_idx
  on public.agent_icp (user_id)
  where is_active = true;

create policy "Users can delete their own agent icp rows"
  on public.agent_icp
  for delete
  to authenticated
  using (auth.uid() = user_id);
