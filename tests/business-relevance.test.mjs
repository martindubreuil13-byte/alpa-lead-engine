import assert from 'node:assert/strict'
import test from 'node:test'
import { classifyBusinessRelevance, rankBusinessCandidates } from '../lib/scraper/business-relevance.ts'
const classify=(q,name,industry)=>classifyBusinessRelevance(q,{company_name:name,industry})
test('consultant search excludes recruitment category despite suggestive name',()=>{
 assert.equal(classify('consultant','Options Consulting','Employment agency'),'mismatch')
 for (const category of ['Business management consultant','Health consultant','Computer consultant']) assert.equal(classify('consultant','Advisor',category),'match')
 assert.equal(classify('recruitment consultant','Staffing Team','Employment agency'),'match')
})
test('specific consulting specialty does not claim unrelated consultant is a confirmed match',()=>{
 assert.equal(classify('IT consultant','Advisor','Health consultant'),'mismatch')
 assert.equal(classify('IT consultant','Advisor','Computer consultant'),'match')
})
test('SEO recognizes explicit evidence, preserves adjacent uncertainty and rejects clear conflicts',()=>{
 assert.equal(classify('SEO agency','SEO Company Pakistan','Internet marketing service'),'match')
 assert.equal(classify('search engine optimisation agency','Company','Search engine optimization service'),'match')
 assert.equal(classify('SEO agency','Digital Team','Marketing agency'),'uncertain')
 assert.equal(classify('SEO agency','SEO Restaurant','Restaurant'),'mismatch')
 assert.equal(classify('SEO agency','Company',null),'uncertain')
})
test('unknown query and generic categories are not treated as proven mismatches',()=>{
 assert.equal(classify('architect','Company','Agency'),'uncertain')
 assert.equal(classify('consultant','Company','point_of_interest'),'uncertain')
})
test('ranking is stable and does not invent or overwrite categories',()=>{
 const rows=[{company_name:'Digital A',industry:'Marketing agency'},{company_name:'SEO A',industry:'Internet marketing service'},{company_name:'SEO B',industry:'Internet marketing service'}]
 assert.deepEqual(rankBusinessCandidates('SEO agency',rows).map(x=>x.company_name),['SEO A','SEO B','Digital A'])
 assert.equal(rows[0].industry,'Marketing agency')
})
