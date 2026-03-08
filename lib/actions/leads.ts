"use server";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { LEAD_STATUSES } from "@/lib/constants";

export type LeadStatus = (typeof LEAD_STATUSES)[number];

export async function listLeads({
  search,
  status
}: {
  search?: string;
  status?: LeadStatus | "all";
}) {
  const supabase = createServerSupabaseClient();
  let query = supabase.from("leads").select("*").order("date_added", {
    ascending: false
  });

  if (status && status !== "all") {
    query = query.eq("status", status);
  }

  if (search) {
    query = query.or(
      `company_name.ilike.%${search}%,email.ilike.%${search}%,contact_name.ilike.%${search}%,city.ilike.%${search}%`
    );
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data;
}

export async function getLeadById(id: string) {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase.from("leads").select("*").eq("id", id).single();
  if (error) throw new Error(error.message);
  return data;
}

export async function updateLeadStatus({
  leadId,
  status,
  archivedReason
}: {
  leadId: string;
  status: LeadStatus;
  archivedReason?: string | null;
}) {
  const supabase = createServerSupabaseClient();
  const { error } = await supabase
    .from("leads")
    .update({
      status,
      archived_reason: archivedReason ?? null,
      last_contact_at: new Date().toISOString()
    })
    .eq("id", leadId);
  if (error) throw new Error(error.message);
}

export async function updateLeadNotes({
  leadId,
  notes
}: {
  leadId: string;
  notes: string;
}) {
  const supabase = createServerSupabaseClient();
  const { error } = await supabase.from("leads").update({ notes }).eq("id", leadId);
  if (error) throw new Error(error.message);
}

export async function markFollowupDue() {
  const supabase = createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return 0;

  const { data, error } = await supabase.rpc("mark_followup_due", {
    user_id_input: user.id
  });
  if (error) throw new Error(error.message);
  return data ?? 0;
}

export async function upsertScrapedLeads(
  leads: Array<{
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
  }>
) {
  const supabase = createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const results = [] as any[];

  for (const lead of leads) {
    const payload = {
      ...lead,
      user_id: user.id,
      status: "new"
    };

    if (lead.email) {
      const { data, error } = await supabase
        .from("leads")
        .upsert(payload, { onConflict: "user_id,email_norm" })
        .select();
      if (error) throw new Error(error.message);
      results.push(...(data ?? []));
      continue;
    }

    if (lead.website) {
      const { data, error } = await supabase
        .from("leads")
        .upsert(payload, { onConflict: "user_id,website_norm" })
        .select();
      if (error) throw new Error(error.message);
      results.push(...(data ?? []));
      continue;
    }

    const { data, error } = await supabase
      .from("leads")
      .upsert(payload, { onConflict: "user_id,company_city_norm" })
      .select();
    if (error) throw new Error(error.message);
    results.push(...(data ?? []));
  }

  return results;
}
