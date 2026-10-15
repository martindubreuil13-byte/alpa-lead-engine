-- PREPARED ONLY. Requires the proposed 20261015_phase1_pricing.sql lifetime ledger.
-- No deployment/application authorized. No existing lead, profile, trial or usage row is rewritten by setup.
BEGIN;
DO $$ BEGIN
  IF to_regclass('public.business_allowance_ledger') IS NULL THEN
    RAISE EXCEPTION 'Lifetime allowance ledger must be installed first';
  END IF;
END $$;
-- No cascading foreign keys: deleting a business/account/trial must not erase import ownership/history.
CREATE TABLE public.guest_import_claims(trial_id uuid PRIMARY KEY, user_id uuid NOT NULL);
CREATE INDEX guest_import_claims_user ON public.guest_import_claims(user_id);
CREATE TABLE public.guest_import_items(trial_id uuid NOT NULL, item_key text NOT NULL, lead_id uuid NOT NULL,
  PRIMARY KEY(trial_id,item_key));
ALTER TABLE public.guest_import_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guest_import_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.guest_import_claims, public.guest_import_items FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.guest_import_claims, public.guest_import_items TO service_role;
CREATE FUNCTION public.guest_import_key(p_lead jsonb) RETURNS text LANGUAGE sql IMMUTABLE
SET search_path = pg_catalog, public AS $$
 SELECT md5(concat_ws('::', lower(btrim(coalesce(p_lead->>'company_name',''))),
   lower(btrim(coalesce(p_lead->>'email',''))),lower(btrim(coalesce(p_lead->>'phone',''))),
   lower(btrim(coalesce(p_lead->>'website',''))),lower(btrim(coalesce(p_lead->>'city','')))))
$$;
REVOKE ALL ON FUNCTION public.guest_import_key(jsonb) FROM PUBLIC, anon, authenticated;
-- Preserve all known legacy claims and match retained imported businesses without changing either.
INSERT INTO public.guest_import_claims SELECT id,owner_user_id FROM public.guest_trials WHERE owner_user_id IS NOT NULL;
INSERT INTO public.guest_import_items
SELECT t.id,public.guest_import_key(g.item),l.id
FROM public.guest_trials t CROSS JOIN LATERAL jsonb_array_elements(t.leads) g(item)
JOIN public.leads l ON l.user_id=t.owner_user_id AND public.guest_import_key(to_jsonb(l))=public.guest_import_key(g.item)
WHERE t.owner_user_id IS NOT NULL ON CONFLICT DO NOTHING;

CREATE FUNCTION public.claim_guest_businesses(p_user_id uuid,p_trial_id uuid,p_leads jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public SET timezone = 'UTC' AS $$
DECLARE
 v_trial public.guest_trials%ROWTYPE; v_profile public.profiles%ROWTYPE;
 v_owner uuid; v_free boolean; v_used integer; v_item jsonb; v_key text;
 v_id uuid; v_lead public.leads%ROWTYPE; v_rows integer;
 v_imported integer:=0; v_invalid integer:=0; v_duplicate integer:=0; v_allowance integer:=0; v_backfilled integer:=0;
 v_facts boolean; v_light boolean; v_was_duplicate boolean;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Server access required' USING ERRCODE='42501'; END IF;
 IF p_user_id IS NULL OR p_trial_id IS NULL OR p_leads IS NULL OR jsonb_typeof(p_leads)<>'array' OR jsonb_array_length(p_leads)>25 THEN
  RAISE EXCEPTION 'Invalid guest import';
 END IF;
 -- Same lock as atomic discovery: a claim and a search cannot spend the same final slot.
 PERFORM pg_advisory_xact_lock(hashtextextended('discover:'||p_user_id::text,0));
 SELECT * INTO v_trial FROM public.guest_trials WHERE id=p_trial_id FOR UPDATE;
 IF NOT FOUND OR v_trial.created_at < clock_timestamp()-interval '30 days' THEN RAISE EXCEPTION 'Trial unavailable'; END IF;
 SELECT user_id INTO v_owner FROM public.guest_import_claims WHERE trial_id=p_trial_id;
 IF (v_owner IS NOT NULL AND v_owner<>p_user_id) OR (v_trial.owner_user_id IS NOT NULL AND v_trial.owner_user_id<>p_user_id) THEN
  RAISE EXCEPTION 'Trial belongs to another account' USING ERRCODE='42501';
 END IF;
 IF EXISTS(SELECT 1 FROM public.guest_import_claims WHERE user_id=p_user_id AND trial_id<>p_trial_id) THEN
  RETURN jsonb_build_object('success',true,'imported',0,'skipped_invalid',0,'skipped_duplicate',0,'skipped_allowance',0,'backfilled',0);
 END IF;
 -- Lock the authoritative plan through commit; a concurrent downgrade cannot race the quota decision.
 SELECT * INTO v_profile FROM public.profiles WHERE id=p_user_id FOR SHARE;
 v_free := NOT coalesce(v_profile.plan='admin' OR (v_profile.plan IN ('starter','starter_100','prospector','pro') AND (
   coalesce(v_profile.plan_status,v_profile.subscription_status) IN ('active','trialing') OR
   (coalesce(v_profile.plan_status,v_profile.subscription_status) IN ('canceling','past_due','paused','unpaid','canceled') AND v_profile.current_period_end>clock_timestamp()) OR
   (v_profile.plan_status IS NULL AND v_profile.subscription_status IS NULL))),false);
 SELECT count(*) INTO v_used FROM public.business_allowance_ledger WHERE user_id=p_user_id;
 INSERT INTO public.guest_import_claims VALUES(p_trial_id,p_user_id) ON CONFLICT DO NOTHING;
 UPDATE public.guest_trials SET owner_user_id=p_user_id WHERE id=p_trial_id;
 SELECT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.leads'::regclass AND attname='website_facts' AND NOT attisdropped),
        EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.leads'::regclass AND attname='light_profile' AND NOT attisdropped) INTO v_facts,v_light;
 FOR v_item IN SELECT value FROM jsonb_array_elements(p_leads) LOOP
  IF jsonb_typeof(v_item)<>'object' OR nullif(btrim(v_item->>'company_name'),'') IS NULL OR
    (nullif(btrim(v_item->>'email'),'') IS NULL AND nullif(btrim(v_item->>'phone'),'') IS NULL) THEN
   v_invalid:=v_invalid+1; CONTINUE;
  END IF;
  v_key:=public.guest_import_key(v_item); v_id:=NULL;
  SELECT lead_id INTO v_id FROM public.guest_import_items WHERE trial_id=p_trial_id AND item_key=v_key;
  IF v_id IS NULL THEN
   SELECT id INTO v_id FROM public.leads WHERE user_id=p_user_id AND public.guest_import_key(to_jsonb(leads))=v_key ORDER BY id LIMIT 1;
  END IF;
  v_was_duplicate:=v_id IS NOT NULL;
  IF v_was_duplicate THEN
   v_duplicate:=v_duplicate+1;
   INSERT INTO public.guest_import_items VALUES(p_trial_id,v_key,v_id) ON CONFLICT DO NOTHING;
  ELSE
   IF v_free AND v_used>=25 THEN v_allowance:=v_allowance+1; CONTINUE; END IF;
   v_lead:=jsonb_populate_record(NULL::public.leads,v_item); v_id:=gen_random_uuid();
   INSERT INTO public.leads(id,user_id,company_name,email,phone,website,city,industry,status,source,email_confidence,email_source,is_generic_email,cost_estimate)
   VALUES(v_id,p_user_id,v_lead.company_name,nullif(btrim(v_lead.email),''),nullif(btrim(v_lead.phone),''),v_lead.website,v_lead.city,v_lead.industry,
    'inbox',v_lead.source,v_lead.email_confidence,v_lead.email_source,coalesce(v_lead.is_generic_email,false),coalesce(v_lead.cost_estimate,0));
   INSERT INTO public.guest_import_items VALUES(p_trial_id,v_key,v_id);
   v_used:=v_used+1; v_imported:=v_imported+1;
  END IF;
  -- Preserve original saved facts/profiles. Missing optional columns never discard the guest's copy.
  IF v_facts AND jsonb_typeof(v_item->'website_facts')='object' THEN
   EXECUTE 'UPDATE public.leads SET website_facts=$1 WHERE id=$2 AND user_id=$3 AND website_facts IS NULL'
    USING v_item->'website_facts',v_id,p_user_id;
   GET DIAGNOSTICS v_rows=ROW_COUNT;
   IF v_was_duplicate AND v_rows>0 THEN v_backfilled:=v_backfilled+v_rows; END IF;
  END IF;
  IF v_light AND jsonb_typeof(v_item->'light_profile')='object' THEN
   EXECUTE 'UPDATE public.leads SET light_profile=$1 WHERE id=$2 AND user_id=$3 AND light_profile IS NULL'
    USING v_item->'light_profile',v_id,p_user_id;
  END IF;
 END LOOP;
 RETURN jsonb_build_object('success',true,'imported',v_imported,'skipped_invalid',v_invalid,'skipped_duplicate',v_duplicate,'skipped_allowance',v_allowance,'backfilled',v_backfilled);
END $$;
REVOKE ALL ON FUNCTION public.claim_guest_businesses(uuid,uuid,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_guest_businesses(uuid,uuid,jsonb) TO service_role;
COMMIT;
