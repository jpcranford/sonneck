import { useState } from 'react'
import { IconArrowLeft, IconCircleCheckFilled, IconUserCircle } from '@tabler/icons-react'
import { useMockupTitle } from '../lib/useMockupTitle'

// Auth Change flow — multi-user support, Phase 16 of the plan (memory
// project_multiuser_build.md / precious-kindling-pretzel.md's own "Auth
// Change flow" section). Built the same day Admin Settings' in-app
// Security "Change…" capability was removed entirely per direct
// feedback — security is now env-var-only, with zero in-app way to
// change AUTH_METHOD post-launch. In its place: the app detects an
// AUTH_METHOD change at boot (resolved value vs. a new stored
// `server_settings.last_active_auth_method`) and gates the whole app
// behind this flow, the exact same architectural shape FirstLaunchFlow.tsx
// already uses to gate the app before first-launch completes — just
// triggered by a different condition, and only ever reached *after*
// first-launch is already done.
//
// Reuses, rather than reinvents, the exact content the removed Security
// modal/downgrade-flow used to hold: the choose-admin and confirm-delete
// screens below are close to a direct port of what briefly existed in
// AdminSettingsMockup.tsx before it was pulled out — that work wasn't
// wasted, it just moved from an in-app admin action to a boot-time gate.
//
// Five fixture SCENARIOS cover every meaningfully-different content path a
// real AUTH_METHOD transition can take (a dev-only "Simulate detected
// change" preview control switches between them — not part of the shipped
// design, which only ever has one real detected transition to walk
// through): upgrading to OIDC (informational only, no data at risk),
// moving to Password with no existing password_hash (needs a new
// password, reusing FirstLaunchMockup.tsx's own password-fields shape),
// a light Password→No-login swap (nothing to adjust), downgrading from a
// *single*-account OIDC setup (light confirmation, nothing destroyed), and
// downgrading from a *multi*-account OIDC setup (the full destructive
// choose-admin + confirm-delete sequence). The step sequence itself is
// computed per scenario (`computeSteps`), not hardcoded, so composing two
// needs at once — e.g. the last scenario needs both a new password *and*
// the destructive downgrade — falls out naturally rather than needing a
// sixth hand-written case.

type AuthMethod = 'none' | 'singlepass' | 'oidc'

interface ScenarioUser {
  id: number
  name: string
  email: string | null
  isAdmin: boolean
}

interface Scenario {
  label: string
  fromLabel: string
  to: AuthMethod
  toLabel: string
  existingPasswordSet: boolean
  users: ScenarioUser[]
}

type ScenarioKey =
  | 'none-to-oidc'
  | 'none-to-singlepass'
  | 'singlepass-to-none'
  | 'oidc-to-none-single'
  | 'oidc-to-singlepass-multi'

const SCENARIOS: Record<ScenarioKey, Scenario> = {
  'none-to-oidc': {
    label: 'No login → OIDC SSO',
    fromLabel: 'No login',
    to: 'oidc',
    toLabel: 'OIDC SSO',
    existingPasswordSet: false,
    users: [{ id: 1, name: 'Admin', email: null, isAdmin: true }],
  },
  'none-to-singlepass': {
    label: 'No login → Password (new)',
    fromLabel: 'No login',
    to: 'singlepass',
    toLabel: 'Password',
    existingPasswordSet: false,
    users: [{ id: 1, name: 'Admin', email: null, isAdmin: true }],
  },
  'singlepass-to-none': {
    label: 'Password → No login',
    fromLabel: 'Password',
    to: 'none',
    toLabel: 'No login',
    existingPasswordSet: true,
    users: [{ id: 1, name: 'Admin', email: null, isAdmin: true }],
  },
  'oidc-to-none-single': {
    label: 'OIDC SSO (1 account) → No login',
    fromLabel: 'OIDC SSO',
    to: 'none',
    toLabel: 'No login',
    existingPasswordSet: false,
    users: [{ id: 1, name: 'Jamie Chen', email: 'jamie@example.com', isAdmin: true }],
  },
  'oidc-to-singlepass-multi': {
    label: 'OIDC SSO (3 accounts) → Password (new)',
    fromLabel: 'OIDC SSO',
    to: 'singlepass',
    toLabel: 'Password',
    existingPasswordSet: false,
    users: [
      { id: 1, name: 'Jamie Chen', email: 'jamie@example.com', isAdmin: true },
      { id: 2, name: 'Alex Rivera', email: 'alex@example.com', isAdmin: true },
      { id: 3, name: 'Sam Okafor', email: 'sam@example.com', isAdmin: false },
    ],
  },
}

type StepKey = 'intro' | 'password' | 'choose-admin' | 'confirm-delete' | 'done'

function computeSteps(scenario: Scenario): StepKey[] {
  const steps: StepKey[] = ['intro']
  const needsPassword = scenario.to === 'singlepass' && !scenario.existingPasswordSet
  const isDowngrade = scenario.users.length > 1
  const admins = scenario.users.filter((u) => u.isAdmin)
  if (needsPassword) steps.push('password')
  if (isDowngrade) {
    if (admins.length > 1) steps.push('choose-admin')
    steps.push('confirm-delete')
  }
  steps.push('done')
  return steps
}

function ScenarioPicker({
  scenarioKey,
  onChange,
}: {
  scenarioKey: ScenarioKey
  onChange: (key: ScenarioKey) => void
}) {
  return (
    <div className="fixed top-3 right-3 z-30 flex max-w-[min(92vw,620px)] flex-wrap items-center gap-2 rounded-md border border-dashed border-border bg-paper-raised px-2.5 py-1.5 text-xs text-ink-soft shadow-sm">
      <span>Simulate detected change:</span>
      <div className="flex flex-wrap overflow-hidden rounded border border-border">
        {(Object.keys(SCENARIOS) as ScenarioKey[]).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => onChange(key)}
            className={`cursor-pointer px-2 py-1 ${
              scenarioKey === key ? 'bg-accent text-white' : 'bg-paper hover:bg-paper-sunken'
            }`}
          >
            {SCENARIOS[key].label}
          </button>
        ))}
      </div>
    </div>
  )
}

// Reassurance copy, per direct feedback: nothing this flow does actually
// takes effect until the very last actionable step's own button is
// clicked — the operator can switch AUTH_METHOD back to whatever it was
// before at any earlier point and lose nothing. Shown on every step but
// 'done'; wording sharpens on whichever step is actually last for the
// current scenario (computed by the caller, not hardcoded to any one
// step key, since which step is last varies — 'intro' itself for a purely
// informational scenario, 'password' for one that only needs a new
// password, 'confirm-delete' for a destructive one).
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

export function AuthChangeFlowMockup() {
  useMockupTitle('Auth Change Flow')
  const [scenarioKey, setScenarioKey] = useState<ScenarioKey>('oidc-to-singlepass-multi')
  const [stepIndex, setStepIndex] = useState(0)
  const [keptAdminId, setKeptAdminId] = useState<number | null>(null)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  const scenario = SCENARIOS[scenarioKey]
  const steps = computeSteps(scenario)
  const step = steps[stepIndex]
  const admins = scenario.users.filter((u) => u.isAdmin)
  const keptAdmin = scenario.users.find((u) => u.id === keptAdminId) ?? null
  const usersToDelete = scenario.users.filter((u) => u.id !== keptAdminId)
  const passwordValid = password.length >= 8 && password === confirmPassword

  function selectScenario(key: ScenarioKey) {
    setScenarioKey(key)
    setStepIndex(0)
    setPassword('')
    setConfirmPassword('')
    const nextAdmins = SCENARIOS[key].users.filter((u) => u.isAdmin)
    setKeptAdminId(nextAdmins.length === 1 ? nextAdmins[0].id : null)
  }

  function goNext() {
    setStepIndex((i) => Math.min(i + 1, steps.length - 1))
  }
  function goBack() {
    setStepIndex((i) => Math.max(i - 1, 0))
  }

  const canContinue =
    step !== 'password' || passwordValid
  const chooseAdminCanContinue = step !== 'choose-admin' || keptAdminId !== null
  // 'done' is always last in `steps`, so the step right before it is the
  // real last *actionable* one — whichever step that turns out to be for
  // this scenario is where ReversibleNote's wording sharpens.
  const isFinalActionableStep = steps[steps.length - 2] === step

  return (
    <div className="flex min-h-dvh items-center justify-center bg-paper p-6">
      <ScenarioPicker scenarioKey={scenarioKey} onChange={selectScenario} />

      <div className="w-full max-w-md">
        <div className="mb-6 rounded-md border border-dashed border-accent/40 bg-accent-soft/40 px-4 py-2 text-xs text-ink-soft">
          Reference sample — <span className="font-medium text-ink">Auth Change flow (Phase 16)</span>. A
          boot-time gate, reached only when the app detects its resolved <code>AUTH_METHOD</code> no longer
          matches what it last ran under. Switch the scenario above to preview every content path.
        </div>

        {step === 'intro' && (
          <>
            <h1 className="font-display text-2xl font-medium text-ink">We noticed your sign-in method changed</h1>
            <p className="mt-2 text-sm text-ink-soft">
              Sonneck is now configured for <strong className="text-ink">{scenario.toLabel}</strong> — it was{' '}
              <strong className="text-ink">{scenario.fromLabel}</strong> last time it ran.
            </p>
            <p className="mt-2 text-sm text-ink-soft">
              {scenario.to === 'oidc'
                ? 'Existing data (favorites, notes, tags) carries over to whoever signs in first.'
                : scenario.users.length > 1
                  ? "The next few screens will walk you through what this means for your existing accounts."
                  : 'No other accounts are affected by this change.'}
            </p>
            <ReversibleNote fromLabel={scenario.fromLabel} isFinalStep={isFinalActionableStep} />
            <button
              type="button"
              onClick={goNext}
              className="mt-8 flex w-full cursor-pointer items-center justify-center gap-2 rounded-md bg-accent px-5 py-2.5 font-display text-white hover:bg-accent/90"
            >
              Continue
            </button>
          </>
        )}

        {step === 'password' && (
          <>
            <BackLink onClick={goBack} />
            <h1 className="font-display text-2xl font-medium text-ink">Set a password</h1>
            <p className="mt-1 text-sm text-ink-soft">
              {scenario.toLabel} gates the whole app behind a single shared password — pick one now.
            </p>
            <div className="mt-6 flex flex-col gap-2">
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Password (min. 8 characters)"
                className="w-full rounded-md border border-border bg-paper-raised px-3 py-2 text-sm text-ink"
              />
              <input
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                placeholder="Confirm password"
                className="w-full rounded-md border border-border bg-paper-raised px-3 py-2 text-sm text-ink"
              />
              {confirmPassword.length > 0 && !passwordValid && (
                <p className="text-xs text-red-700">
                  {password.length < 8 ? 'At least 8 characters.' : "Passwords don't match."}
                </p>
              )}
            </div>
            <ReversibleNote fromLabel={scenario.fromLabel} isFinalStep={isFinalActionableStep} />
            <button
              type="button"
              disabled={!canContinue}
              onClick={goNext}
              className="mt-8 flex w-full items-center justify-center gap-2 rounded-md bg-accent px-5 py-2.5 font-display text-white enabled:cursor-pointer enabled:hover:bg-accent/90 disabled:opacity-40"
            >
              Continue
            </button>
          </>
        )}

        {step === 'choose-admin' && (
          <>
            <BackLink onClick={goBack} />
            <h1 className="font-display text-2xl font-medium text-ink">Multiple admins found</h1>
            <p className="mt-1 text-sm text-ink-soft">
              {scenario.toLabel} supports only one account, and only an existing admin can become it. Choose
              which account to keep — every other account will be deleted next.
            </p>
            <div className="mt-6 flex flex-col gap-3" role="radiogroup" aria-label="Choose the surviving admin account">
              {admins.map((admin) => (
                <button
                  key={admin.id}
                  type="button"
                  onClick={() => setKeptAdminId(admin.id)}
                  role="radio"
                  aria-checked={keptAdminId === admin.id}
                  className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3.5 text-left ${
                    keptAdminId === admin.id
                      ? 'border-accent bg-accent-soft'
                      : 'border-border bg-paper-raised hover:border-accent/50'
                  }`}
                >
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-paper-sunken text-ink-soft">
                    <IconUserCircle size={16} />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-ink">{admin.name}</span>
                    {admin.email && <span className="block text-xs text-ink-soft">{admin.email}</span>}
                  </span>
                </button>
              ))}
            </div>
            <ReversibleNote fromLabel={scenario.fromLabel} isFinalStep={isFinalActionableStep} />
            <button
              type="button"
              disabled={!chooseAdminCanContinue}
              onClick={goNext}
              className="mt-8 flex w-full items-center justify-center gap-2 rounded-md bg-accent px-5 py-2.5 font-display text-white enabled:cursor-pointer enabled:hover:bg-accent/90 disabled:opacity-40"
            >
              Continue
            </button>
          </>
        )}

        {step === 'confirm-delete' && keptAdmin && (
          <>
            <BackLink onClick={goBack} />
            <h1 className="font-display text-2xl font-medium text-ink">Delete the other accounts?</h1>
            <p className="mt-2 text-sm text-ink-soft">
              {scenario.toLabel} supports only one account. <strong className="text-ink">{keptAdmin.name}</strong>{' '}
              will become that account, and the following {usersToDelete.length} account
              {usersToDelete.length === 1 ? '' : 's'} will be permanently deleted:
            </p>
            <ul className="mt-4 flex flex-col gap-2">
              {usersToDelete.map((user) => (
                <li key={user.id} className="rounded-md border border-[#f3d4ce] bg-[#fbe9e7] px-3 py-2 text-sm text-ink">
                  <span className="font-medium">{user.name}</span>
                  {user.email && <span className="text-ink-soft"> — {user.email}</span>}
                </li>
              ))}
            </ul>
            <p className="mt-4 text-xs text-ink-soft">
              This is the last step — until you click "Delete accounts and continue" below, you can still
              switch <code className="rounded bg-paper-sunken px-1 py-0.5">AUTH_METHOD</code> back to{' '}
              <strong className="text-ink">{scenario.fromLabel}</strong> and nothing will be lost. Once you
              click it, this can't be undone — anything specific to just those accounts (their own favorites,
              notes, and tags) is deleted along with them.
            </p>
            <button
              type="button"
              onClick={goNext}
              className="mt-8 flex w-full cursor-pointer items-center justify-center gap-2 rounded-md bg-red-700 px-5 py-2.5 font-display text-white hover:bg-red-800"
            >
              Delete accounts and continue
            </button>
          </>
        )}

        {step === 'done' && (
          <div className="flex flex-col items-center text-center">
            <IconCircleCheckFilled size={48} className="text-accent" />
            <h1 className="mt-4 font-display text-2xl font-medium text-ink">All set</h1>
            <p className="mt-2 text-sm text-ink-soft">
              Sonneck is now running with <strong className="text-ink">{scenario.toLabel}</strong>.
            </p>
            <button
              type="button"
              onClick={() => selectScenario(scenarioKey)}
              className="mt-8 cursor-pointer text-sm text-ink-soft underline hover:text-ink"
            >
              Restart this scenario
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
