import { apiGet, apiPatch, apiPost } from './client'

// Mirrors internal/api/dto.go's AuthMeResponse — the frontend's one source
// of truth for "who am I, what can I do, how is this server configured for
// login" (multi-user support, master plan Phase 11: AuthGate/App.tsx, the
// sidebar user menu, and every later per-user route guard).
export interface AuthMe {
  id: number
  displayName: string
  permissions: string[]
  authMethod: 'none' | 'singlepass' | 'oidc'
}

export function getMe(): Promise<AuthMe> {
  return apiGet<AuthMe>('/api/auth/me')
}

// singlepass mode's only login UI (master plan's Auth methods table — none
// has no login at all, oidc redirects to the IdP instead, Phase 14).
export function login(password: string): Promise<AuthMe> {
  return apiPost<AuthMe>('/api/auth/login', { password })
}

export function logout(): Promise<{ ok: boolean }> {
  return apiPost<{ ok: boolean }>('/api/auth/logout')
}

// User Settings' Account card (master plan Phase 12) — self-rename and
// self-service password change.
export function updateMe(displayName: string): Promise<AuthMe> {
  return apiPatch<AuthMe>('/api/auth/me', { displayName })
}

export function changePassword(currentPassword: string, newPassword: string): Promise<{ ok: boolean }> {
  return apiPost<{ ok: boolean }>('/api/auth/change-password', { currentPassword, newPassword })
}
