import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import {chromium} from 'playwright'
import {buildLeadCsv} from '../lib/leads/csv.ts'
const base=process.env.BASE_URL || 'http://localhost:3131'
const output=process.env.GUEST_SCREENSHOT_DIR || '/private/tmp/alpa-guest-browser'
await fs.mkdir(output,{recursive:true})
const browser=await chromium.launch({headless:true,channel:'chrome'})
const leads=Array.from({length:25},(_,i)=>({id:`fixture-${i}`,company_name:`Fixture Business ${i+1}`,city:'Toronto',industry:'Consulting',email:i===24?null:`info@fixture${i}.ca`,phone:i===23?null:'+1 416 555 0100',website:i===24?null:`https://fixture${i}.ca`,email_confidence:'medium',website_intelligence:i===24?null:{title:'Fixture business site',description:'Website says it offers local consulting.',headings:['Small business support'],source_urls:[`https://fixture${i}.ca/`]},created_at:'2026-10-12T00:00:00Z'}))
for(const [name,viewport] of [['desktop',{width:1440,height:1000}],['mobile',{width:390,height:844}]]) {
 const context=await browser.newContext({viewport,acceptDownloads:true})
 const page=await context.newPage()
 let searched=false,exportPayload=null,paidRequests=0
 await context.route('**/*',async route=>{
  const url=new URL(route.request().url())
  if(url.origin!==new URL(base).origin){paidRequests++;return route.abort()}
  if(url.pathname==='/api/scrape') {
   assert.equal(route.request().postDataJSON().guestTrial,true)
   searched=true
   return route.fulfill({contentType:'text/event-stream',body:leads.map(lead=>`data: ${JSON.stringify({type:'lead',payload:lead})}\n\n`).join('')+`data: ${JSON.stringify({type:'result',payload:{summaryLine:'25 businesses'}})}\n\n`})
  }
  if(url.pathname==='/api/guest/session')return route.fulfill({json:{leads:searched?leads:[],used:searched?25:0}})
  if(url.pathname==='/api/guest/export') {
   exportPayload=route.request().postDataJSON()
   return route.fulfill({contentType:'text/csv',headers:{'Content-Disposition':'attachment; filename="alpa-businesses.csv"'},body:buildLeadCsv(leads)})
  }
  if(url.pathname.startsWith('/api/'))return route.fulfill({json:{}})
  return route.continue()
 })
 await page.goto(base)
 await page.getByRole('button',{name:/Find 25 businesses free/i}).first().click()
 await page.locator('#trial-biz').fill('Consultants')
 await page.locator('#trial-loc').fill('Toronto')
 assert.equal(await page.locator('input[type=email],input[type=password]').count(),0)
 await page.screenshot({path:`${output}/${name}-search.png`})
 await page.getByRole('button',{name:'Run free lead search',exact:false}).last().click()
 await page.waitForURL('**/trial/results')
 await page.getByRole('heading',{name:'Fixture Business 25',exact:true}).waitFor()
 assert.equal(await page.locator('article').count(),25)
 await page.locator('article').first().getByText('Open business profile').click()
 await page.getByText('Website says it offers local consulting.').first().waitFor()
 await page.locator('article').last().getByText('Open business profile').click()
 await page.getByText('Website intelligence is unavailable for this business. No profile has been invented.').waitFor()
 assert.equal(await page.locator('input[type=password]').count(),0)
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false)
 await page.screenshot({path:`${output}/${name}-results.png`})
 await page.getByRole('button',{name:'Download CSV',exact:true}).click()
 assert.equal(await page.getByRole('checkbox').isChecked(),false)
 await page.getByLabel('Email address').fill('guest@example.com')
 await page.screenshot({path:`${output}/${name}-export.png`})
 const downloadPromise=page.waitForEvent('download')
 await page.getByRole('button',{name:'Get my CSV'}).click()
 const download=await downloadPromise
 await download.saveAs(`${output}/${name}-businesses.csv`)
 const csv=await fs.readFile(`${output}/${name}-businesses.csv`,'utf8')
 assert.equal(csv.split('\n').length,26)
 assert.equal(exportPayload.email,'guest@example.com')
 assert.equal(exportPayload.marketingOptIn,false)
 await page.reload()
 await page.getByRole('heading',{name:'Fixture Business 25',exact:true}).waitFor()
 assert.equal(await page.locator('article').count(),25)
 await page.getByRole('link',{name:'Create an optional free account'}).click()
 await page.waitForURL('**/login?mode=signup')
 await page.goBack()
 await page.getByRole('heading',{name:'Fixture Business 25',exact:true}).waitFor()
 console.log(`${name}: CTA → search → 25 full results → profiles → unchecked opt-in → real 26-row CSV → reload/signup return passed. External requests blocked: ${paidRequests}`)
 await context.close()
}
await browser.close()
