import type { MetadataRoute } from 'next'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/dashboard', '/login', '/post-checkout'],
    },
    sitemap: 'https://alpa.mindrasolutions.com/sitemap.xml',
  }
}
