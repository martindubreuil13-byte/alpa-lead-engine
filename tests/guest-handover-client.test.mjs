import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

let cleared = 0, stored = [], attempts = 0
const requests = []
function load(file, mocks) {
  const compiled = { exports: {} }
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  new Function('require', 'module', 'exports', code)(name => {
    if (name in mocks) return mocks[name]
    throw new Error('Unmocked dependency: ' + name)
  }, compiled, compiled.exports)
  return compiled.exports
}
const handover = load('lib/guest/claim-client.ts', {
  '@/lib/session/guest-trial-mode': { clearGuestTrialMode: () => { cleared++ } },
  '@/lib/session/scrape-result': { writeStoredGuestClaimResult: result => { stored.push(result) } },
})
const good = { success: true, imported: 2, skipped_duplicate: 0, skipped_invalid: 0, skipped_allowance: 0 }
function reply(body, status = 200) {
  cleared = 0; stored = []; attempts = 0; requests.length = 0
  globalThis.fetch = async (url, init) => { attempts++; requests.push({ url, init }); return Response.json(body, { status }) }
}
test('confirmed import records the result and clears mode without sending business data', async () => {
  reply(good)
  assert.deepEqual(await handover.finishGuestHandOver(), good)
  assert.equal(cleared, 1); assert.deepEqual(stored, [good])
  assert.deepEqual(requests[0], { url: '/api/guest/claim', init: { method: 'POST', headers: { 'Content-Type': 'application/json' } } })
})
test('a new device with explicitly no guest session continues without fabricating an import', async () => {
  reply({ error: 'No guest session' }, 401)
  assert.equal(await handover.finishGuestHandOver(), null)
  assert.equal(cleared, 1); assert.deepEqual(stored, [])
})
test('RPC failure, expired trial, unauthorized and malformed responses preserve guest mode and report failure', async () => {
  for (const [body, status] of [[{error:'migration missing'},503],[{error:'Unauthorized'},401],[{error:'expired'},410],[{},200],[{...good,success:false},200],[{...good,imported:-1},200],[{...good,imported:null},200]]) {
    reply(body,status)
    await assert.rejects(handover.finishGuestHandOver, handover.GuestImportError)
    assert.equal(cleared, 0); assert.deepEqual(stored, [])
  }
})
test('lost response leaves the trial intact; idempotent retry accepts the confirmed duplicate result', async () => {
  reply(good)
  globalThis.fetch = async () => { throw new Error('Connection lost after commit') }
  await assert.rejects(handover.finishGuestHandOver, handover.GuestImportError)
  assert.equal(cleared, 0); assert.deepEqual(stored, [])
  reply({...good,imported:0,skipped_duplicate:2})
  assert.equal((await handover.finishGuestHandOver()).skipped_duplicate,2)
  assert.equal(cleared,1)
})
test('continuation cannot navigate to checkout when the handover fails; retry retains the chosen Pro plan', async () => {
  const continuation = load('lib/auth/continue-client.ts', {
    '@/lib/auth/email-confirmation': { destinationAfterConfirmation: ({browserPending,userMetadata}) => '/checkout/start?plan='+(browserPending?.plan ?? userMetadata.pending_plan) },
    '@/lib/checkout/pending-plan': { readPendingCheckout: () => null },
    '@/lib/guest/claim-client': handover,
    '@/lib/supabase': { supabase: { auth: { getSession: async () => ({data:{session:{user:{user_metadata:{pending_plan:'pro'}}}}}) } } },
  })
  globalThis.window = { localStorage: {} }
  reply({error:'unavailable'},503)
  await assert.rejects(continuation.destinationForSignedInCustomer, handover.GuestImportError)
  assert.equal(cleared,0)
  reply(good)
  assert.equal(await continuation.destinationForSignedInCustomer(),'/checkout/start?plan=pro')
  assert.equal(attempts,1)
  delete globalThis.window
})
