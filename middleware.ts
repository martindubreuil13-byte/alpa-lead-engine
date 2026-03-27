import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

const GUEST_ALLOWED_PATHS = new Set([
  '/dashboard',
  '/dashboard/leads',
  '/dashboard/kanban',
  '/dashboard/scraper',
])

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({
    request,
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value)
          })

          response = NextResponse.next({
            request,
          })

          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options)
          })
        },
      },
    }
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (user) {
    return response
  }

  if (GUEST_ALLOWED_PATHS.has(request.nextUrl.pathname)) {
    return response
  }

  const loginUrl = request.nextUrl.clone()
  loginUrl.pathname = '/login'
  loginUrl.search = ''

  const redirectResponse = NextResponse.redirect(loginUrl)

  response.cookies.getAll().forEach((cookie) => {
    redirectResponse.cookies.set(cookie)
  })

  return redirectResponse
}

export const config = {
  matcher: ['/dashboard/:path*'],
}
