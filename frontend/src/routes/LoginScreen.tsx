import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { IconAlertTriangle, IconEye, IconEyeOff } from '@tabler/icons-react'
import type { AppConfig } from '../api/config'
import { ApiError } from '../api/client'
import { login } from '../api/auth'
import { SonneckWordmark } from '../components/SonneckWordmark'

// The small fixed set of ?oidcError= codes handleOIDCCallback
// (internal/handlers/oidc.go) can redirect back with — mapped to a short,
// friendly line rather than showing raw error text.
const OIDC_ERROR_MESSAGES: Record<string, string> = {
  state: 'That sign-in link expired or was already used — try again.',
  exchange: 'Your identity provider could not complete sign-in — try again.',
  registration_disabled: "This account isn't set up yet. Ask an admin to add it first.",
  unconfigured: 'Sign-in through an identity provider is not set up on this server.',
  internal: 'Something went wrong signing you in — try again.',
}

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
export function LoginScreen({
  authMethod,
  oidcProviderName,
}: {
  authMethod: AppConfig['authMethod']
  oidcProviderName?: string
}) {
  const queryClient = useQueryClient()
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  // handleOIDCCallback (internal/handlers/oidc.go) redirects failures back
  // here as ?oidcError=<code>. Read once via a lazy initializer rather than
  // an effect calling setState (react-hooks/set-state-in-effect — this
  // project's React Compiler setup flags that, CLAUDE.md > Frontend's own
  // "prefer deriving state from the event that causes it" gotcha).
  const [oidcError] = useState<string | null>(() => {
    const code = new URLSearchParams(window.location.search).get('oidcError')
    return code ? (OIDC_ERROR_MESSAGES[code] ?? OIDC_ERROR_MESSAGES.internal) : null
  })

  // Stripping the query param is a real external-system side effect (not a
  // React state update), so it stays in an effect — just with no setState
  // call inside it.
  useEffect(() => {
    if (!window.location.search.includes('oidcError')) return
    const params = new URLSearchParams(window.location.search)
    params.delete('oidcError')
    const rest = params.toString()
    window.history.replaceState(null, '', window.location.pathname + (rest ? `?${rest}` : ''))
  }, [])

  const loginMutation = useMutation({
    mutationFn: () => login(password),
    onSuccess: () => {
      // AuthGate holds the same ['auth', 'me'] query and swaps to the real
      // app on its own once this refetch lands — same pattern
      // FirstLaunchFlow's own completeMutation uses against ['config'].
      void queryClient.invalidateQueries({ queryKey: ['auth', 'me'] })
    },
  })

  // OIDC (Phase 14) — a real top-level navigation to the IdP, not an
  // in-app action, so this is a genuine <a>, not a click-handled button
  // (CLAUDE.md > Frontend's own "card navigation needs a real <a>"
  // convention, same underlying reason).
  if (authMethod === 'oidc') {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center bg-paper p-6">
        <div className="flex w-full max-w-sm flex-col items-center gap-5 text-center">
          <SonneckWordmark className="h-20 w-auto text-ink" />
          <div className="flex flex-col gap-1">
            <h1 className="font-display text-2xl font-medium text-ink">Welcome back</h1>
            <p className="text-sm text-ink-soft">Sign in to continue.</p>
          </div>
          {oidcError && <p className="text-xs text-red-700">{oidcError}</p>}
          {/* w-auto + min-w, not w-full — this and the Log In button below
              read too wide stretched to the full form width. min-w keeps a
              short label from looking cramped; w-auto (no max-w) lets this
              one specifically keep growing for a genuinely long
              oidcProviderName rather than wrapping or truncating it. */}
          <a
            href="/api/auth/oidc/login"
            className="flex w-auto min-w-[180px] items-center justify-center gap-2 rounded-md bg-accent px-8 py-2.5 font-display text-white hover:bg-accent/90"
          >
            Sign in with {oidcProviderName ?? 'your identity provider'}
          </a>
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
        <SonneckWordmark className="h-20 w-auto text-ink" />
        <div className="flex flex-col gap-1">
          <h1 className="font-display text-2xl font-medium text-ink">Welcome back</h1>
          <p className="text-sm text-ink-soft">Enter the password to continue.</p>
        </div>
        <div className="relative w-full">
          <input
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            autoFocus
            aria-invalid={loginMutation.isError ? true : undefined}
            // text-base + tracking-wide, not text-sm — the browser's own
            // masked "dot" glyph for type="password" scales with font-size,
            // and macOS renders a noticeably larger dot than Windows at the
            // same small size — bumping the font-size gives every OS a
            // legible minimum dot size instead of leaving it to each
            // platform's own default.
            className={`w-full rounded-md border bg-paper-raised px-3 py-2 pr-9 text-base tracking-wide text-ink ${
              loginMutation.isError ? 'border-red-700' : 'border-border'
            }`}
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
          <p className="-mt-3 flex items-center justify-center gap-1.5 text-xs font-medium text-red-700">
            <IconAlertTriangle size={14} />
            {loginMutation.error instanceof ApiError ? loginMutation.error.message : 'Something went wrong.'}
          </p>
        )}
        <button
          type="submit"
          disabled={password.length === 0 || loginMutation.isPending}
          className="flex w-auto min-w-[180px] items-center justify-center gap-2 rounded-md bg-accent px-8 py-2.5 font-display text-white enabled:cursor-pointer enabled:hover:bg-accent/90 disabled:opacity-40"
        >
          {loginMutation.isPending ? 'Signing in…' : 'Log In'}
        </button>
      </form>
    </div>
  )
}
