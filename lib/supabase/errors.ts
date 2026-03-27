export function isIgnorableEmptyResultError(error: any) {
  if (!error) return true

  if (error.code === 'PGRST116') return true

  if (typeof error === 'object' && Object.keys(error).length === 0) return true

  if (!error.message && !error.details && !error.hint) return true

  return false
}
