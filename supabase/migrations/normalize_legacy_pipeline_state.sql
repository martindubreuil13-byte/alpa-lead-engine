do $$
declare
  has_leads boolean;
  has_pipeline_stage boolean;
  has_status boolean;
  has_first_contact_at boolean;
  has_contacted_at boolean;
  has_followup_due_at boolean;
  has_followup_sent_at boolean;
  has_last_contact_at boolean;
  has_next_action_status boolean;
  has_last_activity_at boolean;
  has_status_updated_at boolean;
  has_closed_at boolean;
  has_created_at boolean;
  has_date_added boolean;
  contact_expr text;
  final_activity_expr text;
  activity_expr text;
  created_expr text;
  final_evidence_expr text;
  not_closed_expr text;
  stage_repair_expr text;
  validation record;
begin
  select exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'leads'
  ) into has_leads;

  if not has_leads then
    raise notice 'Legacy pipeline normalization skipped: public.leads does not exist.';
    return;
  end if;

  select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'leads' and column_name = 'pipeline_stage') into has_pipeline_stage;
  select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'leads' and column_name = 'status') into has_status;
  select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'leads' and column_name = 'first_contact_at') into has_first_contact_at;
  select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'leads' and column_name = 'contacted_at') into has_contacted_at;
  select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'leads' and column_name = 'followup_due_at') into has_followup_due_at;
  select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'leads' and column_name = 'followup_sent_at') into has_followup_sent_at;
  select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'leads' and column_name = 'last_contact_at') into has_last_contact_at;
  select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'leads' and column_name = 'next_action_status') into has_next_action_status;
  select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'leads' and column_name = 'last_activity_at') into has_last_activity_at;
  select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'leads' and column_name = 'status_updated_at') into has_status_updated_at;
  select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'leads' and column_name = 'closed_at') into has_closed_at;
  select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'leads' and column_name = 'created_at') into has_created_at;
  select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'leads' and column_name = 'date_added') into has_date_added;

  if not has_pipeline_stage then
    raise notice 'Legacy pipeline normalization skipped: public.leads.pipeline_stage does not exist.';
    return;
  end if;

  contact_expr := nullif(concat_ws(', ',
    case when has_contacted_at then 'contacted_at' end,
    case when has_first_contact_at then 'first_contact_at' end
  ), '');

  created_expr := nullif(concat_ws(', ',
    case when has_created_at then 'created_at' end,
    case when has_date_added then 'date_added' end
  ), '');

  final_activity_expr := nullif(concat_ws(', ',
    case when has_followup_sent_at then 'followup_sent_at' end,
    case when has_last_contact_at then 'last_contact_at' end,
    case when has_status_updated_at then 'status_updated_at' end,
    created_expr
  ), '');

  activity_expr := nullif(concat_ws(', ',
    case when has_followup_sent_at then 'followup_sent_at' end,
    case when has_last_contact_at then 'last_contact_at' end,
    contact_expr,
    case when has_closed_at then 'closed_at' end,
    created_expr
  ), '');

  not_closed_expr := case
    when has_status then 'coalesce(status, '''') not in (''closed_no_response'', ''rejected'', ''invalid'', ''no_response'') and pipeline_stage is distinct from ''closed'''
    else 'pipeline_stage is distinct from ''closed'''
  end;

  final_evidence_expr := concat_ws(' or ',
    case when has_followup_sent_at then 'followup_sent_at is not null' end,
    case when has_status then 'status = ''followup_sent''' end,
    case when has_next_action_status then 'next_action_status = ''final_attempt_sent''' end,
    'pipeline_stage = ''final_attempt'''
  );

  stage_repair_expr := 'pipeline_stage is null or pipeline_stage not in (''ready'', ''contacted'', ''ready_followup'', ''final_attempt'', ''closed'')';

  -- Rule 5: closed states are terminal in the current lifecycle helper.
  if has_status then
    execute format(
      'update public.leads
       set pipeline_stage = ''closed''
       where status in (''closed_no_response'', ''rejected'', ''invalid'', ''no_response'')
         and pipeline_stage is distinct from ''closed'''
    );
  end if;

  -- Rule 1: a recorded follow-up is historical proof of final-attempt state.
  if has_status or has_followup_sent_at or has_next_action_status then
    execute format(
      'update public.leads
       set pipeline_stage = ''final_attempt''
       where (%s)
         and %s
         and pipeline_stage is distinct from ''final_attempt''',
      final_evidence_expr,
      not_closed_expr
    );

    if has_last_activity_at and final_activity_expr is not null then
      execute format(
        'update public.leads
         set last_activity_at = coalesce(%s)
         where last_activity_at is null
           and (%s)',
        final_activity_expr,
        final_evidence_expr
      );
    end if;
  end if;

  -- Follow-up due dates are derived from the real first-contact timestamp.
  if has_followup_due_at and contact_expr is not null then
    execute format(
      'update public.leads
       set followup_due_at = coalesce(%s) + interval ''5 days''
       where followup_due_at is null
         and coalesce(%s) is not null
         and %s
         and %s
         and not (%s)',
      contact_expr,
      contact_expr,
      not_closed_expr,
      case when has_followup_sent_at then 'followup_sent_at is null' else 'true' end,
      final_evidence_expr
    );
  end if;

  -- Rule 2: contacted leads past the five-day threshold are ready for follow-up.
  if contact_expr is not null then
    execute format(
      'update public.leads
       set pipeline_stage = ''ready_followup''
       where coalesce(%s) <= now() - interval ''5 days''
         and %s
         and %s
         and not (%s)
         and pipeline_stage is distinct from ''ready_followup''',
      contact_expr,
      case when has_followup_sent_at then 'followup_sent_at is null' else 'true' end,
      not_closed_expr,
      final_evidence_expr
    );

    -- Rule 3: contacted leads inside the wait window remain contacted.
    execute format(
      'update public.leads
       set pipeline_stage = ''contacted''
       where coalesce(%s) > now() - interval ''5 days''
         and %s
         and %s
         and not (%s)
         and pipeline_stage is distinct from ''contacted''',
      contact_expr,
      case when has_followup_sent_at then 'followup_sent_at is null' else 'true' end,
      not_closed_expr,
      final_evidence_expr
    );
  end if;

  -- Rule 4: untouched, open leads become ready for initial outreach.
  execute format(
    'update public.leads
     set pipeline_stage = ''ready''
     where %s
       and %s
       and %s
       and not (%s)
       and (%s)',
    case when contact_expr is not null then format('coalesce(%s) is null', contact_expr) else 'true' end,
    case when has_followup_sent_at then 'followup_sent_at is null' else 'true' end,
    not_closed_expr,
    final_evidence_expr,
    stage_repair_expr
  );

  -- Timestamp backfill: fill only missing lifecycle timestamps from historical fields.
  if has_last_activity_at and activity_expr is not null then
    execute format(
      'update public.leads
       set last_activity_at = coalesce(%s)
       where last_activity_at is null',
      activity_expr
    );
  end if;

  if has_status_updated_at and activity_expr is not null then
    execute format(
      'update public.leads
       set status_updated_at = coalesce(%s)
       where status_updated_at is null',
      activity_expr
    );
  end if;

  raise notice 'Legacy pipeline normalization complete. Stages were inferred from stored contact, follow-up, close, status, and creation timestamps only.';

  for validation in execute
    'select pipeline_stage, count(*) as lead_count
     from public.leads
     where pipeline_stage in (''ready'', ''contacted'', ''ready_followup'', ''final_attempt'', ''closed'')
     group by pipeline_stage
     order by pipeline_stage'
  loop
    raise notice 'Normalized pipeline count: %= %', validation.pipeline_stage, validation.lead_count;
  end loop;
end $$;
