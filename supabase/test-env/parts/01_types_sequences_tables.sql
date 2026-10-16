CREATE TYPE public.cta_type AS ENUM ('link', 'email', 'calendly', 'none');

CREATE SEQUENCE IF NOT EXISTS public.ci_research_control_log_id_seq AS bigint START 1 INCREMENT 1;

CREATE TABLE public.activity_logs (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  session_id text NOT NULL,
  user_id uuid,
  email text,
  event text NOT NULL,
  query text,
  location text,
  leads_count integer,
  metadata jsonb,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.agent_emails (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid,
  mission_id uuid,
  lead_id uuid,
  company_name text,
  contact_email text,
  website text,
  location text,
  icp_summary text,
  outreach_angle text,
  subject text,
  hook text,
  body text,
  cta text,
  full_email text,
  tone text DEFAULT 'professional'::text,
  personalization_score integer DEFAULT 0,
  quality_score integer DEFAULT 0,
  status text DEFAULT 'draft'::text,
  created_at timestamp with time zone DEFAULT now(),
  approved_at timestamp with time zone,
  sent_at timestamp with time zone
);

CREATE TABLE public.agent_icp (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid,
  raw_input text,
  structured_output jsonb,
  status text DEFAULT 'pending'::text,
  created_at timestamp without time zone DEFAULT now(),
  is_active boolean DEFAULT false,
  name text
);

CREATE TABLE public.agent_lead_queue (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  mission_id uuid NOT NULL,
  icp_id uuid,
  business_name text,
  website text,
  email text,
  phone text,
  qualification_status text DEFAULT 'pending'::text,
  context_status text DEFAULT 'pending'::text,
  draft_status text DEFAULT 'pending'::text,
  draft_email text,
  created_at timestamp without time zone DEFAULT now(),
  location text,
  dedup_key text,
  normalized_business_name text,
  normalized_domain text,
  domain text,
  source text,
  metadata jsonb,
  run_id uuid
);

CREATE TABLE public.agent_mission_icps (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  mission_id uuid,
  label text NOT NULL,
  value text NOT NULL,
  is_active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  "position" integer,
  query text,
  user_id uuid
);

CREATE TABLE public.agent_mission_runs (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  mission_id uuid,
  status text DEFAULT 'queued'::text,
  started_at timestamp with time zone,
  completed_at timestamp with time zone,
  leads_requested integer,
  leads_found integer,
  leads_accepted integer,
  leads_deduped integer,
  drafts_generated integer,
  error text,
  created_at timestamp with time zone DEFAULT now(),
  requested_leads integer,
  scheduled_for timestamp with time zone,
  trigger_type text,
  user_id uuid,
  updated_at timestamp with time zone DEFAULT now(),
  accepted_count integer DEFAULT 0,
  drafts_generated_count integer DEFAULT 0,
  finished_at timestamp with time zone,
  stop_reason text
);

CREATE TABLE public.agent_missions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  icp_id uuid NOT NULL,
  name text,
  status text DEFAULT 'draft'::text,
  leads_per_day integer DEFAULT 10,
  contact_mode text DEFAULT 'email'::text,
  require_email boolean DEFAULT true,
  require_phone boolean DEFAULT false,
  require_website boolean DEFAULT true,
  location text DEFAULT 'Global'::text,
  outreach_mode text DEFAULT 'draft_only'::text,
  created_at timestamp without time zone DEFAULT now(),
  offer_input text,
  audience_input text,
  location_input text,
  offer_context jsonb,
  icp_expanded jsonb,
  search_patterns jsonb,
  daily_target integer DEFAULT 10,
  cta text,
  send_window text,
  sender_signature text,
  last_run_at timestamp with time zone,
  next_run_at timestamp with time zone,
  schedule_local_time time without time zone,
  schedule_timezone text DEFAULT 'UTC'::text,
  schedule_start_date date,
  daily_lead_target integer DEFAULT 10,
  updated_at timestamp with time zone DEFAULT now(),
  starts_at timestamp with time zone,
  is_paused boolean DEFAULT false,
  last_stop_reason text,
  ctas jsonb DEFAULT '[]'::jsonb
);

CREATE TABLE public.app_settings (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid,
  smtp_host text,
  smtp_port integer,
  smtp_user text,
  smtp_pass text,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.ci_research_charges (
  queue_id uuid NOT NULL,
  attempt integer NOT NULL,
  run_id uuid NOT NULL,
  user_id uuid NOT NULL,
  reserved_usd numeric(10,6) NOT NULL,
  actual_usd numeric(10,6),
  state text DEFAULT 'reserved'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  settled_at timestamp with time zone
);

CREATE TABLE public.ci_research_control_log (
  id bigint DEFAULT nextval('public.ci_research_control_log_id_seq'::regclass) NOT NULL,
  at timestamp with time zone DEFAULT now() NOT NULL,
  operator text NOT NULL,
  action text NOT NULL,
  detail jsonb
);

CREATE TABLE public.ci_research_controls (
  id boolean DEFAULT true NOT NULL,
  enabled boolean DEFAULT false NOT NULL,
  per_job_reserve_usd numeric(10,6),
  per_profile_ceiling_usd numeric(10,6),
  per_run_cap_usd numeric(10,6),
  per_lead_monthly_usd numeric(10,6),
  global_monthly_limit_usd numeric(12,6),
  max_leads_per_run integer,
  allow_all_customers boolean DEFAULT false NOT NULL,
  allowed_user_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
  per_user_concurrency integer DEFAULT 4 NOT NULL,
  max_attempts integer DEFAULT 2 NOT NULL,
  run_ttl_hours integer DEFAULT 24 NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_by text
);

CREATE TABLE public.ci_research_run_leads (
  run_id uuid NOT NULL,
  lead_id uuid NOT NULL,
  user_id uuid NOT NULL,
  initial_state text NOT NULL
);

CREATE TABLE public.ci_research_runs (
  run_id uuid NOT NULL,
  user_id uuid NOT NULL,
  status text DEFAULT 'active'::text NOT NULL,
  saved_count integer NOT NULL,
  queued_count integer DEFAULT 0 NOT NULL,
  budget_limit_usd numeric(10,6) NOT NULL,
  customer_month_limit_usd numeric(10,6) NOT NULL,
  max_attempts integer NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  cancelled_at timestamp with time zone
);

CREATE TABLE public.commercial_intelligence_queue (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  lead_id uuid NOT NULL,
  user_id uuid NOT NULL,
  status character varying(50) DEFAULT 'pending'::character varying NOT NULL,
  retry_count integer DEFAULT 0 NOT NULL,
  max_retries integer DEFAULT 3 NOT NULL,
  last_retry_at timestamp with time zone,
  last_error text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  started_at timestamp with time zone,
  completed_at timestamp with time zone,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  processing_duration_ms integer,
  total_cost numeric(10,2) DEFAULT 0,
  worker_eligible boolean DEFAULT false NOT NULL,
  claim_token uuid,
  run_id uuid
);

CREATE TABLE public.discover_save_receipts (
  run_id uuid NOT NULL,
  user_id uuid NOT NULL,
  request_hash text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.email_events (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  recipient text NOT NULL,
  subject text,
  status text DEFAULT 'sent'::text,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.email_templates (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  name text NOT NULL,
  slug text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  description text,
  is_active boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  category text DEFAULT 'general'::text
);

CREATE TABLE public.email_usage (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  date date NOT NULL,
  emails_sent integer DEFAULT 0,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.follow_up_settings (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  follow_up_delay_days integer DEFAULT 3 NOT NULL,
  coupon_code text,
  discount_label text,
  email_subject text DEFAULT 'Still need fresh leads? Use {{coupon_code}}'::text NOT NULL,
  email_body_template text DEFAULT 'Hi,\n\nYou generated {{lead_count}} lead{{lead_count_plural}} for "{{search_query}}" in "{{location}}".\n\nIf you want to keep prospecting with ALPA, use coupon code {{coupon_code}} for {{discount_label}}.\n\nBest,\nMartin'::text NOT NULL,
  send_copy_to_admin boolean DEFAULT true NOT NULL,
  admin_notification_email text,
  exclusion_patterns text[] DEFAULT ARRAY['martin@'::text, 'test@'::text, 'admin@'::text, '@mindrasolutions.com'::text] NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.guest_trial_rate_limits (
  bucket text NOT NULL,
  attempts integer DEFAULT 0 NOT NULL
);

CREATE TABLE public.guest_trials (
  id uuid NOT NULL,
  leads jsonb DEFAULT '[]'::jsonb NOT NULL,
  used integer DEFAULT 0 NOT NULL,
  attempts integer DEFAULT 0 NOT NULL,
  active_run uuid,
  active_until timestamp with time zone,
  email text,
  marketing_opt_in boolean DEFAULT false NOT NULL,
  consent_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  owner_user_id uuid,
  profile_attempts integer DEFAULT 0 NOT NULL
);

CREATE TABLE public.lead_activity_events (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  lead_id uuid NOT NULL,
  event_type text NOT NULL,
  outreach_queue_id uuid,
  metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.lead_follow_ups (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  source_activity_id uuid,
  session_id text,
  user_id uuid,
  email text NOT NULL,
  search_query text,
  location text,
  lead_count integer DEFAULT 0 NOT NULL,
  followup_sent boolean DEFAULT false NOT NULL,
  status text DEFAULT 'pending'::text NOT NULL,
  converted boolean DEFAULT false NOT NULL,
  converted_at timestamp with time zone,
  email_subject text,
  email_body text,
  email_html text,
  provider_message_id text,
  last_error text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  follow_up_sent_at timestamp with time zone,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.leads (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  company_name text,
  industry text,
  email text,
  phone text,
  website text,
  status text DEFAULT 'new'::text,
  city text,
  source text,
  scraped_at timestamp with time zone DEFAULT now(),
  notes text,
  source_url text,
  contacted_at timestamp without time zone,
  followup_sent_at timestamp without time zone,
  status_updated_at timestamp without time zone DEFAULT now(),
  reject_reason text,
  filter jsonb,
  "emailData" jsonb,
  user_id uuid,
  pipeline_stage text,
  close_reason text,
  next_action_at timestamp without time zone,
  last_contacted_at timestamp without time zone,
  email_source text,
  email_confidence text,
  is_generic_email boolean DEFAULT false,
  cost_estimate numeric,
  contact_name text,
  date_added timestamp without time zone DEFAULT now(),
  mission_id uuid,
  run_id uuid,
  first_contact_at timestamp with time zone,
  last_contact_at timestamp with time zone,
  followup_due_at timestamp with time zone,
  final_attempt_sent_at timestamp with time zone,
  outreach_attempts integer DEFAULT 0,
  next_action_status text DEFAULT 'needs_initial_outreach'::text,
  closed_at timestamp with time zone,
  last_activity_at timestamp with time zone,
  automation_enabled boolean DEFAULT false NOT NULL,
  sequence_paused boolean DEFAULT false NOT NULL,
  website_snapshot jsonb,
  business_signals jsonb,
  commercial_profile jsonb,
  ci_enrichment_status character varying(50) DEFAULT 'pending'::character varying,
  ci_started_at timestamp with time zone,
  ci_completed_at timestamp with time zone,
  ci_last_error text,
  ci_retry_count integer DEFAULT 0,
  ci_processing_duration_ms integer,
  ci_cost_estimate numeric(10,6) DEFAULT 0,
  ci_model_versions jsonb DEFAULT '{"profile": "v1", "signals": "v1", "snapshot": "v1"}'::jsonb,
  website_facts jsonb,
  light_profile jsonb
);

CREATE TABLE public.outreach_queue (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  lead_id uuid,
  mission_id uuid,
  source text DEFAULT 'manual'::text NOT NULL,
  company_name text NOT NULL,
  contact_email text,
  website text,
  location text,
  phone text,
  icp_summary text,
  outreach_angle text,
  subject text,
  hook text,
  body text,
  cta text,
  full_email text,
  context_title text,
  context_description text,
  context_h1 text,
  context_status text DEFAULT 'basic'::text,
  personalization_score integer DEFAULT 0,
  quality_score integer DEFAULT 0,
  status text DEFAULT 'draft'::text NOT NULL,
  review_status text DEFAULT 'pending'::text NOT NULL,
  generated_at timestamp with time zone DEFAULT now(),
  approved_at timestamp with time zone,
  rejected_at timestamp with time zone,
  sent_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  draft_status text DEFAULT 'draft'::text,
  draft_email text,
  dedup_key text,
  run_id uuid,
  style text,
  cta_label text,
  cta_type text,
  cta_value text,
  template_id uuid,
  automation_step text
);

CREATE TABLE public.pipeline_automation_settings (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  enabled boolean DEFAULT false NOT NULL,
  step1_template_id uuid,
  step2_template_id uuid,
  step3_template_id uuid,
  step2_delay_days integer DEFAULT 3 NOT NULL,
  step3_delay_days integer DEFAULT 5 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.profiles (
  id uuid NOT NULL,
  email text,
  plan text DEFAULT 'free'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  stripe_customer_id text,
  subscription_status text DEFAULT 'free'::text,
  current_period_end timestamp without time zone,
  current_period_start timestamp without time zone,
  role text DEFAULT 'user'::text,
  stripe_subscription_id text,
  plan_status text,
  cancel_at_period_end boolean DEFAULT false NOT NULL,
  canceled_at timestamp with time zone,
  subscription_tier text
);

CREATE TABLE public.sender_settings (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  sender_name text,
  sender_email text,
  company_name text,
  signature_html text,
  created_at timestamp without time zone DEFAULT now(),
  logo_url text,
  job_title text,
  phone text,
  website text,
  test_email text
);

CREATE TABLE public.subscriptions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid,
  stripe_subscription_id text,
  stripe_customer_id text,
  status text,
  price_id text,
  current_period_start timestamp without time zone,
  current_period_end timestamp without time zone,
  created_at timestamp without time zone DEFAULT now()
);

CREATE TABLE public.templates (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid,
  name text,
  subject text,
  body text,
  signature text,
  created_at timestamp without time zone DEFAULT now(),
  type text,
  tag text
);

CREATE TABLE public.usage (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid,
  period_start timestamp without time zone,
  period_end timestamp without time zone,
  leads_used integer DEFAULT 0,
  leads_limit integer DEFAULT 300,
  created_at timestamp without time zone DEFAULT now()
);

CREATE TABLE public.user_ctas (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  label text NOT NULL,
  type public.cta_type DEFAULT 'link'::public.cta_type NOT NULL,
  value text,
  is_active boolean DEFAULT true,
  usage_count integer DEFAULT 0,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.user_usage (
  user_id uuid NOT NULL,
  leads_used integer DEFAULT 0,
  leads_limit integer DEFAULT 100,
  updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.users (
  id uuid NOT NULL,
  email text,
  role text DEFAULT 'user'::text,
  plan text DEFAULT 'free'::text,
  created_at timestamp with time zone DEFAULT now()
);
