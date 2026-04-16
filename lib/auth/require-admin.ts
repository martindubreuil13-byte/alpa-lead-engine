import { NextResponse } from 'next/server'
import type { createServerClient } from '@/lib/supabase/server'

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
