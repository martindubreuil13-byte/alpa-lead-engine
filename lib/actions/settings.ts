"use server";

import { createServerSupabaseClient } from "@/lib/supabase/server";

export async function getSettings() {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase.from("app_settings").select("*").single();
  if (error && error.code !== "PGRST116") {
    throw new Error(error.message);
  }
  return data ?? null;
}

export async function upsertSettings(input: {
  smtp_host: string | null;
  smtp_port: number | null;
  smtp_user: string | null;
  smtp_pass: string | null;
  smtp_secure: boolean | null;
  from_name: string | null;
  from_email: string | null;
  signature: string | null;
}) {
  const supabase = createServerSupabaseClient();
  const { error } = await supabase.from("app_settings").upsert({
    ...input,
    updated_at: new Date().toISOString()
  });
  if (error) throw new Error(error.message);
}
