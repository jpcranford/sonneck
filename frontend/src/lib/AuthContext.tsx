import { createContext, useContext } from 'react'
import type { AuthMe } from '../api/auth'
import type { Permission } from '../api/admin'

// Set once, by App.tsx's AuthGate, once GET /api/auth/me has resolved
// successfully — everything inside <Routes> (Sidebar/MobileNav's user menu,
// Settings, the Admin route guard) reads the current user from here instead
// of each re-querying ['auth', 'me'] and re-handling the loading/401 cases
// AuthGate already resolved once at the root. Non-null by construction:
// AuthGate only ever renders <Routes> after a successful fetch, so useAuth
// below can assume a real value rather than threading `| undefined` through
// every consumer.
export const AuthContext = createContext<AuthMe | null>(null)

export function useAuth(): AuthMe {
  const me = useContext(AuthContext)
  if (!me) {
    throw new Error('useAuth() called outside AuthContext.Provider')
  }
  return me
}

// Whether the signed-in user may do what `perm` covers. `admin` implies
// every permission, whether or not the others are ticked — the same rule
// as the server's User.HasPermission, so a control is never hidden or
// faded for an action the server would allow.
export function hasPermission(me: AuthMe, perm: Permission): boolean {
  return me.permissions.includes('admin') || me.permissions.includes(perm)
}
