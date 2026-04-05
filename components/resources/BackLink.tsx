import Link from 'next/link'

export default function BackLink() {
  return (
    <Link href="/" className="mb-6 inline-block text-sm text-slate-400 hover:text-white">
      ← Back to home
    </Link>
  )
}
