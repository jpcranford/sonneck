import { apiGet, apiPost } from './client'

// Auth Change flow — both endpoints are reachable pre-session by necessity (nobody can be logged in yet under whichever
// method just became active), self-guarded server-side by re-deriving
// AppConfig['authChangePending'] rather than trusting the client to only
// call these when App.tsx's own gate says to.

// Despite the name, every existing account, not just admin-eligible
// survivors — isAdmin drives the choose-admin step's own radio list, but
// confirm-delete needs the complete account list to correctly report
// *everyone* who's actually about to be deleted (the backend has no
// admin-only carve-out on the delete side).
export interface AuthChangeCandidate {
  id: number
  displayName: string
  isAdmin: boolean
}

// Only meaningful (and only ever called) when the pending target is
// none/singlepass and more than one account currently exists — the
// destructive downgrade's account data.
export function getAuthChangeCandidates(): Promise<AuthChangeCandidate[]> {
  return apiGet<AuthChangeCandidate[]>('/api/auth-change/candidates')
}

// password/keepUserId are each required only for specific transitions —
// the server re-derives which apply from its own state, not from which
// fields this call happens to send.
export function completeAuthChange(body: { password?: string; keepUserId?: number }): Promise<{ ok: boolean }> {
  return apiPost<{ ok: boolean }>('/api/auth-change/complete', body)
}
