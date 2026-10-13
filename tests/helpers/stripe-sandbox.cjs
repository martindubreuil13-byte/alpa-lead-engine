// Test-only: no request to api.stripe.com can leave the machine. Loaded with NODE_OPTIONS=--require by the browser tests: every
// attempt is refused at once (connection refused on a closed local port) and written to the file named by STRIPE_BLOCK_LOG, so a
// test can state how many times the application tried and prove that none got out.
const fs = require('node:fs')
const https = require('node:https')
const http = require('node:http')
const original = https.request

https.request = function patched(options, callback) {
  const target = typeof options === 'string' || options instanceof URL ? new URL(String(options)) : options
  const host = String((target && (target.hostname || target.host)) || '')
  if (/(^|\.)stripe\.com$/i.test(host)) {
    try { fs.appendFileSync(process.env.STRIPE_BLOCK_LOG || '/tmp/stripe-blocked.log', `${new Date().toISOString()} ${target.method || 'GET'} ${host}${target.path || ''}\n`) } catch {}
    return http.request({ host: '127.0.0.1', port: 1, method: target.method, path: '/', agent: false }, callback)
  }
  return original.apply(this, arguments)
}
