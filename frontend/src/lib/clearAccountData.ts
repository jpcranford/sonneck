import type { QueryClient } from '@tanstack/react-query'

// Drops every cached query except the sign-in check (['auth', 'me']) and
// the server's own config (['config']) — the two that AuthGate and the
// sign-in screen run on, and the only ones that don't belong to an
// account. Nothing else's cache key names the account it belongs to
// (settings, tags, setlists, practice statuses, favorites), so the next
// person to sign in in this tab would otherwise see the last person's data
// until it went stale. Called after signing out (once the sign-in screen
// has replaced the app, so nothing on screen is still reading what's
// dropped) and just before a sign-in completes.
export function clearAccountData(queryClient: QueryClient) {
  queryClient.removeQueries({
    predicate: (query) => query.queryKey[0] !== 'auth' && query.queryKey[0] !== 'config',
  })
}
