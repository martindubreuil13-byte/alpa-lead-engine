'use client'
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { type TrialLead } from '@/lib/trial'
import { saveGuestLeads, saveGuestCaptureEmail } from '@/lib/guest-session'

function safeUrl(value: string | null | undefined) {
 try { const url = new URL(value || ''); return ['https:','http:'].includes(url.protocol) ? url.href : null } catch { return null }
}
export default function GuestResults() {
 const params = useSearchParams()
 const [leads,setLeads] = useState<TrialLead[]>([])
 const [loading,setLoading] = useState(true)
 const [error,setError] = useState('')
 const [exportOpen,setExportOpen] = useState(false)
 const [email,setEmail] = useState('')
 const [marketing,setMarketing] = useState(false)
 const [busy,setBusy] = useState(false)
 const [downloadError,setDownloadError] = useState('')
 const [downloaded,setDownloaded] = useState(false)
 const emailRef = useRef<HTMLInputElement>(null)
 useEffect(()=>{
  fetch('/api/guest/session',{cache:'no-store'}).then(async res=>{
   const data=await res.json()
   if(!res.ok) throw new Error(data.error)
   setLeads(data.leads || [])
   saveGuestLeads(data.leads || [])
   setEmail(data.email || '')
   if(params.get('download') === '1' && data.leads?.length) setExportOpen(true)
  }).catch(err=>setError(err.message || 'Your results could not be loaded. Please refresh.')).finally(()=>setLoading(false))
 },[params])
 useEffect(()=>{
  if(exportOpen) emailRef.current?.focus()
 },[exportOpen])
 async function download(event: React.FormEvent) {
  event.preventDefault();setBusy(true);setDownloadError('')
  try {
   const res = await fetch('/api/guest/export',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,marketingOptIn:marketing})})
   if(!res.ok) { const data=await res.json();throw new Error(data.error) }
   const url=URL.createObjectURL(await res.blob())
   const a=document.createElement('a');a.href=url;a.download='alpa-businesses.csv';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000)
   saveGuestCaptureEmail(email);setDownloaded(true);setExportOpen(false)
  } catch(err) {setDownloadError(err instanceof Error ? err.message : 'Please try again.')} finally {setBusy(false)}
 }
 return <main className="min-h-screen bg-[#080e1a] px-4 py-8 text-slate-200 sm:px-8">
  <div className="mx-auto max-w-4xl">
   <Link href="/" className="text-sm text-blue-300">ALPA · Home</Link>
   <h1 className="mt-8 font-serif text-4xl text-white">Your free businesses</h1>
   <p className="mt-3 text-sm text-slate-400">View every returned business and its available details. Contact information can be missing or outdated; delivery and accuracy are not guaranteed.</p>
   {loading ? <p role="status" className="mt-8">Loading your results…</p> : error ? <p role="alert" className="mt-8">{error}</p> : <>
    <div className="my-6 flex flex-wrap items-center gap-4">
     <p>{leads.length} of up to 25 businesses</p>
     {leads.length > 0 && <button className="rounded-lg bg-blue-500 px-5 py-3 font-medium text-white" onClick={()=>{setMarketing(false);setExportOpen(true)}}>Download CSV</button>}
     <Link href="/" className="text-sm text-blue-300">Return to free search</Link>
    </div>
    {downloaded && <p role="status" className="mb-6 text-emerald-300">Your CSV is ready. Your results are still available here.</p>}
    {!leads.length && <p>No results yet. Start a free search from the home page.</p>}
    <div className="space-y-4">
     {leads.map(lead=>{
      const site = safeUrl(lead.website)
      const facts = lead.website_intelligence
      return <article key={lead.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
       <h2 className="text-xl font-medium text-white">{lead.company_name}</h2>
       <p className="mt-1 text-sm text-slate-400">{[lead.city,lead.industry].filter(Boolean).join(' · ') || 'Location/category unavailable'}</p>
       <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
        <div className="min-w-0"><dt className="text-slate-500">Email</dt><dd className="break-all">{lead.email ? <><a className="text-blue-300" href={`mailto:${lead.email}`}>{lead.email}</a>{lead.email_confidence === 'low' && <span> · Possible address</span>}</> : lead.email_inspection?.state === 'unreadable' ? 'Website could not be read; email unavailable' : 'Email not discovered'}</dd></div>
        <div><dt className="text-slate-500">Phone</dt><dd>{lead.phone ? <a className="text-blue-300" href={`tel:${lead.phone.replace(/[^+\d]/g,'')}`}>{lead.phone}</a> : 'Phone not discovered'}</dd></div>
        <div className="min-w-0 sm:col-span-2"><dt className="text-slate-500">Website</dt><dd className="break-all">{site ? <a href={site} target="_blank" rel="noopener noreferrer" className="text-blue-300">{site}</a> : 'Website not discovered'}</dd></div>
       </dl>
       <details className="mt-5 border-t border-white/10 pt-4">
        <summary className="cursor-pointer text-blue-300">Open business profile</summary>
        <div className="mt-4 space-y-3 text-sm">
         <h3 className="font-medium text-white">Website-derived information</h3>
         {facts ? <>
          {facts.title && <p><span className="text-slate-500">Website title: </span>{facts.title}</p>}
          {facts.description && <p>{facts.description}</p>}
          {facts.headings.length > 0 && <div><p className="text-slate-500">Topics shown on the website</p><ul className="mt-2 list-inside list-disc space-y-1">{facts.headings.map((heading,i)=><li key={i}>{heading}</li>)}</ul></div>}
          {!facts.title && !facts.description && !facts.headings.length && <p>No descriptive business information was found on the pages read.</p>}
          <p className="text-slate-500">These are statements from the business website. ALPA has not independently confirmed them.{lead.email_inspection?.partial ? ' Some website pages could not be read.' : ''}</p>
          {facts.source_urls.map(url=>safeUrl(url) && <a className="block break-all text-blue-300" key={url} href={safeUrl(url)!} target="_blank" rel="noopener noreferrer">Source: {url}</a>)}
         </> : <p className="text-slate-400">Website intelligence is unavailable for this business. No profile has been invented.</p>}
        </div>
       </details>
      </article>
     })}
    </div>
    {leads.length > 0 && <p className="mt-8 text-sm text-slate-400">Results stay available in this browser for 30 days. <Link href="/login?mode=signup" className="text-blue-300">Create an optional free account</Link> to save businesses and return to your trial information on another device during those 30 days. <Link href="/plans" className="text-blue-300">View plans</Link> when you need more.</p>}
   </>}
  </div>
  {exportOpen && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onKeyDown={event=>{if(event.key === 'Escape' && !busy)setExportOpen(false)}}>
   <form onSubmit={download} onKeyDown={event=>{
    if(event.key !== 'Tab') return
    const controls=Array.from(event.currentTarget.querySelectorAll<HTMLElement>('input,button:not(:disabled)'))
    const first=controls[0],last=controls[controls.length-1]
    if(event.shiftKey && document.activeElement === first){event.preventDefault();last?.focus()}
    if(!event.shiftKey && document.activeElement === last){event.preventDefault();first?.focus()}
   }} role="dialog" aria-modal="true" aria-labelledby="export-title" className="w-full max-w-md rounded-2xl border border-white/10 bg-[#101a2a] p-6">
    <h2 id="export-title" className="text-2xl text-white">Download your businesses</h2>
    <p className="mt-3 text-sm text-slate-400">Enter your email to download the full CSV immediately. No account or password. We do not send an email copy automatically.</p>
    <label className="mt-5 block" htmlFor="export-email">Email address</label>
    <input ref={emailRef} id="export-email" type="email" required maxLength={254} autoComplete="email" value={email} onChange={event=>setEmail(event.target.value)} className="mt-2 w-full rounded-lg border border-white/20 bg-white/5 px-3 py-3 text-white" />
    <label className="mt-5 flex items-start gap-3 text-sm"><input type="checkbox" checked={marketing} onChange={event=>setMarketing(event.target.checked)} className="mt-1" />Email me ALPA news and offers (optional).</label>
    {downloadError && <p role="alert" className="mt-4 text-red-300">{downloadError}</p>}
    <div className="mt-6 flex gap-3"><button type="submit" disabled={busy} className="rounded-lg bg-blue-500 px-5 py-3 text-white disabled:opacity-50">{busy ? 'Preparing…' : 'Get my CSV'}</button><button type="button" disabled={busy} onClick={()=>setExportOpen(false)} className="px-4 py-3">Cancel</button></div>
   </form>
  </div>}
 </main>
}
