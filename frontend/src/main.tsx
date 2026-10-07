import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { TitleBarDragStrip } from './components/NativeTitleBar'
import { ApiError } from './api/client'

// Retry a failed load up to three times (TanStack's default), except when
// the server has already answered with a 4xx — not found, invalid, not
// allowed — which a retry can't change. Without this, a link to a deleted
// piece sat on "Loading…" for about 7 seconds of backed-off retries before
// showing "Piece not found".
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false
        return failureCount < 3
      },
    },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
        <TitleBarDragStrip />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
