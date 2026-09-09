import { useRef, useState } from 'react'
import {
  IconChevronDown,
  IconCircleCheck,
  IconCircleDashedPlus,
  IconExternalLink,
  IconInfoCircle,
  IconKey,
  IconLockOpen2,
  IconTrash,
  IconUserCircle,
} from '@tabler/icons-react'
import { InfoTooltip } from '../components/InfoTooltip'
import { Modal } from '../components/Modal'
import { useMockupTitle } from '../lib/useMockupTitle'

// Admin Settings — multi-user support, Phase 9 of the plan (memory
// project_multiuser_build.md). Real build of the approved Phase 6 artifact:
// Option B ("single scrolling page, pill-style jump-nav") for the overall
// structure (one continuous page, no tab state), but each section renders
// as its own bordered card rather than one shared panel with dividers —
// switched over per direct feedback to match User Settings' own Phase 8
// Option 2 ("separate cards per section") look, so the two settings pages
// read consistently. The jump-nav pills (the part of Option B that
// actually distinguished it from Option A) are unchanged — still one
// strip above the section cards, still real same-page anchor links.
//
// Applies both forward notes locked when Phase 6 was approved:
// 1. The Version section's copy now explicitly warns that the check only
//    ever compares against official GitHub releases — a :dev/:beta install
//    can be genuinely ahead of the latest release shown here with no way
//    for the check to know that. **Superseded 2026-09-08, see below** — the
//    check itself was refined so this is no longer a caveat the copy has
//    to apologize for; it's now genuinely handled.
// 2. EVERY Library Settings field (not just Backup schedule, the only one
//    the artifact actually demoed locked) independently shows "Set by
//    environment variable" the moment its own env var is set, with env
//    always winning. Demonstrated here via a dev-only "Simulate env vars
//    set" preview strip — not part of the shipped design, just how this
//    mockup proves every field (not only one) can independently flip.
//
// One real backend gap the Phase 6 artifact's own footer flagged, still
// unbuilt (Phase 13 dependency, not a design blocker): no runtime version
// identity exists yet to power the Version section below.
//
// Version identification was tweaked per direct feedback after this phase
// was first approved: rather than a plain "vX.Y.Z" baked in at build time,
// the real mechanism identifies a build by its own commit SHA (injected at
// build time, same Phase 13 dependency as above) checked against GitHub's
// release *and* pre-release tags — that tag's name if one points at this
// exact commit, else "Dev build, from commit <shortSHA> on <date>". See
// BUILD_FIXTURES/the Version section's own "Preview build identity"
// control below, which previews all three outcomes (not a real toggle —
// the shipped page only ever has one true build identity to report).
//
// "Check for updates" refined 2026-09-08, per direct feedback on the
// master plan (precious-kindling-pretzel.md's Status/Backend architecture
// sections) — plan-only at the time, now ported into this mockup's copy
// and preview states. The real endpoint won't just compare against the
// latest official release and call it a day; it double-checks (GitHub's
// compare API, keyed off the same injected commit SHA the build-identity
// mechanism above already needs) whether the *running* commit is actually
// behind that release before ever claiming "update available" — so a
// pre-release/dev build that's already ahead of the latest official
// release correctly shows "ahead," not a false update prompt. Each
// BUILD_FIXTURES entry now carries its own `checkResult` ('upToDate' for
// the tagged-release fixture, 'ahead' for the pre-release one, 'behind'
// for the dev one) so flipping through the existing "Preview build
// identity" toggle also previews all three check outcomes, without a
// second toggle control. The footer copy's old apologetic "it may already
// be newer than what's shown here" caveat is gone, replaced by copy
// describing the real fix, plus a line about result caching (a real
// concern flagged the same round: this control can get clicked repeatedly
// over the weeks between releases, so results are cached server-side
// rather than re-hitting GitHub every time).
//
// Security's in-app "Change…" flow (a modal chooser, plus a two-step
// downgrade-from-multi-user flow reusing FirstLaunchFlow.tsx's own
// full-page-takeover weight for the destructive "delete every other
// account" case) was built here, then removed entirely per direct
// feedback: any change touching OIDC (or downgrading away from a
// multi-account OIDC install) is env-var-only, full stop. The
// destructive-downgrade content that flow used to hold (choose which
// admin survives, confirm deleting the rest) wasn't thrown away — it's
// the reason **Phase 16, "Build — Auth Change flow,"** exists: the app
// detects an `AUTH_METHOD` change at boot (comparing the resolved value
// against a stored "last known" one) and walks the admin through exactly
// that same choose-then-confirm content as a startup gate. See
// `/mockup/auth-change-flow` and the master plan's own "Auth Change flow"
// design section.
//
// **Re-added per direct feedback, narrower than what was removed**: while
// the *current* method is `none` or `singlepass` (never `oidc` — that
// stays permanently env-var-only and unreachable from here) and `AUTH_METHOD`
// isn't itself env-set (the existing env-shadow pill still wins otherwise),
// a "Change…" button reappears — a small modal choosing "No login" or
// "Password" (add/reset/remove a password by picking Password with a new
// value, blank to keep the current one, or picking No login to clear it).
// No downgrade risk exists in this scope at all — `none`/`singlepass` are
// always exactly one implicit account either way, so there's nothing to
// lose and no need for the destructive full-screen flow above; this is a
// direct, immediate, un-gated save, unlike the boot-time Auth Change flow
// OIDC transitions still require.
//
// **Follow-up fix, same day**: `identityKey === 'oidc'` used to render its
// own bespoke "OIDC is never changeable here" static text, separate from
// the normal env-var-shadow pill every other field uses. Direct feedback:
// OIDC is *always* env-var-set for real (there's no other way it's ever
// enabled), so that distinction was fake — an active `oidc` identity now
// just forces `envSet` true for this one field (`EnvSimulatorStrip`'s own
// Security checkbox is force-checked and disabled to match, rather than
// letting it show an impossible "OIDC, but not env-set" combination), and
// the field falls back to the one standard pill every other field already
// uses. Simpler code too — `control` is unconditionally the Change button
// now, since `LibraryField` never even renders it once `envSet` is true.
//
// Users gained a per-row delete (trash icon, guarded by the same
// `isLastAdmin` check the permission grid already uses, confirmed via a
// plain `window.confirm()` matching `BookContextMenu.tsx`'s existing
// hard-delete convention rather than a custom dialog).
//
// Lookup Tables gained create/delete, per direct feedback: a circular "+"
// at the end of each column appends a new blank row (auto-focused via
// `lastAddedLookupIdRef`, self-removed on blur if left empty — no stray
// unnamed entries), and each existing row's own delete button opens a real
// modal asking whether to merge the entry into another one in the same
// column (a live dropdown of the others) or delete it outright, rather
// than deleting immediately — the two destructive paths differ only in
// framing here (both just remove the entry from this mockup's own
// fixture; a real backend would additionally reassign every piece/book
// tagged with it before removing the row on the merge path).

type IdentityKey = 'none' | 'singlepass' | 'oidc'

const IDENTITY_LABELS: Record<IdentityKey, string> = {
  none: 'No login',
  singlepass: 'Password',
  oidc: 'OIDC (multiple accounts)',
}

// oidc's provider name is hand-copied as "Authelia" — the exact same
// fixture value UserSettingsMockup.tsx's own IDENTITIES record already
// uses for its "Signed in via {provider} as {email}" line, kept in sync
// deliberately rather than reinvented here. Real data comes from the
// already-planned `EXTERNAL_PROVIDER` env var (Auth methods table, master
// plan) — the display name an operator sets alongside the other OIDC_*
// vars, not something this screen would ever let an admin type in.
const SECURITY_STATUS: Record<IdentityKey, string> = {
  none: 'No login',
  singlepass: 'Password',
  oidc: 'Sign in with Authelia',
}

const ALL_PERMS = [
  'read',
  'download',
  'practice',
  'edit',
  'upload',
  'create',
  'delete',
  'admin',
] as const
type Permission = (typeof ALL_PERMS)[number]

// Matches the locked permission-mapping in the master plan
// (precious-kindling-pretzel.md's own "Permission model" section) — kept
// in sync with that doc, not re-derived independently, since Phase 10's
// real backend enforces exactly this mapping.
const PERM_DESCRIPTIONS: Record<Permission, string> = {
  read: 'View and search pieces, books, and people.',
  download: "Download a piece's file.",
  practice: 'Use practice tracking and annotations (Sheet Viewer, once built).',
  edit: 'Edit piece, book, and person details.',
  upload: 'Upload new pieces and books.',
  create: 'Create new setlists.',
  delete: 'Delete pieces, books, and people.',
  admin: 'Full access to everything, including these settings — implies every permission above.',
}

interface AdminUser {
  id: number
  name: string
  email: string | null
  perms: Permission[]
}

const INITIAL_USERS: Record<IdentityKey, AdminUser[]> = {
  none: [{ id: 1, name: 'Admin', email: null, perms: ['admin'] }],
  singlepass: [{ id: 1, name: 'Admin', email: null, perms: ['admin'] }],
  oidc: [
    { id: 1, name: 'Jamie Chen', email: 'jamie@example.com', perms: ['admin'] },
    {
      id: 2,
      name: 'Alex Rivera',
      email: 'alex@example.com',
      perms: ['read', 'download', 'practice'],
    },
    { id: 3, name: 'Sam Okafor', email: 'sam@example.com', perms: ['read'] },
  ],
}

// Version identification, tweaked per direct feedback: rather than a
// version string baked in at build time, the real check would compare this
// build's own commit SHA (injected at build time, same Phase 13 dependency
// already noted below) against GitHub's release *and* pre-release tags —
// showing that tag's name if one points at this exact commit, else a dev
// build identified by its own short SHA + commit date. BUILD_FIXTURES
// previews all three outcomes; not a real toggle in the shipped page,
// which only ever has one real build identity to report.
//
// Each fixture also carries its own `checkResult` (added 2026-09-08, see
// this file's header comment) so the same "Preview build identity" toggle
// doubles as a preview of "Check for updates"' three possible outcomes —
// the tagged release is already current (`upToDate`), the tagged
// pre-release is genuinely ahead of the latest official release
// (`ahead` — the exact case the old naive check would've gotten wrong),
// and the dev build is genuinely behind it (`behind`, with a real
// `availableVersion` to surface).
type BuildKind = 'release' | 'prerelease' | 'dev'
type CheckResult = 'upToDate' | 'ahead' | 'behind'

const BUILD_FIXTURES: Record<
  BuildKind,
  {
    label: string
    shortSha: string
    commitDate: string
    releaseName?: string
    checkResult: CheckResult
    availableVersion?: string
  }
> = {
  release: {
    label: 'Tagged release (up to date)',
    shortSha: 'a1b2c3d',
    commitDate: '2026-08-30',
    // No "v" prefix — real release tags are bare numbers ("0.5", "0.5.1"),
    // confirmed against this repo's own actual releases; fixed 2026-09-09
    // after this fixture drifted from that real convention.
    releaseName: '0.5',
    checkResult: 'upToDate',
  },
  prerelease: {
    label: 'Tagged pre-release (ahead of latest)',
    shortSha: 'f9e8d7c',
    commitDate: '2026-09-02',
    releaseName: '0.6-beta.1',
    checkResult: 'ahead',
  },
  dev: {
    label: 'Dev build (update available)',
    shortSha: '7c3a9f1',
    commitDate: '2026-09-06',
    checkResult: 'behind',
    availableVersion: '0.6',
  },
}

type LookupColumn = 'Sheet Types' | 'Instruments'

interface LookupItem {
  id: number
  name: string
}

const INITIAL_LOOKUP_TABLES: Record<LookupColumn, LookupItem[]> = {
  'Sheet Types': [
    { id: 1, name: 'Lead Sheet' },
    { id: 2, name: 'Solo Part' },
    { id: 3, name: 'Ensemble Score' },
    { id: 4, name: 'PVG Score' },
  ],
  Instruments: [
    { id: 5, name: 'Piano' },
    { id: 6, name: 'Violin' },
    { id: 7, name: 'Flute' },
    { id: 8, name: 'Trumpet' },
    { id: 9, name: 'Guitar' },
  ],
}

const JUMP_LINKS = [
  { id: 'library-settings', label: 'Library Settings' },
  { id: 'library', label: 'Library' },
  { id: 'version', label: 'Version' },
  { id: 'users', label: 'Users' },
  { id: 'lookup', label: 'Lookup Tables' },
]

type EnvKey = 'backupSchedule' | 'backupRetention' | 'logLevel' | 'copyrightRegion' | 'security'

const ENV_VAR_NAMES: Record<EnvKey, string> = {
  backupSchedule: 'BACKUP_CRON',
  backupRetention: 'BACKUP_RETENTION_DAYS',
  logLevel: 'LOG_LEVEL',
  copyrightRegion: 'COPYRIGHT_REGION',
  security: 'AUTH_METHOD',
}

function IdentityStateToggle({
  state,
  onChange,
}: {
  state: IdentityKey
  onChange: (state: IdentityKey) => void
}) {
  return (
    <div className="fixed top-16 right-3 z-30 flex max-w-[min(92vw,560px)] flex-wrap items-center gap-2 rounded-md border border-dashed border-border bg-paper-raised px-2.5 py-1.5 text-xs text-ink-soft shadow-sm md:top-3">
      <span>Identity state</span>
      <div className="flex flex-wrap overflow-hidden rounded border border-border">
        {(Object.keys(IDENTITY_LABELS) as IdentityKey[]).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => onChange(key)}
            className={`cursor-pointer px-2 py-1 ${
              state === key ? 'bg-accent text-white' : 'bg-paper hover:bg-paper-sunken'
            }`}
          >
            {IDENTITY_LABELS[key]}
          </button>
        ))}
      </div>
    </div>
  )
}

// Dev-only preview strip — proves the env-var-shadow rule generalizes to
// every field below, not just Backup schedule. Not part of the shipped
// design: the real page has no such control, since a field's env-shadowed
// state comes from whatever GET /api/config actually reports, not a
// user-facing toggle.
function EnvSimulatorStrip({
  overrides,
  onToggle,
  oidcActive,
}: {
  overrides: Record<EnvKey, boolean>
  onToggle: (key: EnvKey) => void
  // OIDC is always env-var-set for real — forces the Security checkbox on
  // and disables it while `oidc` is the previewed identity, rather than
  // letting it show an impossible "OIDC, but not env-set" combination.
  oidcActive: boolean
}) {
  const labels: Record<EnvKey, string> = {
    backupSchedule: 'Backup schedule',
    backupRetention: 'Backup retention',
    logLevel: 'Log level',
    copyrightRegion: 'Copyright region',
    security: 'Security',
  }
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed border-accent/40 bg-accent-soft/40 px-3 py-2 text-xs text-ink-soft">
      <span className="font-medium text-ink">Simulate env vars set:</span>
      {(Object.keys(labels) as EnvKey[]).map((key) => {
        const forced = key === 'security' && oidcActive
        return (
          <label
            key={key}
            title={forced ? 'OIDC is always env-var-set' : undefined}
            className={`flex items-center gap-1.5 ${forced ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
          >
            <input
              type="checkbox"
              checked={overrides[key] || forced}
              disabled={forced}
              onChange={() => onToggle(key)}
              className="accent-accent"
            />
            {labels[key]}
          </label>
        )
      })}
    </div>
  )
}

function LibraryField({
  label,
  help,
  envKey,
  envSet,
  control,
}: {
  label: string
  help?: string
  envKey: EnvKey
  envSet: boolean
  control: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <div className="min-w-0">
        <p className="text-sm font-medium text-ink">{label}</p>
        {help && <p className="mt-0.5 text-xs text-ink-soft">{help}</p>}
      </div>
      <div className="shrink-0">
        {envSet ? (
          <span
            title={`Set via ${ENV_VAR_NAMES[envKey]}`}
            className="rounded-full border border-border bg-paper-sunken px-2.5 py-1 text-xs text-ink-soft"
          >
            Set by environment variable
          </span>
        ) : (
          control
        )}
      </div>
    </div>
  )
}

// Radio-card chooser for the Security "Change…" modal below — hand-copied
// from FirstLaunchMockup.tsx's own SecurityCard/SecurityStep (same visual
// language), simplified twice over from the version this file briefly had
// before: no Docker/Native runtime-mode branch (Admin Settings has no such
// preview toggle), and — new this pass — no "Sign in with…" card at all,
// since OIDC is permanently out of scope for anything reachable from here.
function SecurityCard({
  selected,
  icon,
  title,
  description,
  onSelect,
  children,
}: {
  selected: boolean
  icon: React.ReactNode
  title: string
  description: string
  onSelect: () => void
  children?: React.ReactNode
}) {
  return (
    <div
      className={`rounded-lg border p-3.5 ${
        selected
          ? 'cursor-pointer border-accent bg-accent-soft'
          : 'cursor-pointer border-border bg-paper-raised hover:border-accent/50'
      }`}
      onClick={onSelect}
      role="radio"
      aria-checked={selected}
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onSelect()
        }
      }}
    >
      <div className="flex items-start gap-3">
        <span
          className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full ${
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
      {children && <div className="mt-3 pl-10">{children}</div>}
    </div>
  )
}

function SectionBlock({
  id,
  title,
  children,
}: {
  id: string
  title: string
  children: React.ReactNode
}) {
  return (
    <div id={id} className="scroll-mt-20 rounded-lg border border-border bg-paper-raised p-5">
      <h2 className="mb-3 font-display text-base font-medium text-ink">{title}</h2>
      {children}
    </div>
  )
}

function isLastAdmin(users: AdminUser[], user: AdminUser): boolean {
  const admins = users.filter((u) => u.perms.includes('admin'))
  return user.perms.includes('admin') && admins.length === 1
}

export function AdminSettingsMockup() {
  useMockupTitle('Admin Settings')
  const [identityKey, setIdentityKey] = useState<IdentityKey>('none')
  const [users, setUsers] = useState<Record<IdentityKey, AdminUser[]>>(INITIAL_USERS)
  const [openUserId, setOpenUserId] = useState<number | null>(null)

  const [backupRetentionDays, setBackupRetentionDays] = useState(30)
  const [logLevel, setLogLevel] = useState<'debug' | 'info' | 'warn' | 'error'>('info')
  const [copyrightRegion, setCopyrightRegion] = useState('en-US')
  const [backupSchedule, setBackupSchedule] = useState('0 3 * * *')

  const [envOverrides, setEnvOverrides] = useState<Record<EnvKey, boolean>>({
    backupSchedule: true,
    backupRetention: false,
    logLevel: false,
    copyrightRegion: false,
    security: false,
  })

  const [updateChecked, setUpdateChecked] = useState(false)
  const [buildKind, setBuildKind] = useState<BuildKind>('release')
  const build = BUILD_FIXTURES[buildKind]
  const runningLabel = build.releaseName
    ? `version ${build.releaseName}`
    : `Dev build, from commit ${build.shortSha} on ${build.commitDate}`

  const currentUsers = users[identityKey]

  // Security "Change…" — only ever reachable while the current method is
  // `none`/`singlepass` (never `oidc`) and AUTH_METHOD isn't itself
  // env-set; see this file's own header comment for why that scope is
  // safe to leave un-gated (no accounts ever at risk here).
  const [securityModalOpen, setSecurityModalOpen] = useState(false)
  const [securityChoice, setSecurityChoice] = useState<'none' | 'singlepass'>('none')
  const [securityPassword, setSecurityPassword] = useState('')
  const [securityConfirmPassword, setSecurityConfirmPassword] = useState('')
  // A password field left blank means "keep the current password" when one
  // already exists (switching `singlepass` → `singlepass`, i.e. a no-op
  // pick, or just leaving it alone while only toggling something else) —
  // it's only actually required when there's no existing password to fall
  // back to (identityKey is currently `none`, about to become `singlepass`
  // for the first time).
  const securityPasswordValid =
    securityPassword.length === 0 ||
    (securityPassword.length >= 8 && securityPassword === securityConfirmPassword)
  const canSaveSecurity =
    securityChoice === 'none' ||
    (securityChoice === 'singlepass' &&
      securityPasswordValid &&
      (identityKey === 'singlepass' || securityPassword.length > 0))

  function openSecurityModal() {
    setSecurityChoice(identityKey === 'singlepass' ? 'singlepass' : 'none')
    setSecurityPassword('')
    setSecurityConfirmPassword('')
    setSecurityModalOpen(true)
  }

  function saveSecurity() {
    setIdentityKey(securityChoice)
    setSecurityModalOpen(false)
  }

  function togglePermission(userId: number, perm: Permission) {
    setUsers((prev) => ({
      ...prev,
      [identityKey]: prev[identityKey].map((u) =>
        u.id === userId
          ? {
              ...u,
              perms: u.perms.includes(perm)
                ? u.perms.filter((p) => p !== perm)
                : [...u.perms, perm],
            }
          : u,
      ),
    }))
  }

  // Removes only the app's own row — the real account still exists at the
  // IdP either way (there's no admin API call this app could make to touch
  // that), so signing in again via OIDC just auto-provisions a brand-new
  // row per the locked plan's own OIDC auth-methods table, with none of
  // this one's data. window.confirm(), not a custom dialog — same cheap
  // native-confirm() convention BookContextMenu.tsx/BookDetailsPage.tsx
  // already use for this app's other hard-delete, no-undo actions.
  function handleDeleteUser(user: AdminUser) {
    if (isLastAdmin(currentUsers, user)) return
    const message =
      `Delete ${user.name}'s account? This removes it from Sonneck only — the account still exists ` +
      `with its identity provider, so signing in again will create a brand-new Sonneck account with ` +
      `none of this one's data (permissions, favorites, notes). This can't be undone.`
    if (!window.confirm(message)) return
    setUsers((prev) => ({
      ...prev,
      [identityKey]: prev[identityKey].filter((u) => u.id !== user.id),
    }))
    if (openUserId === user.id) setOpenUserId(null)
  }

  const [lookupTables, setLookupTables] =
    useState<Record<LookupColumn, LookupItem[]>>(INITIAL_LOOKUP_TABLES)
  const nextLookupIdRef = useRef(100)
  // Set right before the new row's own first render, read (and cleared)
  // by that row's own input ref below — a plain ref, not state, since
  // nothing needs to re-render off this, just the one input to focus
  // itself once, the first time it mounts.
  const lastAddedLookupIdRef = useRef<number | null>(null)

  const [lookupDeleteTarget, setLookupDeleteTarget] = useState<{
    column: LookupColumn
    id: number
    name: string
  } | null>(null)
  const [lookupDeleteMode, setLookupDeleteMode] = useState<'merge' | 'outright'>('merge')
  const [mergeTargetId, setMergeTargetId] = useState<number | null>(null)

  const lookupOtherItems = lookupDeleteTarget
    ? lookupTables[lookupDeleteTarget.column].filter((item) => item.id !== lookupDeleteTarget.id)
    : []

  function addLookupItem(column: LookupColumn) {
    const id = nextLookupIdRef.current++
    lastAddedLookupIdRef.current = id
    setLookupTables((prev) => ({ ...prev, [column]: [...prev[column], { id, name: '' }] }))
  }

  function handleLookupBlur(column: LookupColumn, id: number, rawValue: string) {
    const value = rawValue.trim()
    setLookupTables((prev) => {
      const current = prev[column]
      const existing = current.find((item) => item.id === id)
      if (!existing) return prev
      // A freshly-added row (via the + button below) left blank on blur —
      // drop it rather than keep a stray unnamed lookup value around.
      if (!value && existing.name === '') {
        return { ...prev, [column]: current.filter((item) => item.id !== id) }
      }
      return {
        ...prev,
        [column]: current.map((item) => (item.id === id ? { ...item, name: value } : item)),
      }
    })
  }

  function openLookupDelete(column: LookupColumn, item: LookupItem) {
    const others = lookupTables[column].filter((i) => i.id !== item.id)
    setLookupDeleteTarget({ column, id: item.id, name: item.name || '(untitled)' })
    setLookupDeleteMode(others.length > 0 ? 'merge' : 'outright')
    setMergeTargetId(others[0]?.id ?? null)
  }

  function confirmLookupDelete() {
    if (!lookupDeleteTarget) return
    const { column, id } = lookupDeleteTarget
    // Both paths remove the original entry either way — a real backend
    // would additionally reassign every piece/book tagged with it to
    // `mergeTargetId` first when merging, but that per-piece bookkeeping
    // has nothing to demonstrate at this mockup's fixture level.
    setLookupTables((prev) => ({
      ...prev,
      [column]: prev[column].filter((item) => item.id !== id),
    }))
    setLookupDeleteTarget(null)
  }

  return (
    <div className="flex flex-1 flex-col gap-4 p-6 md:p-8">
      <IdentityStateToggle
        state={identityKey}
        onChange={(key) => {
          setIdentityKey(key)
          setOpenUserId(null)
        }}
      />

      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
        <div className="rounded-md border border-dashed border-accent/40 bg-accent-soft/40 px-4 py-2 text-sm text-ink-soft">
          Reference sample —{' '}
          <span className="font-medium text-ink">
            Admin Settings, Option B (single scrolling page, jump-nav)
          </span>
          . Reached from the sidebar's account menu, admin permission only. Expand a user row to
          edit permissions, click "Check for updates," or edit a lookup name inline — everything
          below is real and clickable.
        </div>

        <h1 className="font-display text-xl font-medium text-ink">Admin Settings</h1>

        <EnvSimulatorStrip
          overrides={envOverrides}
          onToggle={(key) => setEnvOverrides((prev) => ({ ...prev, [key]: !prev[key] }))}
          oidcActive={identityKey === 'oidc'}
        />

        <div className="flex flex-wrap gap-1.5 rounded-lg border border-border bg-paper-raised p-4">
          {JUMP_LINKS.map((link) => (
            <a
              key={link.id}
              href={`#${link.id}`}
              className="rounded-full bg-paper-sunken px-2.5 py-1 text-xs text-ink-soft hover:bg-accent-soft hover:text-accent"
            >
              {link.label}
            </a>
          ))}
        </div>

        <SectionBlock id="library-settings" title="Library Settings">
          <div className="divide-y divide-border">
            <LibraryField
              label="Backup schedule"
              help="Standard cron expression"
              envKey="backupSchedule"
              envSet={envOverrides.backupSchedule}
              control={
                <input
                  value={backupSchedule}
                  onChange={(event) => setBackupSchedule(event.target.value)}
                  className="w-40 rounded-md border border-border bg-paper-raised px-2.5 py-1.5 text-sm text-ink"
                />
              }
            />
            <LibraryField
              label="Backup retention"
              help="Days before an old backup is pruned"
              envKey="backupRetention"
              envSet={envOverrides.backupRetention}
              control={
                <input
                  type="number"
                  min={1}
                  value={backupRetentionDays}
                  onChange={(event) => setBackupRetentionDays(Number(event.target.value))}
                  className="w-20 rounded-md border border-border bg-paper-raised px-2.5 py-1.5 text-sm text-ink"
                />
              }
            />
            <LibraryField
              label="Log level"
              envKey="logLevel"
              envSet={envOverrides.logLevel}
              control={
                <select
                  value={logLevel}
                  onChange={(event) => setLogLevel(event.target.value as typeof logLevel)}
                  className="rounded-md border border-border bg-paper-raised px-2.5 py-1.5 text-sm text-ink"
                >
                  <option value="debug">debug</option>
                  <option value="info">info</option>
                  <option value="warn">warn</option>
                  <option value="error">error</option>
                </select>
              }
            />
            <LibraryField
              label="Copyright region"
              envKey="copyrightRegion"
              envSet={envOverrides.copyrightRegion}
              control={
                <select
                  value={copyrightRegion}
                  onChange={(event) => setCopyrightRegion(event.target.value)}
                  className="rounded-md border border-border bg-paper-raised px-2.5 py-1.5 text-sm text-ink"
                >
                  <option value="en-US">en-US</option>
                  <option value="eu-generic">eu-generic</option>
                  <option value="en-GB">en-GB</option>
                  <option value="ca">ca</option>
                </select>
              }
            />
            <LibraryField
              label="Security"
              help={`Currently: ${SECURITY_STATUS[identityKey]}`}
              envKey="security"
              // OIDC is *always* env-var-set — it's the only way it's ever
              // enabled, never selectable through any UI (Auth methods
              // table, master plan) — so an active `oidc` identity forces
              // this true regardless of the dev-only simulator checkbox
              // below, which only exists to preview the other 4 fields
              // and would otherwise let `oidc` render as if unset, an
              // impossible real-world combination.
              envSet={envOverrides.security || identityKey === 'oidc'}
              control={
                <button
                  type="button"
                  onClick={openSecurityModal}
                  className="cursor-pointer rounded-md border border-border bg-paper-raised px-3 py-1.5 text-sm text-ink hover:border-accent"
                >
                  Change…
                </button>
              }
            />
          </div>
        </SectionBlock>

        <SectionBlock id="library" title="Library">
          <div className="flex gap-3">
            {[
              { label: 'Pieces', value: 342 },
              { label: 'Books', value: 58 },
              { label: 'People', value: 27 },
            ].map((stat) => (
              <div
                key={stat.label}
                className="flex-1 rounded-md border border-border py-3 text-center"
              >
                <p className="font-display text-2xl font-bold text-ink">{stat.value}</p>
                <p className="mt-0.5 text-xs tracking-wide text-ink-soft uppercase">{stat.label}</p>
              </div>
            ))}
          </div>
        </SectionBlock>

        <SectionBlock id="version" title="Version">
          <div className="flex flex-col gap-3">
            {/* Dev-only preview control — the real page has exactly one
                build identity to report, computed server-side by matching
                this build's own injected commit SHA against GitHub's
                release + pre-release tags. This lets all three outcomes be
                reviewed without three separate real builds. */}
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed border-accent/40 bg-accent-soft/40 px-3 py-2 text-xs text-ink-soft">
              <span className="font-medium text-ink">Preview build identity:</span>
              <div className="flex overflow-hidden rounded border border-border">
                {(Object.keys(BUILD_FIXTURES) as BuildKind[]).map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setBuildKind(key)}
                    className={`cursor-pointer px-2 py-1 ${
                      buildKind === key ? 'bg-accent text-white' : 'bg-paper hover:bg-paper-sunken'
                    }`}
                  >
                    {BUILD_FIXTURES[key].label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-ink">
                Running <strong>{runningLabel}</strong>
              </span>
              {updateChecked ? (
                build.checkResult === 'behind' ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-[#fbe9e7] px-2.5 py-1 text-sm text-[#b45309]">
                    version {build.availableVersion} available
                    <a href="#" className="inline-flex items-center gap-0.5 text-inherit underline">
                      View release <IconExternalLink size={12} />
                    </a>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-sm text-[#3fa34d]">
                    <IconCircleCheck size={14} className="text-[#3fa34d]" />
                    {build.checkResult === 'ahead' ? 'Ahead of the latest release' : 'Up to date'}
                  </span>
                )
              ) : (
                <button
                  type="button"
                  onClick={() => setUpdateChecked(true)}
                  className="cursor-pointer rounded-md border border-border bg-paper-raised px-3 py-1.5 text-sm text-ink hover:border-accent"
                >
                  Check for updates
                </button>
              )}
            </div>
            {updateChecked && (
              <p className="text-xs text-ink-soft">Checked just now — cached for a while, so checking again soon reuses this result instead of asking GitHub every time.</p>
            )}
            <p className="text-xs text-ink-soft">
              Shows the build you're running and checks GitHub for anything newer — without falsely
              flagging a preview or dev build that's already ahead of the latest release.
            </p>
          </div>
        </SectionBlock>

        <SectionBlock id="users" title="Users">
          <div className="flex flex-col gap-2">
            {currentUsers.map((user) => {
              const isOpen = openUserId === user.id
              const isAdmin = user.perms.includes('admin')
              const lastAdmin = isLastAdmin(currentUsers, user)
              return (
                <div key={user.id} className="rounded-md border border-border">
                  {/* Delete lives as a separate sibling button, not nested
                      inside the expand/collapse button — an interactive
                      element can't nest inside another one. */}
                  <div className="flex items-center gap-1.5 px-3 py-2.5">
                    <button
                      type="button"
                      onClick={() => setOpenUserId(isOpen ? null : user.id)}
                      className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 text-left"
                    >
                      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-paper-sunken text-ink-soft">
                        <IconUserCircle size={16} />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-ink">
                          {user.name}
                        </span>
                        {user.email && (
                          <span className="block truncate text-xs text-ink-soft">{user.email}</span>
                        )}
                      </span>
                      <span
                        className={`ml-auto shrink-0 rounded-full px-2 py-0.5 text-[0.65rem] font-bold tracking-wide uppercase ${
                          isAdmin ? 'bg-accent text-white' : 'bg-paper-sunken text-ink-soft'
                        }`}
                      >
                        {isAdmin
                          ? 'Admin'
                          : `${user.perms.length} permission${user.perms.length === 1 ? '' : 's'}`}
                      </span>
                      <IconChevronDown
                        size={16}
                        className={`shrink-0 text-ink-soft transition-transform ${isOpen ? 'rotate-180' : ''}`}
                      />
                    </button>
                    <button
                      type="button"
                      disabled={lastAdmin}
                      onClick={() => handleDeleteUser(user)}
                      title={
                        lastAdmin
                          ? "The only admin account can't be deleted."
                          : `Delete ${user.name}`
                      }
                      aria-label={`Delete ${user.name}`}
                      className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-ink-soft hover:bg-red-50 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-ink-soft"
                    >
                      <IconTrash size={15} />
                    </button>
                  </div>
                  {isOpen && (
                    <div className="grid grid-cols-2 gap-2 px-3 pt-1 pb-3 pl-[46px] sm:grid-cols-4">
                      {ALL_PERMS.map((perm) => {
                        const locked = perm === 'admin' && lastAdmin
                        return (
                          // InfoTooltip's own trigger button doesn't call
                          // preventDefault on click, so it must stay a
                          // sibling of the <label>, never nested inside
                          // it — a nested click would still bubble up and
                          // toggle the checkbox via the label's native
                          // activation behavior (same reasoning as every
                          // other InfoTooltip-next-to-a-Toggle pairing in
                          // the real app, e.g. EditPieceModal.tsx's
                          // copyrightRenewed field).
                          <div key={perm} className="flex items-center gap-1">
                            <label
                              className={`flex items-center gap-1.5 text-sm ${
                                locked
                                  ? 'cursor-not-allowed text-ink-soft/50'
                                  : 'cursor-pointer text-ink'
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={user.perms.includes(perm)}
                                disabled={locked}
                                onChange={() => togglePermission(user.id, perm)}
                                className="accent-accent"
                              />
                              {perm}
                            </label>
                            <InfoTooltip
                              message={PERM_DESCRIPTIONS[perm]}
                              ariaLabel={`What "${perm}" allows`}
                              triggerClassName="text-ink-soft/60 hover:text-ink-soft"
                            >
                              <IconInfoCircle size={12} />
                            </InfoTooltip>
                          </div>
                        )
                      })}
                    </div>
                  )}
                  {isOpen && isAdmin && lastAdmin && (
                    <p className="px-3 pb-3 pl-[46px] text-xs text-ink-soft">
                      The only admin account can't remove its own admin permission or be deleted.
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        </SectionBlock>

        <SectionBlock id="lookup" title="Lookup Tables">
          <p className="mb-4 text-sm text-ink-soft">
            These names are shared across the whole library — every piece and book already tagged
            with one updates automatically when you rename it here, rather than creating a new,
            separate value. Renaming "Piano" to "Keyboard," for example, changes it everywhere
            "Piano" was used, instead of leaving old pieces on "Piano" and new ones on "Keyboard."
          </p>
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            {(Object.keys(lookupTables) as LookupColumn[]).map((column) => (
              <div key={column}>
                <p className="mb-1.5 text-xs font-semibold tracking-wide text-ink-soft uppercase">
                  {column}
                </p>
                <div className="flex flex-col">
                  {lookupTables[column].map((item) => (
                    <div key={item.id} className="flex items-center gap-1">
                      <input
                        defaultValue={item.name}
                        placeholder={column === 'Sheet Types' ? 'New Sheet Type' : 'New Instrument'}
                        ref={(el) => {
                          if (el && lastAddedLookupIdRef.current === item.id) {
                            el.focus()
                            lastAddedLookupIdRef.current = null
                          }
                        }}
                        onBlur={(event) => handleLookupBlur(column, item.id, event.target.value)}
                        className="min-w-0 flex-1 rounded-md border border-transparent px-2 py-1.5 text-sm text-ink hover:border-border focus:border-border focus:bg-paper-raised focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => openLookupDelete(column, item)}
                        aria-label={`Delete ${item.name || 'this entry'}`}
                        className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-ink-soft hover:bg-red-50 hover:text-red-700"
                      >
                        <IconTrash size={14} />
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => addLookupItem(column)}
                  aria-label={`Add ${column === 'Sheet Types' ? 'sheet type' : 'instrument'}`}
                  title={`Add ${column === 'Sheet Types' ? 'sheet type' : 'instrument'}`}
                  className="mt-3 flex w-full cursor-pointer items-center justify-center text-[#9d9892] hover:text-accent"
                >
                  <IconCircleDashedPlus size={22} />
                </button>
              </div>
            ))}
          </div>
        </SectionBlock>
      </div>

      <Modal
        open={securityModalOpen}
        onClose={() => setSecurityModalOpen(false)}
        labelledBy="security-modal-title"
        footer={
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setSecurityModalOpen(false)}
              className="cursor-pointer rounded-md border border-border bg-paper-raised px-4 py-2 text-sm text-ink hover:bg-paper"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!canSaveSecurity}
              onClick={saveSecurity}
              className="cursor-pointer rounded-md bg-accent px-4 py-2 text-sm text-white enabled:hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Save changes
            </button>
          </div>
        }
      >
        <h2 id="security-modal-title" className="font-display text-lg font-medium text-ink">
          Change security
        </h2>
        <p className="mt-1 text-sm text-ink-soft">Choose how people sign in to this library.</p>

        <div className="mt-4 flex flex-col gap-3" role="radiogroup" aria-label="Security">
          <SecurityCard
            selected={securityChoice === 'none'}
            icon={<IconLockOpen2 size={15} />}
            title="No login"
            description="Anyone with network access to this app can use it, as one shared account."
            onSelect={() => setSecurityChoice('none')}
          />
          <SecurityCard
            selected={securityChoice === 'singlepass'}
            icon={<IconKey size={15} />}
            title="Password"
            description="A single shared password gates the whole app — still just one shared account behind it, now locked."
            onSelect={() => setSecurityChoice('singlepass')}
          >
            <div className="flex flex-col gap-2">
              <input
                type="password"
                value={securityPassword}
                onChange={(event) => setSecurityPassword(event.target.value)}
                onClick={(event) => event.stopPropagation()}
                placeholder={
                  identityKey === 'singlepass'
                    ? 'New password (leave blank to keep current)'
                    : 'Password (min. 8 characters)'
                }
                className="w-full rounded-md border border-border bg-paper-raised px-3 py-2 text-sm text-ink"
              />
              <input
                type="password"
                value={securityConfirmPassword}
                onChange={(event) => setSecurityConfirmPassword(event.target.value)}
                onClick={(event) => event.stopPropagation()}
                placeholder="Confirm password"
                className="w-full rounded-md border border-border bg-paper-raised px-3 py-2 text-sm text-ink"
              />
              {securityPassword.length > 0 && !securityPasswordValid && (
                <p className="text-xs text-red-700">
                  {securityPassword.length < 8 ? 'At least 8 characters.' : "Passwords don't match."}
                </p>
              )}
            </div>
          </SecurityCard>
        </div>

        <p className="mt-4 text-xs text-ink-soft">
          Switching to "No login" clears the current password entirely — the next person to switch back to
          "Password" has to set a new one.
        </p>
      </Modal>

      <Modal
        open={lookupDeleteTarget !== null}
        onClose={() => setLookupDeleteTarget(null)}
        labelledBy="lookup-delete-title"
        footer={
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setLookupDeleteTarget(null)}
              className="cursor-pointer rounded-md border border-border bg-paper-raised px-4 py-2 text-sm text-ink hover:bg-paper"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={lookupDeleteMode === 'merge' && mergeTargetId === null}
              onClick={confirmLookupDelete}
              className="cursor-pointer rounded-md bg-red-700 px-4 py-2 text-sm text-white hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {lookupDeleteMode === 'merge' ? 'Merge and delete' : 'Delete outright'}
            </button>
          </div>
        }
      >
        {lookupDeleteTarget && (
          <>
            <h2 id="lookup-delete-title" className="font-display text-lg font-medium text-ink">
              Delete "{lookupDeleteTarget.name}"?
            </h2>
            <p className="mt-1 text-sm text-ink-soft">
              Choose what happens to pieces and books already tagged with it.
            </p>

            <div
              className="mt-4 flex flex-col gap-3"
              role="radiogroup"
              aria-label="Delete or merge"
            >
              {lookupOtherItems.length > 0 && (
                <label
                  className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3.5 ${
                    lookupDeleteMode === 'merge'
                      ? 'border-accent bg-accent-soft'
                      : 'border-border bg-paper-raised hover:border-accent/50'
                  }`}
                >
                  <input
                    type="radio"
                    checked={lookupDeleteMode === 'merge'}
                    onChange={() => setLookupDeleteMode('merge')}
                    className="mt-1 accent-accent"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="font-display font-medium text-ink">
                      Merge into another{' '}
                      {lookupDeleteTarget.column === 'Sheet Types' ? 'sheet type' : 'instrument'}
                    </p>
                    <p className="text-sm text-ink-soft">
                      Every piece/book tagged "{lookupDeleteTarget.name}" will be retagged instead.
                    </p>
                    {lookupDeleteMode === 'merge' && (
                      <select
                        value={mergeTargetId ?? ''}
                        onChange={(event) => setMergeTargetId(Number(event.target.value))}
                        onClick={(event) => event.stopPropagation()}
                        className="mt-2 rounded-md border border-border bg-paper-raised px-2.5 py-1.5 text-sm text-ink"
                      >
                        {lookupOtherItems.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name || '(untitled)'}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                </label>
              )}
              <label
                className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3.5 ${
                  lookupDeleteMode === 'outright'
                    ? 'border-accent bg-accent-soft'
                    : 'border-border bg-paper-raised hover:border-accent/50'
                }`}
              >
                <input
                  type="radio"
                  checked={lookupDeleteMode === 'outright'}
                  onChange={() => setLookupDeleteMode('outright')}
                  className="mt-1 accent-accent"
                />
                <div className="min-w-0 flex-1">
                  <p className="font-display font-medium text-ink">Delete outright</p>
                  <p className="text-sm text-ink-soft">
                    Pieces/books tagged "{lookupDeleteTarget.name}" will just lose that tag —
                    nothing else is affected.
                  </p>
                </div>
              </label>
            </div>
          </>
        )}
      </Modal>
    </div>
  )
}
