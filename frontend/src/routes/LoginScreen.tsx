import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { IconEye, IconEyeOff, IconShieldLock } from '@tabler/icons-react'
import type { AppConfig } from '../api/config'
import { ApiError } from '../api/client'
import { login } from '../api/auth'
import { SonneckWordmark } from '../components/SonneckWordmark'

// Boot-time login gate — multi-user support, Phase 11 of the master plan
// (memory project_multiuser_build.md). Not itself named as a phase in that
// plan's own 16-phase list (a real gap flagged and confirmed with the user
// directly this session): singlepass mode had real backend enforcement
// since Phase 10, but no frontend surface to actually log in through until
// this — exactly the lockout risk README.md's own Security section already
// warned about. Rendered by App.tsx's AuthGate whenever GET /api/auth/me
// comes back 401 (no valid session cookie) — never reached in `none` mode,
// since that mode's implicit id=1 user always resolves with no session
// needed at all (authMiddleware).
//
// Same full-page-takeover visual language as FirstLaunchFlow.tsx (bg-paper,
// centered column, SonneckWordmark, PasswordFields-style show/hide input,
// text-red-700 error line) — not a mockup-first build, since no design
// mockup exists for this screen; it's small enough, and similar enough to
// FirstLaunchFlow's own Security step, not to need one.
export function LoginScreen({ authMethod }: { authMethod: AppConfig['authMethod'] }) {
  const queryClient = useQueryClient()
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  const loginMutation = useMutation({
    mutationFn: () => login(password),
    onSuccess: () => {
      // AuthGate holds the same ['auth', 'me'] query and swaps to the real
      // app on its own once this refetch lands — same pattern
      // FirstLaunchFlow's own completeMutation uses against ['config'].
      void queryClient.invalidateQueries({ queryKey: ['auth', 'me'] })
    },
  })

  // OIDC is env-var-only and Phase 14 (not built) — a server configured for
  // it has no IdP redirect this frontend can perform, so this explains the
  // dead end instead of rendering a password field that could never work.
  if (authMethod === 'oidc') {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-5 bg-paper p-6 text-center">
        <SonneckWordmark className="h-14 w-auto text-ink" />
        <div className="flex max-w-sm flex-col items-center gap-2">
          <IconShieldLock size={28} className="text-ink-soft" />
          <h1 className="font-display text-xl font-medium text-ink">Sign-in isn't built yet</h1>
          <p className="text-sm text-ink-soft">
            This server is set up for sign-in through an identity provider, but that part of Sonneck isn't built
            yet. Unset <code className="rounded bg-paper-sunken px-1 py-0.5">AUTH_METHOD</code>, or set it to{' '}
            <code className="rounded bg-paper-sunken px-1 py-0.5">none</code> or{' '}
            <code className="rounded bg-paper-sunken px-1 py-0.5">singlepass</code>, to get back in.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-paper p-6">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (password.length > 0) loginMutation.mutate()
        }}
        className="flex w-full max-w-sm flex-col items-center gap-5 text-center"
      >
        <SonneckWordmark className="h-14 w-auto text-ink" />
        <div className="flex flex-col gap-1">
          <h1 className="font-display text-2xl font-medium text-ink">Welcome back</h1>
          <p className="text-sm text-ink-soft">Enter the shared password to continue.</p>
        </div>
        <div className="relative w-full">
          <input
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            autoFocus
            className="w-full rounded-md border border-border bg-paper-raised px-3 py-2 pr-9 text-sm text-ink"
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            className="absolute top-1/2 right-2 flex -translate-y-1/2 cursor-pointer items-center text-ink-soft hover:text-ink"
          >
            {showPassword ? <IconEyeOff size={16} /> : <IconEye size={16} />}
          </button>
        </div>
        {loginMutation.isError && (
          <p className="text-xs text-red-700">
            {loginMutation.error instanceof ApiError ? loginMutation.error.message : 'Something went wrong.'}
          </p>
        )}
        <button
          type="submit"
          disabled={password.length === 0 || loginMutation.isPending}
          className="flex w-full items-center justify-center gap-2 rounded-md bg-accent px-5 py-2.5 font-display text-white enabled:cursor-pointer enabled:hover:bg-accent/90 disabled:opacity-40"
        >
          {loginMutation.isPending ? 'Signing in…' : 'Log In'}
        </button>
      </form>
    </div>
  )
}
