# Free-trial feedback: what is stored and how to read it

One question at the end of the free-trial results: "Did ALPA find what you were looking for?" (Yes / Partly / Not really), and for
Partly and Not really an optional "What could ALPA have done better?". No email, account or personal detail is requested.

## Where it lives

No new table and no migration. One row per free trial in `public.activity_logs`, `event = 'trial_feedback'`, written server-side by
`POST /api/guest/feedback` (service role; the table's only customer access is the existing own-rows read policy). Columns used:
`session_id` (the visitor's analytics session when known, otherwise the trial id), `user_id` (the account, when signed in), `email`
(always null), `leads_count`, `metadata`, `created_at`. `metadata` holds:

| key | meaning |
|---|---|
| `trial_id` | the free trial (joins `guest_trials.id`, which carries `owner_user_id` once the visitor signs up) |
| `answer` | `yes`, `partly` or `not_really` (latest wins) |
| `comment`, `has_comment` | the optional text, at most 500 characters |
| `sends`, `first_sent_at`, `last_sent_at` | corrections are allowed up to 5 times per trial; later sends are refused |
| `saved_businesses`, `searches`, `businesses_used` | the server's record of the trial when answered |
| `trial_age_hours` | hours since the trial began (how "returning" the visitor was) |
| `downloaded` | whether the CSV had been downloaded when the answer was given |
| `signed_in`, `analytics_session_id`, `source` | context; no fingerprint, address or device detail |

The prompt's own display is `trial_feedback_prompt_shown` (the denominator for a response rate). Comments are visitor-written text:
read them as data, never render them as markup.

## The questions we want to answer (read-only SQL)

```sql
-- 1. How many found ALPA useful, partly, not?
select metadata->>'answer' as answer, count(*) from public.activity_logs
where event = 'trial_feedback' group by 1 order by 2 desc;

-- 2. Response rate: answers per time the prompt was shown
select (select count(*) from public.activity_logs where event = 'trial_feedback') as answered,
       (select count(*) from public.activity_logs where event = 'trial_feedback_prompt_shown') as shown;

-- 3. Problems mentioned repeatedly (word counts; read the comments themselves for the real story)
select w as word, count(*) from public.activity_logs l,
  regexp_split_to_table(regexp_replace(lower(l.metadata->>'comment'), '[^a-z ]', ' ', 'g'), '\s+') w
where l.event = 'trial_feedback' and l.metadata->>'comment' is not null and length(w) > 3
group by w order by 2 desc limit 30;

-- 4. Does satisfaction go with downloading, and with returning (a trial older than a day)?
select f.metadata->>'answer' as answer, count(*) as answers,
  count(*) filter (where exists (select 1 from public.activity_logs d where d.event = 'trial_csv_downloaded'
                                  and d.session_id = f.metadata->>'analytics_session_id')) as downloaded_csv,
  count(*) filter (where (f.metadata->>'trial_age_hours')::int >= 24) as returning_visitors
from public.activity_logs f where f.event = 'trial_feedback' group by 1;

-- 5. Does it go with upgrading? (trial -> account -> paid plan)
select f.metadata->>'answer' as answer, count(*) as answers,
  count(*) filter (where p.plan in ('prospector', 'starter', 'pro')) as paying
from public.activity_logs f
left join public.guest_trials t on t.id::text = f.metadata->>'trial_id'
left join public.profiles p on p.id = t.owner_user_id
where f.event = 'trial_feedback' group by 1;
```

## Limits worth knowing

- One answer per trial, but the check is read-then-write: two simultaneous first sends could create two rows. Analyses should take the
  latest row per `metadata->>'trial_id'`. A unique index would close it; it needs a migration and was not judged worth one.
- A visitor who clears cookies is a new trial and can answer again. That is the same limit as the free allowance.
- Feedback never triggers anything: no email, no pop-up, no offer. The allowance-exhausted upgrade moment is separate.
