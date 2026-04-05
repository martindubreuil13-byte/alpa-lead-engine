import type { MetadataRoute } from 'next'

import { resources } from '@/lib/resources'

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = 'https://alpa.mindrasolutions.com'
  const resourceUrls = resources.map((resource) => ({
    url: `${baseUrl}${resource.href}`,
    lastModified: new Date(),
  }))

  return [
    {
      url: baseUrl,
      lastModified: new Date(),
    },
    {
      url: `${baseUrl}/about`,
      lastModified: new Date(),
    },
    {
      url: `${baseUrl}/resources`,
      lastModified: new Date(),
    },
    {
      url: `${baseUrl}/plans`,
      lastModified: new Date(),
    },
    ...resourceUrls,
  ]
}
