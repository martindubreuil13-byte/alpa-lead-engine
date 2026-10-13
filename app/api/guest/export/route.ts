import { NextResponse } from 'next/server'
import { guestSession, loadGuestSession } from '@/lib/guest/server'
import { buildLeadCsv } from '@/lib/leads/csv'

// The visitor's own businesses as a CSV, immediately: no email, account or card, and nothing is stored about the download.
// It is a plain GET so a phone can simply follow the link (a form post plus a script-built download is unreliable on iOS and
// in in-app browsers). The signed guest cookie is the only credential, and it can only ever return that visitor's own results.
export async function GET() {
 try {
  const id = await guestSession()
  if(!id) return NextResponse.json({error:'Start a free search first.'},{status:401,headers:{'Cache-Control':'no-store'}})
  const trial = await loadGuestSession(id)
  if(!trial.leads.length) return NextResponse.json({error:'No businesses are available to download yet.'},{status:400,headers:{'Cache-Control':'no-store'}})
  return new Response(buildLeadCsv(trial.leads),{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="alpa-businesses.csv"','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}})
 } catch {
  return NextResponse.json({error:'Download unavailable. Your results are still saved; please try again.'},{status:503,headers:{'Cache-Control':'no-store'}})
 }
}
