// Browser storage that cannot break the page. Merely reading window.localStorage throws a SecurityError when storage is
// blocked (private or restricted modes, some in-app browsers), and setItem throws when it is full. Every read and write here
// is guarded and mirrored in memory, so a visitor whose storage is unavailable still completes a search in the same page
// view. Persistence across reloads is then only a convenience, never a requirement: the server holds the real session.

export type StorageKind = 'local' | 'session'

const memory: Record<StorageKind, Map<string, string>> = { local: new Map(), session: new Map() }

function backing(kind: StorageKind): Storage | null {
  if (typeof window === 'undefined') return null
  try {
    return (kind === 'local' ? window.localStorage : window.sessionStorage) ?? null
  } catch {
    return null
  }
}

export function safeGetItem(kind: StorageKind, key: string): string | null {
  const store = backing(kind)
  if (store) {
    try {
      const value = store.getItem(key)
      if (value !== null) return value
    } catch {
      // fall back to memory
    }
  }
  return memory[kind].get(key) ?? null
}

export function safeSetItem(kind: StorageKind, key: string, value: string): boolean {
  memory[kind].set(key, value)
  const store = backing(kind)
  if (!store) return false
  try {
    store.setItem(key, value)
    return true
  } catch {
    return false
  }
}

export function safeRemoveItem(kind: StorageKind, key: string): void {
  memory[kind].delete(key)
  const store = backing(kind)
  if (!store) return
  try {
    store.removeItem(key)
  } catch {
    // nothing to do
  }
}
