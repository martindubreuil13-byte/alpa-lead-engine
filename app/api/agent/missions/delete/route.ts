import { NextResponse } from 'next/server'

import { createServerClient } from '@/lib/supabase/server'

export async function POST(req: Request) {
  try {
    const { id } = await req.json()

    if (!id || typeof id !== 'string') {
      return NextResponse.json({ error: 'Missing mission id' }, { status: 400 })
    }

    const supabase = await createServerClient()
    const { data: user } = await supabase.auth.getUser()

    if (!user?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { error } = await supabase
      .from('agent_missions')
      .delete()
      .eq('id', id)
      .eq('user_id', user.user.id)

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
