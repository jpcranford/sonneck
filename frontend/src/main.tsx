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
// Loaded data counts as fresh for a minute: navigating back to a page, or
// returning to the app (switching tabs, waking the device), within that
// minute costs no requests at all. Returning after longer refetches what's
// on screen once, so a page left open never goes on showing old data —
// TanStack's refetch-on-focus only ever touches data past its staleTime.
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
