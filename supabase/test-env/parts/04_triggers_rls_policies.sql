CREATE TRIGGER set_agent_missions_updated_at BEFORE UPDATE ON public.agent_missions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.agent_missions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_guard_ci_queue_user_write BEFORE INSERT OR UPDATE ON public.commercial_intelligence_queue FOR EACH ROW EXECUTE FUNCTION guard_ci_queue_user_write();
CREATE TRIGGER trg_guard_ci_queue_worker_eligible BEFORE INSERT OR UPDATE ON public.commercial_intelligence_queue FOR EACH ROW EXECUTE FUNCTION guard_ci_queue_worker_eligible();
CREATE TRIGGER trg_email_templates_updated_at BEFORE UPDATE ON public.email_templates FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_email_usage_updated_at BEFORE UPDATE ON public.email_usage FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_guard_leads_research_columns BEFORE INSERT OR UPDATE ON public.leads FOR EACH ROW EXECUTE FUNCTION guard_leads_research_columns();
CREATE TRIGGER outreach_queue_set_updated_at BEFORE UPDATE ON public.outreach_queue FOR EACH ROW EXECUTE FUNCTION set_outreach_queue_updated_at();
-- The sign-up trigger: every new auth user gets a profile row (plan 'free').
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION handle_new_user();

ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_emails ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_icp ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_lead_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_mission_icps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_mission_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_missions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ci_research_charges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ci_research_control_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ci_research_controls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ci_research_run_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ci_research_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commercial_intelligence_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.discover_save_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.follow_up_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guest_trial_rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guest_trials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_activity_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_follow_ups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outreach_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pipeline_automation_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sender_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_ctas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

CREATE POLICY activity_logs_select_own ON public.activity_logs AS PERMISSIVE FOR SELECT TO authenticated USING ((user_id = auth.uid()));
CREATE POLICY admin_only_access ON public.agent_icp AS PERMISSIVE FOR ALL TO public USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))));
CREATE POLICY agent_queue_owner_access ON public.agent_lead_queue AS PERMISSIVE FOR ALL TO public USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));
CREATE POLICY agent_mission_icps_delete_own ON public.agent_mission_icps AS PERMISSIVE FOR DELETE TO authenticated USING (((user_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM agent_missions m
  WHERE ((m.id = agent_mission_icps.mission_id) AND (m.user_id = auth.uid()))))));
CREATE POLICY agent_mission_icps_insert_own ON public.agent_mission_icps AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((user_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM agent_missions m
  WHERE ((m.id = agent_mission_icps.mission_id) AND (m.user_id = auth.uid()))))));
CREATE POLICY agent_mission_icps_select_own ON public.agent_mission_icps AS PERMISSIVE FOR SELECT TO authenticated USING (((user_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM agent_missions m
  WHERE ((m.id = agent_mission_icps.mission_id) AND (m.user_id = auth.uid()))))));
CREATE POLICY agent_mission_icps_update_own ON public.agent_mission_icps AS PERMISSIVE FOR UPDATE TO authenticated USING (((user_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM agent_missions m
  WHERE ((m.id = agent_mission_icps.mission_id) AND (m.user_id = auth.uid())))))) WITH CHECK (((user_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM agent_missions m
  WHERE ((m.id = agent_mission_icps.mission_id) AND (m.user_id = auth.uid()))))));
CREATE POLICY agent_mission_runs_insert_own ON public.agent_mission_runs AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((user_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM agent_missions m
  WHERE ((m.id = agent_mission_runs.mission_id) AND (m.user_id = auth.uid()))))));
CREATE POLICY agent_mission_runs_select_own ON public.agent_mission_runs AS PERMISSIVE FOR SELECT TO authenticated USING (((user_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM agent_missions m
  WHERE ((m.id = agent_mission_runs.mission_id) AND (m.user_id = auth.uid()))))));
CREATE POLICY agent_mission_runs_update_own ON public.agent_mission_runs AS PERMISSIVE FOR UPDATE TO authenticated USING (((user_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM agent_missions m
  WHERE ((m.id = agent_mission_runs.mission_id) AND (m.user_id = auth.uid())))))) WITH CHECK (((user_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM agent_missions m
  WHERE ((m.id = agent_mission_runs.mission_id) AND (m.user_id = auth.uid()))))));
CREATE POLICY "Users can delete their missions" ON public.agent_missions AS PERMISSIVE FOR DELETE TO public USING ((auth.uid() = user_id));
CREATE POLICY "Users can read their missions" ON public.agent_missions AS PERMISSIVE FOR SELECT TO public USING ((auth.uid() = user_id));
CREATE POLICY mission_insert ON public.agent_missions AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth.uid() = user_id));
CREATE POLICY mission_select ON public.agent_missions AS PERMISSIVE FOR SELECT TO public USING ((auth.uid() = user_id));
CREATE POLICY mission_update ON public.agent_missions AS PERMISSIVE FOR UPDATE TO public USING ((auth.uid() = user_id));
CREATE POLICY "Customers read their own research run leads" ON public.ci_research_run_leads AS PERMISSIVE FOR SELECT TO authenticated USING ((auth.uid() = user_id));
CREATE POLICY "Customers read their own research runs" ON public.ci_research_runs AS PERMISSIVE FOR SELECT TO authenticated USING ((auth.uid() = user_id));
CREATE POLICY "Users can insert their own ci queue" ON public.commercial_intelligence_queue AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth.uid() = user_id));
CREATE POLICY "Users can view their own ci queue" ON public.commercial_intelligence_queue AS PERMISSIVE FOR SELECT TO public USING ((auth.uid() = user_id));
CREATE POLICY "Users can insert/update their own usage" ON public.email_usage AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth.uid() = user_id));
CREATE POLICY "Users can view their own usage" ON public.email_usage AS PERMISSIVE FOR SELECT TO public USING ((auth.uid() = user_id));
CREATE POLICY "Users can delete their leads" ON public.leads AS PERMISSIVE FOR DELETE TO public USING ((auth.uid() = user_id));
CREATE POLICY "Users can insert their own leads" ON public.leads AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth.uid() = user_id));
CREATE POLICY "Users can only see their leads" ON public.leads AS PERMISSIVE FOR SELECT TO public USING ((auth.uid() = user_id));
CREATE POLICY "Users can see their own leads" ON public.leads AS PERMISSIVE FOR SELECT TO public USING ((auth.uid() = user_id));
CREATE POLICY "Users can update their leads" ON public.leads AS PERMISSIVE FOR UPDATE TO public USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));
CREATE POLICY "Users can view their leads" ON public.leads AS PERMISSIVE FOR SELECT TO public USING ((auth.uid() = user_id));
CREATE POLICY outreach_queue_owner_delete ON public.outreach_queue AS PERMISSIVE FOR DELETE TO authenticated USING ((auth.uid() = user_id));
CREATE POLICY outreach_queue_owner_insert ON public.outreach_queue AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((auth.uid() = user_id));
CREATE POLICY outreach_queue_owner_select ON public.outreach_queue AS PERMISSIVE FOR SELECT TO authenticated USING ((auth.uid() = user_id));
CREATE POLICY outreach_queue_owner_update ON public.outreach_queue AS PERMISSIVE FOR UPDATE TO authenticated USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));
CREATE POLICY profiles_select_own ON public.profiles AS PERMISSIVE FOR SELECT TO authenticated USING ((id = auth.uid()));
CREATE POLICY sender_settings_delete_own ON public.sender_settings AS PERMISSIVE FOR DELETE TO authenticated USING ((user_id = auth.uid()));
CREATE POLICY sender_settings_insert_own ON public.sender_settings AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((user_id = auth.uid()));
CREATE POLICY sender_settings_select_own ON public.sender_settings AS PERMISSIVE FOR SELECT TO authenticated USING ((user_id = auth.uid()));
CREATE POLICY sender_settings_update_own ON public.sender_settings AS PERMISSIVE FOR UPDATE TO authenticated USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));
CREATE POLICY "Users can delete their templates" ON public.templates AS PERMISSIVE FOR DELETE TO public USING ((auth.uid() = user_id));
CREATE POLICY "Users can insert their templates" ON public.templates AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth.uid() = user_id));
CREATE POLICY "Users can update their templates" ON public.templates AS PERMISSIVE FOR UPDATE TO public USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));
CREATE POLICY "Users can view their templates" ON public.templates AS PERMISSIVE FOR SELECT TO public USING ((auth.uid() = user_id));
CREATE POLICY usage_select_own ON public.usage AS PERMISSIVE FOR SELECT TO authenticated USING ((user_id = auth.uid()));
CREATE POLICY "Users can manage their own CTAs" ON public.user_ctas AS PERMISSIVE FOR ALL TO public USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));
