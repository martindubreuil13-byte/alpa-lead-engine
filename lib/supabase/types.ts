export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type UserRole = 'admin' | 'user';
export type UserPlan = 'free' | 'starter' | 'pro' | 'admin';

export type UserProfile = {
  id: string;
  email: string;
  role: UserRole;
  plan: UserPlan;
  stripe_customer_id?: string | null;
  subscription_status?: string | null;
  current_period_end?: string | null;
  created_at: string;
};

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          plan: UserPlan;
          stripe_customer_id: string | null;
          subscription_status: string | null;
          current_period_end: string | null;
          created_at: string;
        };
        Insert: {
          id: string;
          plan?: UserPlan;
          stripe_customer_id?: string | null;
          subscription_status?: string | null;
          current_period_end?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["profiles"]["Insert"]>;
      };
      usage: {
        Row: {
          user_id: string;
          leads_used: number;
          leads_limit: number;
          period_start: string;
          period_end: string;
        };
        Insert: {
          user_id: string;
          leads_used?: number;
          leads_limit?: number;
          period_start?: string;
          period_end?: string;
        };
        Update: Partial<Database["public"]["Tables"]["usage"]["Insert"]>;
      };
      email_usage: {
        Row: {
          user_id: string;
          usage_date: string;
          emails_sent: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          usage_date: string;
          emails_sent?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["email_usage"]["Insert"]>;
      };
      activity_logs: {
        Row: {
          id: string;
          session_id: string;
          user_id: string | null;
          email: string | null;
          event: string;
          query: string | null;
          location: string | null;
          leads_count: number | null;
          metadata: Json | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          session_id: string;
          user_id?: string | null;
          email?: string | null;
          event: string;
          query?: string | null;
          location?: string | null;
          leads_count?: number | null;
          metadata?: Json | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["activity_logs"]["Insert"]>;
      };
      users: {
        Row: UserProfile;
        Insert: {
          id: string;
          email: string;
          role?: UserRole;
          plan?: UserPlan;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["users"]["Insert"]>;
      };
      leads: {
        Row: {
          id: string;
          user_id: string;
          company_name: string;
          contact_name: string | null;
          email: string | null;
          email_source: string | null;
          email_confidence: Database["public"]["Enums"]["email_confidence"] | null;
          is_generic_email: boolean;
          source: string | null;
          cost_estimate: number | null;
          phone: string | null;
          website: string | null;
          industry: string | null;
          city: string | null;
          source_url: string | null;
          notes: string | null;
          status: string;
          pipeline_stage: string | null;
          close_reason: string | null;
          date_added: string;
          first_contact_at: string | null;
          followup_due_at: string | null;
          last_contact_at: string | null;
          archived_reason: string | null;
        };
        Insert: {
          id?: string;
          user_id?: string;
          company_name: string;
          contact_name?: string | null;
          email?: string | null;
          email_source?: string | null;
          email_confidence?: Database["public"]["Enums"]["email_confidence"] | null;
          is_generic_email?: boolean;
          source?: string | null;
          cost_estimate?: number | null;
          phone?: string | null;
          website?: string | null;
          industry?: string | null;
          city?: string | null;
          source_url?: string | null;
          notes?: string | null;
          status?: string;
          pipeline_stage?: string | null;
          close_reason?: string | null;
          date_added?: string;
          first_contact_at?: string | null;
          followup_due_at?: string | null;
          last_contact_at?: string | null;
          archived_reason?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["leads"]["Insert"]>;
      };
      agent_icp: {
        Row: {
          id: string;
          user_id: string;
          raw_input: string;
          structured_output: Json;
          status: string;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id?: string;
          raw_input: string;
          structured_output: Json;
          status?: string;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["agent_icp"]["Insert"]>;
      };
      agent_missions: {
        Row: {
          id: string;
          user_id: string;
          icp_id: string | null;
          name: string | null;
          status: string;
          leads_per_day: number;
          contact_mode: string;
          require_email: boolean;
          require_phone: boolean;
          require_website: boolean;
          location: string;
          outreach_mode: string;
          offer_input: string | null;
          audience_input: string | null;
          location_input: string | null;
          offer_context: Json | null;
          icp_expanded: Json | null;
          search_patterns: Json | null;
          daily_target: number;
          cta: string | null;
          send_window: string | null;
          sender_signature: string | null;
          completed_at: string | null;
          next_run_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id?: string;
          icp_id?: string | null;
          name?: string | null;
          status?: string;
          leads_per_day?: number;
          contact_mode?: string;
          require_email?: boolean;
          require_phone?: boolean;
          require_website?: boolean;
          location?: string;
          outreach_mode?: string;
          offer_input?: string | null;
          audience_input?: string | null;
          location_input?: string | null;
          offer_context?: Json | null;
          icp_expanded?: Json | null;
          search_patterns?: Json | null;
          daily_target?: number;
          cta?: string | null;
          send_window?: string | null;
          sender_signature?: string | null;
          completed_at?: string | null;
          next_run_at?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["agent_missions"]["Insert"]>;
      };
      agent_lead_queue: {
        Row: {
          id: string;
          user_id: string;
          mission_id: string;
          icp_id: string;
          business_name: string | null;
          website: string | null;
          email: string | null;
          phone: string | null;
          location: string | null;
          qualification_status: string;
          context_status: string;
          draft_status: string;
          draft_email: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id?: string;
          mission_id: string;
          icp_id: string;
          business_name?: string | null;
          website?: string | null;
          email?: string | null;
          phone?: string | null;
          location?: string | null;
          qualification_status?: string;
          context_status?: string;
          draft_status?: string;
          draft_email?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["agent_lead_queue"]["Insert"]>;
      };
      guest_lead_captures: {
        Row: {
          id: string;
          guest_session_id: string;
          email: string;
          lead_count: number;
          preview_count: number;
          last_trigger: string;
          last_preview_sent_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          guest_session_id: string;
          email: string;
          lead_count?: number;
          preview_count?: number;
          last_trigger?: string;
          last_preview_sent_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["guest_lead_captures"]["Insert"]>;
      };
      templates: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          tag: string | null;
          subject: string;
          body: string;
          signature: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id?: string;
          name: string;
          tag?: string | null;
          subject: string;
          body: string;
          signature?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["templates"]["Insert"]>;
      };
      scrape_jobs: {
        Row: {
          id: string;
          user_id: string;
          mode: string;
          query: string | null;
          directory_url: string | null;
          status: string;
          total_found: number;
          created_at: string;
          completed_at: string | null;
          notes: string | null;
        };
        Insert: {
          id?: string;
          user_id?: string;
          mode: string;
          query?: string | null;
          directory_url?: string | null;
          status?: string;
          total_found?: number;
          created_at?: string;
          completed_at?: string | null;
          notes?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["scrape_jobs"]["Insert"]>;
      };
      outreach_queue: {
        Row: {
          id: string;
          user_id: string;
          lead_id: string | null;
          source: string;
          mission_id: string | null;
          company_name: string | null;
          contact_email: string | null;
          location: string | null;
          website: string | null;
          subject: string | null;
          hook: string | null;
          body: string | null;
          cta: string | null;
          full_email: string | null;
          personalization_score: number | null;
          quality_score: number | null;
          context_status: string;
          context_title: string | null;
          context_description: string | null;
          context_h1: string | null;
          status: string;
          review_status: 'draft' | 'approved' | 'sent' | 'rejected';
          approved_at: string | null;
          rejected_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id?: string;
          lead_id?: string | null;
          source?: string;
          mission_id?: string | null;
          company_name?: string | null;
          contact_email?: string | null;
          location?: string | null;
          website?: string | null;
          subject?: string | null;
          hook?: string | null;
          body?: string | null;
          cta?: string | null;
          full_email?: string | null;
          personalization_score?: number | null;
          quality_score?: number | null;
          context_status?: string;
          context_title?: string | null;
          context_description?: string | null;
          context_h1?: string | null;
          status?: string;
          review_status?: 'draft' | 'approved' | 'rejected';
          approved_at?: string | null;
          rejected_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["outreach_queue"]["Insert"]>;
      };
      app_settings: {
        Row: {
          id: string;
          user_id: string;
          smtp_host: string | null;
          smtp_port: number | null;
          smtp_user: string | null;
          smtp_pass: string | null;
          smtp_secure: boolean | null;
          from_name: string | null;
          from_email: string | null;
          signature: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id?: string;
          smtp_host?: string | null;
          smtp_port?: number | null;
          smtp_user?: string | null;
          smtp_pass?: string | null;
          smtp_secure?: boolean | null;
          from_name?: string | null;
          from_email?: string | null;
          signature?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["app_settings"]["Insert"]>;
      };
    };
    Functions: {
      increment_email_usage: {
        Args: {
          target_user_id: string;
          target_date: string;
          increment_by?: number;
        };
        Returns: {
          user_id: string;
          usage_date: string;
          emails_sent: number;
          created_at: string;
          updated_at: string;
        }[];
      };
      mark_followup_due: {
        Args: {
          user_id_input: string;
        };
        Returns: number;
      };
    };
    Enums: {
      email_confidence: "high" | "medium" | "low";
    };
  };
}
