import { useState } from 'react'
import { IconAlertTriangle, IconEye, IconEyeOff } from '@tabler/icons-react'
import { useMockupTitle } from '../lib/useMockupTitle'
import { SonneckWordmark } from '../components/SonneckWordmark'

// Login Screen mockup. The real LoginScreen.tsx was built without a
// mockup of its own — small enough, and close enough to
// FirstLaunchFlow.tsx's own Security step, that it didn't seem to need
// one. Built after the fact, so the Auth Change Flow mockup has
// something real to preview as the screen a completed transition hands
// the user off to, rather than describing it only in prose.
//
// A visual port of the real component's four reachable states — no real
// API calls, no real /api/auth/oidc/login navigation (the "Sign in
// with…" control below is a plain button, not the real <a href>, since
// there's nowhere real for it to go from a mockup).

type PreviewState = 'singlepass' | 'singlepass-error' | 'oidc' | 'oidc-error'

const PREVIEW_LABELS: Record<PreviewState, string> = {
  singlepass: 'Password',
  'singlepass-error': 'Password — wrong password',
  oidc: 'OIDC / SSO',
  'oidc-error': 'OIDC / SSO — sign-in failed',
}

function PreviewToggle({ state, onChange }: { state: PreviewState; onChange: (state: PreviewState) => void }) {
  return (
    <div className="fixed top-3 right-3 z-30 flex max-w-[min(92vw,560px)] flex-wrap items-center gap-2 rounded-md border border-dashed border-border bg-paper-raised px-2.5 py-1.5 text-xs text-ink-soft shadow-sm">
      <span>Preview state:</span>
      <div className="flex flex-wrap overflow-hidden rounded border border-border">
        {(Object.keys(PREVIEW_LABELS) as PreviewState[]).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => onChange(key)}
            className={`cursor-pointer px-2 py-1 ${state === key ? 'bg-accent text-white' : 'bg-paper hover:bg-paper-sunken'}`}
          >
            {PREVIEW_LABELS[key]}
          </button>
        ))}
      </div>
    </div>
  )
}

export function LoginScreenMockup() {
  useMockupTitle('Login Screen')
  const [state, setState] = useState<PreviewState>('singlepass')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  const isOIDC = state === 'oidc' || state === 'oidc-error'
  const oidcError = state === 'oidc-error' ? 'Your identity provider could not complete sign-in — try again.' : null
  const passwordError = state === 'singlepass-error' ? 'Incorrect password.' : null

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-paper p-6">
      <PreviewToggle state={state} onChange={setState} />

      <div className="mb-8 w-full max-w-sm rounded-md border border-dashed border-accent/40 bg-accent-soft/40 px-4 py-2 text-xs text-ink-soft">
        Reference sample — <span className="font-medium text-ink">Login Screen</span>. Shown whenever a{' '}
        <code>singlepass</code>/<code>oidc</code> install has no valid session — first launch after setup, after
        logging out, or after the Auth Change flow hands off to a method that needs signing in.
      </div>

      {isOIDC ? (
        <div className="flex w-full max-w-sm flex-col items-center gap-5 text-center">
          <SonneckWordmark className="h-20 w-auto text-ink" />
          <div className="flex flex-col gap-1">
            <h1 className="font-display text-2xl font-medium text-ink">Welcome back</h1>
            <p className="text-sm text-ink-soft">Sign in to continue.</p>
          </div>
          {oidcError && <p className="text-xs text-red-700">{oidcError}</p>}
          {/* w-auto + min-w, not w-full — this and the Log In button
              below read too wide stretched to the full form width. min-w
              keeps a short label (or "Log In") from looking cramped;
              w-auto (no max-w) lets this one specifically keep growing
              for a genuinely long EXTERNAL_PROVIDER name rather than
              wrapping or truncating it. */}
          <button
            type="button"
            className="flex w-auto min-w-[180px] cursor-pointer items-center justify-center gap-2 rounded-md bg-accent px-8 py-2.5 font-display text-white hover:bg-accent/90"
          >
            Sign in with Test IdP
          </button>
        </div>
      ) : (
        <form
          onSubmit={(e) => e.preventDefault()}
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
              aria-invalid={passwordError ? true : undefined}
              // text-base + tracking-wide, not text-sm — the browser's own
              // masked "dot" glyph for type="password" scales with
              // font-size, and macOS vs. Windows render meaningfully
              // different dot sizes at the same small size (macOS's is
              // noticeably larger) — bumping the font-size is the standard
              // cross-platform fix, giving every OS a legible minimum dot
              // size rather than leaving it to each one's own default.
              className={`w-full rounded-md border bg-paper-raised px-3 py-2 pr-9 text-base tracking-wide text-ink ${
                passwordError ? 'border-red-700' : 'border-border'
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
          {passwordError && (
            <p className="-mt-3 flex items-center justify-center gap-1.5 text-xs font-medium text-red-700">
              <IconAlertTriangle size={14} />
              {passwordError}
            </p>
          )}
          <button
            type="submit"
            disabled={password.length === 0}
            className="flex w-auto min-w-[180px] items-center justify-center gap-2 rounded-md bg-accent px-8 py-2.5 font-display text-white enabled:cursor-pointer enabled:hover:bg-accent/90 disabled:opacity-40"
          >
            Log In
          </button>
        </form>
      )}
    </div>
  )
}
