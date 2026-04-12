import { NextResponse } from 'next/server'

import { createServerClient } from '@/lib/supabase/server'

export async function POST(req: Request) {
  try {
    const { id } = await req.json()

    if (!id) {
      return NextResponse.json({ error: 'Missing ICP id' }, { status: 400 })
    }

    const supabase = await createServerClient()
    const { data: user } = await supabase.auth.getUser()

    if (!user?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { error } = await supabase
      .from('agent_icp')
      .delete()
      .eq('id', id)
      .eq('user_id', user.user.id)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
