import type { MetadataRoute } from 'next'

import { resources } from '@/lib/resources'

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = 'https://alpa.mindrasolutions.com'

  const resourceUrls = resources.map((resource) => ({
    url: `${baseUrl}${resource.href}`,
    lastModified: resource.lastModified,
    changeFrequency: 'monthly' as const,
    priority: 0.6,
  }))

  return [
    {
      url: baseUrl,
      lastModified: '2026-04-15',
      changeFrequency: 'weekly',
      priority: 1.0,
    },
    {
      url: `${baseUrl}/about`,
      lastModified: '2026-04-01',
      changeFrequency: 'monthly',
      priority: 0.7,
    },
    {
      url: `${baseUrl}/resources`,
      lastModified: '2026-04-15',
      changeFrequency: 'monthly',
      priority: 0.8,
    },
    {
      url: `${baseUrl}/plans`,
      lastModified: '2026-04-15',
      changeFrequency: 'monthly',
      priority: 0.8,
    },
    ...resourceUrls,
  ]
}
