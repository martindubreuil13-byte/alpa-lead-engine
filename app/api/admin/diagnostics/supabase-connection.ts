import { createServerClient } from '@/lib/supabase/server'
import { isAdmin } from '@/lib/auth/access'
import { getUserProfile } from '@/lib/auth/get-user-profile'

/**
 * Diagnostic endpoint to verify Supabase connection details.
 * Admin-only. Returns the Supabase URL, project ref, and auth context.
 */
export async function GET(req: Request) {
  try {
    const profile = await getUserProfile()
    if (!profile || !isAdmin(profile)) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: 'Admin access required',
        }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

    // Extract project ref from URL
    // URL format: https://[project-ref].supabase.co
    const projectRef = supabaseUrl?.split('//')[1]?.split('.')[0] || 'unknown'

    // Get the authenticated user info
    const supabase = await createServerClient()
    const { data: authData } = await supabase.auth.getUser()
    const userId = authData.user?.id || 'not-authenticated'

    // Try to query the queue table to verify connection
    const { data: queueTest, error: queueError } = await supabase
      .from('commercial_intelligence_queue')
      .select('count')
      .limit(1)

    // Get server client session to identify if service role or anon
    const { data: sessionData } = await supabase.auth.getSession()
    const clientType = anonKey ? 'anon-key-client' : 'service-role-client'

    console.log('[DIAG] Supabase Connection Details:')
    console.log('[DIAG] URL:', supabaseUrl)
    console.log('[DIAG] Project Ref:', projectRef)
    console.log('[DIAG] Client Type:', clientType)
    console.log('[DIAG] Authenticated User:', userId)
    console.log('[DIAG] Queue Table Accessible:', !queueError)
    console.log('[DIAG] Queue Error:', queueError?.message || 'none')

    return new Response(
      JSON.stringify({
        ok: true,
        supabaseUrl,
        projectRef,
        clientType,
        authenticatedUser: userId,
        queueTableAccessible: !queueError,
        queueTableError: queueError?.message || null,
        environment: {
          NEXT_PUBLIC_SUPABASE_URL: supabaseUrl ? '✓ set' : '✗ missing',
          NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey ? '✓ set' : '✗ missing',
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    console.error('[DIAG] Exception:', err)
    return new Response(
      JSON.stringify({
        ok: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
