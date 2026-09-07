import { apiPost } from './client'

// First-time launch flow's one real write endpoint (memory
// project_multiuser_build.md, Phase 3) — POST /api/setup/complete.
// authMethod is sent even when the picker is locked by AUTH_METHOD (the
// server ignores it and uses its own env var value in that case — see
// handleCompleteSetup's own comment); password only matters for
// "singlepass".
export function completeSetup(authMethod: 'none' | 'singlepass', password?: string): Promise<{ ok: boolean }> {
  return apiPost<{ ok: boolean }>('/api/setup/complete', { authMethod, password })
}
