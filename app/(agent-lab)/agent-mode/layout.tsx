import { requireAdminPage } from '@/lib/auth/require-admin'

// Agent Mode is retired for customers: reachable by administrators only (server-side).
export default async function AgentModeLayout({ children }: { children: React.ReactNode }) {
  await requireAdminPage()
  return children
}
