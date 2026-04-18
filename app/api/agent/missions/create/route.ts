import { NextResponse } from 'next/server'

import { normalizeScheduleTime } from '@/lib/agent/schedule'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createServerClient } from '@/lib/supabase/server'

export async function POST(req: Request) {
  try {
    const {
      icp_id,
      name,
      leads_per_day,
      contact_mode,
      require_email,
      require_phone,
      require_website,
      location,
      schedule_timezone,
      schedule_local_time,
    } = await req.json()

    if (!icp_id) {
      return NextResponse.json({ error: 'Missing ICP id' }, { status: 400 })
    }

    const supabase = await createServerClient()
    const { userId, error: adminError } = await requireAdmin(supabase)
    if (adminError) return adminError
    void userId

    const { data: user } = await supabase.auth.getUser()
    if (!user?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: mission, error } = await supabase
      .from('agent_missions')
      .insert({
        user_id: user.user.id,
        icp_id,
        name: typeof name === 'string' ? name : null,
        leads_per_day: typeof leads_per_day === 'number' ? leads_per_day : 10,
        contact_mode: typeof contact_mode === 'string' ? contact_mode : 'email',
        require_email: true,
        require_phone: Boolean(require_phone),
        require_website: require_website !== false,
        location: typeof location === 'string' && location.trim() ? location.trim() : 'Global',
        status: 'draft',
        outreach_mode: 'draft_only',
        schedule_timezone: typeof schedule_timezone === 'string' && schedule_timezone.trim() ? schedule_timezone.trim() : 'UTC',
        schedule_local_time: normalizeScheduleTime(
          typeof schedule_local_time === 'string' ? schedule_local_time : '09:00'
        ),
      })
      .select()
      .single()

    if (error) {
      console.error(error)
      return NextResponse.json({ error: 'Failed to create mission' }, { status: 500 })
    }

    return NextResponse.json(mission)
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
