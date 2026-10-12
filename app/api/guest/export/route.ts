import { NextResponse } from 'next/server'
import { guestDb, guestSession, loadGuestSession } from '@/lib/guest/server'
import { sameOrigin, validExportEmail } from '@/lib/guest/security'
import { buildLeadCsv } from '@/lib/leads/csv'
export async function POST(req: Request) {
 if(!sameOrigin(req)) return NextResponse.json({error:'Request origin refused'},{status:403})
 try {
  const body = await req.json()
  if(!validExportEmail(body.email) || typeof body.marketingOptIn !== 'boolean') return NextResponse.json({error:'Please enter a valid email address.'},{status:400})
  const id = await guestSession()
  if(!id) return NextResponse.json({error:'Start a free search first.'},{status:401})
  const trial = await loadGuestSession(id)
  if(!trial.leads.length) return NextResponse.json({error:'No businesses are available to download yet.'},{status:400})
  const {error} = await guestDb().from('guest_trials').update({email:body.email.trim().toLowerCase(),marketing_opt_in:body.marketingOptIn,consent_at:new Date().toISOString()}).eq('id',id)
  if(error) throw error
  return new Response(buildLeadCsv(trial.leads),{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="alpa-businesses.csv"','Cache-Control':'no-store'}})
 } catch {
  return NextResponse.json({error:'Download unavailable. Your results are still saved; please try again.'},{status:503})
 }
}
