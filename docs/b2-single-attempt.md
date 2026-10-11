# One attempt per profile (operator note)

No migration is needed. The number of attempts a job gets is `ci_research_controls.max_attempts`, copied onto each job
(`max_retries`) when a run is authorized. With `max_attempts = 1`, `complete_ci_enrichment_worker` ends a failed attempt
as `failed` at once (`retry_count + 1 < max_retries` is false), so there is no retry and no 60-second cooldown, and a
timed-out or interrupted job also ends as `failed`. Runs authorized earlier keep the value they were created with.

Apply with the existing operator function (service role, audited in `ci_research_control_log`); every other value is the
current production configuration and must be passed unchanged:

```sql
select set_config('request.jwt.claim.role','service_role', false);
select set_ci_research_limits(0.002, 0.006, 0.05, 0.001, 0.25, 10, 2, 1, 24, 'owner-single-attempt');
-- arguments: per_job_reserve, per_profile_ceiling, per_run_cap, per_lead_monthly, global_monthly, max_leads_per_run,
--            per_user_concurrency, max_attempts (now 1), run_ttl_hours, operator
select get_ci_research_status();   -- expect max_attempts 1, everything else unchanged
```
