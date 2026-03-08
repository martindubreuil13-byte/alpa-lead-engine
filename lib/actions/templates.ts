"use server";

import { createServerSupabaseClient } from "@/lib/supabase/server";

export async function listTemplates() {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase.from("templates").select("*").order("created_at", {
    ascending: false
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function createTemplate({
  name,
  subject,
  body
}: {
  name: string;
  subject: string;
  body: string;
}) {
  const supabase = createServerSupabaseClient();
  const { error } = await supabase.from("templates").insert({ name, subject, body });
  if (error) throw new Error(error.message);
}

export async function updateTemplate({
  id,
  name,
  subject,
  body
}: {
  id: string;
  name: string;
  subject: string;
  body: string;
}) {
  const supabase = createServerSupabaseClient();
  const { error } = await supabase
    .from("templates")
    .update({ name, subject, body })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteTemplate(id: string) {
  const supabase = createServerSupabaseClient();
  const { error } = await supabase.from("templates").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
