import { NextResponse } from 'next/server'

import { requireAdmin } from '@/lib/auth/require-admin'
import { createServerClient } from '@/lib/supabase/server'

export async function POST(req: Request) {
  try {
    const { id } = await req.json()

    if (!id || typeof id !== 'string') {
      return NextResponse.json({ error: 'Missing mission id' }, { status: 400 })
    }

    const supabase = await createServerClient()
    const { userId, error: adminError } = await requireAdmin(supabase)
    if (adminError) return adminError

    const { error } = await supabase
      .from('agent_missions')
      .delete()
      .eq('id', id)
      .eq('user_id', userId)

    if (error) {
      console.error(error)
      return NextResponse.json({ error: 'Failed to delete mission' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error(error)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
