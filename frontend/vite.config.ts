import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      // Design doc §2: relative-path, same-origin API calls in production
      // (single Docker image serving both). In dev, Vite proxies /api to
      // the Go backend instead, so the frontend code never needs a base
      // URL or environment-specific branching.
      '/api': 'http://localhost:8080',
    },
  },
})
