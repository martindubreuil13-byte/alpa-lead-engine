// Synthetic, offline website fixtures for Email Intelligence. No network is ever used.
//
// These are hand-written to resemble real small-business sites. They are NOT a sample of real
// websites, so results on them show whether each extraction technique works, not how much real
// coverage will improve. See the benchmark report for what real evidence is still needed.

/** Cloudflare email-protection encoding (what Cloudflare injects into a page). */
export function cfEncode(email, key = 0x4f) {
  let hex = key.toString(16).padStart(2, '0')
  for (const char of email) hex += (char.charCodeAt(0) ^ key).toString(16).padStart(2, '0')
  return hex
}

function page(body, { lang = 'en', head = '' } = {}) {
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><title>Site</title>${head}</head><body>${body}</body></html>`
}

const nav = (extra = '') =>
  `<nav><a href="/">Home</a> <a href="/services">Services</a> <a href="/contact">Contact</a> ${extra}</nav>`

// Each site: website, pages (path -> html), acceptable (emails a person would call the right
// business contact), plus optional latency, redirects, status errors and notes.
export const SITES = [
  {
    id: 'plain-mailto',
    website: 'https://maplewoodplumbing.ca',
    pages: { '/': page(`${nav()}<p>Call us today.</p><a href="mailto:service@maplewoodplumbing.ca">Email us</a>`) },
    acceptable: ['service@maplewoodplumbing.ca'],
  },
  {
    id: 'footer-text-role',
    website: 'https://northshoredental.com',
    pages: { '/': page(`${nav()}<footer><p>Email: info@northshoredental.com</p><p>Phone 604-555-0198</p></footer>`) },
    acceptable: ['info@northshoredental.com'],
  },
  {
    id: 'contact-page-only',
    website: 'https://brightleafcafe.com',
    pages: {
      '/': page(`${nav()}<h1>Bright Leaf Cafe</h1>`),
      '/contact': page(`<h1>Contact</h1><a href="mailto:owner@brightleafcafe.com">owner@brightleafcafe.com</a>`),
    },
    acceptable: ['owner@brightleafcafe.com'],
  },
  {
    id: 'cloudflare-attribute',
    website: 'https://summitroofing.ca',
    pages: {
      '/': page(`${nav()}<h1>Summit Roofing</h1>`),
      '/contact': page(
        `<p>Write to us: <a href="/cdn-cgi/l/email-protection" class="__cf_email__" data-cfemail="${cfEncode('quotes@summitroofing.ca')}">[email&#160;protected]</a></p>`
      ),
    },
    acceptable: ['quotes@summitroofing.ca'],
  },
  {
    id: 'cloudflare-link-form',
    website: 'https://harborviewlaw.com',
    pages: {
      '/': page(
        `${nav()}<a href="/cdn-cgi/l/email-protection#${cfEncode('intake@harborviewlaw.com', 0x2a)}">Contact our office</a>`
      ),
    },
    acceptable: ['intake@harborviewlaw.com'],
  },
  {
    id: 'obfuscated-brackets',
    website: 'https://pinecrestfitness.com',
    pages: { '/': page(`${nav()}<p>Memberships: sales [at] pinecrestfitness [dot] com</p>`) },
    acceptable: ['sales@pinecrestfitness.com'],
  },
  {
    id: 'obfuscated-parentheses',
    website: 'https://lakesidebistro.ca',
    pages: { '/contact': page(`<p>Reservations: reservations (at) lakesidebistro (dot) ca</p>`), '/': page(nav()) },
    acceptable: ['reservations@lakesidebistro.ca'],
  },
  {
    id: 'jsonld-only',
    website: 'https://clearviewoptical.com',
    pages: {
      '/': page(`${nav()}<h1>Clearview Optical</h1>`, {
        head: `<script type="application/ld+json">{"@context":"https://schema.org","@type":"Optician","name":"Clearview Optical","email":"hello@clearviewoptical.com","telephone":"+1-555-0100"}</script>`,
      }),
    },
    acceptable: ['hello@clearviewoptical.com'],
  },
  {
    id: 'jsonld-graph-author-excluded',
    website: 'https://stonebridgebakery.com',
    pages: {
      '/': page(`${nav()}<h1>Stonebridge Bakery</h1>`, {
        head: `<script type="application/ld+json">{"@context":"https://schema.org","@graph":[
          {"@type":"Bakery","name":"Stonebridge Bakery","email":"orders@stonebridgebakery.com"},
          {"@type":"BlogPosting","headline":"Our story","author":{"@type":"Person","name":"Dev","email":"dev@freelancestudio.io"}}]}</script>`,
      }),
    },
    acceptable: ['orders@stonebridgebakery.com'],
  },
  {
    id: 'microdata',
    website: 'https://eastgatevet.com',
    pages: {
      '/': page(
        `${nav()}<div itemscope itemtype="https://schema.org/VeterinaryCare"><span itemprop="name">Eastgate Vet</span><a itemprop="email" href="mailto:frontdesk@eastgatevet.com">Front desk</a></div>`
      ),
    },
    acceptable: ['frontdesk@eastgatevet.com'],
  },
  {
    id: 'privacy-linked-in-footer',
    website: 'https://redcedarmovers.com',
    pages: {
      '/': page(`${nav()}<footer><a href="/privacy-policy">Privacy Policy</a></footer>`),
      '/privacy-policy': page(`<h1>Privacy</h1><p>Questions about this policy? Email privacy@redcedarmovers.com.</p>`),
    },
    acceptable: ['privacy@redcedarmovers.com'],
  },
  {
    id: 'privacy-guessed-path',
    website: 'https://oakridgeaccounting.ca',
    pages: {
      '/': page(`${nav()}<h1>Oakridge Accounting</h1>`),
      '/privacy-policy': page(`<p>Contact our privacy officer: compliance@oakridgeaccounting.ca</p>`),
    },
    acceptable: ['compliance@oakridgeaccounting.ca'],
  },
  {
    id: 'german-impressum',
    website: 'https://alpenblickhotel.de',
    pages: {
      '/': page(`<a href="/kontakt-aufnehmen">Start</a> <footer><a href="/impressum">Impressum</a></footer>`, { lang: 'de' }),
      '/impressum': page(`<h1>Impressum</h1><p>E-Mail: info [at] alpenblickhotel [dot] de</p>`, { lang: 'de' }),
    },
    acceptable: ['info@alpenblickhotel.de'],
  },
  {
    id: 'french-nous-joindre',
    website: 'https://boulangeriedupont.ca',
    pages: {
      '/': page(`<nav><a href="/menu">Menu</a> <a href="/nous-joindre">Nous joindre</a></nav>`, { lang: 'fr' }),
      '/nous-joindre': page(`<p>Écrivez-nous : <a href="mailto:commandes@boulangeriedupont.ca">commandes@boulangeriedupont.ca</a></p>`, { lang: 'fr' }),
    },
    acceptable: ['commandes@boulangeriedupont.ca'],
  },
  {
    id: 'french-mentions-legales',
    website: 'https://atelierlumiere.fr',
    pages: {
      '/': page(`<footer><a href="/mentions-legales">Mentions légales</a></footer>`, { lang: 'fr' }),
      '/mentions-legales': page(`<p>Courriel : bonjour@atelierlumiere.fr</p>`, { lang: 'fr' }),
    },
    acceptable: ['bonjour@atelierlumiere.fr'],
  },
  {
    id: 'gmail-business-mailto',
    website: 'https://bobsplumbingrepair.ca',
    pages: {
      '/': page(nav()),
      '/contact': page(`<p>Reach Bob: <a href="mailto:bobsplumbing.repair@gmail.com">bobsplumbing.repair@gmail.com</a></p>`),
    },
    acceptable: ['bobsplumbing.repair@gmail.com'],
  },
  {
    id: 'gmail-business-labelled',
    website: 'https://studiolune.ca',
    pages: { '/': page(`${nav()}<p>Courriel : studiolune.photo@gmail.com</p>`) },
    acceptable: ['studiolune.photo@gmail.com'],
  },
  {
    id: 'gmail-stray-testimonial',
    website: 'https://riversidegym.com',
    pages: {
      '/': page(`${nav()}<blockquote>"Best gym ever!" wrote happyclient88@gmail.com in her review.</blockquote>`),
    },
    acceptable: [],
    note: 'A customer address in prose: must not count as the business contact.',
  },
  {
    id: 'placeholder-only',
    website: 'https://greenfieldlandscaping.ca',
    pages: {
      '/': page(`${nav()}<form><p>Enter your email, e.g. john@example.com or name@domain.com</p></form>`),
      '/contact': page(`<p>Use the form. Placeholder: your@email.com</p>`),
    },
    acceptable: [],
  },
  {
    id: 'technical-and-image-names',
    website: 'https://redwoodcleaners.com',
    pages: {
      '/': page(`${nav()}<p>Download logo@2x.png and banner@3x.jpg. Errors reported to errors@sentry.io.</p>`),
    },
    acceptable: [],
  },
  {
    id: 'agency-credit-and-business',
    website: 'https://tidalwavesurf.com',
    pages: {
      '/': page(`${nav()}<p>Book: <a href="mailto:book@tidalwavesurf.com">book@tidalwavesurf.com</a></p><footer>Site by <a href="mailto:hello@webcraftagency.io">WebCraft</a></footer>`),
    },
    acceptable: ['book@tidalwavesurf.com'],
  },
  {
    id: 'agency-credit-only',
    website: 'https://quietpinespa.com',
    pages: { '/': page(`${nav()}<footer>Website by <a href="mailto:hello@webcraftagency.io">WebCraft</a></footer>`) },
    acceptable: [],
    note: 'Only a third-party address exists: should not count as coverage.',
  },
  {
    id: 'noreply-only',
    website: 'https://copperkettlediner.com',
    pages: { '/': page(`${nav()}<p>Automated mail comes from noreply@copperkettlediner.com</p>`) },
    acceptable: [],
  },
  {
    id: 'glued-block-text',
    website: 'https://ironworksgarage.ca',
    pages: { '/': page(`<div><p>info@ironworksgarage.ca</p><p>Call us at 555-0123</p></div>`) },
    acceptable: ['info@ironworksgarage.ca'],
    note: 'V1 concatenates block text and mangles the address.',
  },
  {
    id: 'subdomain-address',
    website: 'https://crestviewclinic.com',
    pages: { '/': page(`${nav()}<a href="mailto:appointments@mail.crestviewclinic.com">Appointments</a>`) },
    acceptable: ['appointments@mail.crestviewclinic.com'],
  },
  {
    id: 'same-brand-other-tld',
    website: 'https://larkspurflowers.com',
    pages: { '/': page(`${nav()}<a href="mailto:orders@larkspurflowers.ca">orders@larkspurflowers.ca</a>`) },
    acceptable: ['orders@larkspurflowers.ca'],
  },
  {
    id: 'malformed-html',
    website: 'https://timberlinecabins.com',
    pages: {
      '/': '<html><body><div><p>Reach us <b>at <a href="mailto:stay@timberlinecabins.com">stay@timberlinecabins.com<div><span>unclosed<p>more <i>text</b></a>',
    },
    acceptable: ['stay@timberlinecabins.com'],
  },
  {
    id: 'mailto-encoded-and-multiple',
    website: 'https://orchardhillfarm.com',
    pages: {
      '/': page(`${nav()}<a href="mailto:Sales%40OrchardHillFarm.com?subject=Hello%20there">Sales</a> <a href="mailto:picks@orchardhillfarm.com,farm@orchardhillfarm.com">Pick your own</a>`),
    },
    acceptable: ['sales@orchardhillfarm.com', 'picks@orchardhillfarm.com', 'farm@orchardhillfarm.com'],
  },
  {
    id: 'script-only-email',
    website: 'https://slatemountainguides.com',
    pages: { '/': page(`${nav()}<script>var support = "hidden@slatemountainguides.com";</script><p>Book online.</p>`) },
    acceptable: [],
    note: 'Emails inside arbitrary scripts are deliberately ignored.',
  },
  {
    id: 'www-redirect',
    website: 'https://juniperhillsalon.com',
    pages: { '/': page(`${nav()}<p>Salon: <a href="mailto:book@juniperhillsalon.com">book@juniperhillsalon.com</a></p>`) },
    acceptable: ['book@juniperhillsalon.com'],
    redirects: { 'https://juniperhillsalon.com/': 'https://www.juniperhillsalon.com/' },
  },
  {
    id: 'offsite-redirect',
    website: 'https://abandoneddomain.ca',
    pages: {},
    acceptable: [],
    redirects: { 'https://abandoneddomain.ca/': 'https://parkedpages-hosting.com/' },
    externalPages: { 'https://parkedpages-hosting.com/': page('<a href="mailto:sales@parkedpages-hosting.com">Buy this domain</a>') },
  },
  {
    id: 'unreachable',
    website: 'https://deadlinkplumbing.ca',
    pages: {},
    acceptable: [],
    status: { '*': 500 },
  },
  {
    id: 'form-only-no-email',
    website: 'https://velvetmoonboutique.com',
    pages: { '/': page(`${nav()}<form><input name="email" placeholder="Your email"></form>`), '/contact': page('<form>Send us a message</form>') },
    acceptable: [],
  },
  {
    id: 'email-late-in-huge-page',
    website: 'https://megaportalstores.com',
    pages: {
      '/': page(`${nav()}<div>${'<p>filler text for a heavy page</p>'.repeat(70_000)}</div><footer><a href="mailto:care@megaportalstores.com">care@megaportalstores.com</a></footer>`),
    },
    acceptable: ['care@megaportalstores.com'],
    note: 'Address sits after ~2.4 MB of markup. V2 reads at most 1.5 MB, so this is a known V2 miss.',
    knownV2Miss: true,
  },
]

const delay = (ms, signal) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
    })
  })

function htmlResponse(html, status = 200, extra = {}) {
  return new Response(html, { status, headers: { 'content-type': 'text/html; charset=utf-8', ...extra } })
}

/**
 * Builds a fetch implementation serving one fixture site. Paths not defined 404. It follows
 * redirects itself unless the caller asks for `redirect: 'manual'`, like real fetch.
 */
export function createFixtureFetch(site, { requests = [], latency = 25 } = {}) {
  const external = site.externalPages || {}
  const redirects = site.redirects || {}

  const lookup = (href) => {
    const url = new URL(href)
    if (external[url.href]) return external[url.href]
    const host = url.hostname.replace(/^www\./, '')
    const siteHost = new URL(site.website).hostname.replace(/^www\./, '')
    if (host !== siteHost) return null
    const path = url.pathname.replace(/\/+$/, '') || '/'
    return site.pages[path] ?? null
  }

  return async function fixtureFetch(input, init = {}) {
    const href = new URL(String(input)).href
    requests.push({ href, at: performance.now() })
    await delay(site.latency?.[new URL(href).pathname] ?? site.latency?.default ?? latency, init.signal)

    if (redirects[href]) {
      if (init.redirect === 'manual') {
        return new Response(null, { status: 301, headers: { location: redirects[href] } })
      }
      return fixtureFetch(redirects[href], init)
    }

    const forced = site.status?.[new URL(href).pathname] ?? site.status?.['*']
    if (forced) return htmlResponse('error', forced)

    const html = lookup(href)
    const response = html === null ? htmlResponse('not found', 404) : htmlResponse(html)
    Object.defineProperty(response, 'url', { value: href })
    return response
  }
}

export const PUBLIC_RESOLVER = async () => ['93.184.216.34']
