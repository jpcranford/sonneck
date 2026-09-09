import { apiGet } from './client'

// A minimal, deliberately narrow slice of server config the frontend needs
// at runtime — copyrightRegion (US renewal follow-up: gates whether the
// Copyright Year field's renewal toggle even shows), not the whole backend
// config.Config (most of which is server-internal, with no frontend use).
//
// authMethod/authMethodSetByEnv/firstLaunchCompleted/dataDir (multi-user
// support, first-time launch flow — see App.tsx's own gating and
// FirstLaunchFlow.tsx) are already server-resolved: authMethod reflects
// AUTH_METHOD if set, else the stored first-launch choice, else "none" —
// the frontend never re-derives that order itself. dataDir is only ever
// present while firstLaunchCompleted is false (see ConfigResponse's own Go
// comment for why).
export type AuthMethod = 'none' | 'singlepass' | 'oidc'

export interface AppConfig {
  copyrightRegion: string
  authMethod: AuthMethod
  authMethodSetByEnv: boolean
  firstLaunchCompleted: boolean
  dataDir?: string
  // oidcProviderName (Phase 14) — only present when authMethod is 'oidc';
  // drives LoginScreen.tsx's "Sign in with {name}" button text.
  oidcProviderName?: string
  // authChangePending (Phase 16) — non-null means the resolved auth method
  // no longer matches what the app last ran under (an operator changed
  // AUTH_METHOD since the previous boot). App.tsx gates on this exactly
  // parallel to firstLaunchCompleted, rendering AuthChangeFlow instead of
  // the normal routes until it's resolved. needsPassword/multiAccount let
  // that flow compute its whole step sequence upfront (computeSteps) —
  // see AuthChangePendingResponse's own Go doc comment for exactly what
  // each means.
  authChangePending: { from: AuthMethod; to: AuthMethod; needsPassword: boolean; multiAccount: boolean } | null
}

export function getConfig(): Promise<AppConfig> {
  return apiGet<AppConfig>('/api/config')
}
