alter table public.outreach_queue
  add column if not exists template_id uuid null references public.templates(id) on delete set null;

create index if not exists outreach_queue_template_id_idx
  on public.outreach_queue(template_id);
