import fs from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'

import { fetchLeadDossier, fetchLeadsForExport, LIST_COLUMNS } from '../lib/my-leads/list.ts'
import { buildStoredWebsiteFacts } from '../lib/leads/stored-website-facts.ts'
import { buildLeadCsv } from '../lib/leads/csv.ts'
import { createFakeClient } from './helpers/fake-postgrest.mjs'

const read = (file) => fs.readFileSync(file, 'utf8')
const OWNER = '35d2cccf-1de5-48d4-b61a-68de1db94432'
const OTHER = '99999999-1111-4222-8333-444444444444'
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const facts = buildStoredWebsiteFacts({ website_intelligence: { title: 'Clinique Laval', description: 'Family dental care in Laval.', headings: ['Implants'], source_urls: ['https://cl.ca/'] }, email_inspection: { state: 'checked', partial: true } }, new Date('2026-10-13T00:00:00Z'))
const row = (n, over = {}) => ({ id: uuid(n), user_id: OWNER, company_name: `Imported ${n}`, industry: 'Dentist', city: 'Laval', email: `a${n}@cl.ca`, phone: null, website: 'https://cl.ca', status: 'inbox', pipeline_stage: null, closed_at: null, created_at: '2026-10-13T00:00:00Z', last_activity_at: null, commercial_profile: null, website_snapshot: null, business_signals: null, website_facts: facts, ...over })
const client = (rows) => createFakeClient({ leads: rows, commercial_intelligence_queue: [] })

test('the dossier of an imported business carries its website facts, apart from the (absent) AI profile', async () => {
  const dossier = await fetchLeadDossier(client([row(1)]), OWNER, uuid(1))
  assert.equal(dossier.website.title, 'Clinique Laval'); assert.equal(dossier.website.description, 'Family dental care in Laval.')
  assert.deepEqual(dossier.website.headings, ['Implants']); assert.deepEqual(dossier.website.source_urls, ['https://cl.ca/'])
  assert.deepEqual(dossier.website.inspection, { state: 'checked', partial: true })
  assert.equal(dossier.intelligence.card, null, 'no AI profile is generated or implied')
  assert.equal(dossier.intelligence.state, 'not_started')
})

test('a business without kept facts, and a tampered value, both read as "no website facts" and never break the dossier', async () => {
  const c = client([row(1, { website_facts: null }), row(2, { website_facts: 'not an object' }), row(3, { website_facts: { version: 9, origin: 'free_trial', title: 'x' } }), row(4, { website_facts: { version: 1, origin: 'free_trial', title: '<script>alert(1)</script>', source_urls: ['javascript:alert(1)'] } })])
  for (const n of [1, 2, 3]) assert.equal((await fetchLeadDossier(c, OWNER, uuid(n))).website, null, `business ${n}`)
  const odd = (await fetchLeadDossier(c, OWNER, uuid(4))).website
  assert.equal(odd.title, '<script>alert(1)</script>', 'kept as plain text (it is rendered as text, never as markup)')
  assert.deepEqual(odd.source_urls, [])
})

test('facts are owner-only like the rest of the business, and are not part of the list payload', async () => {
  const c = client([row(1)])
  assert.equal(await fetchLeadDossier(c, OTHER, uuid(1)), null)
  assert.doesNotMatch(LIST_COLUMNS, /website_facts/)
  assert.match(read('lib/my-leads/list.ts'), /DOSSIER_COLUMNS =[\s\S]*website_facts/)
})

test('a CSV export of imported businesses includes their website title, description and topics', async () => {
  const rows = await fetchLeadsForExport(client([row(1), row(2, { website_facts: null })]), OWNER, [uuid(1), uuid(2)])
  assert.deepEqual(rows[0].website_intelligence, { title: 'Clinique Laval', description: 'Family dental care in Laval.', headings: ['Implants'], source_urls: ['https://cl.ca/'] })
  assert.equal(rows[1].website_intelligence, null)
  assert.equal('website_facts' in rows[0], false, 'the raw stored value is not exposed')
  const csv = buildLeadCsv(rows)
  assert.match(csv, /Family dental care in Laval\./); assert.match(csv, /Clinique Laval/); assert.match(csv, /Implants/)
})

test('the migration is additive, nullable and nothing else, and is proposed, not applied', () => {
  const sql = read('supabase/proposed/20261017_leads_website_facts.sql').replace(/--.*$/gm, '')
  const statements = sql.split(';').map((statement) => statement.replace(/\s+/g, ' ').trim()).filter((statement) => statement && !/^(BEGIN|COMMIT)$/i.test(statement))
  assert.deepEqual(statements, ['ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS website_facts jsonb', "COMMENT ON COLUMN public.leads.website_facts IS 'The business''s own website words (title, description, headings, sources) read by rules during a free-trial search. Not AI-written. Shape: lib/leads/stored-website-facts.ts.'"])
  assert.doesNotMatch(sql, /DEFAULT|NOT NULL|DROP|UPDATE|DELETE|CREATE (INDEX|POLICY|FUNCTION)|GRANT|REVOKE/i)
  assert.equal(fs.existsSync('supabase/migrations/20261017_leads_website_facts.sql'), false, 'not in the push path')
  assert.equal(fs.existsSync('supabase/applied-records/20261017_leads_website_facts.sql'), false, 'not recorded as applied')
})

test('the claim sends nothing from the browser, needs nothing the browser kept, and touches no billing or AI code', () => {
  const route = read('app/api/guest/claim/route.ts')
  assert.doesNotMatch(route, /req\.json|body\./, 'the browser supplies nothing')
  assert.doesNotMatch(route, /stripe|checkout|openai|enrichLead|enqueueLeadEnrichment|commercial_profile|website_snapshot|business_signals/i)
  assert.match(route, /rpc\('claim_guest_businesses'/)
  const sql = read('supabase/proposed/20261019_guest_import_lifetime_quota.sql')
  assert.match(sql, /business_allowance_ledger/); assert.match(sql, /v_free AND v_used>=25/); assert.match(sql, /pg_advisory_xact_lock/)
  const login = read('app/login/page.tsx')
  assert.doesNotMatch(login, /getGuestLeads/)
  assert.match(login, /await finishGuestHandOver\(\)/)
  assert.match(read('lib/guest/claim-client.ts'), /fetch\('\/api\/guest\/claim', \{ method: 'POST'/)
  assert.doesNotMatch(login.slice(login.indexOf('async function claimGuestTrialIfNeeded'), login.indexOf('async function handleAuth')), /guestLeads/)
})

test('the member dossier says which words are the website\'s and which are the AI\'s', () => {
  const view = read('components/my-leads/DossierView.tsx')
  assert.match(view, />AI summary</); assert.match(view, /Written by AI from their website\. Not independently verified\./)
  assert.match(view, /From their website/)
  const model = read('lib/my-leads/dossier-model.ts')
  assert.match(model, /aiNote: !card && site \? stateText : null/)
  assert.doesNotMatch(read('lib/leads/stored-website-facts.ts'), /openai|fetch\(|process\.env/i)
})
