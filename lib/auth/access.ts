import type { UserProfile } from '@/lib/supabase/types'

export function isAdmin(user: UserProfile | null) {
  return user?.role === 'admin'
}

export function isFree(user: UserProfile | null) {
  return user?.plan === 'free'
}

export function isStarter(user: UserProfile | null) {
  return user?.plan === 'starter'
}

export function canAccessFeature(feature: string, user: UserProfile | null) {
  if (!user) return false

  if (user.role === 'admin') return true

  switch (feature) {
    case 'pipeline':
    case 'templates':
    case 'email':
      return user.plan === 'starter'

    case 'leads':
    case 'csv':
      return true

    default:
      return false
  }
}
