import { NextResponse } from 'next/server'
import { guestSession, loadGuestSession } from '@/lib/guest/server'
export async function GET() {
 try {
  const id = await guestSession()
  if (!id) return NextResponse.json({leads:[],used:0,attempts:0},{headers:{'Cache-Control':'no-store'}})
  return NextResponse.json(await loadGuestSession(id),{headers:{'Cache-Control':'no-store'}})
 } catch {
  return NextResponse.json({error:'Your trial could not be loaded. Please try again.'},{status:503})
 }
}
