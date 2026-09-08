import { Navigate } from 'react-router-dom'
import { ComingSoon } from '../components/ComingSoon'
import { usePageTitle } from '../lib/usePageTitle'
import { useAuth } from '../lib/AuthContext'

// Real route (shell scope) for the sidebar user menu's "Admin Settings"
// link — reachable now, filled in for real during master plan Phase 13
// against the already-approved /mockup/admin-settings design. The sidebar
// menu itself only ever shows this link to an admin, but a non-admin
// typing the URL directly still needs turning away — the same guard
// pattern Phase 13's real content will keep, not something to drop once
// this stub is replaced.
export function AdminPage() {
  usePageTitle('Admin Settings')
  const me = useAuth()
  if (!me.permissions.includes('admin')) {
    return <Navigate to="/" replace />
  }
  return <ComingSoon title="Admin Settings" />
}
