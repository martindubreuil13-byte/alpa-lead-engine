import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/lib/supabase/types'

let adminClient: SupabaseClient<Database> | null = null

export function createAdminClient() {
  if (adminClient) {
    return adminClient
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !serviceRoleKey) {
    throw new Error('Missing Supabase admin environment variables')
  }

  adminClient = createClient<Database>(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })

  return adminClient
}
