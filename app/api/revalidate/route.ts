import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const path = searchParams.get('path')

    if (!path) {
      return NextResponse.json({ error: 'path parameter required' }, { status: 400 })
    }

    revalidatePath(path)

    return NextResponse.json({
      ok: true,
      message: `Revalidated ${path}`,
    })
  } catch (err) {
    console.error('[revalidate] error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Revalidation failed' },
      { status: 500 }
    )
  }
}
