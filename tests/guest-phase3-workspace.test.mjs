import fs from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'

import { guestDossierModel, hostOf, memberDossierModel, safeHttpUrl } from '../lib/my-leads/dossier-model.ts'
import { describeGuestRange, filterAndSortGuest, GUEST_DEFAULT_FILTERS, guestWebsiteState, hasGuestFilters, summarizeGuest, toGuestListItem } from '../lib/guest/workspace.ts'

const read = (file) => fs.readFileSync(file, 'utf8')
const facts = (over = {}) => ({ title: 'Clinique Laval', description: 'Family dental care in Laval since 1998.', headings: ['Teeth whitening', 'Implants'], source_urls: ['https://cliniquelaval.ca/'], ...over })
const lead = (over = {}) => ({
  id: 'a', company_name: 'Clinique Laval', city: 'Laval', industry: 'Dentist', email: 'info@cliniquelaval.ca', phone: '+1 450 555 0100', website: 'https://cliniquelaval.ca',
  email_confidence: 'high', is_generic_email: false, website_intelligence: facts(), created_at: '2026-10-13T00:00:00Z', ...over,
})

// ---- WHO / WHAT / HOW TO REACH, and never inventing

test('a complete business reads as who they are, what they do and how to reach them, from the website\'s own words', () => {
  const m = guestDossierModel(lead())
  assert.equal(m.name, 'Clinique Laval')
  assert.deepEqual(m.who, ['Dentist · Laval', 'cliniquelaval.ca'])
  assert.equal(m.what.ai, null, 'a guest has no AI summary, and none is invented')
  assert.equal(m.what.site.text, 'Family dental care in Laval since 1998.')
  assert.deepEqual(m.what.site.topics, ['Teeth whitening', 'Implants'])
  assert.match(m.what.site.caveat, /not independently confirmed/)
  assert.deepEqual([m.contact.email, m.contact.phone, m.contact.website], ['info@cliniquelaval.ca', '+1 450 555 0100', 'https://cliniquelaval.ca/'])
  assert.deepEqual(m.contact.missing, [])
  assert.deepEqual(m.what.site.sources, [{ label: 'cliniquelaval.ca', url: 'https://cliniquelaval.ca/' }])
})

test('missing contact details are named as missing, never guessed', () => {
  const m = guestDossierModel(lead({ email: null, phone: null, website: null, website_intelligence: null }))
  assert.equal(m.contact.email, null); assert.equal(m.contact.phone, null); assert.equal(m.contact.website, null)
  assert.equal(m.contact.missing.length, 3)
  assert.match(m.contact.missing.join(' '), /No email address was published/)
  assert.match(m.contact.missing.join(' '), /No phone number was found/)
  assert.match(m.contact.missing.join(' '), /No website was found/)
})

test('an unreadable website is reported as such, for both the email and the description', () => {
  const m = guestDossierModel(lead({ email: null, website_intelligence: null, email_inspection: { state: 'unreadable' } }))
  assert.match(m.contact.missing.join(' '), /the website could not be read/)
  assert.match(m.what.empty, /could not be read/)
})

test('incomplete website intelligence: only what exists is shown; a title is shown only when there is no description', () => {
  assert.equal(guestDossierModel(lead({ website_intelligence: facts({ description: null }) })).what.site.titleLine, 'Clinique Laval')
  assert.equal(guestDossierModel(lead()).what.site.titleLine, null)
  const bare = guestDossierModel(lead({ website_intelligence: facts({ title: null, description: null, headings: [] }) }))
  assert.equal(bare.what.site, null)
  assert.equal(bare.what.empty, 'No descriptive text was found on the pages ALPA read.')
  assert.equal(guestDossierModel(lead({ website_intelligence: null })).what.empty, 'ALPA could not read a description for this business.')
  assert.match(guestDossierModel(lead({ website: null, website_intelligence: null })).what.empty, /no website listed/)
  assert.match(guestDossierModel(lead({ website_intelligence: facts(), email_inspection: { state: 'checked', partial: true } })).what.site.caveat, /Some website pages could not be read/)
})

test('nothing is invented: a model contains no field that is not in the business or its website facts', () => {
  const m = guestDossierModel(lead({ industry: null, city: null }))
  assert.equal(m.who[0], 'Industry and location were not provided')
  assert.equal(m.what.ai, null)
  assert.equal(guestDossierModel(lead({ email_confidence: 'low' })).contact.emailNote, 'Possible address.')
  assert.equal(guestDossierModel(lead({ is_generic_email: true })).contact.emailNote, 'Shared business inbox.')
})

test('only web addresses a person can safely open are linked', () => {
  assert.equal(safeHttpUrl('javascript:alert(1)'), null)
  assert.equal(safeHttpUrl('data:text/html,x'), null)
  assert.equal(safeHttpUrl('https://a.ca/x'), 'https://a.ca/x')
  assert.equal(guestDossierModel(lead({ website: 'javascript:alert(1)' })).contact.website, null)
  assert.deepEqual(guestDossierModel(lead({ website_intelligence: facts({ source_urls: ['javascript:alert(1)', 'https://ok.ca/'] }) })).what.site.sources.map((s) => s.url), ['https://ok.ca/'])
  assert.equal(hostOf('https://www.a.ca/page'), 'a.ca'); assert.equal(hostOf(null), null); assert.equal(hostOf('not a url at all'), 'not a url at all'.length ? hostOf('not a url at all') : null)
})

test('the member model keeps its stored profile: summary, services, audience, status wording, contact', () => {
  const dossier = {
    website: null, id: 'm', company_name: 'Acme', industry: 'Plumbing', city: 'Laval', archived: false, status: null, pipeline_stage: null, notes: null, created_at: null, last_activity_at: null, source: null,
    contact: { name: 'Jo', email: 'jo@acme.ca', email_source: null, email_confidence: 'low', is_generic_email: false, phone: null, website: 'https://acme.ca', source_url: null },
    intelligence: { state: 'ready', label: 'Profile ready', reason: null, researched_at: null, card: { summary: 'Plumbing for homes.', services: [], audience: null, facts: { signals: [], pagesRead: [], sources: [] }, limitations: [] },
      profile: { industry: 'Plumbing', business_category: 'Home services', primary_service: null, core_services: ['Repairs'], target_customer: 'Homeowners', keywords: ['pipes'] } },
  }
  const m = memberDossierModel(dossier)
  assert.equal(m.what.ai.text, 'Plumbing for homes.')
  assert.deepEqual(m.what.ai.offers, ['Repairs']); assert.equal(m.what.ai.serves, 'Homeowners'); assert.equal(m.what.site, null)
  assert.equal(m.contact.emailNote, 'Lower-confidence address.'); assert.equal(m.contact.name, 'Jo')
  assert.deepEqual(m.who, ['Plumbing · Home services · Laval', 'acme.ca'])
  const waiting = memberDossierModel({ ...dossier, intelligence: { ...dossier.intelligence, state: 'queued', card: null, profile: null } })
  assert.equal(waiting.what.ai, null); assert.match(waiting.what.empty, /Queued for research/)
  assert.deepEqual(memberDossierModel({ ...dossier, contact: { ...dossier.contact, email: null, website: null } }).contact.missing, ['No contact details were found for this business.'])
})

// ---- local search, filter, sort, counts

const trio = [
  lead({ id: '1', company_name: 'Zeta Dental', city: 'Montreal', industry: 'Dentist', phone: null }),
  lead({ id: '2', company_name: 'Alpha Smiles', city: 'Laval', industry: 'Dentist', email: null, website_intelligence: facts({ description: 'Orthodontics for teens.', headings: ['Braces'] }) }),
  lead({ id: '3', company_name: 'Mid Clinic', city: 'Brossard', industry: 'Physiotherapy', website: null, website_intelligence: null }),
]
const ids = (filters) => filterAndSortGuest(trio, { ...GUEST_DEFAULT_FILTERS, ...filters }).map((l) => l.id)

test('the discovery order is kept by default, and names and places sort alphabetically', () => {
  assert.deepEqual(ids({}), ['1', '2', '3'])
  assert.deepEqual(ids({ sort: 'name' }), ['2', '3', '1'])
  assert.deepEqual(ids({ sort: 'location' }), ['3', '2', '1'])
})

test('search matches name, industry, city, website and what the website says, every word required', () => {
  assert.deepEqual(ids({ q: 'dental' }), ['1'])
  assert.deepEqual(ids({ q: 'physiotherapy' }), ['3'])
  assert.deepEqual(ids({ q: 'orthodontics' }), ['2'])
  assert.deepEqual(ids({ q: 'braces' }), ['2'])
  assert.deepEqual(ids({ q: 'dentist laval' }), ['1', '2'], 'the description of the first mentions Laval')
  assert.deepEqual(ids({ q: 'dentist montreal' }), ['1'])
  assert.deepEqual(ids({ q: 'dentist nowhere' }), [])
  assert.deepEqual(ids({ q: '  ' }), ['1', '2', '3'])
  assert.deepEqual(ids({ q: 'cliniquelaval.ca' }), ['1', '2'])
})

test('city, industry and contact filters combine; "has" requires the detail', () => {
  assert.deepEqual(ids({ city: 'lav' }), ['2'])
  assert.deepEqual(ids({ industry: 'dent' }), ['1', '2'])
  assert.deepEqual(ids({ contact: ['email'] }), ['1', '3'])
  assert.deepEqual(ids({ contact: ['phone'] }), ['2', '3'])
  assert.deepEqual(ids({ contact: ['email', 'phone', 'website'] }), [])
  assert.deepEqual(ids({ industry: 'dentist', contact: ['website'], sort: 'name' }), ['2', '1'])
  assert.equal(hasGuestFilters(GUEST_DEFAULT_FILTERS), false)
  assert.equal(hasGuestFilters({ ...GUEST_DEFAULT_FILTERS, contact: ['email'] }), true)
})

test('overview counts and the range text', () => {
  assert.deepEqual(summarizeGuest(trio), { total: 3, withEmail: 2, withPhone: 2, withWebsite: 2 })
  assert.equal(describeGuestRange(3, 3), '3 businesses'); assert.equal(describeGuestRange(1, 1), '1 business')
  assert.equal(describeGuestRange(2, 25), '2 of 25 businesses'); assert.equal(describeGuestRange(0, 0), 'No businesses')
})

test('a guest row is a member row: same shape, honest website status, nothing about saved profiles', () => {
  const row = toGuestListItem(trio[1])
  assert.deepEqual(row.has, { email: false, phone: true, website: true })
  assert.equal(row.archived, false); assert.equal(row.last_activity_at, null)
  assert.equal(row.intelligence.preview, 'Orthodontics for teens.')
  assert.deepEqual(guestWebsiteState(trio[0]), { label: 'Website read', tone: 'ready' })
  assert.deepEqual(guestWebsiteState(trio[2]), { label: 'No website', tone: 'quiet' })
  assert.deepEqual(guestWebsiteState(lead({ website_intelligence: null })), { label: 'Nothing to read', tone: 'quiet' })
})

// ---- one shared presentation layer, no second results interface

test('guests and members render the same row, dossier and filter components', () => {
  const guest = read('components/guest/GuestWorkspace.tsx')
  for (const shared of ['LeadRow', 'DossierView', 'CommandBar', 'MetricStrip']) assert.match(guest, new RegExp(`from '@/components/my-leads/${shared}'`))
  assert.match(read('components/my-leads/LeadDossier.tsx'), /<DossierView model=\{memberDossierModel\(lead\)\}/)
  assert.match(read('components/my-leads/OverviewStrip.tsx'), /<MetricStrip metrics=\{metrics\}/)
  // no second results interface: the old guest list is gone
  assert.equal(fs.existsSync('components/guest/GuestResults.tsx'), false)
  assert.doesNotMatch(guest, /<article|<details|<summary/)
})

test('the guest workspace keeps its promises: no email, no account to see everything, no paid work, no member data access', () => {
  const guest = read('components/guest/GuestWorkspace.tsx')
  assert.doesNotMatch(guest, /type="email"|type="checkbox"|marketing|supabase|createClient|\/api\/my-leads|openai|enrich/i)
  assert.match(guest, /fetch\('\/api\/guest\/session'/)
  assert.match(guest, /href="\/api\/guest\/export"/)
  assert.match(guest, /Your businesses are ready\./)
  assert.match(guest, /href="\/login\?mode=signup"/)
  const shared = ['components/my-leads/DossierView.tsx', 'lib/my-leads/dossier-model.ts', 'lib/guest/workspace.ts', 'components/ui/BottomSheet.tsx'].map(read).join('\n')
  assert.doesNotMatch(shared, /fetch\(|openai|supabase|process\.env/i)
})

test('the phone presentation is an accessible bottom sheet; the desktop one stays inline', () => {
  const sheet = read('components/ui/BottomSheet.tsx')
  assert.match(sheet, /role="dialog"/); assert.match(sheet, /aria-modal="true"/); assert.match(sheet, /aria-labelledby="sheet-title"/)
  assert.match(sheet, /event\.key === 'Escape'/); assert.match(sheet, /event\.key !== 'Tab'/)
  assert.match(sheet, /document\.body\.style\.overflow = 'hidden'/); assert.match(sheet, /opener\?\.focus/)
  assert.match(sheet, /max-h-\[92dvh\]/); assert.match(sheet, /env\(safe-area-inset-bottom\)/)
  const guest = read('components/guest/GuestWorkspace.tsx')
  assert.match(guest, /useMediaQuery\('\(max-width: 767px\)'\)/)
  assert.match(guest, /if \(phone\) setSheetId\(lead\.id\)/)
  assert.match(guest, /hasPanel=\{!phone\}/)
})

test('mobile comfort: 44px controls and 16px fields on a phone, in the shared components', () => {
  const bar = read('components/my-leads/CommandBar.tsx')
  assert.match(bar, /h-11 [^']*text-base[^']*sm:h-9 sm:text-sm/)
  const view = read('components/my-leads/DossierView.tsx')
  assert.match(view, /min-h-\[44px\]/); assert.match(view, /h-11 w-11/)
  assert.match(view, /href=\{`tel:\$\{contact\.phone\.replace/); assert.match(view, /href=\{`mailto:\$\{contact\.email\}`\}/)
})

test('the member workspace is unchanged in behaviour: same endpoints, same actions, view tabs and intelligence filter on by default', () => {
  const bar = read('components/my-leads/CommandBar.tsx')
  assert.match(bar, /showViews = true/); assert.match(bar, /showIntelligence = true/); assert.match(bar, /sortKeys = SORT_KEYS/)
  const workspace = read('components/my-leads/MyLeadsWorkspace.tsx')
  assert.match(workspace, /<CommandBar filters=\{filters\} archivedCount=\{summary \? summary\.archived : null\} onChange=\{change\}/)
  assert.doesNotMatch(workspace, /selectable=\{false\}|showPreview|hasPanel=/, 'the member rows use the defaults')
})
