import { apiGet } from './client'

// A minimal, deliberately narrow slice of server config the frontend needs
// at runtime — just copyrightRegion so far (US renewal follow-up: gates
// whether the Copyright Year field's renewal toggle even shows), not the
// whole backend config.Config (most of which is server-internal, with no
// frontend use).
export interface AppConfig {
  copyrightRegion: string
}

export function getConfig(): Promise<AppConfig> {
  return apiGet<AppConfig>('/api/config')
}
