// Email Intelligence V2: pure extraction, classification and page-planning logic.
//
// Nothing here touches the network. It turns HTML into ranked email candidates and decides
// which extra pages are worth fetching. The orchestration lives in email-enrichment.ts.
//
// Principles:
//  - More addresses is not a better result. Placeholders, tracking/technical addresses,
//    no-reply addresses and image file names are rejected outright.
//  - Confidence never claims an address is verified or deliverable. It only says how likely the
//    address is to be the business's own published contact.
//  - Matched business-domain addresses keep exactly the V1 confidence (high personal,
//    medium role-based), so existing "strong signal" accounting is never demoted.
//  - Confidence stays in the existing 'high' | 'medium' | 'low' vocabulary for compatibility.

import * as cheerio from 'cheerio'

import {
  domainsClearlyMatch,
  getWebsiteHost,
  hostsClearlyRelated,
  isBlockedWebsiteHost,
  type EmailConfidence,
  type EmailValidationResult,
} from '../validation.ts'

// ---------------------------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------------------------

export type EmailEvidence = 'mailto' | 'cloudflare' | 'jsonld' | 'microdata' | 'obfuscated' | 'text'

export type EmailRelevance =
  | 'business-domain' // same site or a subdomain of it
  | 'associated' // same brand label on another TLD (acme.com site, info@acme.ca)
  | 'declared' // the page's own structured data names it, on an unrelated domain
  | 'external-provider' // gmail, outlook and other legitimate mailbox providers
  | 'unrelated' // some other organisation's address

export type EmailCandidateV2 = EmailValidationResult & {
  evidence: EmailEvidence
  relevance: EmailRelevance
}

export type ExtractInput = {
  html: string
  pageUrl: string
  websiteHost: string
}

// ---------------------------------------------------------------------------------------------
// Rejection lists
// ---------------------------------------------------------------------------------------------

const EMAIL_PATTERN = /[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/gi

const FREE_MAIL_PROVIDERS = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'outlook.fr', 'outlook.ca', 'hotmail.com', 'hotmail.ca',
  'hotmail.fr', 'hotmail.co.uk', 'live.com', 'live.ca', 'live.fr', 'msn.com', 'yahoo.com', 'yahoo.ca',
  'yahoo.fr', 'yahoo.co.uk', 'ymail.com', 'icloud.com', 'me.com', 'mac.com', 'aol.com', 'proton.me',
  'protonmail.com', 'pm.me', 'gmx.com', 'gmx.de', 'gmx.net', 'web.de', 't-online.de', 'mail.com',
  'zoho.com', 'yandex.com', 'videotron.ca', 'videotron.com', 'bell.net', 'sympatico.ca', 'shaw.ca',
  'rogers.com', 'telus.net', 'cogeco.ca', 'sasktel.net', 'orange.fr', 'wanadoo.fr', 'free.fr', 'sfr.fr',
  'laposte.net', 'libero.it', 'tiscali.it', 'virgilio.it', 'terra.com.br', 'uol.com.br', 'bol.com.br',
  'btinternet.com', 'sky.com', 'comcast.net', 'att.net', 'verizon.net',
])

const PLACEHOLDER_DOMAINS = new Set([
  'example.com', 'example.org', 'example.net', 'domain.com', 'yourdomain.com', 'yoursite.com',
  'yourwebsite.com', 'yourcompany.com', 'company.com', 'mydomain.com', 'mysite.com', 'email.com',
  'test.com', 'sample.com', 'website.com', 'site.com', 'domain.tld', 'tonsite.com', 'votresite.com',
  'ejemplo.com', 'beispiel.de',
])

// Services whose addresses appear in page source but never belong to the business.
const TECHNICAL_DOMAINS = [
  'sentry.io', 'sentry-next.wixpress.com', 'wixpress.com', 'schema.org', 'w3.org', 'googleapis.com',
  'gstatic.com', 'cloudflare.com', 'mailchimp.com', 'list-manage.com', 'mandrillapp.com',
  'sendgrid.net', 'amazonses.com', 'hubspot.com', 'hs-sites.com', 'gravatar.com', 'wordpress.com',
  'wp.com', 'squarespace.com', 'godaddy.com', 'shopify.com', 'myshopify.com', 'facebook.com',
  'instagram.com', 'linkedin.com', 'twitter.com', 'google.com', 'apple.com', 'microsoft.com',
]

const FILE_EXTENSION_TLDS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'avif', 'ico', 'bmp', 'css', 'js', 'mjs', 'json', 'map',
  'woff', 'woff2', 'ttf', 'eot', 'otf', 'pdf', 'zip', 'mp4', 'mp3', 'webm', 'html', 'php', 'xml',
])

const NO_REPLY_LOCALS = new Set([
  'noreply', 'no-reply', 'no_reply', 'donotreply', 'do-not-reply', 'do_not_reply', 'donotrespond',
  'do-not-respond', 'mailer-daemon', 'bounce', 'bounces', 'unsubscribe', 'postmaster', 'abuse',
  'dmarc', 'hostmaster',
])

const PLACEHOLDER_LOCALS = new Set([
  'your', 'youremail', 'yourname', 'your.name', 'your-email', 'yourmail', 'your.email', 'username',
  'user.name', 'firstname', 'firstname.lastname', 'first.last', 'name', 'nom', 'votrenom',
  'votre.nom', 'votreemail', 'tuemail', 'jane.doe', 'john.doe', 'johndoe', 'janedoe',
])

// Same V1 role-based list on purpose: changing it would demote existing 'high' results.
const GENERIC_LOCALS = new Set(['info', 'contact', 'hello', 'admin', 'support', 'sales', 'office'])

const GENERIC_BRAND_LABELS = new Set([
  'dental', 'clinic', 'clinique', 'plumbing', 'services', 'service', 'group', 'canada', 'quebec',
  'montreal', 'solutions', 'studio', 'online', 'media', 'design', 'health', 'repair', 'cleaning',
  'electric', 'roofing', 'legal', 'realty', 'travel', 'fitness',
])

// ---------------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------------

function normalizeHostName(host: string) {
  return host.trim().toLowerCase().replace(/^www\./, '')
}

function localPartOf(email: string) {
  return email.split('@')[0]?.split('+')[0] || ''
}

function domainOf(email: string) {
  return email.split('@')[1] || ''
}

// Two-letter country codes are always accepted. Longer top-level domains must be recognised: a
// glued run of page text ("x@acme.combook") ends in something that is not a real domain suffix.
const KNOWN_TLDS = new Set(
  (
    'com net org edu gov mil int info biz name pro mobi asia tel travel jobs museum coop aero cat xxx post ' +
    'app dev page online site shop store tech agency marketing digital media design studio dental clinic ' +
    'health healthcare medical doctor dentist care surgery law legal lawyer attorney plumbing repair ' +
    'services service solutions company business consulting center centre works expert guru ninja email ' +
    'network group team zone world today life live cloud space website web blog news press academy ' +
    'education school college university training institute church community foundation charity ngo ong ' +
    'gmbh ltd inc llc llp restaurant cafe bar pub pizza kitchen food wine beer coffee fitness yoga hotel ' +
    'house homes properties realty estate rentals land city london paris berlin nyc miami vegas quebec ' +
    'wales scot swiss casa cool club fun fashion style beauty salon tattoo photo photos photography ' +
    'gallery art video movie music events party gifts flowers jewelry shoes clothing furniture tools ' +
    'cars car auto motorcycles bike taxi tours holiday flights cruises insurance finance financial bank ' +
    'money tax accountant accountants capital fund exchange market trade deals discount sale software ' +
    'systems technology computer hosting domains global international link click one xyz top icu vip ' +
    'red blue pink green black gold plus pet vet dog cab bio eco green energy solar construction ' +
    'contractors engineering builders build supply supplies equipment industries limited partners ' +
    'ventures holdings management directory guide rocks wiki works wtf tips tools tires toys ' +
    'bargains boutique brussels bzh paris scot work digital direct support wedding studio salon spa ' +
    'sport sports golf ski surf football fit fitness bike run racing yachts boats fishing hunting'
  ).split(' ')
)

function hasKnownTld(domain: string) {
  const tld = domain.split('.').pop() || ''
  return tld.length === 2 || KNOWN_TLDS.has(tld)
}

function isValidEmailShape(email: string) {
  if (email.length < 6 || email.length > 254) return false
  const [local, domain, ...rest] = email.split('@')
  if (rest.length || !local || !domain || local.length > 64) return false
  if (!/^[a-z0-9._%+-]+$/.test(local) || local.startsWith('.') || local.endsWith('.')) return false
  if (email.includes('..')) return false
  const labels = domain.split('.')
  if (labels.length < 2) return false
  for (const label of labels) {
    if (!label || label.length > 63 || !/^[a-z0-9-]+$/.test(label)) return false
    if (label.startsWith('-') || label.endsWith('-')) return false
  }
  const tld = labels[labels.length - 1]
  return /^[a-z]{2,24}$/.test(tld) && hasKnownTld(domain)
}

export function normalizeCandidateEmail(raw: string): string | null {
  let value = raw.trim()
  if (/%[0-9a-f]{2}/i.test(value)) {
    try {
      value = decodeURIComponent(value)
    } catch {}
  }
  value = value
    .replace(/^mailto:/i, '')
    .replace(/^[("'`<\[\s]+/, '')
    .replace(/[),;:.>\]"'`\s]+$/g, '')
    .toLowerCase()

  return isValidEmailShape(value) ? value : null
}

/** True when the address is a placeholder, a technical/tracking address, a no-reply or a file name. */
export function isRejectedEmail(email: string): boolean {
  const local = localPartOf(email)
  const domain = normalizeHostName(domainOf(email))
  const tld = domain.split('.').pop() || ''

  if (FILE_EXTENSION_TLDS.has(tld)) return true
  if (NO_REPLY_LOCALS.has(local)) return true
  if (/^[0-9a-f]{24,}$/.test(local)) return true // hashes used by trackers
  if (/^\+?\d[\d.\-_]{5,}[a-z]/.test(local)) return true // a phone number glued onto the address
  if (PLACEHOLDER_DOMAINS.has(domain)) return true
  if (/\.(example|invalid|test|localhost)$/.test(domain)) return true
  if (TECHNICAL_DOMAINS.some((blocked) => domain === blocked || domain.endsWith(`.${blocked}`))) return true
  if (PLACEHOLDER_LOCALS.has(local) && (FREE_MAIL_PROVIDERS.has(domain) || PLACEHOLDER_DOMAINS.has(domain))) {
    return true
  }
  return false
}

function brandLabel(host: string): string | null {
  const parts = normalizeHostName(host).split('.')
  if (parts.length < 2) return null
  const tld = parts[parts.length - 1]
  const second = parts[parts.length - 2]
  const compound = tld.length === 2 && ['co', 'com', 'org', 'net', 'gov', 'ac', 'ne'].includes(second)
  const label = compound ? parts[parts.length - 3] : second
  return label || null
}

function sameBrand(websiteHost: string, emailDomain: string) {
  const left = brandLabel(websiteHost)
  const right = brandLabel(emailDomain)
  return Boolean(
    left && right && left === right && left.length >= 5 && !GENERIC_BRAND_LABELS.has(left)
  )
}

// ---------------------------------------------------------------------------------------------
// Decoders
// ---------------------------------------------------------------------------------------------

/** Decodes Cloudflare's email-protection hex string (first byte is the XOR key). */
export function decodeCloudflareEmail(encoded: string): string | null {
  const hex = encoded.trim()
  if (hex.length < 4 || hex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hex)) return null

  const key = parseInt(hex.slice(0, 2), 16)
  let output = ''
  for (let index = 2; index < hex.length; index += 2) {
    output += String.fromCharCode(parseInt(hex.slice(index, index + 2), 16) ^ key)
  }
  return output.includes('@') ? output : null
}

const OBFUSCATED_AT = /\s*[[({<]\s*(?:at|@|arobase|arroba)\s*[\])}>]\s*/gi
const OBFUSCATED_DOT = /\s*[[({<]\s*(?:dot|point|punto|ponto|punkt)\s*[\])}>]\s*/gi

/**
 * Rewrites bracketed "[at]" / "(dot)" markers. Bare words ("name at company dot com") are
 * deliberately NOT rewritten: ordinary prose would turn into false addresses.
 */
export function deobfuscateEmailText(text: string): string {
  return text.replace(OBFUSCATED_AT, '@').replace(OBFUSCATED_DOT, '.')
}

const ENCODED_VALUE = /^[A-Za-z0-9._%+\-[\]()]{3,254}$/
const BRACKETED_AT = /\[\s*at\s*\]/i

/**
 * Decodes the value WordPress email-encoder plugins write into `data-enc-email`, for example
 * "vasb[at]cebivfb.pn": the letters are ROT13 and "[at]" stands for "@". The page ships this for every
 * visitor and a browser decodes it on load, so reading it is reading what the site publishes.
 *
 * Deliberately strict: only the "[at]" form is decoded, only plain address characters are allowed, and a
 * value that already contains "@" is not touched. The result is only a candidate; whether it is trusted is
 * decided by the same validation and classification as every other address.
 */
export function decodeRot13Email(encoded: string): string | null {
  const value = encoded.trim()
  if (!ENCODED_VALUE.test(value) || value.includes('@')) return null
  if ((value.match(new RegExp(BRACKETED_AT.source, 'gi')) ?? []).length !== 1) return null // exactly one "[at]"

  const rot13 = (text: string) =>
    text.replace(/[a-z]/gi, (letter) => {
      const base = letter <= 'Z' ? 65 : 97
      return String.fromCharCode(((letter.charCodeAt(0) - base + 13) % 26) + base)
    })

  // The marker is written in the clear; only the address parts around it are ROT13.
  const decoded = rot13(value.replace(BRACKETED_AT, '@'))
  // Plain address characters only, something on both sides of the "@", and a dotted domain.
  return /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/.test(decoded) ? decoded : null
}

function splitMailtoRecipients(href: string): string[] {
  const body = href.replace(/^\s*mailto:/i, '').split('?')[0] || ''
  let decoded = body
  try {
    decoded = decodeURIComponent(body)
  } catch {}
  return decoded.split(/[,;]/).map((part) => part.trim()).filter(Boolean)
}

// ---------------------------------------------------------------------------------------------
// Structured data
// ---------------------------------------------------------------------------------------------

// schema.org only allows `email` on Organization, Person, Place and ContactPoint subtypes
// (bakeries, dentists, opticians, ...). Rather than list every business type, exclude the
// content types that can carry someone else's address.
const NON_BUSINESS_TYPE_PATTERN =
  /review|comment|article|posting|rating|product|offer|webpage|website|imageobject|question|answer|event|recipe|videoobject|listitem/i

const SKIPPED_JSONLD_KEYS = new Set([
  'author', 'creator', 'contributor', 'editor', 'translator', 'review', 'reviews', 'comment',
  'comments', 'aggregaterating', 'reviewbody', 'blogpost', 'article',
])

function typeText(node: Record<string, unknown>) {
  const value = node['@type']
  return Array.isArray(value) ? value.join(' ') : typeof value === 'string' ? value : ''
}

function collectJsonLdEmails(node: unknown, found: string[], depth = 0, budget = { nodes: 0 }) {
  if (depth > 8 || budget.nodes++ > 2_000 || node === null || typeof node !== 'object') return

  if (Array.isArray(node)) {
    node.forEach((item) => collectJsonLdEmails(item, found, depth + 1, budget))
    return
  }

  const record = node as Record<string, unknown>
  const type = typeText(record)

  if (type && !NON_BUSINESS_TYPE_PATTERN.test(type)) {
    const email = record.email
    for (const value of Array.isArray(email) ? email : [email]) {
      if (typeof value === 'string') found.push(value)
    }
  }

  for (const [key, value] of Object.entries(record)) {
    if (SKIPPED_JSONLD_KEYS.has(key.toLowerCase())) continue
    if (value && typeof value === 'object') collectJsonLdEmails(value, found, depth + 1, budget)
  }
}

function extractJsonLdEmails($: cheerio.CheerioAPI): string[] {
  const found: string[] = []

  $('script[type="application/ld+json"]').each((_, element) => {
    const raw = $(element).contents().text().trim()
    if (!raw || raw.length > 500_000) return
    try {
      collectJsonLdEmails(JSON.parse(raw.replace(/^\s*<!\[CDATA\[|\]\]>\s*$/g, '')), found)
    } catch {
      // malformed structured data is ignored, never guessed at
    }
  })

  return found
}

// ---------------------------------------------------------------------------------------------
// Candidate extraction
// ---------------------------------------------------------------------------------------------

const EVIDENCE_STRENGTH: Record<EmailEvidence, number> = {
  jsonld: 5,
  mailto: 4,
  cloudflare: 4,
  microdata: 3,
  obfuscated: 2,
  text: 1,
}

const STRONG_EVIDENCE = new Set<EmailEvidence>(['mailto', 'cloudflare', 'jsonld', 'microdata', 'obfuscated'])

// A label sitting directly in front of the address ("Courriel :", "Email us at"), not merely a
// "Contact" link somewhere earlier in the page.
const CONTACT_LABEL =
  /(?:e-?mail(?: us)?(?: at)?|courriel|correo|e-?post|mail to|write to us|écrivez-nous|ecrivez-nous|contact|kontakt|reach us at)\s*(?:address|adresse)?\s*[:：\-–—]?\s*$/i

// Addresses that sit in a website-credit line ("Site by Acme Agency") or inside a testimonial
// or review belong to someone other than the business, whatever domain they use.
const CREDIT_PHRASE =
  /(?:design(?:ed)?|develop(?:ed|ment)?|d[ée]velopp[\wéèê]*|con[çc]u|r[ée]alis[ée]|built|created|crafted|made|powered|hosted|maintained|managed|seo|marketing|web ?site|site)\s+(?:by|par|von|por|door)\s*$|\bcredits?\b\s*:?\s*$|agence web\s*:?\s*$|webdesign\s*:?\s*$/i
const THIRD_PARTY_TEXT = /\b(?:said|says|wrote|writes|reviewed|écrit|a écrit|dit)\b[^.]{0,60}$/i
const TESTIMONIAL_ATTRIBUTE = /testimon|review|comment|avis\b|rese[ñn]a|bewertung|t[ée]moignage/i

function inThirdPartyContext($: cheerio.CheerioAPI, element: Parameters<cheerio.CheerioAPI>[0]): boolean {
  const node = $(element)
  const ancestors = node.parents().slice(0, 8).toArray()
  for (const ancestor of ancestors) {
    const signature = `${$(ancestor).attr('class') || ''} ${$(ancestor).attr('id') || ''}`
    if ((ancestor as { tagName?: string }).tagName === 'blockquote' || TESTIMONIAL_ATTRIBUTE.test(signature)) return true
  }

  const parentText = node.parent().text().replace(/\s+/g, ' ')
  if (parentText.length > 240) return false // too large to say what the nearby words refer to
  const own = node.text().replace(/\s+/g, ' ').trim()
  const at = own ? parentText.indexOf(own) : -1
  const before = (at >= 0 ? parentText.slice(0, at) : parentText).slice(-50).trim()
  return CREDIT_PHRASE.test(before) || THIRD_PARTY_TEXT.test(before)
}

// Every tag boundary gets a leading space in the raw markup so neighbouring elements never fuse
// ("info@x.com" + "Call us" must not become "info@x.comCall", and a label such as "Email" next to
// the address must not become part of it: "emailhello@x.com"). One regex pass: linear in page
// size, unlike editing the parsed tree element by element. Addresses are not split by this
// because real ones come from mailto links, structured data or a single text run.
const TAG_START = /<(?=[a-z/!])/gi

function separateBlocks(html: string) {
  return html.replace(TAG_START, ' <')
}

function pathPriority(pageUrl: string): number {
  try {
    const path = new URL(pageUrl).pathname.toLowerCase()
    if (/contact|kontakt|contacto|contatt|contato|joindre/.test(path)) return 3
    if (/about|propos|ueber|uber-uns|nosotros|chi-siamo|impressum|mentions|privacy|confidential|datenschutz|privacidad|legal/.test(path)) {
      return 2
    }
    if (path === '/' || path === '') return 1
  } catch {}
  return 0
}

function classify(
  email: string,
  evidence: EmailEvidence,
  pageUrl: string,
  websiteHost: string,
  hasContext: boolean,
  thirdParty: boolean
): EmailCandidateV2 | null {
  if (isRejectedEmail(email)) return null

  const domain = normalizeHostName(domainOf(email))
  const generic = GENERIC_LOCALS.has(localPartOf(email))
  const domainMatch = domainsClearlyMatch(websiteHost, domain)

  let relevance: EmailRelevance
  let confidence: EmailConfidence

  if (domainMatch) {
    relevance = 'business-domain'
    confidence = generic ? 'medium' : 'high' // identical to V1
  } else if (sameBrand(websiteHost, domain)) {
    relevance = 'associated'
    confidence = 'medium'
  } else if (thirdParty) {
    relevance = 'unrelated'
    confidence = 'low'
  } else if (FREE_MAIL_PROVIDERS.has(domain)) {
    relevance = 'external-provider'
    const onContactPage = pathPriority(pageUrl) >= 3
    confidence = STRONG_EVIDENCE.has(evidence) || hasContext || onContactPage ? 'medium' : 'low'
  } else if (evidence === 'jsonld') {
    relevance = 'declared'
    confidence = 'medium'
  } else {
    relevance = 'unrelated'
    confidence = 'low'
  }

  return {
    value: email,
    emailSource: pageUrl,
    emailConfidence: confidence,
    isGenericEmail: generic,
    domainMatch,
    evidence,
    relevance,
  }
}

export function extractEmailCandidatesV2({ html, pageUrl, websiteHost }: ExtractInput): EmailCandidateV2[] {
  const $ = cheerio.load(separateBlocks(html))
  const raw: { email: string; evidence: EmailEvidence; context: boolean; thirdParty: boolean }[] = []

  const add = (value: string, evidence: EmailEvidence, context = false, thirdParty = false) => {
    const email = normalizeCandidateEmail(value)
    if (email) raw.push({ email, evidence, context, thirdParty })
  }

  // 1. Structured data (read before scripts are removed).
  extractJsonLdEmails($).forEach((value) => add(value, 'jsonld'))

  $('[itemprop="email"]').each((_, element) => {
    const scope = $(element).closest('[itemscope]')
    const itemType = scope.attr('itemtype') || ''
    if (!scope.length || !itemType || NON_BUSINESS_TYPE_PATTERN.test(itemType)) return
    const href = $(element).attr('href')
    const value = href?.toLowerCase().startsWith('mailto:')
      ? splitMailtoRecipients(href)[0]
      : $(element).attr('content') || $(element).text()
    if (value) add(value, 'microdata')
  })

  // 2. Cloudflare email protection (attribute form and the /cdn-cgi/ link form).
  $('[data-cfemail]').each((_, element) => {
    const decoded = decodeCloudflareEmail($(element).attr('data-cfemail') || '')
    if (decoded) add(decoded, 'cloudflare')
  })
  $('a[href*="/cdn-cgi/l/email-protection#"]').each((_, element) => {
    const hash = ($(element).attr('href') || '').split('#')[1] || ''
    const decoded = decodeCloudflareEmail(hash)
    if (decoded) add(decoded, 'cloudflare')
  })

  // 2b. ROT13-encoded address attributes (WordPress email-encoder plugins). The same third-party test
  // as a mailto link applies: an encoded address in a "Site by ..." credit is not the business's.
  $('[data-enc-email]').each((_, element) => {
    const decoded = decodeRot13Email($(element).attr('data-enc-email') || '')
    if (decoded) add(decoded, 'obfuscated', false, inThirdPartyContext($, element))
  })

  // 3. Drop everything that is not visible content.
  $('script, style, noscript, svg, iframe, template').remove()

  // 4. mailto links, including multiple recipients and encoded values.
  $('a[href]').each((_, element) => {
    const href = $(element).attr('href') || ''
    if (!/^\s*mailto:/i.test(href)) return
    const thirdParty = inThirdPartyContext($, element)
    splitMailtoRecipients(href).forEach((recipient) => add(recipient, 'mailto', false, thirdParty))
  })

  // 5. Visible text (block boundaries were separated before parsing).
  const text = $('body').length ? $('body').text() : $.root().text()

  const seenInPlainText = new Set<string>()
  for (const match of text.matchAll(EMAIL_PATTERN)) {
    const before = text.slice(Math.max(0, (match.index ?? 0) - 32), match.index ?? 0)
    const email = normalizeCandidateEmail(match[0])
    if (!email) continue
    seenInPlainText.add(email)
    const wider = text.slice(Math.max(0, (match.index ?? 0) - 60), match.index ?? 0).replace(/\s+/g, ' ').trim()
    raw.push({
      email, evidence: 'text', context: CONTACT_LABEL.test(before),
      thirdParty: CREDIT_PHRASE.test(wider) || THIRD_PARTY_TEXT.test(wider),
    })
  }

  if (OBFUSCATED_AT.test(text)) {
    OBFUSCATED_AT.lastIndex = 0
    for (const match of deobfuscateEmailText(text).matchAll(EMAIL_PATTERN)) {
      const email = normalizeCandidateEmail(match[0])
      if (email && !seenInPlainText.has(email)) raw.push({ email, evidence: 'obfuscated', context: true, thirdParty: false })
    }
  }
  OBFUSCATED_AT.lastIndex = 0

  // 6. Classify and keep the strongest sighting of each address.
  const best = new Map<string, EmailCandidateV2>()
  for (const item of raw) {
    const candidate = classify(item.email, item.evidence, pageUrl, websiteHost, item.context, item.thirdParty)
    if (!candidate) continue
    const previous = best.get(candidate.value)
    if (
      !previous ||
      rankConfidence(candidate.emailConfidence) > rankConfidence(previous.emailConfidence) ||
      (candidate.emailConfidence === previous.emailConfidence &&
        EVIDENCE_STRENGTH[candidate.evidence] > EVIDENCE_STRENGTH[previous.evidence])
    ) {
      best.set(candidate.value, candidate)
    }
  }

  // A text sighting like "emailhello@x.com" next to a structured "hello@x.com" is the same address
  // with a label or number glued on the front, not a second contact.
  const all = [...best.values()]
  return all.filter((candidate) => {
    if (candidate.evidence !== 'text' && candidate.evidence !== 'obfuscated') return true
    const local = localPartOf(candidate.value)
    const domain = domainOf(candidate.value)
    return !all.some((other) => {
      if (other === candidate || domainOf(other.value) !== domain) return false
      if (EVIDENCE_STRENGTH[other.evidence] <= EVIDENCE_STRENGTH[candidate.evidence]) return false
      const otherLocal = localPartOf(other.value)
      return otherLocal.length >= 3 && local.length > otherLocal.length && local.endsWith(otherLocal)
    })
  })
}

// ---------------------------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------------------------

function rankConfidence(confidence: EmailConfidence) {
  return confidence === 'high' ? 3 : confidence === 'medium' ? 2 : 1
}

const RELEVANCE_RANK: Record<EmailRelevance, number> = {
  'business-domain': 4,
  associated: 3,
  declared: 2,
  'external-provider': 1,
  unrelated: 0,
}

export function pickBestEmailCandidateV2(candidates: EmailCandidateV2[]): EmailCandidateV2 | null {
  if (candidates.length === 0) return null

  return [...candidates].sort((left, right) => {
    const confidence = rankConfidence(right.emailConfidence) - rankConfidence(left.emailConfidence)
    if (confidence) return confidence

    const relevance = RELEVANCE_RANK[right.relevance] - RELEVANCE_RANK[left.relevance]
    if (relevance) return relevance

    const generic = Number(left.isGenericEmail) - Number(right.isGenericEmail)
    if (generic) return generic

    const evidence = EVIDENCE_STRENGTH[right.evidence] - EVIDENCE_STRENGTH[left.evidence]
    if (evidence) return evidence

    const source = pathPriority(right.emailSource) - pathPriority(left.emailSource)
    if (source) return source

    return left.value.localeCompare(right.value)
  })[0]
}

/** An address counts toward email coverage only at high or medium confidence. */
export function isRelevantEmail(candidate: Pick<EmailValidationResult, 'emailConfidence'> | null) {
  return Boolean(candidate && candidate.emailConfidence !== 'low')
}

// ---------------------------------------------------------------------------------------------
// Page planning
// ---------------------------------------------------------------------------------------------

/** Pages worth fetching alongside the homepage, before anything about the site is known. */
export const STAGE_ONE_PATHS = ['/contact', '/contact-us', '/about'] as const
/** Extra pages allowed in the follow-up round, which only runs when no relevant email exists yet. */
export const MAX_FOLLOW_UP_PAGES = 2
const MAX_ANCHORS_SCANNED = 400

const NON_PAGE_EXTENSION = /\.(pdf|jpe?g|png|gif|webp|svg|zip|docx?|xlsx?|pptx?|mp[34]|avi|mov|css|js|xml|json)$/i

const CONTACT_LINK = /contact|contactez|nous-?joindre|joignez|kontakt|contacto|cont[áa]ctanos|contatt|contato|écrivez|ecrivez/i
const ABOUT_LINK = /about|à propos|a-propos|apropos|qui-sommes|über uns|uber-uns|ueber-uns|sobre|nosotros|chi-siamo|quem-somos/i
const LEGAL_LINK = /privacy|confidential|datenschutz|impressum|mentions-l|mentions l|aviso-legal|privacidad|informativa|legal-notice|politique-de|politica-de/i
const TEAM_LINK = /\bteam\b|[ée]quipe|notre-equipe|equipo|mitarbeiter/i

const PRIVACY_GUESSES: Record<string, string[]> = {
  en: ['/privacy-policy', '/privacy'],
  fr: ['/politique-de-confidentialite', '/mentions-legales', '/confidentialite'],
  de: ['/impressum', '/datenschutz'],
  es: ['/politica-de-privacidad', '/aviso-legal'],
  it: ['/privacy-policy', '/informativa-privacy'],
  pt: ['/politica-de-privacidade', '/privacidade'],
}

const TLD_LANGUAGE: Record<string, string> = {
  fr: 'fr', de: 'de', at: 'de', es: 'es', mx: 'es', it: 'it', pt: 'pt', br: 'pt',
}

export function detectPageLanguage(html: string | null, host: string): string {
  const lang = html?.match(/<html[^>]*\slang\s*=\s*["']?([a-z]{2})/i)?.[1]?.toLowerCase()
  if (lang && PRIVACY_GUESSES[lang]) return lang
  return TLD_LANGUAGE[host.split('.').pop() || ''] || 'en'
}

/** Normalised page identity used to avoid requesting the same URL twice. */
export function pageKey(value: string): string | null {
  try {
    const url = new URL(value)
    const path = url.pathname.replace(/\/+$/, '') || '/'
    return `${normalizeHostName(url.hostname)}${path}`.toLowerCase()
  } catch {
    return null
  }
}

function safeSiteUrl(value: string, anchor: string, siteHost: string): string | null {
  try {
    const url = new URL(value, anchor)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null

    const host = getWebsiteHost(url.toString())
    if (!host || isBlockedWebsiteHost(host) || !hostsClearlyRelated(siteHost, host)) return null

    url.hash = ''
    url.search = ''
    const path = url.pathname.replace(/\/+$/, '') || '/'
    if (path === '/' || NON_PAGE_EXTENSION.test(path)) return null
    return `${url.origin}${path}`
  } catch {
    return null
  }
}

export function planStageOneUrls(base: string): string[] {
  const siteHost = getWebsiteHost(base)
  if (!siteHost || isBlockedWebsiteHost(siteHost)) return []

  const urls = [base]
  const seen = new Set<string>([pageKey(base) || base])
  for (const path of STAGE_ONE_PATHS) {
    const url = safeSiteUrl(path, base, siteHost)
    const key = url && pageKey(url)
    if (url && key && !seen.has(key)) {
      seen.add(key)
      urls.push(url)
    }
  }
  return urls
}

/**
 * Chooses the follow-up pages: links the homepage itself advertises (contact, about, legal and
 * privacy pages in any supported language) first, then a few language-appropriate guesses.
 * Never returns a page that was already requested, and never more than `limit` pages.
 */
export function planFollowUpUrls({
  base,
  homepage,
  alreadyRequested,
  limit = MAX_FOLLOW_UP_PAGES,
}: {
  base: string
  homepage: { html: string; resolvedUrl: string } | null
  alreadyRequested: Iterable<string>
  limit?: number
}): string[] {
  const siteHost = getWebsiteHost(base)
  if (!siteHost || isBlockedWebsiteHost(siteHost)) return []

  const requested = new Set<string>()
  for (const url of alreadyRequested) {
    const key = pageKey(url)
    if (key) requested.add(key)
  }

  const scored = new Map<string, number>()
  const anchor = homepage?.resolvedUrl || base
  const consider = (value: string, priority: number) => {
    const url = safeSiteUrl(value, anchor, siteHost)
    const key = url && pageKey(url)
    if (!url || !key || requested.has(key)) return
    if (priority > (scored.get(url) || 0)) scored.set(url, priority)
  }

  if (homepage) {
    const $ = cheerio.load(homepage.html)
    let scanned = 0
    $('a[href]').each((_, element) => {
      if (scanned++ >= MAX_ANCHORS_SCANNED) return false
      const href = $(element).attr('href') || ''
      const label = `${href} ${$(element).text().trim().slice(0, 80)}`
      if (CONTACT_LINK.test(label)) consider(href, 4)
      else if (LEGAL_LINK.test(label)) consider(href, 3)
      else if (ABOUT_LINK.test(label)) consider(href, 2.5)
      else if (TEAM_LINK.test(label)) consider(href, 2)
    })
  }

  const language = detectPageLanguage(homepage?.html ?? null, siteHost)
  for (const path of PRIVACY_GUESSES[language] ?? PRIVACY_GUESSES.en) consider(path, 1)

  return [...scored.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, limit)
    .map(([url]) => url)
}

// ---------------------------------------------------------------------------------------------
// Coverage metrics
// ---------------------------------------------------------------------------------------------

export type EmailCoverageClass = 'high' | 'medium' | 'low_or_unrelated' | 'none' | 'unanalyzable'

export type EmailOutcome = {
  best: Pick<EmailValidationResult, 'emailConfidence'> | null
  /** True when at least one page of the business website was read. */
  analyzed: boolean
  hasWebsite: boolean
}

export function classifyEmailOutcome(outcome: EmailOutcome): EmailCoverageClass {
  if (!outcome.hasWebsite) return 'unanalyzable'
  if (outcome.best) {
    return outcome.best.emailConfidence === 'high'
      ? 'high'
      : outcome.best.emailConfidence === 'medium'
        ? 'medium'
        : 'low_or_unrelated'
  }
  return outcome.analyzed ? 'none' : 'unanalyzable'
}

export type EmailCoverageSummary = {
  discovered: number
  high: number
  medium: number
  lowOrUnrelated: number
  none: number
  unanalyzable: number
  /** Businesses with a high- or medium-confidence email. Low-confidence addresses do not count. */
  withRelevantEmail: number
  /** withRelevantEmail / discovered. */
  coverage: number
  /** withRelevantEmail / (discovered - unanalyzable): coverage among websites that could be read. */
  analyzableCoverage: number
}

export function summarizeEmailCoverage(outcomes: EmailOutcome[]): EmailCoverageSummary {
  const counts = { high: 0, medium: 0, low_or_unrelated: 0, none: 0, unanalyzable: 0 }
  for (const outcome of outcomes) counts[classifyEmailOutcome(outcome)] += 1

  const discovered = outcomes.length
  const withRelevantEmail = counts.high + counts.medium
  const analyzable = discovered - counts.unanalyzable
  const ratio = (value: number, total: number) => (total === 0 ? 0 : Number((value / total).toFixed(4)))

  return {
    discovered,
    high: counts.high,
    medium: counts.medium,
    lowOrUnrelated: counts.low_or_unrelated,
    none: counts.none,
    unanalyzable: counts.unanalyzable,
    withRelevantEmail,
    coverage: ratio(withRelevantEmail, discovered),
    analyzableCoverage: ratio(withRelevantEmail, analyzable),
  }
}

/**
 * Coverage from saved lead data, for leads that predate V2 or have no fetch record. A lead
 * with a website but no email cannot be told apart from "website unreadable", so it is counted
 * as `none`.
 */
export function summarizeLeadEmailCoverage(
  leads: { website: string | null; email: string | null; email_confidence: EmailConfidence | null }[]
): EmailCoverageSummary {
  return summarizeEmailCoverage(
    leads.map((lead) => ({
      hasWebsite: Boolean(lead.website && lead.website.trim()),
      analyzed: true,
      best: lead.email ? { emailConfidence: lead.email_confidence ?? 'low' } : null,
    }))
  )
}
