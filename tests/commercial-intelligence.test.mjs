import assert from 'node:assert/strict'
import test from 'node:test'

import {
  generateProfileFromEvidence,
  hasSufficientResearchEvidence,
} from '../lib/commercial-intelligence/commercial-profile-core.ts'
import { extractWebsiteSnapshot } from '../lib/commercial-intelligence/extract-website-snapshot.ts'
import {
  safeFetchWebsite,
  WebsiteFetchError,
} from '../lib/commercial-intelligence/safe-website-fetch.ts'

const PUBLIC_RESOLVER = async () => ['93.184.216.34']

function htmlResponse(html, init = {}) {
  return new Response(html, {
    status: init.status || 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      ...(init.headers || {}),
    },
  })
}

function snapshotWithText(text) {
  return {
    title: 'Example Co',
    meta_description: null,
    h1: 'Example Co',
    body_excerpt: text,
    contact_url: null,
    about_url: null,
    services_url: null,
    visible_email: null,
    visible_phone: null,
    social_links: {},
    html_hash: 'test',
    extracted_at: new Date(0).toISOString(),
    research_pages: [{ kind: 'homepage', url: 'https://example.com/', text }],
    source_urls: ['https://example.com/'],
  }
}

const signals = {
  has_https: true,
  has_contact_page: true,
  has_about_page: true,
  has_services_page: true,
  has_pricing: false,
  has_testimonials: false,
  has_blog: false,
  has_faq: false,
  has_booking_link: false,
  has_social_links: false,
  has_visible_email: false,
  has_visible_phone: false,
  detected_at: new Date(0).toISOString(),
}

test('collects bounded readable content from homepage, about, services, and contact pages', async () => {
  const pages = new Map([
    [
      'https://example.com/',
      `<html><head><title>Example Co</title></head><body><nav>Ignore navigation</nav><main><h1>Industrial filtration systems</h1><p>Example Co designs filtration equipment for food manufacturers and laboratories.</p><a href="/about">About us</a><a href="/services">Services</a><a href="/contact">Contact</a></main></body></html>`,
    ],
    ['https://example.com/about', '<main>Founded by engineers, the company serves regulated production teams with application-specific advice.</main>'],
    ['https://example.com/services', '<main>Products include membrane filters, filter housings, validation support, and replacement components.</main>'],
    ['https://example.com/contact', '<main>Contact the technical sales team for product selection and support.</main>'],
  ])

  const result = await extractWebsiteSnapshot('example.com', {
    fetchOptions: {
      resolveHostname: PUBLIC_RESOLVER,
      fetchImpl: async (url) => htmlResponse(pages.get(String(url)) || ''),
    },
  })

  assert.equal(result.ok, true)
  assert.equal(result.data?.research_pages?.length, 4)
  assert.deepEqual(result.data?.source_urls, [...pages.keys()])
  assert.doesNotMatch(result.data?.research_pages?.[0].text || '', /Ignore navigation/)
})

test('continues when optional About or Services pages are absent', async () => {
  const result = await extractWebsiteSnapshot('https://example.com', {
    fetchOptions: {
      resolveHostname: PUBLIC_RESOLVER,
      fetchImpl: async () =>
        htmlResponse('<main><h1>Neighborhood dental clinic</h1><p>Preventive and restorative dental care for adults and children.</p></main>'),
    },
  })

  assert.equal(result.ok, true)
  assert.deepEqual(result.data?.research_pages?.map((page) => page.kind), ['homepage'])
})

test('returns an explicit failure for an inaccessible website', async () => {
  const result = await extractWebsiteSnapshot('https://example.com', {
    fetchOptions: {
      resolveHostname: PUBLIC_RESOLVER,
      fetchImpl: async () => {
        throw new Error('connection refused')
      },
    },
  })

  assert.equal(result.ok, false)
  assert.equal(result.error?.code, 'FETCH_FAILED')
})

test('rejects unsafe initial URLs and unsafe redirect targets', async () => {
  await assert.rejects(
    () => safeFetchWebsite('http://127.0.0.1/admin'),
    (error) => error instanceof WebsiteFetchError && error.code === 'UNSAFE_URL'
  )

  await assert.rejects(
    () =>
      safeFetchWebsite('https://example.com', {
        resolveHostname: async (hostname) =>
          hostname === 'example.com' ? ['93.184.216.34'] : ['169.254.169.254'],
        fetchImpl: async () =>
          new Response(null, {
            status: 302,
            headers: { location: 'http://metadata.internal/latest' },
          }),
      }),
    (error) => error instanceof WebsiteFetchError && error.code === 'UNSAFE_URL'
  )
})

test('rejects oversized and non-HTML responses', async () => {
  await assert.rejects(
    () =>
      safeFetchWebsite('https://example.com', {
        resolveHostname: PUBLIC_RESOLVER,
        maxBytes: 10,
        fetchImpl: async () => htmlResponse('This response is longer than ten bytes'),
      }),
    (error) => error instanceof WebsiteFetchError && error.code === 'RESPONSE_TOO_LARGE'
  )

  await assert.rejects(
    () =>
      safeFetchWebsite('https://example.com/file.pdf', {
        resolveHostname: PUBLIC_RESOLVER,
        fetchImpl: async () =>
          new Response('pdf', { headers: { 'content-type': 'application/pdf' } }),
      }),
    (error) => error instanceof WebsiteFetchError && error.code === 'INVALID_CONTENT_TYPE'
  )
})

test('does not call AI when website evidence is insufficient', async () => {
  const snapshot = snapshotWithText('A business website.')
  let called = false
  const result = await generateProfileFromEvidence('https://example.com', snapshot, signals, async () => {
    called = true
    return { content: '{}' }
  })

  assert.equal(hasSufficientResearchEvidence(snapshot), false)
  assert.equal(called, false)
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'INSUFFICIENT_INFORMATION')
})

test('accepts a factual mocked AI profile with a 50-80 word synopsis', async () => {
  const evidence = 'Example Co designs and manufactures industrial filtration systems for food producers, laboratories, and regulated manufacturing teams. Its website describes membrane filters, sanitary filter housings, replacement components, system validation support, technical product selection, and maintenance guidance. The company works with production and quality teams that need application-specific filtration equipment and documented support for controlled processes.'
  const summary = 'Example Co designs and manufactures industrial filtration systems for food producers, laboratories, and regulated manufacturing teams. Its products include membrane filters, sanitary filter housings, and replacement components. The company also provides system validation support, technical product selection, and maintenance guidance for production and quality teams operating controlled processes.'
  const result = await generateProfileFromEvidence(
    'https://example.com',
    snapshotWithText(evidence),
    signals,
    async () => ({
      content: JSON.stringify({
        summary,
        industry: 'Industrial filtration',
        business_category: 'Manufacturer',
        primary_service: 'Filtration systems',
        core_services: ['Membrane filters', 'Validation support'],
        target_customer: 'Food producers, laboratories, and regulated manufacturers',
        competitive_advantage: '',
        keywords: ['filtration', 'membrane filters'],
      }),
      inputTokens: 200,
      outputTokens: 100,
    })
  )

  assert.equal(result.ok, true)
  assert.equal(result.data?.summary, summary)
})

test('rejects invalid or undersized mocked AI responses', async () => {
  const evidence = 'A sufficiently detailed business description '.repeat(20)
  const invalidJson = await generateProfileFromEvidence(
    'https://example.com',
    snapshotWithText(evidence),
    signals,
    async () => ({ content: 'not json' })
  )
  const shortSummary = await generateProfileFromEvidence(
    'https://example.com',
    snapshotWithText(evidence),
    signals,
    async () => ({ content: JSON.stringify({ summary: 'Too short.' }) })
  )

  assert.equal(invalidJson.ok, false)
  assert.equal(invalidJson.error.code, 'INVALID_RESPONSE')
  assert.equal(shortSummary.ok, false)
  assert.equal(shortSummary.error.code, 'INVALID_RESPONSE')
})
