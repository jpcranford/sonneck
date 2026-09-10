import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  IconAlertTriangle,
  IconArrowLeft,
  IconCircleCheckFilled,
  IconLoader2,
  IconUserCircle,
} from '@tabler/icons-react'
import type { AuthMethod } from '../api/config'
import { getAuthChangeCandidates, completeAuthChange } from '../api/authChange'
import { ApiError } from '../api/client'
import { afterMinDuration } from '../lib/minDuration'

// Auth Change flow — multi-user support, master plan Phase 16. Real build
// of the already-approved AuthChangeFlowMockup.tsx (see that file's own
// header comment for the full design history) — a boot-time gate, the
// exact same architectural shape FirstLaunchFlow.tsx already uses, reached
// whenever App.tsx sees a non-null GET /api/config authChangePending.
//
// The mockup's five fixture SCENARIOS are gone — pending (this component's
// one real prop, straight from AppConfig) already carries everything
// computeSteps needs (needsPassword/multiAccount, computed server-side in
// handleGetConfig). The choose-admin step's candidate list and the whole
// flow's completion are real API calls (GET /api/auth-change/candidates,
// POST /api/auth-change/complete) instead of fixture data — both
// deliberately pre-auth endpoints, since nobody can be logged in yet under
// whichever method just became active (see internal/handlers/authchange.go's
// own doc comment for the reasoning).
//
// Every scenario ends on a real 'done' screen with a genuine "Continue to
// Library"/"Continue to Sign In" button — completeAuthChange's own success
// does NOT invalidate ['config'] itself; that invalidation (the thing that
// actually makes App.tsx swap this component out for the real app) fires
// only from that button's own click. This mirrors every other step in the
// flow already ending on an explicit "click to proceed" action, rather than
// silently vanishing the instant the mutation resolves.
//
// The destructive downgrade path specifically routes through a real
// 'updating' step between confirm-delete and done — clicking "Delete
// accounts now" advances immediately to 'updating' and kicks off the real
// mutation; afterMinDuration (lib/minDuration.ts, the same shared helper
// used elsewhere for this exact "a fast local mutation needs an artificial
// minimum display duration" gotcha) guarantees the spinner shows for at
// least 2.5s even though the real delete-and-reassign transaction usually
// resolves in a fraction of that, then advances to 'done' automatically —
// no click needed. A failed mutation instead steps back to confirm-delete
// so its existing inline error line can show what went wrong. The lighter,
// non-destructive scenarios skip 'updating' entirely (their own final
// button just awaits the mutation directly, same as before) — nothing
// worth narrating a wait for on those paths.

const METHOD_LABELS: Record<AuthMethod, string> = {
  none: 'No login',
  singlepass: 'Password',
  oidc: 'Sign in with…',
}

type StepKey = 'intro' | 'password' | 'choose-admin' | 'confirm-delete' | 'updating' | 'done'

function computeSteps(pending: { needsPassword: boolean; multiAccount: boolean }): StepKey[] {
  const steps: StepKey[] = ['intro']
  if (pending.needsPassword) steps.push('password')
  if (pending.multiAccount) {
    steps.push('choose-admin', 'confirm-delete', 'updating')
  }
  steps.push('done')
  return steps
}

// Reassurance copy, ported as-is from the mockup: nothing this flow does
// actually takes effect until the very last actionable step's own button
// is clicked.
function ReversibleNote({ fromLabel, isFinalStep }: { fromLabel: string; isFinalStep: boolean }) {
  return (
    <p className="mt-4 text-xs text-ink-soft">
      {isFinalStep ? 'This is the last step — until you confirm below, ' : 'Nothing is applied yet — '}
      you can still switch <code className="rounded bg-paper-sunken px-1 py-0.5">AUTH_METHOD</code> back to{' '}
      <strong className="text-ink">{fromLabel}</strong> and nothing will be lost.
    </p>
  )
}

function BackLink({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mb-4 flex cursor-pointer items-center gap-1 text-sm text-ink-soft hover:text-ink"
    >
      <IconArrowLeft size={16} />
      Back
    </button>
  )
}

export function AuthChangeFlow({
  pending,
}: {
  pending: { from: AuthMethod; to: AuthMethod; needsPassword: boolean; multiAccount: boolean }
}) {
  const queryClient = useQueryClient()
  const [stepIndex, setStepIndex] = useState(0)
  const [keptAdminId, setKeptAdminId] = useState<number | null>(null)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  const fromLabel = METHOD_LABELS[pending.from]
  const toLabel = METHOD_LABELS[pending.to]
  const steps = computeSteps(pending)
  const step = steps[stepIndex]
  const passwordValid = !pending.needsPassword || (password.length >= 8 && password === confirmPassword)

  const candidatesQuery = useQuery({
    queryKey: ['auth-change', 'candidates'],
    queryFn: getAuthChangeCandidates,
    enabled: pending.multiAccount,
  })
  // Every existing account — confirm-delete needs the complete list to
  // correctly report everyone who's actually about to be deleted, not just
  // the admin-eligible ones below.
  const candidates = candidatesQuery.data ?? []
  // The choose-admin step's own radio list is the admin-eligible subset —
  // only an admin can become none/singlepass mode's one implicit account.
  const admins = candidates.filter((u) => u.isAdmin)
  const keptAdmin = candidates.find((u) => u.id === keptAdminId) ?? null

  const completeMutation = useMutation({
    mutationFn: () =>
      completeAuthChange({ password: pending.needsPassword ? password : undefined, keepUserId: keptAdminId ?? undefined }),
  })

  function goNext() {
    setStepIndex((i) => Math.min(i + 1, steps.length - 1))
  }
  function goBack() {
    setStepIndex((i) => Math.max(i - 1, 0))
  }

  // The real last *actionable* step — the last one with a button a person
  // actually clicks — isn't always steps[steps.length - 2] now that
  // 'updating' can sit non-interactively between confirm-delete and 'done'.
  const actionableSteps = steps.filter((s) => s !== 'updating' && s !== 'done')
  const isFinalActionableStep = step === actionableSteps[actionableSteps.length - 1]
  const chooseAdminCanContinue = step !== 'choose-admin' || keptAdminId !== null

  // The 'done' step's own button is the one place ['config'] actually gets
  // invalidated — see this file's own header comment for why that's
  // deliberately not tied to the mutation's own onSuccess.
  function finish() {
    void queryClient.invalidateQueries({ queryKey: ['config'] })
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-paper p-6">
      <div className="w-full max-w-md">
        {step === 'intro' && (
          <>
            <h1 className="font-display text-2xl font-medium text-ink">We noticed your sign-in method changed</h1>
            <p className="mt-2 text-sm text-ink-soft">
              Sonneck is now configured for <strong className="text-ink">{toLabel}</strong> — it was{' '}
              <strong className="text-ink">{fromLabel}</strong> last time it ran.
            </p>
            <p className="mt-2 text-sm text-ink-soft">
              {pending.to === 'oidc'
                ? 'Nothing is lost — the first person who signs in takes control of your existing account, with all its favorites, notes, and tags already there.'
                : pending.multiAccount
                  ? 'The next few screens will walk you through what this means for your existing accounts.'
                  : 'No other accounts are affected by this change.'}
            </p>
            {pending.to === 'oidc' ? (
              <p className="mt-4 text-xs text-ink-soft">
                Nothing is lost with this upgrade. To abandon before upgrading, switch{' '}
                <code className="rounded bg-paper-sunken px-1 py-0.5">AUTH_METHOD</code> back to{' '}
                <strong className="text-ink">{fromLabel}</strong>.
              </p>
            ) : (
              <ReversibleNote fromLabel={fromLabel} isFinalStep={isFinalActionableStep} />
            )}
            {isFinalActionableStep && completeMutation.isError && (
              <p className="mt-3 text-xs text-red-700">
                {completeMutation.error instanceof ApiError ? completeMutation.error.message : 'Something went wrong.'}
              </p>
            )}
            <button
              type="button"
              disabled={completeMutation.isPending}
              onClick={() =>
                isFinalActionableStep ? completeMutation.mutate(undefined, { onSuccess: goNext }) : goNext()
              }
              className="mt-8 flex w-full items-center justify-center gap-2 rounded-md bg-accent px-5 py-2.5 font-display text-white enabled:cursor-pointer enabled:hover:bg-accent/90 disabled:opacity-40"
            >
              {isFinalActionableStep && completeMutation.isPending ? 'Continuing…' : 'Continue'}
            </button>
          </>
        )}

        {step === 'password' && (
          <>
            <BackLink onClick={goBack} />
            <h1 className="font-display text-2xl font-medium text-ink">Set a password</h1>
            <p className="mt-1 text-sm text-ink-soft">{toLabel} gates the whole app behind a single shared password — pick one now.</p>
            {/* text-base + tracking-wide, not text-sm — the browser's own
                masked "dot" glyph for type="password" scales with
                font-size, and macOS renders a noticeably larger dot than
                Windows at the same small size — bumping the font-size gives
                every OS a legible minimum dot size instead of leaving it to
                each platform's own default. */}
            <div className="mt-6 flex flex-col gap-2">
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Password (min. 8 characters)"
                className="w-full rounded-md border border-border bg-paper-raised px-3 py-2 text-base tracking-wide text-ink"
              />
              <input
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                placeholder="Confirm password"
                className="w-full rounded-md border border-border bg-paper-raised px-3 py-2 text-base tracking-wide text-ink"
              />
              {confirmPassword.length > 0 && !passwordValid && (
                <p className="text-xs text-red-700">{password.length < 8 ? 'At least 8 characters.' : "Passwords don't match."}</p>
              )}
            </div>
            <ReversibleNote fromLabel={fromLabel} isFinalStep={isFinalActionableStep} />
            {isFinalActionableStep && completeMutation.isError && (
              <p className="mt-3 text-xs text-red-700">
                {completeMutation.error instanceof ApiError ? completeMutation.error.message : 'Something went wrong.'}
              </p>
            )}
            <button
              type="button"
              disabled={!passwordValid || completeMutation.isPending}
              onClick={() =>
                isFinalActionableStep ? completeMutation.mutate(undefined, { onSuccess: goNext }) : goNext()
              }
              className="mt-8 flex w-full items-center justify-center gap-2 rounded-md bg-accent px-5 py-2.5 font-display text-white enabled:cursor-pointer enabled:hover:bg-accent/90 disabled:opacity-40"
            >
              {isFinalActionableStep && completeMutation.isPending ? 'Continuing…' : 'Continue'}
            </button>
          </>
        )}

        {step === 'choose-admin' && (
          <>
            <BackLink onClick={goBack} />
            <h1 className="font-display text-2xl font-medium text-ink">Multiple admins found</h1>
            <p className="mt-1 text-sm text-ink-soft">
              {toLabel} supports only one account, and only an existing admin can become it. Choose which account to
              keep — every other account will be deleted next.
            </p>
            {candidatesQuery.isLoading ? (
              <p className="mt-6 text-sm text-ink-soft">Loading accounts…</p>
            ) : (
              <div className="mt-6 flex flex-col gap-3" role="radiogroup" aria-label="Choose the surviving admin account">
                {admins.map((admin) => (
                  <button
                    key={admin.id}
                    type="button"
                    onClick={() => setKeptAdminId(admin.id)}
                    role="radio"
                    aria-checked={keptAdminId === admin.id}
                    className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3.5 text-left ${
                      keptAdminId === admin.id ? 'border-accent bg-accent-soft' : 'border-border bg-paper-raised hover:border-accent/50'
                    }`}
                  >
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-paper-sunken text-ink-soft">
                      <IconUserCircle size={16} />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-ink">{admin.displayName}</span>
                    </span>
                  </button>
                ))}
              </div>
            )}
            <ReversibleNote fromLabel={fromLabel} isFinalStep={isFinalActionableStep} />
            <button
              type="button"
              disabled={!chooseAdminCanContinue}
              onClick={goNext}
              className="mt-8 flex w-full items-center justify-center gap-2 rounded-md bg-accent px-5 py-2.5 font-display text-white enabled:cursor-pointer enabled:hover:bg-accent/90 disabled:opacity-40"
            >
              Review Deletion
            </button>
          </>
        )}

        {step === 'confirm-delete' && keptAdmin && (
          <>
            <BackLink onClick={goBack} />
            <h1 className="font-display text-2xl font-medium text-ink">Delete the other accounts?</h1>
            <p className="mt-2 text-sm text-ink-soft">
              {toLabel} supports only one account. <strong className="text-ink">{keptAdmin.displayName}</strong> will
              become that account, and the following {candidates.length - 1} account
              {candidates.length - 1 === 1 ? '' : 's'} will be permanently deleted:
            </p>
            <ul className="mt-4 flex flex-col gap-2">
              {candidates
                .filter((u) => u.id !== keptAdmin.id)
                .map((user) => (
                  <li key={user.id} className="rounded-md border border-[#f3d4ce] bg-[#fbe9e7] px-3 py-2 text-sm text-ink">
                    <span className="font-medium">{user.displayName}</span>
                  </li>
                ))}
            </ul>
            <p className="mt-4 text-xs text-ink-soft">
              This is the last step — until you click "Delete accounts now" below, you can still switch{' '}
              <code className="rounded bg-paper-sunken px-1 py-0.5">AUTH_METHOD</code> back to{' '}
              <strong className="text-ink">{fromLabel}</strong> and nothing will be lost. Clicking it deletes them
              immediately and can't be undone — anything specific to just those accounts (their own favorites,
              notes, and tags) is deleted along with them.
            </p>
            {completeMutation.isError && (
              <p className="mt-3 text-xs text-red-700">
                {completeMutation.error instanceof ApiError ? completeMutation.error.message : 'Something went wrong.'}
              </p>
            )}
            <button
              type="button"
              onClick={() => {
                const startedAt = Date.now()
                goNext()
                completeMutation.mutate(undefined, {
                  onSuccess: () => {
                    afterMinDuration(startedAt, goNext, 2500)
                  },
                  onError: () => {
                    goBack()
                  },
                })
              }}
              className="mt-8 flex w-full cursor-pointer items-center justify-center gap-2.5 rounded-md bg-red-700 px-6 py-3.5 font-display text-base font-medium text-white shadow-sm hover:bg-red-800"
            >
              <IconAlertTriangle size={20} />
              Delete accounts now
            </button>
          </>
        )}

        {step === 'updating' && (
          <div className="flex w-full flex-col items-center py-8 text-center">
            <IconLoader2 size={44} className="animate-spin text-ink" />
            <h1 className="mt-4 font-display text-2xl font-medium text-ink">Updating your library</h1>
            <p className="mt-2 text-sm text-ink-soft">This will only take a moment.</p>
          </div>
        )}

        {step === 'done' && (
          <div className="flex w-full flex-col items-center text-center">
            <IconCircleCheckFilled size={48} className="text-ink" />
            <h1 className="mt-4 font-display text-2xl font-medium text-ink">All set</h1>
            <p className="mt-2 text-sm text-ink-soft">
              Sonneck is now running with <strong className="text-ink">{toLabel}</strong>.
            </p>
            <button
              type="button"
              onClick={finish}
              className="mt-8 flex w-full cursor-pointer items-center justify-center gap-2 rounded-md border border-border bg-paper-raised px-5 py-2.5 font-display text-ink hover:border-accent"
            >
              {pending.to === 'none' ? 'Continue to Library' : 'Continue to Sign In'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
