-- PREPARED ONLY: production subscriber audit and historical-deletion review required before applying.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';
-- Required baseline: applied atomic discovery, including service-only capacity/save RPCs and receipts.
DO $$ BEGIN
  IF to_regprocedure('public.save_discover_results(uuid,uuid,integer,boolean,jsonb)') IS NULL OR
     to_regprocedure('public.get_discover_capacity(uuid,integer,boolean)') IS NULL THEN
    RAISE EXCEPTION 'Applied atomic discovery baseline required';
  END IF;
END $$;
-- Drain existing writers and keep the snapshot stable until the recording trigger is installed.
-- Follow discovery's write order (leads, then receipts); timeout/abort rather than wait indefinitely.
LOCK TABLE public.leads, public.discover_save_receipts IN SHARE ROW EXCLUSIVE MODE;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.discover_save_receipts
    WHERE jsonb_typeof(result->'outcomes') IS DISTINCT FROM 'array') THEN
    RAISE EXCEPTION 'Malformed discovery receipt outcomes: reconcile before migration';
  END IF;
  IF EXISTS (SELECT 1 FROM public.discover_save_receipts r
    CROSS JOIN LATERAL jsonb_array_elements(r.result->'outcomes') o(item)
    WHERE o.item->>'status'='saved' AND
      coalesce(o.item->>'id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') THEN
    RAISE EXCEPTION 'Saved receipt missing a valid business ID: reconcile before migration';
  END IF;
END $$;
-- Add versioned Starter without reinterpreting legacy Starter or rewriting subscriber records.
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_plan_check;
ALTER TABLE public.users ADD CONSTRAINT users_plan_check CHECK (plan IN ('free','starter','prospector','pro','starter_100','admin')) NOT VALID;
ALTER TABLE public.users VALIDATE CONSTRAINT users_plan_check;

-- A durable record survives business deletion, payment, cancellation and re-subscription.
-- Retained leads plus explicit saved receipt IDs are proven lower bounds, not complete lifetime history.
-- Unrecorded historical deletions remain unresolved; never derive invented IDs from aggregate counters.
CREATE TABLE public.business_allowance_ledger (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, lead_id)
);
ALTER TABLE public.business_allowance_ledger ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.business_allowance_ledger FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.business_allowance_ledger TO authenticated;
GRANT ALL ON public.business_allowance_ledger TO service_role;
CREATE POLICY allowance_owner_read ON public.business_allowance_ledger FOR SELECT TO authenticated USING (user_id = auth.uid());
INSERT INTO public.business_allowance_ledger(user_id, lead_id)
SELECT user_id, id FROM public.leads WHERE user_id IS NOT NULL AND (email IS NOT NULL OR phone IS NOT NULL)
UNION
SELECT r.user_id, (o.item->>'id')::uuid FROM public.discover_save_receipts r
CROSS JOIN LATERAL jsonb_array_elements(r.result->'outcomes') o(item)
WHERE o.item->>'status'='saved';

CREATE FUNCTION public.record_business_allowance() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.user_id IS NOT NULL AND (NEW.email IS NOT NULL OR NEW.phone IS NOT NULL) THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('discover:' || NEW.user_id::text, 0));
    INSERT INTO public.business_allowance_ledger(user_id, lead_id) VALUES(NEW.user_id, NEW.id) ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.record_business_allowance() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER record_business_allowance AFTER INSERT OR UPDATE OF user_id,email,phone ON public.leads
FOR EACH ROW EXECUTE FUNCTION public.record_business_allowance();

CREATE OR REPLACE FUNCTION public.get_discover_capacity(p_user_id uuid, p_leads_limit integer, p_monthly boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public SET timezone = 'UTC' AS $$
DECLARE
  v_usage public.usage%ROWTYPE;
  v_used integer;
  v_now timestamptz;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Server access required' USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL OR p_leads_limit IS NULL OR p_leads_limit < 0 OR p_monthly IS NULL THEN
    RAISE EXCEPTION 'Invalid capacity request' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('discover:' || p_user_id::text, 0));
  -- A waiting transaction may have started before the winning transaction created the period.
  v_now := clock_timestamp();
  IF p_monthly THEN
    SELECT * INTO v_usage FROM public.usage
    WHERE user_id = p_user_id AND period_start <= v_now AND period_end > v_now
    ORDER BY period_start DESC, id DESC LIMIT 1 FOR UPDATE;
    IF NOT FOUND THEN
      INSERT INTO public.usage(user_id, leads_used, leads_limit, period_start, period_end)
      VALUES(p_user_id, 0, p_leads_limit, v_now, v_now + interval '1 month')
      RETURNING * INTO v_usage;
    ELSIF v_usage.leads_limit IS DISTINCT FROM p_leads_limit THEN
      UPDATE public.usage SET leads_limit = p_leads_limit WHERE id = v_usage.id
      RETURNING * INTO v_usage;
    END IF;
    IF v_usage.leads_used IS NULL OR v_usage.leads_used < 0 THEN
      RAISE EXCEPTION 'Invalid stored usage';
    END IF;
    RETURN jsonb_build_object('leads_used', v_usage.leads_used, 'leads_limit', p_leads_limit,
      'current_period_end', v_usage.period_end, 'usage_id', v_usage.id);
  END IF;
  SELECT count(*) INTO v_used FROM public.business_allowance_ledger
  WHERE user_id = p_user_id;
  RETURN jsonb_build_object('leads_used', v_used, 'leads_limit', p_leads_limit, 'current_period_end', NULL);
END;
$$;

REVOKE ALL ON FUNCTION public.get_discover_capacity(uuid, integer, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_discover_capacity(uuid, integer, boolean) TO service_role;
COMMIT;
