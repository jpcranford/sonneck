import { useEffect, useState } from 'react'
import { IconAlertTriangle, IconArrowLeft, IconCircleCheckFilled, IconLoader2, IconUserCircle } from '@tabler/icons-react'
import { useMockupTitle } from '../lib/useMockupTitle'
import { afterMinDuration } from '../lib/minDuration'

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
//
// Direct-feedback revisions after the real build was already live-
// verified: the OIDC-upgrade intro copy was vague about what actually
// happens to existing data — reworded to say plainly that nothing is lost
// and the first person to sign in takes control of the existing account,
// both in the intro's own paragraph and in its closing reassurance line
// (a dedicated line for this one scenario, not the shared ReversibleNote
// below — that component's own "switch back and nothing is lost" framing
// only covers reverting, not the fact that *proceeding* is just as safe,
// which only genuinely holds for this specific lossless-upgrade case).
// An earlier pass also added an embedded preview of the Login Screen to
// the 'done' step, plus a "you land on the real Login Screen next" note —
// removed per direct feedback: the preview was superfluous once
// /mockup/login-screen exists as its own real reference, and mockups
// should read as the as-built copy, not carry mockup-to-mockup asides
// like "see its own mockup for every state."
//
// 'done' gained a real, genuine primary button per further direct
// feedback — a real design decision, not an oversight the first pass
// missed: every other step in this flow already ends on an explicit
// button the person clicks to move forward, so silently auto-transitioning
// away the instant the last one succeeds (this app's other boot-time gate,
// FirstLaunchFlow.tsx, does exactly that, with no equivalent final button
// of its own) would be the one step in this whole flow that doesn't ask
// for a deliberate "yes, continue" — worth breaking that precedent here on
// purpose. Labeled "Continue to Library" for a `none` target (no login
// screen to hand off to) or "Continue to Sign In" otherwise. In this
// mockup it re-runs the current scenario (`selectScenario`) rather than
// going anywhere real, the same stand-in every other "what happens next"
// control here already uses — the top `ScenarioPicker` remains the one
// actual way to switch scenarios, this button and the old dedicated
// "Restart this scenario" link (now folded into it, not kept as a second
// control) were both just this screen's own way of looping the demo.
//
// The destructive path's own confirm-delete button was relabeled "Delete
// accounts now" (was "...and continue") specifically to stop reading like
// it's the same kind of "continue" as the new button above — this one's
// click is the actual, immediate, irreversible trigger, not a step toward
// a later confirmation, and the added warning icon reinforces that same
// point visually, not just in the copy.
//
// A further pass strengthened both buttons in the destructive path per
// direct feedback: choose-admin's own "Continue" (bare navigation wording,
// same as every other non-destructive step) was relabeled "Review
// Deletion" — it's the last click before the confirm-delete screen, so
// naming what that screen actually is reads as more deliberate than a
// generic "Continue" would. confirm-delete's "Delete accounts now" got
// more visual weight (larger padding/text) on top of its existing
// red/icon treatment, so the two buttons read as an escalating pair
// rather than two identically-styled steps.
//
// A genuine new step, 'updating', now sits between confirm-delete and
// 'done' — clicking "Delete accounts now" no longer jumps straight to
// "All set"; it shows a full-screen spinner for a guaranteed minimum 2.5s
// (`afterMinDuration`, the same shared helper CLAUDE.md's own "a fast
// mutation needs an artificial minimum display duration" gotcha already
// established elsewhere, imported here as-is since it's pure logic with
// no markup of its own — the one kind of real-code import mockups are
// allowed) before auto-advancing to 'done' with no click needed. Real
// backend work (the destructive downgrade transaction, an OIDC discovery
// call if switching to OIDC, session issuance) is genuinely async in the
// shipped app, unlike this mockup's own fixture data — the spinner reflects
// that real wait, not just decorates a fake one. Scoped to the destructive
// path specifically, not every scenario — the lighter scenarios apply
// near-instantly with nothing worth narrating a wait for.
//
// Color corrections per direct feedback, all pulling 'done'/'updating' back
// from accent to neutral: the spinner (`IconLoader2`) and the checkmark
// (`IconCircleCheckFilled`) both read as `text-ink`, not `text-accent` —
// neutral "something happened" indicators, not accent-colored elements
// competing with the red confirm button that precedes them. 'done's own
// "Continue to Sign In"/"Continue to Library" button was likewise pulled
// back from solid `bg-accent` to this app's standard secondary/white
// button treatment (`border border-border bg-paper-raised text-ink
// hover:border-accent` — the same recipe used everywhere else in the app
// for a lower-emphasis action, e.g. FirstLaunchMockup.tsx's own "Preview
// again") — it's the literal end of the flow, not a decision point that
// needs to compete visually with the buttons that actually drove it
// forward.

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

type StepKey = 'intro' | 'password' | 'choose-admin' | 'confirm-delete' | 'updating' | 'done'

function computeSteps(scenario: Scenario): StepKey[] {
  const steps: StepKey[] = ['intro']
  const needsPassword = scenario.to === 'singlepass' && !scenario.existingPasswordSet
  const isDowngrade = scenario.users.length > 1
  const admins = scenario.users.filter((u) => u.isAdmin)
  if (needsPassword) steps.push('password')
  if (isDowngrade) {
    if (admins.length > 1) steps.push('choose-admin')
    // 'updating' only ever follows the destructive confirm-delete step —
    // the lighter scenarios apply near-instantly, with nothing worth a
    // spinner for.
    steps.push('confirm-delete', 'updating')
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

  // 'updating' auto-advances itself the moment it's reached (below) — a
  // real timer effect calling setState from its own callback once the
  // minimum display duration has elapsed, not a synchronous derivation,
  // so this doesn't hit the same react-hooks/set-state-in-effect gotcha
  // CLAUDE.md already documents elsewhere for the *other* kind of effect.
  useEffect(() => {
    if (step !== 'updating') return
    const startedAt = Date.now()
    let cancelled = false
    afterMinDuration(startedAt, () => {
      if (!cancelled) goNext()
    }, 2500)
    return () => {
      cancelled = true
    }
    // goNext deliberately excluded — it closes over `steps`, which is
    // recomputed every render, so including it would re-fire this effect
    // (and restart the 2.5s timer) far more often than intended; this
    // should only ever restart when `step` itself changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step])

  const canContinue =
    step !== 'password' || passwordValid
  const chooseAdminCanContinue = step !== 'choose-admin' || keptAdminId !== null
  // The real last *actionable* step — the last one with a button a person
  // actually clicks — isn't always steps[steps.length - 2] anymore now
  // that 'updating' can sit between it and 'done' non-interactively.
  const actionableSteps = steps.filter((s) => s !== 'updating' && s !== 'done')
  const isFinalActionableStep = step === actionableSteps[actionableSteps.length - 1]

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
                ? "Nothing is lost — the first person who signs in takes control of your existing account, with all its favorites, notes, and tags already there."
                : scenario.users.length > 1
                  ? "The next few screens will walk you through what this means for your existing accounts."
                  : 'No other accounts are affected by this change.'}
            </p>
            {scenario.to === 'oidc' ? (
              <p className="mt-4 text-xs text-ink-soft">
                Nothing is lost with this upgrade. To abandon before upgrading, switch{' '}
                <code className="rounded bg-paper-sunken px-1 py-0.5">AUTH_METHOD</code> back to{' '}
                <strong className="text-ink">{scenario.fromLabel}</strong>.
              </p>
            ) : (
              <ReversibleNote fromLabel={scenario.fromLabel} isFinalStep={isFinalActionableStep} />
            )}
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
            {/* text-base + tracking-wide, not text-sm — see
                LoginScreenMockup.tsx's own comment on its password field:
                the browser's masked "dot" glyph scales with font-size, and
                macOS renders a noticeably larger dot than Windows at the
                same small size, so bumping the font-size gives every OS a
                legible minimum dot size instead of leaving it to each
                platform's own default. */}
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
              Review Deletion
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
              This is the last step — until you click "Delete accounts now" below, you can still
              switch <code className="rounded bg-paper-sunken px-1 py-0.5">AUTH_METHOD</code> back to{' '}
              <strong className="text-ink">{scenario.fromLabel}</strong> and nothing will be lost. Clicking it
              deletes them immediately and can't be undone — anything specific to just those accounts (their
              own favorites, notes, and tags) is deleted along with them.
            </p>
            <button
              type="button"
              onClick={goNext}
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
              Sonneck is now running with <strong className="text-ink">{scenario.toLabel}</strong>.
            </p>
            <button
              type="button"
              onClick={() => selectScenario(scenarioKey)}
              className="mt-8 flex w-full cursor-pointer items-center justify-center gap-2 rounded-md border border-border bg-paper-raised px-5 py-2.5 font-display text-ink hover:border-accent"
            >
              {scenario.to === 'none' ? 'Continue to Library' : 'Continue to Sign In'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
