import { requireAdminPage } from '@/lib/auth/require-admin'

// Retired customer feature: reachable by administrators only (server-side).
export default async function AdminOnlyLayout({ children }: { children: React.ReactNode }) {
  await requireAdminPage()
  return children
}
