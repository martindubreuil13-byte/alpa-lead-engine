-- PREPARED ONLY. Recovery copy of public.get_discover_capacity exactly as it is in production on 2026-10-16 (captured read-only with
-- pg_get_functiondef before 20261015_phase1_pricing.sql replaces it). Restoring it brings back "free usage = retained businesses"; the
-- ledger table, trigger and all customer data stay untouched. Needs an approved maintenance decision: the old function lets deleting
-- businesses free Free-plan capacity again.
CREATE OR REPLACE FUNCTION public.get_discover_capacity(p_user_id uuid, p_leads_limit integer, p_monthly boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET "TimeZone" TO 'UTC'
AS $function$
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
    WHERE user_id = p_user_id AND period_start <= v_now AND period_end >= v_now
    ORDER BY period_start DESC, id DESC LIMIT 1 FOR UPDATE;
    IF NOT FOUND THEN
      INSERT INTO public.usage(user_id, leads_used, leads_limit, period_start, period_end)
      VALUES(p_user_id, 0, p_leads_limit, v_now, date_trunc('month', v_now) + interval '1 month' + (v_now - date_trunc('month', v_now)))
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
  SELECT count(*) INTO v_used FROM public.leads
  WHERE user_id = p_user_id AND (email IS NOT NULL OR phone IS NOT NULL);
  RETURN jsonb_build_object('leads_used', v_used, 'leads_limit', p_leads_limit, 'current_period_end', NULL);
END;
$function$;
REVOKE ALL ON FUNCTION public.get_discover_capacity(uuid, integer, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_discover_capacity(uuid, integer, boolean) TO service_role;
