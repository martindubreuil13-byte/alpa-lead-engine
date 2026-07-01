'use server'

import { createServerClient } from '@/lib/supabase/server'
import { getUserProfile } from '@/lib/auth/get-user-profile'

export async function archiveLeads(leadIds: string[]): Promise<{ success: boolean; error?: string }> {
  try {
    const profile = await getUserProfile()
    if (!profile) {
      return { success: false, error: 'Not authenticated' }
    }

    const supabase = await createServerClient()

    const { error } = await supabase
      .from('leads')
      .update({
        pipeline_stage: 'closed',
        closed_at: new Date().toISOString(),
        status_updated_at: new Date().toISOString(),
      })
      .in('id', leadIds)
      .eq('user_id', profile.id)

    if (error) {
      return { success: false, error: 'Failed to archive' }
    }

    return { success: true }
  } catch (err) {
    return { success: false, error: 'Failed to archive' }
  }
}

export async function restoreLeads(leadIds: string[]): Promise<{ success: boolean; error?: string }> {
  try {
    const profile = await getUserProfile()
    if (!profile) {
      return { success: false, error: 'Not authenticated' }
    }

    const supabase = await createServerClient()

    const { error } = await supabase
      .from('leads')
      .update({
        pipeline_stage: null,
        closed_at: null,
        status_updated_at: new Date().toISOString(),
      })
      .in('id', leadIds)
      .eq('user_id', profile.id)

    if (error) {
      return { success: false, error: 'Failed to restore' }
    }

    return { success: true }
  } catch (err) {
    return { success: false, error: 'Failed to restore' }
  }
}

export async function deleteLead(leadId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const profile = await getUserProfile()
    if (!profile) {
      return { success: false, error: 'Not authenticated' }
    }

    const supabase = await createServerClient()

    const { error } = await supabase
      .from('leads')
      .delete()
      .eq('id', leadId)
      .eq('user_id', profile.id)

    if (error) {
      return { success: false, error: 'Failed to delete' }
    }

    return { success: true }
  } catch (err) {
    return { success: false, error: 'Failed to delete' }
  }
}

export async function deleteLeads(leadIds: string[]): Promise<{ success: boolean; error?: string }> {
  try {
    const profile = await getUserProfile()
    if (!profile) {
      return { success: false, error: 'Not authenticated' }
    }

    const supabase = await createServerClient()

    const { error } = await supabase
      .from('leads')
      .delete()
      .in('id', leadIds)
      .eq('user_id', profile.id)

    if (error) {
      return { success: false, error: 'Failed to delete' }
    }

    return { success: true }
  } catch (err) {
    return { success: false, error: 'Failed to delete' }
  }
}
