import { createContext, useContext } from 'react'
import type { AuthMe } from '../api/auth'

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
