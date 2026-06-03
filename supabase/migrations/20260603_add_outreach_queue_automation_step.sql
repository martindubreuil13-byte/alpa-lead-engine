alter table public.outreach_queue
  add column if not exists automation_step text null;

create index if not exists outreach_queue_automation_step_idx
  on public.outreach_queue (automation_step);

update public.outreach_queue queue
set automation_step =
  case activity.metadata->>'automation_step'
    when 'firstOutreach' then 'first_outreach'
    when 'followUp' then 'follow_up'
    when 'finalAttempt' then 'final_attempt'
    when 'first_outreach' then 'first_outreach'
    when 'follow_up' then 'follow_up'
    when 'final_attempt' then 'final_attempt'
    else queue.automation_step
  end
from public.lead_activity_events activity
where queue.source = 'pipeline_automation'
  and queue.automation_step is null
  and activity.event_type = 'draft_generated'
  and activity.metadata->>'queue_id' = queue.id::text
  and activity.metadata->>'automation_step' in (
    'firstOutreach',
    'followUp',
    'finalAttempt',
    'first_outreach',
    'follow_up',
    'final_attempt'
  );

update public.outreach_queue queue
set automation_step =
  case
    when queue.template_id = settings.step1_template_id then 'first_outreach'
    when queue.template_id = settings.step2_template_id then 'follow_up'
    when queue.template_id = settings.step3_template_id then 'final_attempt'
    else queue.automation_step
  end
from public.pipeline_automation_settings settings
where queue.source = 'pipeline_automation'
  and queue.automation_step is null
  and queue.user_id = settings.user_id
  and queue.template_id in (
    settings.step1_template_id,
    settings.step2_template_id,
    settings.step3_template_id
  );
