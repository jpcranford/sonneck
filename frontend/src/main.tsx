import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { TitleBarDragStrip } from './components/NativeTitleBar'
import { DialogHost } from './components/DialogHost'
import { installNativeExternalLinks } from './lib/nativeLinks'
import { installTruncationTitles } from './lib/truncationTitles'
import { installShortcuts } from './lib/shortcuts'
import { ApiError } from './api/client'

// Retry a failed load up to three times (TanStack's default), except when
// the server has already answered with a 4xx — not found, invalid, not
// allowed — which a retry can't change. Without this, a link to a deleted
// piece sat on "Loading…" for about 7 seconds of backed-off retries before
// showing "Piece not found".
// Loaded data counts as fresh for a minute, and returning to the app
// (switching tabs, waking the device) doesn't refetch on its own — each of
// those was a burst of requests and a redraw, a real battery cost on slow
// devices like e-ink tablets; pull to refresh and navigating still fetch.
// So that a minute's caching never shows something out of date after a
// change, every successful save marks all loaded data stale — without
// fetching any of it: whatever isn't on screen refetches when it's next
// shown, and each save refreshes what it changed on screen itself (its
// own invalidateQueries). Refetching everything on screen instead cost a
// favorite tap ~19 requests, most for lists it can't change. Mutations
// that only look something up (IMSLP, Wikipedia, update checks) carry
// `meta: { readOnly: true }` and skip even the marking.
const queryClient: QueryClient = new QueryClient({
  mutationCache: new MutationCache({
    onSuccess: (_data, _variables, _context, mutation) => {
      if (!mutation.meta?.readOnly) void queryClient.invalidateQueries({ refetchType: 'none' })
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => {
        if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false
        return failureCount < 3
      },
    },
  },
})

declare module '@tanstack/react-query' {
  interface Register {
    mutationMeta: { readOnly?: boolean }
  }
}

installNativeExternalLinks()
installTruncationTitles()
installShortcuts()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
        <TitleBarDragStrip />
        <DialogHost />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
