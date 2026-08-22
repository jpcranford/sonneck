/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    // Pure-logic test files only so far (frontend/src/lib/*.test.ts) — no
    // React component under test yet, so no jsdom environment needed.
    include: ['src/**/*.test.ts'],
  },
  server: {
    // Bind to all interfaces, not just localhost — needed to reach the
    // dev server from a phone/tablet on the same network (design doc
    // §12/CLAUDE.md: mobile testing, especially the import wizard's
    // touch interactions, is an explicit v1 requirement, not a nice-to-
    // have). The Go backend already binds to all interfaces
    // (ListenAndServe(":"+cfg.Port, ...) in cmd/sonneck/main.go); Vite
    // was the one piece still defaulting to loopback-only.
    host: true,
    proxy: {
      // Design doc §2: relative-path, same-origin API calls in production
      // (single Docker image serving both). In dev, Vite proxies /api to
      // the Go backend instead, so the frontend code never needs a base
      // URL or environment-specific branching.
      '/api': 'http://localhost:8080',
    },
  },
})
