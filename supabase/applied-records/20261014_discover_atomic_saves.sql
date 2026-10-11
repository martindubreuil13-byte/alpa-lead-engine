-- PREPARED ONLY. Issue 5: deploy this reviewed database change before the matching app.
-- No existing lead/usage data is rewritten, no research function or queue is touched.
-- Server supplies the authenticated owner and resolved plan; clients cannot invoke these RPCs.
CREATE TABLE public.discover_save_receipts (
  run_id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  request_hash text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.discover_save_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.discover_save_receipts FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.discover_save_receipts TO service_role;

CREATE FUNCTION public.get_discover_capacity(p_user_id uuid, p_leads_limit integer, p_monthly boolean)
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
$$;

CREATE FUNCTION public.save_discover_results(
  p_run_id uuid, p_user_id uuid, p_leads_limit integer, p_monthly boolean, p_leads jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public SET timezone = 'UTC' AS $$
DECLARE
  v_hash text;
  v_receipt public.discover_save_receipts%ROWTYPE;
  v_capacity jsonb;
  v_usage_id uuid;
  v_used integer;
  v_item jsonb;
  v_lead public.leads%ROWTYPE;
  v_id uuid;
  v_status text;
  v_index integer := 0;
  v_added integer := 0;
  v_outcomes jsonb := '[]'::jsonb;
  v_result jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Server access required' USING ERRCODE = '42501';
  END IF;
  IF p_run_id IS NULL OR p_user_id IS NULL OR p_leads IS NULL OR jsonb_typeof(p_leads) <> 'array' THEN
    RAISE EXCEPTION 'Invalid save request' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_leads) > 50 THEN
    RAISE EXCEPTION 'Save batch exceeds Discover limit' USING ERRCODE = '22023';
  END IF;
  -- Same owner lock is used for period creation, capacity recheck and every batch commit.
  PERFORM pg_advisory_xact_lock(hashtextextended('discover:' || p_user_id::text, 0));
  v_hash := md5(jsonb_build_object('user', p_user_id, 'limit', p_leads_limit,
    'monthly', p_monthly, 'leads', p_leads)::text);
  SELECT * INTO v_receipt FROM public.discover_save_receipts WHERE run_id = p_run_id;
  IF FOUND THEN
    IF v_receipt.user_id <> p_user_id OR v_receipt.request_hash <> v_hash THEN
      RAISE EXCEPTION 'Save reference reused with different input' USING ERRCODE = '22023';
    END IF;
    RETURN v_receipt.result;
  END IF;
  v_capacity := public.get_discover_capacity(p_user_id, p_leads_limit, p_monthly);
  v_used := (v_capacity->>'leads_used')::integer;
  IF p_monthly THEN
    v_usage_id := (v_capacity->>'usage_id')::uuid;
    IF v_usage_id IS NULL THEN RAISE EXCEPTION 'Usage period was not confirmed'; END IF;
  END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_leads) LOOP
    v_id := NULL;
    v_status := 'invalid';
    IF jsonb_typeof(v_item) <> 'object' OR nullif(btrim(v_item->>'company_name'), '') IS NULL OR
       (nullif(btrim(v_item->>'email'), '') IS NULL AND nullif(btrim(v_item->>'phone'), '') IS NULL) THEN
      v_status := 'invalid';
    ELSIF EXISTS (
      SELECT 1 FROM public.leads existing WHERE existing.user_id = p_user_id
      AND lower(regexp_replace(btrim(existing.company_name), '\s+', ' ', 'g')) =
          lower(regexp_replace(btrim(v_item->>'company_name'), '\s+', ' ', 'g'))
      AND lower(btrim(coalesce(existing.city, ''))) = lower(btrim(coalesce(v_item->>'city', '')))
      AND (
        (nullif(btrim(v_item->>'email'), '') IS NOT NULL AND
          lower(btrim(existing.email)) = lower(btrim(v_item->>'email')))
        OR (nullif(regexp_replace(v_item->>'phone', '\D', '', 'g'), '') IS NOT NULL AND
          regexp_replace(existing.phone, '\D', '', 'g') = regexp_replace(v_item->>'phone', '\D', '', 'g'))
        OR (nullif(btrim(v_item->>'website'), '') IS NOT NULL AND
          regexp_replace(regexp_replace(lower(btrim(existing.website)), '^https?://(www\.)?', ''), '/+$', '') =
          regexp_replace(regexp_replace(lower(btrim(v_item->>'website')), '^https?://(www\.)?', ''), '/+$', ''))
      )
    ) THEN
      -- Production has no business UNIQUE constraint. Check identity inside the owner lock.
      -- Require matching name and location plus contact/site evidence; never modify the older lead.
      v_status := 'duplicate';
    ELSIF v_used >= p_leads_limit THEN
      v_status := 'limit';
    ELSE
      BEGIN
        -- Populate typed values, but INSERT only an explicit allowlist. Owner/status/id cannot be overridden.
        v_lead := jsonb_populate_record(NULL::public.leads, v_item);
        v_id := gen_random_uuid();
        INSERT INTO public.leads(id, user_id, company_name, email, phone, website, city, industry,
          status, source, email_confidence, email_source, is_generic_email, cost_estimate)
        VALUES(v_id, p_user_id, btrim(v_lead.company_name), nullif(btrim(v_lead.email), ''),
          nullif(btrim(v_lead.phone), ''), v_lead.website, v_lead.city, v_lead.industry,
          'inbox', v_lead.source, v_lead.email_confidence, v_lead.email_source,
          coalesce(v_lead.is_generic_email, false), coalesce(v_lead.cost_estimate, 0));
        -- Older schemas lack this optional activity field. Match the existing insert behavior.
        IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.leads'::regclass
          AND attname = 'last_activity_at' AND NOT attisdropped) THEN
          EXECUTE 'UPDATE public.leads SET last_activity_at = $1 WHERE id = $2'
          USING now(), v_id;
        END IF;
        v_status := 'saved';
      EXCEPTION
        WHEN unique_violation THEN v_status := 'duplicate'; v_id := NULL;
        WHEN not_null_violation OR check_violation OR foreign_key_violation OR invalid_text_representation
          THEN v_status := 'invalid'; v_id := NULL;
        WHEN OTHERS THEN
          -- Infrastructure, permission, schema and unexpected trigger failures abort the whole batch.
          RAISE;
      END;
      IF v_status = 'saved' THEN v_used := v_used + 1; v_added := v_added + 1; END IF;
    END IF;
    v_outcomes := v_outcomes || jsonb_build_array(jsonb_build_object(
      'index', v_index, 'status', v_status, 'id', v_id));
    v_index := v_index + 1;
  END LOOP;
  IF p_monthly AND v_added > 0 THEN
    -- Any failure here rolls back leads and receipt as well. Never persist an estimated counter.
    UPDATE public.usage SET leads_used = leads_used + v_added WHERE id = v_usage_id;
  END IF;
  v_result := jsonb_build_object('outcomes', v_outcomes, 'leads_used', v_used,
    'leads_limit', p_leads_limit, 'current_period_end', v_capacity->'current_period_end');
  INSERT INTO public.discover_save_receipts(run_id, user_id, request_hash, result)
  VALUES(p_run_id, p_user_id, v_hash, v_result);
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_discover_capacity(uuid, integer, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.save_discover_results(uuid, uuid, integer, boolean, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_discover_capacity(uuid, integer, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.save_discover_results(uuid, uuid, integer, boolean, jsonb) TO service_role;
