import assert from 'node:assert/strict'
import test from 'node:test'
import { signGuestId, readGuestId, guestRateBucket, validExportEmail, sameOrigin } from '../lib/guest/security.ts'
import { extractWebsiteFacts } from '../lib/guest/website-facts.ts'
import { enrichEmailV2 } from '../lib/scraper/email-enrichment.ts'
import { buildLeadCsv } from '../lib/leads/csv.ts'
const id='4f928ea6-1c42-4a98-ae76-999adc264612'
test('server-issued guest cookie rejects forgery and changed IDs',()=>{
 const token=signGuestId(id,'test-secret')
 assert.equal(readGuestId(token,'test-secret'),id)
 assert.equal(readGuestId(token,'other-secret'),null)
 assert.equal(readGuestId(token.replace('4f928','5f928'),'test-secret'),null)
 assert.equal(readGuestId(id,'test-secret'),null)
})
test('IP limiter stores a keyed daily hash, not a raw address',()=>{
 const date=new Date('2026-10-12T12:00:00Z')
 const key=guestRateBucket('192.0.2.1','test',date)
 assert.equal(key.length,64)
 assert.notEqual(key,guestRateBucket('192.0.2.2','test',date))
 assert.notEqual(key,guestRateBucket('192.0.2.1','test',new Date('2026-10-13')))
})
test('email validation and same-origin mutations reject invalid inputs',()=>{
 for(const email of ['', 'bad', 'a@b', 'a\n@b.com', null, 'a'.repeat(255)+'@b.com'])assert.equal(validExportEmail(email),false)
 assert.equal(validExportEmail(' guest@example.com '),true)
 assert.equal(sameOrigin(new Request('https://alpa.example/api/guest/export',{headers:{origin:'https://evil.example'}})),false)
 assert.equal(sameOrigin(new Request('https://alpa.example/api/guest/export',{headers:{origin:'https://alpa.example'}})),true)
})
test('website facts come from the actual safe email pipeline pages with no new network requests',async()=>{
 const urls=[]
 const result=await enrichEmailV2('https://acmeplumbing.ca',{
  fetchRobots:async()=>[],
  fetchPage:async url=>{urls.push(url);return {html:'<title>Fixture business</title><meta name="description" content="Accounting for local shops"><h1>Bookkeeping</h1><a href="mailto:info@acmeplumbing.ca">Contact us</a>',resolvedUrl:url}},
 })
 assert.equal(result.websiteFacts.title,'Fixture business')
 assert.equal(result.websiteFacts.description,'Accounting for local shops')
 assert.deepEqual(result.websiteFacts.headings,['Bookkeeping'])
 assert.ok(urls.includes(result.websiteFacts.source_urls[0]))
 assert.equal(result.rounds,1)
})
test('full CSV preserves missing fields, extracted facts, quotes and spreadsheet safety',()=>{
 const facts=extractWebsiteFacts('<title>Actual &amp; Co</title><h2>Local support</h2>','https://acmeplumbing.ca')
 const leads=Array.from({length:25},(_,i)=>({company_name:i===0?'=FORMULA()':`Business ${i+1}`,email:null,phone:null,city:'City',website_intelligence:facts}))
 const csv=buildLeadCsv(leads)
 assert.equal(csv.split('\n').length,26)
 assert.match(csv,/Business 25/)
 assert.match(csv,/Actual & Co/)
 assert.match(csv,/"'=FORMULA\(\)"/)
 assert.match(csv,/Local support/)
})
