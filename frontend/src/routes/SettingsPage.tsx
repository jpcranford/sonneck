import { ComingSoon } from '../components/ComingSoon'
import { usePageTitle } from '../lib/usePageTitle'

// Real route (shell scope) for the sidebar user menu's "User Settings" link
// — reachable now, filled in for real during master plan Phase 12 against
// the already-approved /mockup/user-settings design.
export function SettingsPage() {
  usePageTitle('User Settings')
  return <ComingSoon title="User Settings" />
}
