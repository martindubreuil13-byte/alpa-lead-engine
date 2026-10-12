import { Suspense } from 'react'
import GuestResults from '@/components/guest/GuestResults'
export default function Page() {
 return <Suspense fallback={<p>Loading your businesses…</p>}><GuestResults /></Suspense>
}
