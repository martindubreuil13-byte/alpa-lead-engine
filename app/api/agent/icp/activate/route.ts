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

    const { data: ownedIcp, error: ownershipError } = await supabase
      .from('agent_icp')
      .select('id')
      .eq('id', id)
      .eq('user_id', user.user.id)
      .maybeSingle()

    if (ownershipError || !ownedIcp) {
      return NextResponse.json({ error: 'ICP not found' }, { status: 404 })
    }

    await supabase
      .from('agent_icp')
      .update({ is_active: false, status: 'draft' })
      .eq('user_id', user.user.id)

    await supabase
      .from('agent_icp')
      .update({ is_active: true, status: 'active' })
      .eq('id', id)
      .eq('user_id', user.user.id)

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
