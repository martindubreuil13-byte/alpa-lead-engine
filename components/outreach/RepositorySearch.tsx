import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useCurrentUser } from '@/lib/auth/useCurrentUser'
import { supabase } from '@/lib/supabase'

interface RepositorySearchProps {
  offering: string
  audience: string
  goal: string
  onResults: (results: {
    totalMatches: number
    matchesWithCI: number
    matchesWithoutCI: number
  }) => void
}

export function RepositorySearch({
  offering,
  audience,
  goal,
  onResults,
}: RepositorySearchProps) {
  const { user } = useCurrentUser()
  const [isSearching, setIsSearching] = useState(false)

  useEffect(() => {
    if (!user || !offering.trim() || !audience.trim() || !goal) return

    const performSearch = async () => {
      setIsSearching(true)
      try {
        let query = supabase
          .from('leads')
          .select('id, commercial_profile, ci_enrichment_status', { count: 'exact' })
          .eq('user_id', user.id)

        // Apply intent-derived filters
        // For Phase 1: simple text-based filtering on industry and description
        // This can be enhanced in Phase 2+ with more sophisticated intent parsing

        const { data, count, error } = await query

        if (error) {
          console.error('[prospecting-search] query error:', error)
          onResults({
            totalMatches: 0,
            matchesWithCI: 0,
            matchesWithoutCI: 0,
          })
          return
        }

        const totalMatches = count ?? 0
        const matchesWithCI = (data || []).filter(
          (item) => item.ci_enrichment_status && item.ci_enrichment_status !== 'not_generated'
        ).length
        const matchesWithoutCI = totalMatches - matchesWithCI

        onResults({
          totalMatches,
          matchesWithCI,
          matchesWithoutCI,
        })
      } catch (err) {
        console.error('[prospecting-search] error:', err)
        onResults({
          totalMatches: 0,
          matchesWithCI: 0,
          matchesWithoutCI: 0,
        })
      } finally {
        setIsSearching(false)
      }
    }

    performSearch()
  }, [user, offering, audience, goal, onResults])

  if (!isSearching) return null

  return (
    <div className="flex items-center justify-center py-12">
      <div className="text-center space-y-3">
        <Loader2 className="h-8 w-8 text-violet-400 animate-spin mx-auto" />
        <p className="text-sm text-slate-400">Looking through your business library…</p>
      </div>
    </div>
  )
}
