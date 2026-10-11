import assert from 'node:assert/strict'
import test from 'node:test'
import { getAccessibleResults } from '../lib/scraper/results-access.ts'
import { buildLeadCsv } from '../lib/leads/csv.ts'
const leads = Array.from({length:25}, (_,i)=>({id:`lead-${i+1}`, company_name:`Business ${i+1}`, email:`contact${i+1}@example.com`, phone:'123', city:'Toronto'}))
test('signed-in results and CSV include all 25 saved leads', ()=>{
 const accessible=getAccessibleResults(leads,true)
 assert.equal(accessible.length,25)
 const csv=buildLeadCsv(accessible)
 assert.equal(csv.split('\n').length,26)
 assert.match(csv,/"Business 25"/)
})
test('guest results and preview CSV retain the five-lead limit', ()=>{
 const accessible=getAccessibleResults(leads,false)
 assert.equal(accessible.length,5)
 assert.equal(buildLeadCsv(accessible).split('\n').length,6)
 assert.doesNotMatch(buildLeadCsv(accessible),/"Business 6"/)
 assert.equal(leads.length,25)
})
test('empty results export no fabricated rows', ()=>{
 assert.deepEqual(getAccessibleResults([],true),[])
 assert.equal(buildLeadCsv([]).split('\n').length,1)
})
