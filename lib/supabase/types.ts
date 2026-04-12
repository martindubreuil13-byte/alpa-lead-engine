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
