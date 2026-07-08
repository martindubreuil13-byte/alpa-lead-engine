import { useEffect } from 'react'

export function Toast({ message, onDone }: { message: string; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 2800)
    return () => clearTimeout(t)
  }, [onDone])
  return (
    <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-xl border border-white/10 bg-[#0d1424] px-5 py-3 text-sm text-slate-200 shadow-[0_8px_32px_rgba(0,0,0,0.5)]">
      {message}
    </div>
  )
}
