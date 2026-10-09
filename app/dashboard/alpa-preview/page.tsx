import { notFound } from 'next/navigation'

import { DiscoverExperience } from '@/app/dashboard/scraper/page'
import { createServerClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export default async function AlpaPreviewPage() {
  const ownerUserId = process.env.PRIVATE_ALPA_OWNER_USER_ID?.trim()
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!ownerUserId || !user?.id || user.id !== ownerUserId) {
    notFound()
  }

  return <DiscoverExperience privatePreview />
}
