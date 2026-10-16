import assert from 'node:assert/strict'
import test from 'node:test'
import { createLinkSessionWitness, readLinkVerifier, captureAuthLinkLocation } from '../lib/auth/link-session.ts'
import { establishSessionFromLink } from '../lib/auth/password-reset.ts'
const link = {kind:'code',code:'valid-link-code'}
const client = token => ({auth:{getSession:async()=>({data:{session:{access_token:token}}}),exchangeCodeForSession:async()=>{throw new Error('A completed link must not be exchanged twice')}}})
test('fast SDK confirmation exchange is accepted even when complete before the page baseline',async()=>{
 const witness=createLinkSessionWitness(link,false,true);witness.observe('SIGNED_IN',{access_token:'verified-link-token'})
 assert.equal(await establishSessionFromLink(client('verified-link-token'),link,{establishedToken:witness.tokenFor}),'ready')
})
test('stored login, wrong link, wrong token and ordinary sign-in never provide recovery proof',()=>{
 const confirmation=createLinkSessionWitness(link,false,true);confirmation.observe('INITIAL_SESSION',{access_token:'old-login'})
 assert.equal(confirmation.tokenFor(link),null)
 confirmation.observe('SIGNED_IN',{access_token:'verified'});assert.equal(confirmation.tokenFor({...link,code:'other-code'}),null)
 const recovery=createLinkSessionWitness(link,true,true);recovery.observe('SIGNED_IN',{access_token:'ordinary-login'});assert.equal(recovery.tokenFor(link),null)
 recovery.observe('INITIAL_SESSION',{access_token:'stored'});assert.equal(recovery.tokenFor(link),null)
 assert.equal(recovery.tokenFor(link),null)
})
test('the witness cannot authorize a bare visit or malformed link',()=>{
 for(const link of [{kind:'none'},{kind:'error',reason:'expired'}]){
  const witness=createLinkSessionWitness(link,false,true);witness.observe('SIGNED_IN',{access_token:'token'});assert.equal(witness.tokenFor(link),null)
 }
})
test('a proven link cannot authorize a different existing session',async()=>{
 const witness=createLinkSessionWitness(link,true,true,true);witness.observe('SIGNED_IN',{access_token:'proof'})
 const c=client('old-login');c.auth.exchangeCodeForSession=async()=>({error:{code:'otp_expired'}})
 assert.equal(await establishSessionFromLink(c,link,{establishedToken:witness.tokenFor,manualAfterMs:0,pollMs:1,timeoutMs:50}),'expired')
})

test('a restored stored login without a PKCE verifier is not accepted as a code exchange',()=>{
 const witness=createLinkSessionWitness(link,false,false);witness.observe('SIGNED_IN',{access_token:'restored-login'});assert.equal(witness.tokenFor(link),null)
 const otp=createLinkSessionWitness({kind:'token_hash',tokenHash:'hash',otpType:'signup'},false,true);otp.observe('SIGNED_IN',{access_token:'stored'});assert.equal(otp.tokenFor({kind:'token_hash',tokenHash:'hash',otpType:'signup'}),null)
})

test('a verifier consumed by a failed automatic exchange is expired, not a different browser',async()=>{
 const c={auth:{getSession:async()=>({data:{session:null}}),exchangeCodeForSession:async()=>({error:{message:'PKCE code verifier not found'}})}}
 const options={manualAfterMs:0,pollMs:1,timeoutMs:50}
 assert.equal(await establishSessionFromLink(c,link,{...options,hadCodeVerifier:true}),'expired')
 assert.equal(await establishSessionFromLink(c,link,options),'other_browser')
})

test('PKCE recovery accepts only an exchange with the pre-existing recovery verifier marker',()=>{
 const witness=createLinkSessionWitness(link,true,true,true);witness.observe('SIGNED_IN',{access_token:'recovery-token'});assert.equal(witness.tokenFor(link),'recovery-token')
 const flags=readLinkVerifier('sb-test='+encodeURIComponent('base64-'+Buffer.from(JSON.stringify('secret/PASSWORD_RECOVERY')).toString('base64url')),'sb-test')
 assert.deepEqual(flags,{present:true,recovery:true})
 assert.deepEqual(readLinkVerifier('sb-test='+encodeURIComponent(JSON.stringify('signup-secret')),'sb-test'),{present:true,recovery:false})
 assert.deepEqual(readLinkVerifier('sb-test=broken','sb-test'),{present:false,recovery:false})
})

test('the original callback survives SDK URL cleanup but is handed over only once, to its own page',()=>{
 const url={pathname:'/auth/reset',search:'?code=verified-code',hash:''};const capture=captureAuthLinkLocation(url)
 url.search='';assert.equal(capture.take('/auth/confirm'),null)
 assert.equal(capture.take('/auth/reset').search,'?code=verified-code')
 assert.equal(capture.take('/auth/reset'),null,'a later bare visit cannot reuse the initial link')
 assert.equal(captureAuthLinkLocation({pathname:'/login',search:'?code=anything',hash:''}).initial,null)
})
