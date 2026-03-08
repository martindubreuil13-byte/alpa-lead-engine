'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

type Lead = {
  id: string
  company_name: string
  industry: string
  email: string
  phone: string
  website: string
  status: string
}

export default function Page() {
  const [leads, setLeads] = useState<Lead[]>([])

  useEffect(() => { fetchLeads() }, [])

  async function fetchLeads() {
    const { data } = await supabase.from('leads').select('*')
    if (data) setLeads(data)
  }

  return (
    <div style={layout}>

      {/* SIDEBAR */}
      <aside style={sidebar}>
        <div style={logo}>OutreachDesk</div>

        <nav style={nav}>
          <NavItem active>Leads</NavItem>
          <NavItem>Pipeline</NavItem>
          <NavItem>Campaigns</NavItem>
          <NavItem>Analytics</NavItem>
          <NavItem>Settings</NavItem>
        </nav>

        <div style={sidebarFooter}>
          Quebec • Outreach System
        </div>
      </aside>

      {/* MAIN AREA */}
      <main style={main}>

        {/* HEADER */}
        <div style={header}>
          <div>
            <h1 style={title}>Leads</h1>
            <p style={subtitle}>Manage and track your outreach</p>
          </div>

          <div style={headerActions}>
            <button style={secondaryBtn}>Import</button>
            <button style={primaryBtn}>+ New Lead</button>
          </div>
        </div>

        {/* METRICS */}
        <div style={metricsGrid}>
          <Metric label="Total" value={leads.length} />
          <Metric label="New" value={count(leads,'new')} />
          <Metric label="Contacted" value={count(leads,'contacted')} />
          <Metric label="Active" value={count(leads,'active')} />
        </div>

        {/* TABLE */}
        <div style={tableCard}>
          <table style={table}>
            <thead>
              <tr>
                <Th>Company</Th>
                <Th>Industry</Th>
                <Th>Email</Th>
                <Th>Phone</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {leads.map(l => (
                <tr key={l.id} style={row}>
                  <Td strong>{l.company_name}</Td>
                  <Td>{l.industry}</Td>
                  <Td>{l.email}</Td>
                  <Td>{l.phone || '—'}</Td>
                  <Td>
                    <Status status={l.status}/>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>

          {leads.length === 0 && (
            <div style={empty}>
              No leads yet — import or add your first prospects.
            </div>
          )}
        </div>
      </main>
    </div>
  )
}

/* ---------- UI COMPONENTS ---------- */

function NavItem({children,active=false}:{children:any,active?:boolean}){
  return <div style={{
    padding:'10px 14px',
    borderRadius:8,
    background: active ? '#1e293b' : 'transparent',
    color: active ? 'white' : '#94a3b8',
    cursor:'pointer',
    fontSize:14
  }}>{children}</div>
}

function Metric({label,value}:{label:string,value:number}){
  return (
    <div style={metricCard}>
      <div style={metricValue}>{value}</div>
      <div style={metricLabel}>{label}</div>
    </div>
  )
}

function Status({status}:{status:string}){
  const c = color(status)
  return <span style={{
    background:c.bg,
    color:c.text,
    padding:'6px 10px',
    borderRadius:20,
    fontSize:12,
    fontWeight:600
  }}>{status}</span>
}

/* ---------- HELPERS ---------- */

const count=(arr:Lead[],s:string)=>arr.filter(l=>l.status?.toLowerCase()===s).length

function color(s:string){
  s=s?.toLowerCase()
  if(s==='new') return {bg:'#e2e8f0',text:'#475569'}
  if(s==='contacted') return {bg:'#fef3c7',text:'#92400e'}
  return {bg:'#dcfce7',text:'#166534'}
}

/* ---------- STYLES ---------- */

const layout={display:'flex',height:'100vh',fontFamily:'Inter, system-ui'}

const sidebar={width:240,background:'#0f172a',padding:20,display:'flex',flexDirection:'column'}

const logo={color:'white',fontWeight:700,fontSize:18,marginBottom:30}

const nav={display:'flex',flexDirection:'column',gap:6}

const sidebarFooter={marginTop:'auto',color:'#64748b',fontSize:12}

const main={flex:1,background:'#f8fafc',padding:32,overflow:'auto'}

const header={display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:28}

const title={margin:0,fontSize:28}

const subtitle={margin:'4px 0 0',color:'#64748b',fontSize:14}

const headerActions={display:'flex',gap:10}

const primaryBtn={background:'#2563eb',color:'white',border:'none',padding:'10px 16px',borderRadius:8,fontWeight:600,cursor:'pointer'}

const secondaryBtn={background:'white',border:'1px solid #e2e8f0',padding:'10px 16px',borderRadius:8,fontWeight:600,cursor:'pointer'}

const metricsGrid={display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:16,marginBottom:28}

const metricCard={background:'white',padding:18,borderRadius:12,border:'1px solid #e2e8f0'}

const metricValue={fontSize:24,fontWeight:700}

const metricLabel={fontSize:13,color:'#64748b'}

const tableCard={background:'white',borderRadius:12,border:'1px solid #e2e8f0',overflow:'hidden'}

const table={width:'100%',borderCollapse:'collapse'}

const Th=(p:any)=><th style={{textAlign:'left',padding:14,fontSize:13,color:'#64748b',borderBottom:'1px solid #e2e8f0'}}>{p.children}</th>

const Td=(p:any)=><td style={{padding:14,fontSize:14,fontWeight:p.strong?600:400}}>{p.children}</td>

const row={borderBottom:'1px solid #f1f5f9'}

const empty={padding:40,textAlign:'center',color:'#64748b'}