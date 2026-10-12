import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    return entry.isDirectory() ? walk(full) : [full]
  })
}
const routes = walk('app/api').filter((file) => /route\.(ts|tsx)$/.test(file))
const read = (file) => fs.readFileSync(file, 'utf8')

test('the unauthenticated service-role lead delete endpoint is gone and cannot return unnoticed', () => {
  assert.equal(fs.existsSync('app/api/leads/[id]/route.ts'), false)
  // No API route deletes leads without scoping the delete to the authenticated owner (post-checkout activation removes the
  // signed-in user's own guest leads: `.eq('user_id', user.id)`).
  for (const file of routes) {
    const flat = read(file).replace(/\s+/g, ' ')
    for (const match of flat.matchAll(/\.from\(\s*['"]leads['"]\s*\)\s*\.delete\(\)/g)) {
      const chain = flat.slice(match.index, match.index + 160)
      assert.match(chain, /\.eq\(\s*['"]user_id['"]/, `${file} deletes leads without an owner scope`)
    }
  }
  // Nothing under /api/leads accepts DELETE at all.
  for (const file of routes.filter((f) => f.includes(`${path.sep}api${path.sep}leads${path.sep}`))) {
    assert.ok(!/export\s+(async\s+)?function\s+DELETE|export\s+const\s+DELETE/.test(read(file)), `${file} exports DELETE`)
  }
})

test('any API route that exports DELETE must authenticate the caller (no mutation route is anonymous by omission)', () => {
  for (const file of routes) {
    const source = read(file)
    if (!/export\s+(async\s+)?function\s+DELETE|export\s+const\s+DELETE/.test(source)) continue
    assert.match(source, /getUser\(|getUserProfile|requireAdmin|isAdmin/, `${file} exports DELETE without an authentication check`)
  }
})

test('lead deletion stays on the authenticated server action, scoped to the signed-in owner', () => {
  const actions = read('app/dashboard/my-leads/actions.ts')
  for (const name of ['deleteLead', 'deleteLeads']) {
    const body = actions.slice(actions.indexOf(`export async function ${name}`))
    const fn = body.slice(0, body.indexOf('\n}\n') + 3)
    assert.match(fn, /getUserProfile\(\)/, `${name} authenticates`)
    assert.match(fn, /if \(!profile\)/, `${name} rejects anonymous callers`)
    assert.match(fn, /\.eq\('user_id', profile\.id\)/, `${name} is limited to the owner's rows`)
    assert.match(fn, /createServerClient\(\)/, `${name} uses the session client, so row security applies`)
  }
  assert.match(read('app/dashboard/my-leads/MyLeadsWorkspaceClient.tsx'), /await deleteLead\(leadId\)/)
})
