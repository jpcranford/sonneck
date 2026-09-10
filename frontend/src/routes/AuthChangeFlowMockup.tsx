import { useEffect, useState } from 'react'
import { IconAlertTriangle, IconArrowLeft, IconCircleCheck, IconLoader2, IconUserCircle } from '@tabler/icons-react'
import { useMockupTitle } from '../lib/useMockupTitle'
import { afterMinDuration } from '../lib/minDuration'

// Auth Change flow — a boot-time gate, the exact same architectural shape
// FirstLaunchFlow.tsx already uses to gate the app before first-launch
// completes. Security has no in-app way to change AUTH_METHOD
// post-launch — it's env-var-only. In its place: the app detects an
// AUTH_METHOD change at boot (resolved value vs. a stored
// `server_settings.last_active_auth_method`) and gates the whole app
// behind this flow, triggered by that detected change rather than by
// first-launch, and only ever reached *after* first-launch is already
// done.
//
// Reuses, rather than reinvents, the content that briefly existed in
// AdminSettingsMockup.tsx's own in-app Security "Change…"
// modal/downgrade-flow before it was pulled out of there: the
// choose-admin and confirm-delete screens below are close to a direct
// port of that content, just moved from an in-app admin action to a
// boot-time gate.
//
// Six fixture SCENARIOS cover every meaningfully-different content path a
// real AUTH_METHOD transition can take (a dev-only "Simulate detected
// change" preview control switches between them — not part of the shipped
// design, which only ever has one real detected transition to walk
// through): upgrading to OIDC (informational only, no data at risk),
// moving to Password with no existing password_hash (needs a new
// password, reusing FirstLaunchMockup.tsx's own password-fields shape),
// a light Password→No-login swap (nothing to adjust), downgrading from a
// *single*-account OIDC setup (its own no-deletion confirm step, nothing
// destroyed), downgrading from a multi-account OIDC setup with only one
// eligible admin (skips choose-admin, goes straight to the real
// destructive confirm since the other, non-admin account still has to
// go), and downgrading from a genuinely *multi-admin* OIDC setup (the
// full destructive choose-admin + confirm-delete sequence). The step
// sequence itself is computed per scenario (`computeSteps`), not
// hardcoded, so composing two needs at once — e.g. the last scenario
// needs both a new password *and* the destructive downgrade — falls out
// naturally rather than needing a sixth hand-written case.
//
// The OIDC-upgrade intro copy states plainly that nothing is lost and the
// first person to sign in takes control of the existing account, both in
// the intro's own paragraph and in its closing reassurance line (a
// dedicated line for this one scenario, not the shared ReversibleNote
// below — that component's own "switch back and nothing is lost" framing
// only covers reverting, not the fact that *proceeding* is just as safe,
// which only genuinely holds for this specific lossless-upgrade case).
// The 'done' step deliberately has no embedded preview of the Login
// Screen — /mockup/login-screen already exists as its own real reference,
// and a mockup should read as the as-built copy, not carry mockup-to-
// mockup asides like "see its own mockup for every state."
//
// 'done' ends on a real, genuine primary button rather than
// auto-transitioning — a deliberate divergence from this app's other
// boot-time gate, FirstLaunchFlow.tsx, which does auto-transition with no
// equivalent final button of its own: every other step in this flow
// already ends on an explicit button click to move forward, so silently
// vanishing the instant the last one succeeds would be the one step in
// this whole flow that doesn't ask for a deliberate "yes, continue".
// Labeled "Continue to Library" for a `none` target (no login screen to
// hand off to) or "Continue to Sign In" otherwise. In this mockup it
// re-runs the current scenario (`selectScenario`) rather than going
// anywhere real, the same stand-in every other "what happens next"
// control here already uses — the top `ScenarioPicker` remains the one
// actual way to switch scenarios.
//
// The destructive path's own confirm-delete button reads "Delete accounts
// now", not "...and continue" — it needs to read as the actual,
// immediate, irreversible trigger, not a step toward a later
// confirmation, and the warning icon reinforces that same point visually,
// not just in the copy. choose-admin's own button reads "Review
// Deletion" rather than a bare "Continue" (every other non-destructive
// step's wording) since it's the last click before the confirm-delete
// screen — naming what that screen actually is reads as more deliberate.
// confirm-delete's "Delete accounts now" carries more visual weight
// (larger padding/text) on top of its existing red/icon treatment, so the
// two buttons read as an escalating pair rather than two
// identically-styled steps.
//
// A genuine 'updating' step sits between confirm-delete and 'done' —
// clicking "Delete accounts now" doesn't jump straight to "All set"; it
// shows a full-screen spinner for a guaranteed minimum 2.5s
// (`afterMinDuration`, the same shared "a fast mutation needs an
// artificial minimum display duration" helper used elsewhere, imported
// here as-is since it's pure logic with no markup of its own — the one
// kind of real-code import mockups are allowed) before auto-advancing to
// 'done' with no click needed. Real backend work (the destructive
// downgrade transaction, an OIDC discovery call if switching to OIDC,
// session issuance) is genuinely async in the shipped app, unlike this
// mockup's own fixture data — the spinner reflects that real wait, not
// just decorates a fake one. Scoped to the destructive path specifically,
// not every scenario — the lighter scenarios apply near-instantly with
// nothing worth narrating a wait for.
//
// 'done'/'updating' are pulled back from accent to neutral: the spinner
// (`IconLoader2`) and the checkmark (`IconCircleCheckFilled`) both read
// as `text-ink`, not `text-accent` — neutral "something happened"
// indicators, not accent-colored elements competing with the red confirm
// button that precedes them. 'done's own "Continue to Sign In"/"Continue
// to Library" button is likewise this app's standard secondary/white
// button treatment (`border border-border bg-paper-raised text-ink
// hover:border-accent` — the same recipe used everywhere else in the app
// for a lower-emphasis action, e.g. FirstLaunchMockup.tsx's own "Preview
// again") rather than solid `bg-accent` — it's the literal end of the
// flow, not a decision point that needs to compete visually with the
// buttons that actually drove it forward.
//
// A multi-account downgrade with only one eligible admin: here,
// computeSteps conditions the choose-admin step on `admins.length > 1`
// (known synchronously from fixture data) and selectScenario pre-selects
// the lone admin as keptAdminId, so scenario 'oidc-to-none-lone-admin'
// (the default) skips the step entirely and goes straight to
// confirm-delete. The real component can't know admin count until
// GET /api/auth-change/candidates resolves, so it takes a different but
// equivalent-UX approach instead of skipping the step outright: it always
// renders choose-admin, but shows a plain single-admin confirmation (no
// redundant one-option radio group) whenever the resolved admin count is
// 1, with keptAdmin auto-derived rather than requiring a click.

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
  | 'oidc-to-none-lone-admin'
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
  // Exercises the "rough edge" fix: multiple accounts exist (isDowngrade
  // is true), but only one of them is an admin — the only real candidate
  // to keep. computeSteps below already omits 'choose-admin' whenever
  // admins.length <= 1, and selectScenario already pre-selects that lone
  // admin as keptAdminId — this scenario is what makes that path
  // reachable/previewable at all, since no prior fixture had a
  // multi-account, single-admin combination.
  'oidc-to-none-lone-admin': {
    label: 'OIDC SSO (1 admin + 1 member) → No login',
    fromLabel: 'OIDC SSO',
    to: 'none',
    toLabel: 'No login',
    existingPasswordSet: false,
    users: [
      { id: 1, name: 'Jamie Chen', email: 'jamie@example.com', isAdmin: true },
      { id: 2, name: 'Riley Park', email: 'riley@example.com', isAdmin: false },
    ],
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
  // A downgrade away from OIDC always gets its own explicit confirm step —
  // 'confirm-delete' — regardless of how many accounts exist. Previously
  // this step (and 'choose-admin' ahead of it) only appeared when more
  // than one account existed; a single-OIDC-account downgrade jumped
  // straight from intro to done instead, the one downgrade scenario with
  // no explicit "yes, continue" moment of its own. Keeping the step count
  // fixed per transition type (never conditionally inserted/omitted based
  // on account count) also sidesteps the real difficulty the live
  // AuthChangeFlow.tsx hits porting this: its account list only resolves
  // once GET /api/auth-change/candidates returns, so skipping a step
  // based on that count needs an effect-driven step-index adjustment —
  // always rendering the step and varying its *content* once the data
  // arrives avoids that entirely.
  const isFromOidc = scenario.fromLabel === 'OIDC SSO'
  const admins = scenario.users.filter((u) => u.isAdmin)
  const willDeleteAccounts = scenario.users.length > 1
  if (needsPassword) steps.push('password')
  if (isFromOidc) {
    if (admins.length > 1) steps.push('choose-admin')
    steps.push('confirm-delete')
    // 'updating' only ever follows when 'confirm-delete' is actually
    // destructive — the no-deletion variant (a single existing account)
    // applies instantly, same as every other light scenario.
    if (willDeleteAccounts) steps.push('updating')
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

// Reassurance copy: nothing this flow does actually
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

// Shared by the initial state below and selectScenario, so a scenario
// with exactly one eligible admin always starts pre-selected — same as
// the real flow ends up needing to do once choose-admin is skipped for
// that case, just simpler here since fixture users are synchronous
// (no query to wait on before the lone candidate is known).
function lonelyAdminId(scenario: Scenario): number | null {
  const admins = scenario.users.filter((u) => u.isAdmin)
  return admins.length === 1 ? admins[0].id : null
}

const DEFAULT_SCENARIO: ScenarioKey = 'oidc-to-none-lone-admin'

export function AuthChangeFlowMockup() {
  useMockupTitle('Auth Change Flow')
  const [scenarioKey, setScenarioKey] = useState<ScenarioKey>(DEFAULT_SCENARIO)
  const [stepIndex, setStepIndex] = useState(0)
  const [keptAdminId, setKeptAdminId] = useState<number | null>(() => lonelyAdminId(SCENARIOS[DEFAULT_SCENARIO]))
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
    setKeptAdminId(lonelyAdminId(SCENARIOS[key]))
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
          Reference sample — <span className="font-medium text-ink">Auth Change flow</span>. A
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

        {step === 'confirm-delete' && keptAdmin && usersToDelete.length === 0 && (
          // The no-deletion variant of this same step — reached whenever a
          // downgrade comes from an OIDC setup with only one existing
          // account, so there's genuinely nothing to choose or delete.
          // Exists specifically so this scenario still gets an explicit,
          // deliberate "yes, continue" moment of its own, the same as
          // every destructive scenario already gets via the variant below
          // — rather than silently completing the instant intro's own
          // Continue button is clicked, which would make this the one
          // downgrade path with no confirm step at all.
          <>
            <BackLink onClick={goBack} />
            <h1 className="font-display text-2xl font-medium text-ink">Confirm the switch</h1>
            <p className="mt-2 text-sm text-ink-soft">
              No accounts need to be deleted — <strong className="text-ink">{keptAdmin.name}</strong> is the
              only account here. Continuing switches Sonneck to{' '}
              <strong className="text-ink">{scenario.toLabel}</strong>; everything else about your library
              stays exactly as it is.
            </p>
            <ReversibleNote fromLabel={scenario.fromLabel} isFinalStep={isFinalActionableStep} />
            <button
              type="button"
              onClick={goNext}
              className="mt-8 flex w-full cursor-pointer items-center justify-center gap-2 rounded-md bg-accent px-5 py-2.5 font-display text-white hover:bg-accent/90"
            >
              Confirm and Continue
            </button>
          </>
        )}

        {step === 'confirm-delete' && keptAdmin && usersToDelete.length > 0 && (
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
            <IconCircleCheck size={48} className="text-ink" />
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
