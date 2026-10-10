// An invented, offline "Toronto consultants" world shaped like a real Discover search. Nothing here is a
// real business or a real address; every domain is made up. It exists so a test can run the real
// discovery worker against listings and websites without touching the network.

/** What Serper's maps endpoint returns for each place: title, website, phoneNumber, type, types. */
export const RAW_PLACES = [
  { title: 'Northgate Staffing', website: 'https://northgatestaffing.ca/', phoneNumber: '+1 416-555-0101', type: 'Staffing agency' },
  { title: 'Lakeshore Advisory', website: 'https://www.lakeshoreadvisory.com/', phoneNumber: '+1 416-555-0102', type: 'Consultant' },
  { title: 'Harbourfront Partners', website: 'https://harbourfrontpartners.com/', phoneNumber: '+1 647-555-0103', types: ['Management consultant', 'Business consultant'] },
  { title: 'Queen Street Strategy', website: 'https://queenstreetstrategy.ca/', phoneNumber: '+1 416-555-0104' }, // the provider gave no category
  { title: 'Shoreline Consulting Group', website: 'https://shorelinecg.ca/', phoneNumber: '+1 416-555-0105', types: ['Business consultant'] },
  { title: 'Dufferin Advisors', phoneNumber: '+1 905-555-0106', type: 'Consultant' }, // no website
  { title: 'Rosedale Partners', website: 'https://rosedalepartners.com/', phoneNumber: '+1 416-555-0107', type: 'Management consultant' },
]

const page = (html, resolvedUrl) => ({ html: `<html><body>${html}</body></html>`, ...(resolvedUrl ? { resolvedUrl } : {}) })
const NOT_FOUND = { failure: 'not_found' }

// ROT13 of "info@northgatestaffing.ca" in the form WordPress email-encoder plugins write.
const NORTHGATE_ENCODED = 'vasb[at]abegutngrfgnssvat.pn'

/** Per website host: what robots.txt says and what each path returns. '*' answers every other path. */
export const SITES = {
  // The ProViso case: the Contact page is /contact-northgate and the address is only a ROT13 attribute.
  'northgatestaffing.ca': {
    robots: [],
    pages: {
      '/': page('<h1>Northgate Staffing</h1><a href="/contact-northgate">Contact</a>'),
      '/contact': page(
        `<h4><a href="javascript:;" data-enc-email="${NORTHGATE_ENCODED}" class="mail-link">Email Us</a></h4><p>320 Bay St</p>`,
        'https://northgatestaffing.ca/contact-northgate'
      ),
      '*': NOT_FOUND,
    },
  },
  // The Cirrus case: robots.txt could not be read in time, so permission is unknown and nothing is requested.
  'lakeshoreadvisory.com': {
    robots: { kind: 'unknown', reason: 'timeout' },
    pages: { '*': { failure: 'timeout' } },
  },
  // An address on the homepage, while every other page timed out.
  'harbourfrontpartners.com': {
    robots: [],
    pages: { '/': page('<a href="mailto:hello@harbourfrontpartners.com">Say hello</a>'), '*': { failure: 'timeout' } },
  },
  // Read in full, genuinely nothing published.
  'queenstreetstrategy.ca': {
    robots: [],
    pages: { '/': page('<h1>Queen Street Strategy</h1><p>Call us.</p>'), '*': NOT_FOUND },
  },
  // An address, but on an unrelated domain: only a possible match.
  'shorelinecg.ca': {
    robots: [],
    pages: { '/': page('<a href="mailto:info@bayviewmail.com">Mail</a>'), '*': NOT_FOUND },
  },
  // A personal address on the business's own domain.
  'rosedalepartners.com': {
    robots: [],
    pages: { '/': page('<h1>Rosedale</h1>'), '/contact': page('<a href="mailto:jane.doe@rosedalepartners.com">Jane</a>'), '*': NOT_FOUND },
  },
}
