import { createServerClient } from '@/lib/supabase/server'
import { isAdmin } from '@/lib/auth/access'
import { getUserProfile } from '@/lib/auth/get-user-profile'

export async function GET() {
  try {
    const profile = await getUserProfile()
    if (!profile || !isAdmin(profile)) {
      return new Response('Unauthorized', { status: 401 })
    }

    const supabase = await createServerClient()

    const { data, error } = await supabase
      .from('leads')
      .select('id, company_name, website, ci_enrichment_status, ci_enriched_at, ci_last_error')
      .order('created_at', { ascending: false })
      .limit(20)

    if (error) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: error.message,
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      )
    }

    return new Response(
      JSON.stringify({
        ok: true,
        leads: data || [],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    console.error('Error fetching recent leads:', err)
    return new Response(
      JSON.stringify({
        ok: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
