import { useRef, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  IconBan,
  IconCircleCheckFilled,
  IconCircleDashed,
  IconCircleDashedPlus,
  IconCircleHalf2,
  IconDeviceDesktop,
  IconEye,
  IconEyeOff,
  IconHourglassEmpty,
  IconMoon,
  IconSun,
  IconTrash,
} from '@tabler/icons-react'
import { Modal } from '../components/Modal'
import { Toggle } from '../components/Toggle'
import { usePageTitle } from '../lib/usePageTitle'
import { useAuth } from '../lib/AuthContext'
import { ApiError } from '../api/client'
import { updateMe, changePassword } from '../api/auth'
import { getUserSettings, updateUserSettings, type UserSettings } from '../api/userSettings'
import {
  listPracticeStatuses,
  listUserTags,
  createUserListItem,
  renameUserListItem,
  deleteUserListItem,
} from '../api/lookups'
import type { PracticeStatusItem, Tag } from '../api/types'

// User Settings — real build of the approved mockup (Option 2, "separate
// cards per section" — /mockup/user-settings, master plan Phases 5/8),
// wired to the real endpoints built for this phase: PATCH /api/auth/me
// (self-rename), POST /api/auth/change-password (self-service, singlepass
// only), GET/PATCH /api/user-settings (Appearance/Library), and real
// PATCH .../{id} rename routes for Tags/Practice Status that didn't exist
// before this phase (the mockup's own create/delete/merge only left rename
// unbuilt). Reached from the sidebar's account menu (UserMenuButton).
//
// Practice Status creation stays muted + "Soon" here too, matching the
// mockup — corrected same day after a first pass got this backwards
// (assumed the mockup's own `canAdd={false}` was purely about schema
// readiness, which POST /api/practice-statuses resolved back in Phase 10,
// so this page briefly shipped creation enabled). Direct feedback: the
// real, still-standing reason is independent of schema — each row renders
// a fixed hardcoded icon (icon_key, migration 00026, matched against
// PRACTICE_STATUS_ICON_COMPONENTS below), and creating a genuinely new
// status has no icon-assignment UX decided yet — a fresh row would just
// have icon_key NULL, same as it does today. Rename/delete/merge on the 5
// existing rows are unaffected; only *create* is blocked, and only for
// Practice Status — Your Tags has no such icon and stays fully creatable.
//
// The Appearance card's Theme control and the sidebar's own ThemeSwitcher
// (UserMenuButton.tsx) now share one persisted source — the same
// ['user-settings'] query/mutation — rather than each holding independent
// local state, so changing either one updates the other immediately and
// survives a reload.

// Keyed by the real, durable icon_key column (migration 00026) — not by
// name. A rename only ever changes `name` server-side, never `icon_key`,
// so this now matches the mockup's own rename-proof guarantee ("keyed by
// the fixed row id, not the live text value") exactly, instead of the
// client-side original-name heuristic this used before — which held only
// within one component mount and lost the icon the moment you navigated
// away and back, since the heuristic itself never survived a remount.
const PRACTICE_STATUS_ICON_COMPONENTS: Record<string, typeof IconCircleDashed> = {
  want_to_learn: IconCircleDashed,
  learning: IconCircleHalf2,
  learned: IconCircleCheckFilled,
  stalled: IconHourglassEmpty,
  dropped: IconBan,
}

function SettingsCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-paper-raised p-5">
      <h2 className="font-display text-base font-medium text-ink">{title}</h2>
      {children}
    </div>
  )
}

function SettingsRow({
  label,
  help,
  control,
  soon,
}: {
  label: string
  help: string
  control: ReactNode
  // Hide Books/Paginated views: the preference itself now genuinely
  // persists (GET/PATCH /api/user-settings), but nothing else in the app
  // consumes it yet (Sidebar.tsx doesn't conditionally hide Books,
  // PieceBrowseView.tsx has no pagination mode) — "Soon" communicates that
  // the toggle is real but not yet consequential, same as the mockup.
  soon?: boolean
}) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <div className="min-w-0">
        <p className="flex items-center gap-2 text-sm font-medium text-ink">
          {label}
          {soon && (
            <span className="shrink-0 rounded-full bg-ink-soft px-1.5 py-px text-[0.6rem] tracking-wide text-white uppercase">
              Soon
            </span>
          )}
        </p>
        <p className="mt-0.5 text-xs text-ink-soft">{help}</p>
      </div>
      <div className="shrink-0 self-end sm:self-auto">{control}</div>
    </div>
  )
}

function ThemeControl({
  theme,
  onChange,
  disabled,
}: {
  theme: UserSettings['themePreference']
  onChange: (theme: 'light' | 'system') => void
  disabled: boolean
}) {
  return (
    <div className="flex rounded-md border border-border">
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange('light')}
        className={`flex cursor-pointer items-center gap-1.5 rounded-l-md border-r border-border px-2.5 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-50 ${
          theme === 'light' ? 'bg-accent text-white' : 'bg-paper-raised text-ink-soft hover:bg-paper-sunken'
        }`}
      >
        <IconSun size={14} />
        Light
      </button>
      <button
        type="button"
        disabled
        title="Coming soon"
        className="relative flex cursor-not-allowed items-center gap-1.5 border-r border-border bg-paper-raised px-2.5 py-1.5 text-sm text-ink-soft/50"
      >
        <IconMoon size={14} />
        Dark
        <span className="absolute -top-2 -right-0.5 rounded-full bg-ink-soft px-1 py-px text-[0.55rem] tracking-wide text-white uppercase">
          Soon
        </span>
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange('system')}
        className={`flex cursor-pointer items-center gap-1.5 rounded-r-md px-2.5 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-50 ${
          theme === 'system' ? 'bg-accent text-white' : 'bg-paper-raised text-ink-soft hover:bg-paper-sunken'
        }`}
      >
        <IconDeviceDesktop size={14} />
        System
      </button>
    </div>
  )
}

type UserListResource = 'tags' | 'practice-statuses'

interface DeleteTarget {
  resource: UserListResource
  id: number
  name: string
}

// A pending, not-yet-created row — no real id yet, tracked by a local
// negative tempId so it can key/focus like any other row until the create
// mutation resolves and the list query brings in the real one.
interface PendingItem {
  tempId: number
}

function EditableUserList({
  resource,
  items,
  onOpenDelete,
  canAdd = true,
}: {
  resource: UserListResource
  items: (Tag & { iconKey?: PracticeStatusItem['iconKey'] })[]
  onOpenDelete: (target: DeleteTarget) => void
  // Practice Status only, for now — each row has a fixed hardcoded icon
  // (icon_key, matched against PRACTICE_STATUS_ICON_COMPONENTS above), and
  // creating a genuinely new status has no icon-assignment UX decided yet,
  // so the add control is muted + tagged "Soon" rather than removed
  // (matches /mockup/user-settings' identical `canAdd` prop).
  canAdd?: boolean
}) {
  const queryClient = useQueryClient()
  const queryKey = [resource === 'tags' ? 'user-tags' : 'practice-statuses']
  const [pending, setPending] = useState<PendingItem[]>([])
  const nextTempIdRef = useRef(-1)
  const lastFocusRef = useRef<number | null>(null)
  const noun = resource === 'tags' ? 'tag' : 'status'

  const createMutation = useMutation({
    mutationFn: (name: string) => createUserListItem(resource, name),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey }),
  })
  const renameMutation = useMutation({
    mutationFn: (vars: { id: number; name: string }) => renameUserListItem(resource, vars.id, vars.name),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey }),
  })

  function addPending() {
    const tempId = nextTempIdRef.current--
    lastFocusRef.current = tempId
    setPending((prev) => [...prev, { tempId }])
  }

  function handleBlur(id: number, rawValue: string) {
    const value = rawValue.trim()
    const isPending = pending.some((p) => p.tempId === id)
    if (isPending) {
      setPending((prev) => prev.filter((p) => p.tempId !== id))
      if (value) createMutation.mutate(value)
      return
    }
    const existing = items.find((item) => item.id === id)
    if (!existing || !value || value === existing.name) return
    renameMutation.mutate({ id, name: value })
  }

  // Enter commits (blur triggers the real onBlur save/create logic above);
  // Escape reverts the DOM value to revertValue first — these inputs are
  // uncontrolled (defaultValue, not value), and handleBlur reads
  // event.target.value directly, so writing the DOM value before blurring
  // is enough to make Escape a genuine no-op rename (value === item.name,
  // handleBlur's own early-return) or a genuine cancel for a pending
  // not-yet-created row (blank value, same as blurring away from an empty
  // new row today).
  function handleEditKeyDown(event: React.KeyboardEvent<HTMLInputElement>, revertValue: string) {
    if (event.key === 'Enter') {
      event.currentTarget.blur()
    } else if (event.key === 'Escape') {
      event.currentTarget.value = revertValue
      event.currentTarget.blur()
    }
  }

  return (
    <div className="flex flex-col">
      {items.map((item) => {
        const Icon = item.iconKey ? PRACTICE_STATUS_ICON_COMPONENTS[item.iconKey] : undefined
        return (
          <div key={item.id} className="flex items-center gap-1">
            {Icon && <Icon size={16} className="shrink-0 text-ink-soft" />}
            <input
              defaultValue={item.name}
              placeholder={`New ${noun}`}
              onKeyDown={(event) => handleEditKeyDown(event, item.name)}
              onBlur={(event) => handleBlur(item.id, event.target.value)}
              className="min-w-0 flex-1 rounded-md border border-transparent px-2 py-1.5 text-sm text-ink hover:border-border focus:border-border focus:bg-paper-raised focus:outline-none"
            />
            <button
              type="button"
              onClick={() =>
                onOpenDelete({
                  resource,
                  id: item.id,
                  name: item.name || '(untitled)',
                })
              }
              aria-label={`Delete ${item.name || 'this entry'}`}
              className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-ink-soft hover:bg-red-50 hover:text-red-700"
            >
              <IconTrash size={14} />
            </button>
          </div>
        )
      })}
      {pending.map((p) => (
        <div key={p.tempId} className="flex items-center gap-1">
          <input
            defaultValue=""
            placeholder={`New ${noun}`}
            ref={(el) => {
              if (el && lastFocusRef.current === p.tempId) {
                el.focus()
                lastFocusRef.current = null
              }
            }}
            onKeyDown={(event) => handleEditKeyDown(event, '')}
            onBlur={(event) => handleBlur(p.tempId, event.target.value)}
            className="min-w-0 flex-1 rounded-md border border-transparent px-2 py-1.5 text-sm text-ink hover:border-border focus:border-border focus:bg-paper-raised focus:outline-none"
          />
        </div>
      ))}
      {canAdd ? (
        <button
          type="button"
          onClick={addPending}
          aria-label={`Add ${noun}`}
          title={`Add ${noun}`}
          className="mt-3 flex w-full cursor-pointer items-center justify-center text-[#9d9892] hover:text-accent"
        >
          <IconCircleDashedPlus size={22} />
        </button>
      ) : (
        <div className="mt-3 flex w-full items-center justify-center gap-2" title={`Adding a new ${noun} is coming soon`}>
          <IconCircleDashedPlus size={22} className="text-ink-soft/40" />
          <span className="rounded-full bg-ink-soft px-1.5 py-px text-[0.6rem] tracking-wide text-white uppercase">
            Soon
          </span>
        </div>
      )}
    </div>
  )
}

function PasswordFields({
  password,
  onChange,
  showPassword,
  onToggleShowPassword,
  placeholder,
}: {
  password: string
  onChange: (v: string) => void
  showPassword: boolean
  onToggleShowPassword: () => void
  placeholder: string
}) {
  return (
    <div className="relative">
      <input
        type={showPassword ? 'text' : 'password'}
        value={password}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-md border border-border bg-paper-raised px-3 py-2 pr-9 text-sm text-ink"
      />
      <button
        type="button"
        onClick={onToggleShowPassword}
        aria-label={showPassword ? 'Hide password' : 'Show password'}
        className="absolute top-1/2 right-2 flex -translate-y-1/2 cursor-pointer items-center text-ink-soft hover:text-ink"
      >
        {showPassword ? <IconEyeOff size={16} /> : <IconEye size={16} />}
      </button>
    </div>
  )
}

function ChangePasswordModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  const mutation = useMutation({
    mutationFn: () => changePassword(currentPassword, newPassword),
    onSuccess: () => {
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      onClose()
    },
  })

  const passwordsMatch = newPassword.length >= 8 && newPassword === confirmPassword
  const canSubmit = currentPassword.length > 0 && passwordsMatch && !mutation.isPending

  return (
    <Modal open={open} onClose={onClose} labelledBy="change-password-title">
      <h2 id="change-password-title" className="font-display text-lg font-medium text-ink">
        Change Password
      </h2>
      <div className="mt-4 flex flex-col gap-2.5">
        <PasswordFields
          password={currentPassword}
          onChange={setCurrentPassword}
          showPassword={showPassword}
          onToggleShowPassword={() => setShowPassword((v) => !v)}
          placeholder="Current password"
        />
        <PasswordFields
          password={newPassword}
          onChange={setNewPassword}
          showPassword={showPassword}
          onToggleShowPassword={() => setShowPassword((v) => !v)}
          placeholder="New password (min. 8 characters)"
        />
        <PasswordFields
          password={confirmPassword}
          onChange={setConfirmPassword}
          showPassword={showPassword}
          onToggleShowPassword={() => setShowPassword((v) => !v)}
          placeholder="Confirm new password"
        />
        {confirmPassword.length > 0 && !passwordsMatch && (
          <p className="text-xs text-red-700">
            {newPassword.length < 8 ? 'At least 8 characters.' : "Passwords don't match."}
          </p>
        )}
        {mutation.isError && (
          <p className="text-xs text-red-700">
            {mutation.error instanceof ApiError ? mutation.error.message : 'Something went wrong.'}
          </p>
        )}
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="cursor-pointer rounded-md border border-border bg-paper-raised px-4 py-2 text-sm text-ink hover:bg-paper"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={!canSubmit}
          onClick={() => mutation.mutate()}
          className="cursor-pointer rounded-md bg-accent px-4 py-2 text-sm text-white hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {mutation.isPending ? 'Saving…' : 'Change Password'}
        </button>
      </div>
    </Modal>
  )
}

export function UserSettingsPage() {
  usePageTitle('User Settings')
  const me = useAuth()
  const queryClient = useQueryClient()

  const [name, setName] = useState(me.displayName)
  // Enter/Escape on the name field both end in a blur (the actual save
  // trigger — see that input's own onBlur) — Escape needs blur to run
  // without saving the just-reverted text. Since `name` is controlled
  // React state, the onBlur closure captured at render time won't see a
  // same-tick setName() before the synchronous blur event fires, so a
  // plain "revert then blur" would still save the stale (pre-revert) text.
  // This ref sidesteps that race: Escape sets it before blurring, onBlur
  // checks it first and skips the save/revert logic it would otherwise run.
  const skipNameSaveRef = useRef(false)
  const [changePasswordOpen, setChangePasswordOpen] = useState(false)

  const renameMutation = useMutation({
    mutationFn: updateMe,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['auth', 'me'] }),
  })

  const { data: settings, isLoading: settingsLoading } = useQuery({
    queryKey: ['user-settings'],
    queryFn: getUserSettings,
  })
  const updateSettingsMutation = useMutation({
    mutationFn: updateUserSettings,
    onSuccess: (updated) => queryClient.setQueryData(['user-settings'], updated),
  })
  function patchSettings(partial: Partial<UserSettings>) {
    if (!settings) return
    updateSettingsMutation.mutate({ ...settings, ...partial })
  }

  const { data: tags = [] } = useQuery({ queryKey: ['user-tags'], queryFn: listUserTags })
  const { data: practiceStatuses = [] } = useQuery({
    queryKey: ['practice-statuses'],
    queryFn: listPracticeStatuses,
  })

  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null)
  const [deleteMode, setDeleteMode] = useState<'merge' | 'outright'>('merge')
  const [mergeTargetId, setMergeTargetId] = useState<number | null>(null)

  const listsByResource: Record<UserListResource, Tag[]> = { tags, 'practice-statuses': practiceStatuses }
  const otherItems = deleteTarget
    ? listsByResource[deleteTarget.resource].filter((item) => item.id !== deleteTarget.id)
    : []

  const deleteMutation = useMutation({
    mutationFn: (target: DeleteTarget) => deleteUserListItem(target.resource, target.id, mergeTargetId ?? undefined),
    onSuccess: (_result, target) => {
      const queryKey = target.resource === 'tags' ? ['user-tags'] : ['practice-statuses']
      void queryClient.invalidateQueries({ queryKey })
      setDeleteTarget(null)
    },
  })

  function openDelete(target: DeleteTarget) {
    const others = listsByResource[target.resource].filter((item) => item.id !== target.id)
    setDeleteTarget(target)
    setDeleteMode(others.length > 0 ? 'merge' : 'outright')
    setMergeTargetId(others[0]?.id ?? null)
  }

  return (
    <div className="flex flex-1 flex-col gap-4 p-6 md:p-8">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
        <h1 className="font-display text-xl font-medium text-ink">User Settings</h1>

        <SettingsCard title="Account">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.currentTarget.blur()
                  } else if (event.key === 'Escape') {
                    skipNameSaveRef.current = true
                    setName(me.displayName)
                    event.currentTarget.blur()
                  }
                }}
                onBlur={() => {
                  if (skipNameSaveRef.current) {
                    skipNameSaveRef.current = false
                    return
                  }
                  const trimmed = name.trim()
                  if (trimmed && trimmed !== me.displayName) renameMutation.mutate(trimmed)
                  else setName(me.displayName)
                }}
                // Disabled for OIDC (Phase 14) — that identity's name is the
                // IdP's to own and gets re-synced on every login
                // (ClaimOrProvisionOIDCUser), so a local edit here would
                // just be silently overwritten next login; PATCH
                // /api/auth/me rejects it server-side too. Porting
                // UserSettingsMockup.tsx's own already-locked design
                // (disabled={identityKey.startsWith('oidc')}), never wired
                // into this real page until now since real OIDC login
                // didn't exist yet to need it.
                disabled={me.authMethod === 'oidc'}
                className="w-full rounded-md border border-border bg-paper-raised px-2.5 py-1.5 text-sm text-ink disabled:cursor-not-allowed disabled:bg-paper-sunken disabled:text-ink-soft"
              />
              <p className="mt-1.5 text-xs text-ink-soft">
                {me.authMethod === 'none'
                  ? 'No login required for this server.'
                  : me.authMethod === 'singlepass'
                    ? 'Shared password'
                    : 'Signed in via identity provider'}
              </p>
            </div>
            {me.authMethod === 'singlepass' && (
              <button
                type="button"
                onClick={() => setChangePasswordOpen(true)}
                className="shrink-0 cursor-pointer rounded-md border border-border bg-paper-raised px-3 py-1.5 text-sm whitespace-nowrap text-ink hover:border-accent"
              >
                Change Password
              </button>
            )}
          </div>
        </SettingsCard>

        <SettingsCard title="Appearance">
          <SettingsRow
            label="Theme"
            help="System follows your device's own light/dark setting."
            control={
              <ThemeControl
                theme={settings?.themePreference ?? 'system'}
                onChange={(theme) => patchSettings({ themePreference: theme })}
                disabled={settingsLoading}
              />
            }
          />
        </SettingsCard>

        <SettingsCard title="Library">
          <SettingsRow
            label='Hide "Books" in sidebar'
            help="Books stay reachable from a piece's own Edit menu even when hidden here."
            soon
            control={
              // Inverse polarity, deliberately: the stored field is
              // showBooksInSidebar (default true — books shown), but this
              // control's own label is the opt-in "Hide" action (default
              // unchecked), same convention "Paginated views" below
              // follows for its own field. Binding `checked` to the raw
              // field directly, without inverting, was a real bug caught
              // via live verification — CLAUDE.md's own forward note on
              // this exact field already flagged the risk.
              <Toggle
                checked={!(settings?.showBooksInSidebar ?? true)}
                onChange={(hidden) => patchSettings({ showBooksInSidebar: !hidden })}
                label=""
                id="hide-books"
              />
            }
          />
          <SettingsRow
            label="Paginated views"
            help="When off, library views scroll continuously instead of using page controls."
            soon
            control={
              <Toggle
                checked={(settings?.contentViewMode ?? 'infinite') === 'paginated'}
                onChange={(checked) => patchSettings({ contentViewMode: checked ? 'paginated' : 'infinite' })}
                label=""
                id="paginated-views"
              />
            }
          />
        </SettingsCard>

        <SettingsCard title="Your Tags & Practice Status">
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <div>
              <p className="mb-1.5 text-xs font-semibold tracking-wide text-ink-soft uppercase">Tags</p>
              <p className="mb-3 text-sm text-ink-soft">
                Private to your account — not shared with anyone else, even other people using this library.
              </p>
              <EditableUserList resource="tags" items={tags} onOpenDelete={openDelete} />
            </div>
            <div>
              <p className="mb-1.5 text-xs font-semibold tracking-wide text-ink-soft uppercase">Practice Status</p>
              <p className="mb-3 text-sm text-ink-soft">
                The stages a piece moves through as you learn it. Sonneck ships with these five by default —
                rename them to fit your own workflow. Adding your own statuses is coming soon.
              </p>
              <EditableUserList
                resource="practice-statuses"
                items={practiceStatuses}
                onOpenDelete={openDelete}
                canAdd={false}
              />
            </div>
          </div>
        </SettingsCard>
      </div>

      <ChangePasswordModal open={changePasswordOpen} onClose={() => setChangePasswordOpen(false)} />

      <Modal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        labelledBy="list-delete-title"
        footer={
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setDeleteTarget(null)}
              className="cursor-pointer rounded-md border border-border bg-paper-raised px-4 py-2 text-sm text-ink hover:bg-paper"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={(deleteMode === 'merge' && mergeTargetId === null) || deleteMutation.isPending}
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget)}
              className="cursor-pointer rounded-md bg-red-700 px-4 py-2 text-sm text-white hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {deleteMutation.isPending ? 'Working…' : deleteMode === 'merge' ? 'Merge and delete' : 'Delete outright'}
            </button>
          </div>
        }
      >
        {deleteTarget && (
          <>
            <h2 id="list-delete-title" className="font-display text-lg font-medium text-ink">
              Delete "{deleteTarget.name}"?
            </h2>
            <p className="mt-1 text-sm text-ink-soft">
              {deleteTarget.resource === 'tags'
                ? 'Choose what happens to pieces already tagged with it.'
                : 'Choose what happens to pieces already set to this status.'}
            </p>

            <div className="mt-4 flex flex-col gap-3" role="radiogroup" aria-label="Delete or merge">
              {otherItems.length > 0 && (
                <label
                  className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3.5 ${
                    deleteMode === 'merge' ? 'border-accent bg-accent-soft' : 'border-border bg-paper-raised hover:border-accent/50'
                  }`}
                >
                  <input
                    type="radio"
                    checked={deleteMode === 'merge'}
                    onChange={() => setDeleteMode('merge')}
                    className="mt-1 accent-accent"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="font-display font-medium text-ink">
                      Merge into another {deleteTarget.resource === 'tags' ? 'tag' : 'status'}
                    </p>
                    <p className="text-sm text-ink-soft">
                      Every piece {deleteTarget.resource === 'tags' ? 'tagged' : 'set to'} "{deleteTarget.name}" will
                      be moved to this one instead.
                    </p>
                    {deleteMode === 'merge' && (
                      <select
                        value={mergeTargetId ?? ''}
                        onChange={(event) => setMergeTargetId(Number(event.target.value))}
                        onClick={(event) => event.stopPropagation()}
                        className="mt-2 rounded-md border border-border bg-paper-raised px-2.5 py-1.5 text-sm text-ink"
                      >
                        {otherItems.map((item) => (
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
                  deleteMode === 'outright' ? 'border-accent bg-accent-soft' : 'border-border bg-paper-raised hover:border-accent/50'
                }`}
              >
                <input
                  type="radio"
                  checked={deleteMode === 'outright'}
                  onChange={() => setDeleteMode('outright')}
                  className="mt-1 accent-accent"
                />
                <div className="min-w-0 flex-1">
                  <p className="font-display font-medium text-ink">Delete outright</p>
                  <p className="text-sm text-ink-soft">
                    {deleteTarget.resource === 'tags'
                      ? `Pieces tagged "${deleteTarget.name}" will just lose that tag — nothing else is affected.`
                      : `Pieces set to "${deleteTarget.name}" will just have no practice status — nothing else is affected.`}
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
