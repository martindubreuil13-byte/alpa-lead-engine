-- READ ONLY. Operator review only; no automatic migration runner or customer data repair.
-- Run before a separately approved activation, then retain the results securely.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '2min';
SELECT to_regprocedure('public.get_discover_capacity(uuid,integer,boolean)') AS capacity_rpc,
       to_regprocedure('public.save_discover_results(uuid,uuid,integer,boolean,jsonb)') AS save_rpc,
       to_regclass('public.discover_save_receipts') AS receipts,
       to_regclass('public.guest_trials') AS guest_trials;
-- Any malformed receipt is a blocking reconciliation item. Never silently discard a saved-ID claim.
SELECT run_id, user_id FROM public.discover_save_receipts
WHERE jsonb_typeof(result->'outcomes') IS DISTINCT FROM 'array'
OR EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(result->'outcomes')='array'
  THEN result->'outcomes' ELSE '[]'::jsonb END) o(item)
  WHERE o.item->>'status'='saved' AND coalesce(o.item->>'id','') !~*
    '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');
WITH receipt_ids AS (
 SELECT DISTINCT r.user_id, (o.item->>'id')::uuid AS lead_id
 FROM public.discover_save_receipts r
 CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(r.result->'outcomes')='array'
  THEN r.result->'outcomes' ELSE '[]'::jsonb END) o(item)
 WHERE o.item->>'status'='saved' AND coalesce(o.item->>'id','') ~*
  '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
), proven AS (
 SELECT user_id,id AS lead_id FROM public.leads WHERE user_id IS NOT NULL AND (email IS NOT NULL OR phone IS NOT NULL)
 UNION SELECT user_id,lead_id FROM receipt_ids
)
SELECT p.id AS user_id,p.plan,p.plan_status,p.subscription_status,
 (SELECT count(*) FROM public.leads l WHERE l.user_id=p.id AND (l.email IS NOT NULL OR l.phone IS NOT NULL)) AS retained_countable,
 (SELECT count(*) FROM receipt_ids r WHERE r.user_id=p.id) AS receipt_saved_ids,
 (SELECT count(*) FROM receipt_ids r WHERE r.user_id=p.id AND NOT EXISTS
   (SELECT 1 FROM public.leads l WHERE l.id=r.lead_id AND l.user_id=r.user_id)) AS receipt_ids_absent_from_library,
 (SELECT count(*) FROM proven k WHERE k.user_id=p.id) AS proven_lifetime_lower_bound,
 (SELECT count(*) FROM public.guest_trials g WHERE g.owner_user_id=p.id) AS linked_trials,
 (SELECT sum(u.leads_used) FROM public.usage u WHERE u.user_id=p.id) AS monthly_aggregate_not_additional_lifetime_proof,
 CASE WHEN (SELECT count(*) FROM proven k WHERE k.user_id=p.id)>=25 THEN 'no remaining Free capacity'
 ELSE 'incomplete history: explicit baseline decision required before remaining Free capacity is enabled' END AS history_review,
 CASE WHEN p.plan IN ('starter','starter_100','prospector','pro') AND p.stripe_subscription_id IS NULL
 THEN 'manual/legacy entitlement review; do not downgrade automatically' END AS subscriber_review
FROM public.profiles p ORDER BY p.id;
-- Missing owners cause ledger FK failure; do not drop these leads to make a migration pass.
SELECT l.id AS lead_id,l.user_id FROM public.leads l LEFT JOIN auth.users a ON a.id=l.user_id
WHERE l.user_id IS NOT NULL AND a.id IS NULL;
-- Monthly periods/counters stay byte-for-byte unchanged. Review anomalies, never reset them to zero.
SELECT u.id,u.user_id,u.leads_used,u.leads_limit,u.period_start,u.period_end
FROM public.usage u WHERE u.leads_used IS NULL OR u.leads_used<0 OR u.leads_limit IS NULL OR u.leads_limit<0
 OR u.period_start IS NULL OR u.period_end IS NULL OR u.period_start>=u.period_end
 OR EXISTS (SELECT 1 FROM public.usage v WHERE v.user_id=u.user_id AND v.id<>u.id
   AND v.period_start<u.period_end AND v.period_end>u.period_start);
COMMIT;
