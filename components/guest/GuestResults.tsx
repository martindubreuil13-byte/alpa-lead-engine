'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { type TrialLead } from '@/lib/trial'
import { saveGuestLeads } from '@/lib/guest-session'
import { trackEvent } from '@/lib/track'

function safeUrl(value: string | null | undefined) {
 try { const url = new URL(value || ''); return ['https:','http:'].includes(url.protocol) ? url.href : null } catch { return null }
}
export default function GuestResults() {
 const params = useSearchParams()
 const [leads,setLeads] = useState<TrialLead[]>([])
 const [loading,setLoading] = useState(true)
 const [error,setError] = useState('')
 const [downloaded,setDownloaded] = useState(false)
 const readyToDownload = params.get('download') === '1'
 useEffect(()=>{
  fetch('/api/guest/session',{cache:'no-store'}).then(async res=>{
   const data=await res.json()
   if(!res.ok) throw new Error(data.error)
   setLeads(data.leads || [])
   saveGuestLeads(data.leads || [])
  }).catch(err=>setError(err.message || 'Your results could not be loaded. Please refresh.')).finally(()=>setLoading(false))
 },[])
 function onDownload() {
  // The browser follows the link and saves the file. The thank-you appears right away; nothing is asked for or stored.
  setDownloaded(true)
  void trackEvent('trial_csv_downloaded',{leads_count:leads.length})
 }
 return <div className="text-slate-200">
  <div className="mx-auto max-w-4xl">
   <h1 className="font-display text-4xl text-white sm:text-5xl">Your free businesses</h1>
   <p className="mt-3 text-sm text-slate-400">View every returned business and its available details. Contact information can be missing or outdated; delivery and accuracy are not guaranteed.</p>
   {loading ? <p role="status" className="mt-8">Loading your results…</p> : error ? <p role="alert" className="mt-8">{error}</p> : <>
    <div className="my-6 flex flex-wrap items-center gap-4">
     <p>{leads.length} of up to 25 businesses</p>
     {leads.length > 0 && <a href="/api/guest/export" onClick={onDownload} className={`inline-flex min-h-[44px] items-center rounded-lg bg-blue-500 px-5 py-3 font-medium text-white ${readyToDownload && !downloaded ? 'ring-2 ring-amber-300 ring-offset-2 ring-offset-[#080e1a]' : ''}`}>{readyToDownload && !downloaded ? 'Your CSV is ready — tap to download' : 'Download CSV'}</a>}
     <Link href="/trial" className="inline-flex min-h-[44px] items-center text-sm text-blue-300">Find more businesses</Link>
    </div>
    {downloaded && <section role="status" className="mb-6 rounded-2xl border border-white/10 bg-white/[0.04] p-5">
     <h2 className="text-xl font-medium text-white">Your businesses are ready.</h2>
     <p className="mt-2 text-slate-300">Thanks for giving ALPA a try. Now go start some conversations.</p>
     <Link href="/plans" className="mt-3 inline-block text-blue-300">Explore ALPA plans →</Link>
     <p className="mt-3 text-sm text-slate-500">Your results stay available here, so you can come back to them.</p>
    </section>}
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
 </div>
}
