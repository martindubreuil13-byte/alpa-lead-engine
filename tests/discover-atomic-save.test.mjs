import assert from 'node:assert/strict'
import test from 'node:test'
import { getDiscoverCapacity, saveDiscoverResults, describeLeadUsage } from '../lib/scraper/save-discover-results.ts'
const input = { runId:'run', userId:'owner', limit:25, monthly:true, leads:[{company_name:'A', phone:'123'}] }
const confirmed = { leads_used:1, leads_limit:25, current_period_end:'2026-11-11', outcomes:[{index:0,status:'saved',id:'lead'}] }
test('a lost confirmation retries the exact batch reference and input', async () => {
 const calls=[]
 const client={async rpc(name,args){calls.push({name,args});return calls.length===1 ? {error:{message:'timeout'}} : {data:confirmed}}}
 assert.deepEqual(await saveDiscoverResults(client,input),confirmed)
 assert.equal(calls.length,2);assert.deepEqual(calls[0],calls[1])
 assert.equal(calls[0].args.p_user_id,'owner')
})
test('unconfirmed saves do not invent usage or fall back to ordinary inserts', async () => {
 let calls=0
 await assert.rejects(saveDiscoverResults({async rpc(){calls++;return {error:{message:'unavailable'}}}},input), /Saving could not be confirmed.*run/)
 assert.equal(calls,2)
})
test('missing accounting support prevents discovery before paid work starts', async () => {
 await assert.rejects(getDiscoverCapacity({async rpc(){return {error:{code:'PGRST202'}}}},'owner',25,true), /No search was started/)
})
test('invalid confirmation and omitted outcomes are rejected', async () => {
 for (const data of [{...confirmed,leads_used:-1},{...confirmed,outcomes:[]},{...confirmed,outcomes:[{index:0,status:'saved'}]}]) {
  await assert.rejects(saveDiscoverResults({async rpc(){return {data}}},input), /invalid/)
 }
})
test('the interface describes saved usage with the actual plan scope', () => {
 assert.equal(describeLeadUsage(5,'25',false),'5 of 25 leads saved')
 assert.equal(describeLeadUsage(10,'500',true),'10 of 500 leads saved this month')
})
