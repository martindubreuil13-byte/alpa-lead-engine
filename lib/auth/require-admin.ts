import { NextResponse } from 'next/server'
import { redirect } from 'next/navigation'

import { isAdmin } from '@/lib/auth/access'
import { getUserProfile } from '@/lib/auth/get-user-profile'
import { createServerClient } from '@/lib/supabase/server'

type SupabaseClient = Awaited<ReturnType<typeof createServerClient>>

export async function requireAdmin(
  supabase: SupabaseClient
): Promise<{ userId: string; error: null } | { userId: null; error: NextResponse }> {
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user?.id) {
    return {
      userId: null,
      error: NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 }),
    }
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('plan')
    .eq('id', user.id)
    .maybeSingle()

  if (profile?.plan !== 'admin') {
    return {
      userId: null,
      error: NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 }),
    }
  }

  return { userId: user.id, error: null }
}

/** API guard: returns a 401/403 response for anyone who is not an admin, otherwise null. */
export async function adminGuard(): Promise<NextResponse | null> {
  const { error } = await requireAdmin(await createServerClient())
  return error
}

/** Page guard for server layouts: sends non-admins back to the customer dashboard. */
export async function requireAdminPage() {
  const profile = await getUserProfile()
  if (!profile) redirect('/login')
  if (!isAdmin(profile)) redirect('/dashboard')
  return profile
}
