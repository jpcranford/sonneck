import { useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  IconArrowLeft,
  IconArrowRight,
  IconCircleCheckFilled,
  IconExternalLink,
  IconEye,
  IconEyeOff,
  IconFolderOpen,
  IconInfoCircle,
  IconKey,
  IconLockOpen2,
  IconShieldLock,
} from '@tabler/icons-react'
import type { AppConfig } from '../api/config'
import { ApiError } from '../api/client'
import { completeSetup } from '../api/setup'
import { afterMinDuration } from '../lib/minDuration'
import { SonneckWordmark } from '../components/SonneckWordmark'

// A meaningful confirmation screen ("You're all set"), not just a stripe
// animation's in-progress flicker — matches EditBookModal.tsx's own
// SAVED_DISPLAY_MS for the same "read a real success message" purpose,
// rather than lib/minDuration.ts's shorter generic default.
const DONE_DISPLAY_MS = 900

// First-Time Launch Flow — multi-user support, Phase 3 of the approved
// master plan (memory project_multiuser_build.md): real build of
// FirstLaunchMockup.tsx (/mockup/first-launch, kept as a standing design
// reference) — same layout/behavior, wired to the actual server instead of
// fixture data. If the two ever look different, that's either a bug or a
// change that needs porting to both.
//
// Two deliberate simplifications vs. the mockup, since neither has a real
// counterpart yet: no "Preview as Docker/Native" toggle (no native/Wails
// build exists — see memory project_wails_native_app_investigation.md —
// so the Folder step only has Docker's read-only path-confirmation
// variant, and the Security step's OIDC card only ever shows the Docker
// wording). Both need a real native branch once that build exists.
//
// App.tsx renders this in place of the real app for as long as
// config.firstLaunchCompleted is false, and passes down the same
// already-fetched config rather than this component re-querying it.

const TOTAL_STEPS = 2 // Welcome is an unnumbered intro, same convention as the Book Upload Wizard's own File step

type Step = 'welcome' | 'folder' | 'security' | 'done'

// Wizard chrome — Back button + "Step X of N" + dot progress, same visual
// language as the Book Upload Wizard's own per-step header (e.g.
// BookUploadAboutStep.tsx).
function WizardChrome({ step, onBack }: { step: number; onBack: () => void }) {
  return (
    <div className="mb-6 flex w-full items-center justify-between">
      <button
        type="button"
        onClick={onBack}
        className="flex cursor-pointer items-center gap-1.5 text-base text-ink-soft hover:text-ink"
      >
        <IconArrowLeft size={22} />
        Back
      </button>
      <div className="flex flex-col items-end gap-1.5">
        <span className="text-xs text-ink-soft">
          Step {step} of {TOTAL_STEPS}
        </span>
        <div className="flex gap-1.5">
          {Array.from({ length: TOTAL_STEPS }, (_, i) => i + 1).map((s) => (
            <span
              key={s}
              className={`h-1 w-5 rounded-full ${
                s < step ? 'bg-accent-on-dark' : s === step ? 'bg-accent' : 'bg-border'
              }`}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

function WelcomeStep({ onStart }: { onStart: () => void }) {
  return (
    <div className="flex w-full max-w-md flex-col items-center gap-5 text-center">
      <SonneckWordmark className="h-20 w-auto text-ink" />
      <div className="flex flex-col gap-3">
        <p className="text-sm text-ink-soft">
          Sonneck is your own sheet music library — organize, browse, and practice from every device on your
          network.
        </p>
        <p className="text-sm text-ink-soft">
          Two quick things before you start: where your library lives, and who's allowed in. Takes about a minute.
        </p>
      </div>
      <button
        type="button"
        onClick={onStart}
        className="mt-2 flex cursor-pointer items-center gap-2 rounded-md bg-accent px-5 py-2.5 font-display text-white hover:bg-accent/90"
      >
        Get Started
        <IconArrowRight size={18} />
      </button>
    </div>
  )
}

function FolderStep({ dataDir, onBack, onNext }: { dataDir: string; onBack: () => void; onNext: () => void }) {
  return (
    <div className="flex w-full max-w-md flex-col">
      <WizardChrome step={1} onBack={onBack} />
      <h1 className="font-display text-2xl font-medium text-ink">Where's your library?</h1>
      <p className="mt-1 text-sm text-ink-soft">
        This is the folder Sonneck reads and writes your books, pieces, and database to.
      </p>

      <div className="mt-6 flex flex-col gap-2.5">
        <div className="flex items-center gap-3 rounded-md border border-border bg-paper-sunken px-4 py-3">
          <IconFolderOpen size={20} className="shrink-0 text-ink-soft" />
          <div className="min-w-0 flex-1">
            <p className="truncate font-mono text-sm text-ink">{dataDir}</p>
            <p className="text-xs text-ink-soft">Mounted via your docker-compose.yml volume</p>
          </div>
        </div>
        <p className="flex items-start gap-1.5 text-xs text-ink-soft">
          <IconInfoCircle size={14} className="mt-0.5 shrink-0" />
          Running in Docker, your library location is set by the volume mount, not from here. To use a different
          folder, point the mount at it and restart the container.
        </p>
      </div>

      <button
        type="button"
        onClick={onNext}
        className="mt-8 flex w-full cursor-pointer items-center justify-center gap-2 rounded-md bg-accent px-5 py-2.5 font-display text-white hover:bg-accent/90"
      >
        Continue
        <IconArrowRight size={18} />
      </button>
    </div>
  )
}

interface SecurityCardProps {
  selected: boolean
  disabled?: boolean
  icon: React.ReactNode
  title: string
  description: string
  onSelect: () => void
  children?: React.ReactNode
}

function SecurityCard({ selected, disabled, icon, title, description, onSelect, children }: SecurityCardProps) {
  return (
    <div
      className={`rounded-lg border p-4 ${
        disabled
          ? 'cursor-not-allowed border-border bg-paper-sunken opacity-60'
          : selected
            ? 'cursor-pointer border-accent bg-accent-soft'
            : 'cursor-pointer border-border bg-paper-raised hover:border-accent/50'
      }`}
      onClick={disabled ? undefined : onSelect}
      role="radio"
      aria-checked={selected}
      aria-disabled={disabled}
      tabIndex={disabled ? -1 : 0}
      onKeyDown={(e) => {
        if (disabled) return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect()
        }
      }}
    >
      <div className="flex items-start gap-3">
        <span
          className={`mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full ${
            selected ? 'bg-accent text-white' : 'bg-paper-sunken text-ink-soft'
          }`}
        >
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-display font-medium text-ink">{title}</p>
          <p className="text-sm text-ink-soft">{description}</p>
        </div>
      </div>
      {children && <div className="mt-3 pl-11">{children}</div>}
    </div>
  )
}

// Shown instead of the picker cards once AUTH_METHOD is set via env var —
// same "field replaced by a hint, not shown as editable" convention Admin
// Settings' own env-var-shadowed fields will use.
function LockedSecurityNotice({ authMethod }: { authMethod: AppConfig['authMethod'] }) {
  const meta: Record<AppConfig['authMethod'], { icon: React.ReactNode; title: string; description: string }> = {
    none: {
      icon: <IconLockOpen2 size={16} />,
      title: 'No login',
      description: 'Anyone with network access to this app can use it, as one shared account.',
    },
    singlepass: {
      icon: <IconKey size={16} />,
      title: 'Password',
      description: 'A single shared password gates the whole app — still just one shared account behind it.',
    },
    oidc: {
      icon: <IconShieldLock size={16} />,
      title: 'Sign in with…',
      description: 'Configured through your identity provider — each person signs in as their own account.',
    },
  }
  const { icon, title, description } = meta[authMethod]

  return (
    <div className="rounded-lg border border-border bg-paper-sunken p-4">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-paper-raised text-ink-soft">
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-display font-medium text-ink">{title}</p>
            <span className="rounded-full border border-border bg-paper-raised px-2 py-0.5 text-[0.65rem] tracking-wide text-ink-soft uppercase">
              Set by environment variable
            </span>
          </div>
          <p className="text-sm text-ink-soft">{description}</p>
        </div>
      </div>
    </div>
  )
}

function PasswordFields({
  password,
  onPasswordChange,
  confirmPassword,
  onConfirmPasswordChange,
  showPassword,
  onToggleShowPassword,
  passwordValid,
}: {
  password: string
  onPasswordChange: (v: string) => void
  confirmPassword: string
  onConfirmPasswordChange: (v: string) => void
  showPassword: boolean
  onToggleShowPassword: () => void
  passwordValid: boolean
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <input
          type={showPassword ? 'text' : 'password'}
          value={password}
          onChange={(e) => onPasswordChange(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          placeholder="Password (min. 8 characters)"
          className="w-full rounded-md border border-border bg-paper-raised px-3 py-2 pr-9 text-sm text-ink"
        />
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onToggleShowPassword()
          }}
          aria-label={showPassword ? 'Hide password' : 'Show password'}
          className="absolute top-1/2 right-2 flex -translate-y-1/2 cursor-pointer items-center text-ink-soft hover:text-ink"
        >
          {showPassword ? <IconEyeOff size={16} /> : <IconEye size={16} />}
        </button>
      </div>
      <input
        type={showPassword ? 'text' : 'password'}
        value={confirmPassword}
        onChange={(e) => onConfirmPasswordChange(e.target.value)}
        onClick={(e) => e.stopPropagation()}
        placeholder="Confirm password"
        className="w-full rounded-md border border-border bg-paper-raised px-3 py-2 text-sm text-ink"
      />
      {confirmPassword.length > 0 && !passwordValid && (
        <p className="text-xs text-red-700">{password.length < 8 ? 'At least 8 characters.' : "Passwords don't match."}</p>
      )}
    </div>
  )
}

function SecurityStep({
  config,
  onBack,
  onFinish,
  pending,
  errorMessage,
}: {
  config: AppConfig
  onBack: () => void
  onFinish: (authMethod: 'none' | 'singlepass', password?: string) => void
  pending: boolean
  errorMessage: string | null
}) {
  const locked = config.authMethodSetByEnv
  const [choice, setChoice] = useState<'none' | 'singlepass'>(
    locked && config.authMethod === 'singlepass' ? 'singlepass' : 'none',
  )
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  const effectiveMethod = locked ? config.authMethod : choice
  const needsPassword = effectiveMethod === 'singlepass'
  const passwordValid = password.length >= 8 && password === confirmPassword
  const canFinish = !pending && (!needsPassword || passwordValid)

  const passwordFields = (
    <PasswordFields
      password={password}
      onPasswordChange={setPassword}
      confirmPassword={confirmPassword}
      onConfirmPasswordChange={setConfirmPassword}
      showPassword={showPassword}
      onToggleShowPassword={() => setShowPassword((v) => !v)}
      passwordValid={passwordValid}
    />
  )

  return (
    <div className="flex w-full max-w-md flex-col">
      <WizardChrome step={2} onBack={onBack} />
      <h1 className="font-display text-2xl font-medium text-ink">Who's allowed in?</h1>
      <p className="mt-1 text-sm text-ink-soft">
        You can change this later from Admin Settings. Every option can add named accounts and permissions once
        Sonneck's multi-user support is fully built out.
      </p>

      <div className="mt-6 flex flex-col gap-3">
        {locked ? (
          <>
            <LockedSecurityNotice authMethod={config.authMethod} />
            {needsPassword && passwordFields}
          </>
        ) : (
          <div className="flex flex-col gap-3" role="radiogroup" aria-label="Security">
            <SecurityCard
              selected={choice === 'none'}
              icon={<IconLockOpen2 size={16} />}
              title="No login"
              description="Anyone with network access to this app can use it, as one shared account. Fine on a private/trusted network."
              onSelect={() => setChoice('none')}
            />
            <SecurityCard
              selected={choice === 'singlepass'}
              icon={<IconKey size={16} />}
              title="Password"
              description="A single shared password gates the whole app — still just one shared account behind it, now locked."
              onSelect={() => setChoice('singlepass')}
            >
              {passwordFields}
            </SecurityCard>
            <SecurityCard
              selected={false}
              disabled
              icon={<IconShieldLock size={16} />}
              title="Sign in with…"
              description="OIDC / SSO through your existing identity provider (Authelia, Authentik, Keycloak, etc.) — each person signs in as their own account."
              onSelect={() => {}}
            >
              <p className="flex items-center gap-1.5 text-xs text-ink-soft">
                <IconInfoCircle size={14} className="shrink-0" />
                Configure via <code className="rounded bg-paper-sunken px-1 py-0.5">OIDC_*</code> environment
                variables.{' '}
                <a
                  href="https://github.com/jpcranford/sonneck#advanced-options"
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="inline-flex items-center gap-0.5 text-accent underline hover:text-accent/80"
                >
                  Setup guide
                  <IconExternalLink size={12} />
                </a>
              </p>
            </SecurityCard>
          </div>
        )}
      </div>

      {errorMessage && <p className="mt-3 text-xs text-red-700">{errorMessage}</p>}

      <button
        type="button"
        disabled={!canFinish}
        onClick={() => (needsPassword ? onFinish('singlepass', password) : onFinish('none'))}
        className="mt-8 flex w-full items-center justify-center gap-2 rounded-md bg-accent px-5 py-2.5 font-display text-white enabled:cursor-pointer enabled:hover:bg-accent/90 disabled:opacity-40"
      >
        {pending ? 'Saving…' : 'Finish Setup'}
      </button>
    </div>
  )
}

function DoneStep({ onContinue }: { onContinue: () => void }) {
  return (
    <div className="flex w-full max-w-md flex-col items-center gap-4 text-center">
      <IconCircleCheckFilled size={40} className="text-accent" />
      <h1 className="font-display text-2xl font-medium text-ink">You're all set</h1>
      <p className="text-sm text-ink-soft">Taking you into your library…</p>
      <button
        type="button"
        onClick={onContinue}
        className="mt-2 flex cursor-pointer items-center gap-2 rounded-md border border-border bg-paper-raised px-4 py-2 font-display text-ink hover:border-accent"
      >
        Continue to Sonneck
      </button>
    </div>
  )
}

interface FirstLaunchFlowProps {
  config: AppConfig
}

export function FirstLaunchFlow({ config }: FirstLaunchFlowProps) {
  const [step, setStep] = useState<Step>('welcome')
  const queryClient = useQueryClient()
  // Date.now() capture lives in mutationFn, not before mutate() is called —
  // same reasoning as EditBookModal.tsx's own saveStartedAtRef: mutationFn
  // is only ever invoked from mutate() itself, so it's unambiguous to the
  // react-hooks/purity lint rule in a way capturing it inline in an event
  // handler further up isn't always.
  const setupStartedAtRef = useRef(0)

  const completeMutation = useMutation({
    mutationFn: (vars: { authMethod: 'none' | 'singlepass'; password?: string }) => {
      setupStartedAtRef.current = Date.now()
      return completeSetup(vars.authMethod, vars.password)
    },
    onSuccess: () => {
      setStep('done')
      // This app's mutations hit a local SQLite backend and routinely
      // resolve in under a paint frame (lib/minDuration.ts) — confirmed
      // live here: an earlier pass invalidating immediately let the
      // refetched config (firstLaunchCompleted: true) reach App.tsx and
      // unmount this component before "You're all set" was ever actually
      // painted, skipping straight to the real app. Deferring the
      // invalidation itself (not just the visual state) is what actually
      // guarantees the confirmation screen gets seen — App.tsx holds the
      // same ['config'] query and swaps to the real app on its own once
      // this refetch lands; the Done screen's own button is a defensive
      // fallback in case that's ever slow.
      afterMinDuration(
        setupStartedAtRef.current,
        () => {
          void queryClient.invalidateQueries({ queryKey: ['config'] })
        },
        DONE_DISPLAY_MS,
      )
    },
  })

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-paper p-6">
      {step === 'welcome' && <WelcomeStep onStart={() => setStep('folder')} />}
      {step === 'folder' && (
        <FolderStep
          dataDir={config.dataDir ?? '/data'}
          onBack={() => setStep('welcome')}
          onNext={() => setStep('security')}
        />
      )}
      {step === 'security' && (
        <SecurityStep
          config={config}
          onBack={() => setStep('folder')}
          onFinish={(authMethod, password) => completeMutation.mutate({ authMethod, password })}
          pending={completeMutation.isPending}
          errorMessage={
            completeMutation.isError
              ? completeMutation.error instanceof ApiError
                ? completeMutation.error.message
                : 'Something went wrong.'
              : null
          }
        />
      )}
      {step === 'done' && (
        <DoneStep onContinue={() => void queryClient.invalidateQueries({ queryKey: ['config'] })} />
      )}
    </div>
  )
}
