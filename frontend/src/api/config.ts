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
export interface AppConfig {
  copyrightRegion: string
  authMethod: 'none' | 'singlepass' | 'oidc'
  authMethodSetByEnv: boolean
  firstLaunchCompleted: boolean
  dataDir?: string
}

export function getConfig(): Promise<AppConfig> {
  return apiGet<AppConfig>('/api/config')
}
