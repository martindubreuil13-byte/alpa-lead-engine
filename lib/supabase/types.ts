export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export interface Database {
  public: {
    Tables: {
      leads: {
        Row: {
          id: string;
          user_id: string;
          company_name: string;
          contact_name: string | null;
          email: string | null;
          phone: string | null;
          website: string | null;
          industry: string | null;
          city: string | null;
          source_type: string | null;
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
          phone?: string | null;
          website?: string | null;
          industry?: string | null;
          city?: string | null;
          source_type?: string | null;
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
  };
}
