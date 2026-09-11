import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Navigate } from 'react-router-dom'
import QRCode from 'qrcode'
import {
  IconChevronDown,
  IconCircleCheck,
  IconCircleDashedPlus,
  IconCopy,
  IconExternalLink,
  IconFolderOpen,
  IconInfoCircle,
  IconLockOpen2,
  IconPassword,
  IconTrash,
  IconUserCircle,
  IconWifi,
  IconWifiOff,
} from '@tabler/icons-react'
import { InfoTooltip } from '../components/InfoTooltip'
import { Modal } from '../components/Modal'
import { usePageTitle } from '../lib/usePageTitle'
import { useAuth } from '../lib/AuthContext'
import { copyToClipboard } from '../lib/clipboard'
import { ApiError } from '../api/client'
import { getConfig } from '../api/config'
import { listInstruments, listSheetTypes } from '../api/lookups'
import { chooseNativeFolder, getNativeSettings, restartNativeApp, updateNativeSettings } from '../api/native'
import type { Tag } from '../api/types'
import {
  checkForUpdates,
  createLookupItem,
  deleteAdminUser,
  deleteLookupItem,
  getLibraryCounts,
  getLibrarySettings,
  getVersion,
  listAdminUsers,
  renameLookupItem,
  setSecurity,
  setUserPermissions,
  updateLibrarySettings,
  type AdminUser,
  type LookupResource,
  type Permission,
  type UpdateLibrarySettingsRequest,
} from '../api/admin'

// Admin Settings — matches /mockup/admin-settings' Option B jump-nav +
// bordered section cards, wired to the real endpoints: Users/Security/
// Library-counts/Sheet-Types/Instruments, plus Library Settings and
// Version/Check-for-updates (see internal/handlers/librarysettings.go/
// version.go).
//
// Every preview-only mechanism from the mockup is gone: IdentityStateToggle,
// EnvSimulatorStrip, and the "Preview build identity" BUILD_FIXTURES toggle
// all existed purely to demo multiple states without three separate real
// deployments — the real page only ever has one true identity/security
// state to show, read from GET /api/config and GET /api/admin/version.

const ALL_PERMS: Permission[] = [
  'read', 'download', 'practice', 'edit', 'upload', 'create', 'delete', 'admin',
]

// Matches CLAUDE.md's permission mapping — kept in sync with that doc,
// not re-derived independently.
const PERM_DESCRIPTIONS: Record<Permission, string> = {
  read: 'View and search pieces, books, and people.',
  download: "Download a piece's file.",
  practice: 'Use practice tracking and annotations (Sheet Viewer, once built).',
  edit: 'Edit piece, book, and person details, including adding a new book or person.',
  upload: 'Upload a piece or book file — adding a book also needs Edit.',
  create: 'Create new setlists.',
  delete: 'Delete pieces, books, and people.',
  admin: 'Full access to everything, including these settings — implies every permission above.',
}

const JUMP_LINKS = [
  { id: 'share-network', label: 'Share on Network', nativeOnly: true },
  { id: 'library-settings', label: 'Library Settings' },
  { id: 'library', label: 'Library' },
  { id: 'version', label: 'Version' },
  { id: 'users', label: 'Users' },
  { id: 'lookup', label: 'Lookup Tables' },
]

// Matches AdminSettingsMockup.tsx's own delay — long enough that the fade
// on the address/QR panel (ShareOnNetworkSection below) has a moment to
// play before the restart banner pops in beside it, short enough not to
// feel sluggish.
const RESTART_BANNER_DELAY_MS = 300

function SectionBlock({
  id,
  title,
  headerExtra,
  children,
}: {
  id: string
  title: string
  headerExtra?: ReactNode
  children: ReactNode
}) {
  return (
    <div id={id} className="scroll-mt-20 rounded-lg border border-border bg-paper-raised p-5">
      <h2 className="mb-3 flex items-center font-display text-base font-medium text-ink">
        {title}
        {headerExtra}
      </h2>
      {children}
    </div>
  )
}

function LibraryField({
  label,
  help,
  envSet,
  envVarName,
  control,
}: {
  label: string
  help?: string
  envSet: boolean
  envVarName: string
  control: ReactNode
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
            title={`Set via ${envVarName}`}
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

// Radio-card chooser for the Security "Change…" modal — same visual
// language as FirstLaunchMockup.tsx's own SecurityCard/SecurityStep.
function SecurityCard({
  selected,
  icon,
  title,
  description,
  onSelect,
  children,
}: {
  selected: boolean
  icon: ReactNode
  title: string
  description: string
  onSelect: () => void
  children?: ReactNode
}) {
  return (
    <div
      className={`rounded-lg border p-3.5 ${
        selected ? 'cursor-pointer border-accent bg-accent-soft' : 'cursor-pointer border-border bg-paper-raised hover:border-accent/50'
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

function SecurityChangeModal({ open, onClose, currentMethod }: { open: boolean; onClose: () => void; currentMethod: 'none' | 'singlepass' | 'oidc' }) {
  const queryClient = useQueryClient()
  const [choice, setChoice] = useState<'none' | 'singlepass'>(currentMethod === 'singlepass' ? 'singlepass' : 'none')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  const passwordValid = password.length === 0 || (password.length >= 8 && password === confirmPassword)
  const canSave = choice === 'none' || (passwordValid && (currentMethod === 'singlepass' || password.length > 0))

  const mutation = useMutation({
    mutationFn: () => setSecurity(choice, password || undefined),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['auth', 'me'] })
      setPassword('')
      setConfirmPassword('')
      onClose()
    },
  })

  return (
    <Modal
      open={open}
      onClose={onClose}
      labelledBy="security-modal-title"
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="cursor-pointer rounded-md border border-border bg-paper-raised px-4 py-2 text-sm text-ink hover:bg-paper">
            Cancel
          </button>
          <button
            type="button"
            disabled={!canSave || mutation.isPending}
            onClick={() => mutation.mutate()}
            className="cursor-pointer rounded-md bg-accent px-4 py-2 text-sm text-white enabled:hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {mutation.isPending ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      }
    >
      <h2 id="security-modal-title" className="font-display text-lg font-medium text-ink">Change security</h2>
      <p className="mt-1 text-sm text-ink-soft">Choose how people sign in to this library.</p>
      <div className="mt-4 flex flex-col gap-3" role="radiogroup" aria-label="Security">
        <SecurityCard
          selected={choice === 'none'}
          icon={<IconLockOpen2 size={15} />}
          title="No login"
          description="Anyone with network access to this app can use it, as one shared account."
          onSelect={() => setChoice('none')}
        />
        <SecurityCard
          selected={choice === 'singlepass'}
          icon={<IconPassword size={15} />}
          title="Password"
          description="A single shared password gates the whole app — still just one shared account behind it, now locked."
          onSelect={() => setChoice('singlepass')}
        >
          <div className="flex flex-col gap-2">
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              onClick={(event) => event.stopPropagation()}
              placeholder={currentMethod === 'singlepass' ? 'New password (leave blank to keep current)' : 'Password (min. 8 characters)'}
              className="w-full rounded-md border border-border bg-paper-raised px-3 py-2 text-sm text-ink"
            />
            <input
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              onClick={(event) => event.stopPropagation()}
              placeholder="Confirm password"
              className="w-full rounded-md border border-border bg-paper-raised px-3 py-2 text-sm text-ink"
            />
            {password.length > 0 && !passwordValid && (
              <p className="text-xs text-red-700">{password.length < 8 ? 'At least 8 characters.' : "Passwords don't match."}</p>
            )}
          </div>
        </SecurityCard>
      </div>
      {mutation.isError && (
        <p className="mt-3 text-xs text-red-700">
          {mutation.error instanceof ApiError ? mutation.error.message : 'Something went wrong.'}
        </p>
      )}
      <p className="mt-4 text-xs text-ink-soft">
        Switching to "No login" clears the current password entirely — the next person to switch back to "Password" has
        to set a new one.
      </p>
    </Modal>
  )
}

function isLastAdmin(user: AdminUser): boolean {
  return user.isLastAdmin
}

function UsersSection() {
  const queryClient = useQueryClient()
  const { data: users = [] } = useQuery({ queryKey: ['admin', 'users'], queryFn: listAdminUsers })
  const [openUserId, setOpenUserId] = useState<number | null>(null)

  const permsMutation = useMutation({
    mutationFn: (vars: { id: number; permissions: Permission[] }) => setUserPermissions(vars.id, vars.permissions),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['admin', 'users'] }),
  })
  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteAdminUser(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['admin', 'users'] }),
  })

  function togglePermission(user: AdminUser, perm: Permission) {
    const next = user.permissions.includes(perm)
      ? user.permissions.filter((p) => p !== perm)
      : [...user.permissions, perm]
    permsMutation.mutate({ id: user.id, permissions: next })
  }

  function handleDelete(user: AdminUser) {
    if (isLastAdmin(user)) return
    const message =
      `Delete ${user.displayName}'s account? This removes it from Sonneck only — the account still exists ` +
      `with its identity provider, so signing in again will create a brand-new Sonneck account with none of ` +
      `this one's data (permissions, favorites, notes). This can't be undone.`
    if (!window.confirm(message)) return
    deleteMutation.mutate(user.id)
    if (openUserId === user.id) setOpenUserId(null)
  }

  return (
    <SectionBlock id="users" title="Users">
      <div className="flex flex-col gap-2">
        {users.map((user) => {
          const isOpen = openUserId === user.id
          const isAdmin = user.permissions.includes('admin')
          const lastAdmin = isLastAdmin(user)
          return (
            <div key={user.id} className="rounded-md border border-border">
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
                    <span className="block truncate text-sm font-medium text-ink">{user.displayName}</span>
                  </span>
                  <span
                    className={`ml-auto shrink-0 rounded-full px-2 py-0.5 text-[0.65rem] font-bold tracking-wide uppercase ${
                      isAdmin ? 'bg-accent text-white' : 'bg-paper-sunken text-ink-soft'
                    }`}
                  >
                    {isAdmin ? 'Admin' : `${user.permissions.length} permission${user.permissions.length === 1 ? '' : 's'}`}
                  </span>
                  <IconChevronDown size={16} className={`shrink-0 text-ink-soft transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                </button>
                <button
                  type="button"
                  disabled={lastAdmin}
                  onClick={() => handleDelete(user)}
                  title={lastAdmin ? "The only admin account can't be deleted." : `Delete ${user.displayName}`}
                  aria-label={`Delete ${user.displayName}`}
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
                      <div key={perm} className="flex items-center gap-1">
                        <label className={`flex items-center gap-1.5 text-sm ${locked ? 'cursor-not-allowed text-ink-soft/50' : 'cursor-pointer text-ink'}`}>
                          <input
                            type="checkbox"
                            checked={user.permissions.includes(perm)}
                            disabled={locked}
                            onChange={() => togglePermission(user, perm)}
                            className="accent-accent"
                          />
                          {perm}
                        </label>
                        <InfoTooltip message={PERM_DESCRIPTIONS[perm]} ariaLabel={`What "${perm}" allows`} triggerClassName="text-ink-soft/60 hover:text-ink-soft">
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
  )
}

interface LookupDeleteTarget {
  resource: LookupResource
  id: number
  name: string
}

function LookupColumn({ resource, label, items, onOpenDelete }: {
  resource: LookupResource
  label: string
  items: Tag[]
  onOpenDelete: (target: LookupDeleteTarget) => void
}) {
  const queryClient = useQueryClient()
  const queryKey = [resource === 'sheet-types' ? 'sheet-types' : 'instruments']
  const [pendingId, setPendingId] = useState<number | null>(null)
  const nextTempIdRef = useRef(-1)
  const lastFocusRef = useRef<number | null>(null)
  const noun = resource === 'sheet-types' ? 'sheet type' : 'instrument'

  const createMutation = useMutation({
    mutationFn: (name: string) => createLookupItem(resource, name),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey }),
  })
  const renameMutation = useMutation({
    mutationFn: (vars: { id: number; name: string }) => renameLookupItem(resource, vars.id, vars.name),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey }),
  })

  function addPending() {
    const tempId = nextTempIdRef.current--
    lastFocusRef.current = tempId
    setPendingId(tempId)
  }

  function handleBlur(id: number, rawValue: string, existingName?: string) {
    const value = rawValue.trim()
    if (id === pendingId) {
      setPendingId(null)
      if (value) createMutation.mutate(value)
      return
    }
    if (!value || value === existingName) return
    renameMutation.mutate({ id, name: value })
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>, revertValue: string) {
    if (event.key === 'Enter') {
      event.currentTarget.blur()
    } else if (event.key === 'Escape') {
      event.currentTarget.value = revertValue
      event.currentTarget.blur()
    }
  }

  return (
    <div>
      <p className="mb-1.5 text-xs font-semibold tracking-wide text-ink-soft uppercase">{label}</p>
      <div className="flex flex-col">
        {items.map((item) => (
          <div key={item.id} className="flex items-center gap-1">
            <input
              defaultValue={item.name}
              placeholder={`New ${noun}`}
              onKeyDown={(event) => handleKeyDown(event, item.name)}
              onBlur={(event) => handleBlur(item.id, event.target.value, item.name)}
              className="min-w-0 flex-1 rounded-md border border-transparent px-2 py-1.5 text-sm text-ink hover:border-border focus:border-border focus:bg-paper-raised focus:outline-none"
            />
            <button
              type="button"
              onClick={() => onOpenDelete({ resource, id: item.id, name: item.name || '(untitled)' })}
              aria-label={`Delete ${item.name || 'this entry'}`}
              className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-ink-soft hover:bg-red-50 hover:text-red-700"
            >
              <IconTrash size={14} />
            </button>
          </div>
        ))}
        {pendingId !== null && (
          <input
            defaultValue=""
            placeholder={`New ${noun}`}
            ref={(el) => {
              if (el && lastFocusRef.current === pendingId) {
                el.focus()
                lastFocusRef.current = null
              }
            }}
            onKeyDown={(event) => handleKeyDown(event, '')}
            onBlur={(event) => handleBlur(pendingId, event.target.value)}
            className="min-w-0 flex-1 rounded-md border border-transparent px-2 py-1.5 text-sm text-ink hover:border-border focus:border-border focus:bg-paper-raised focus:outline-none"
          />
        )}
      </div>
      <button
        type="button"
        onClick={addPending}
        aria-label={`Add ${noun}`}
        title={`Add ${noun}`}
        className="mt-3 flex w-full cursor-pointer items-center justify-center text-[#9d9892] hover:text-accent"
      >
        <IconCircleDashedPlus size={22} />
      </button>
    </div>
  )
}

function LookupTablesSection() {
  const { data: sheetTypes = [] } = useQuery({ queryKey: ['sheet-types'], queryFn: listSheetTypes })
  const { data: instruments = [] } = useQuery({ queryKey: ['instruments'], queryFn: listInstruments })
  const queryClient = useQueryClient()

  const [deleteTarget, setDeleteTarget] = useState<LookupDeleteTarget | null>(null)
  const [deleteMode, setDeleteMode] = useState<'merge' | 'outright'>('merge')
  const [mergeTargetId, setMergeTargetId] = useState<number | null>(null)

  const listsByResource: Record<LookupResource, Tag[]> = { 'sheet-types': sheetTypes, instruments }
  const otherItems = deleteTarget ? listsByResource[deleteTarget.resource].filter((item) => item.id !== deleteTarget.id) : []

  const deleteMutation = useMutation({
    mutationFn: (target: LookupDeleteTarget) => deleteLookupItem(target.resource, target.id, mergeTargetId ?? undefined),
    onSuccess: (_result, target) => {
      const queryKey = target.resource === 'sheet-types' ? ['sheet-types'] : ['instruments']
      void queryClient.invalidateQueries({ queryKey })
      setDeleteTarget(null)
    },
  })

  function openDelete(target: LookupDeleteTarget) {
    const others = listsByResource[target.resource].filter((item) => item.id !== target.id)
    setDeleteTarget(target)
    setDeleteMode(others.length > 0 ? 'merge' : 'outright')
    setMergeTargetId(others[0]?.id ?? null)
  }

  return (
    <SectionBlock id="lookup" title="Lookup Tables">
      <p className="mb-4 text-sm text-ink-soft">
        These names are shared across the whole library — every piece and book already tagged with one updates
        automatically when you rename it here, rather than creating a new, separate value. Renaming "Piano" to
        "Keyboard," for example, changes it everywhere "Piano" was used, instead of leaving old pieces on "Piano"
        and new ones on "Keyboard."
      </p>
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        <LookupColumn resource="sheet-types" label="Sheet Types" items={sheetTypes} onOpenDelete={openDelete} />
        <LookupColumn resource="instruments" label="Instruments" items={instruments} onOpenDelete={openDelete} />
      </div>

      <Modal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        labelledBy="lookup-delete-title"
        footer={
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setDeleteTarget(null)} className="cursor-pointer rounded-md border border-border bg-paper-raised px-4 py-2 text-sm text-ink hover:bg-paper">
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
            <h2 id="lookup-delete-title" className="font-display text-lg font-medium text-ink">
              Delete "{deleteTarget.name}"?
            </h2>
            <p className="mt-1 text-sm text-ink-soft">Choose what happens to pieces and books already tagged with it.</p>
            <div className="mt-4 flex flex-col gap-3" role="radiogroup" aria-label="Delete or merge">
              {otherItems.length > 0 && (
                <label
                  className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3.5 ${
                    deleteMode === 'merge' ? 'border-accent bg-accent-soft' : 'border-border bg-paper-raised hover:border-accent/50'
                  }`}
                >
                  <input type="radio" checked={deleteMode === 'merge'} onChange={() => setDeleteMode('merge')} className="mt-1 accent-accent" />
                  <div className="min-w-0 flex-1">
                    <p className="font-display font-medium text-ink">
                      Merge into another {deleteTarget.resource === 'sheet-types' ? 'sheet type' : 'instrument'}
                    </p>
                    <p className="text-sm text-ink-soft">Every piece/book tagged "{deleteTarget.name}" will be retagged instead.</p>
                    {deleteMode === 'merge' && (
                      <select
                        value={mergeTargetId ?? ''}
                        onChange={(event) => setMergeTargetId(Number(event.target.value))}
                        onClick={(event) => event.stopPropagation()}
                        className="mt-2 rounded-md border border-border bg-paper-raised px-2.5 py-1.5 text-sm text-ink"
                      >
                        {otherItems.map((item) => (
                          <option key={item.id} value={item.id}>{item.name || '(untitled)'}</option>
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
                <input type="radio" checked={deleteMode === 'outright'} onChange={() => setDeleteMode('outright')} className="mt-1 accent-accent" />
                <div className="min-w-0 flex-1">
                  <p className="font-display font-medium text-ink">Delete outright</p>
                  <p className="text-sm text-ink-soft">Pieces/books tagged "{deleteTarget.name}" will just lose that tag — nothing else is affected.</p>
                </div>
              </label>
            </div>
          </>
        )}
      </Modal>
    </SectionBlock>
  )
}

function VersionSection() {
  const { data: version } = useQuery({ queryKey: ['admin', 'version'], queryFn: getVersion })
  const queryClient = useQueryClient()
  const checkMutation = useMutation({
    mutationFn: checkForUpdates,
    onSuccess: (result) => queryClient.setQueryData(['admin', 'version'], result),
  })

  const runningLabel = version?.matchedRelease
    ? `version ${version.matchedRelease}`
    : version
      ? `Dev build, from commit ${version.runningSHA.slice(0, 7)} on ${version.runningDate}`
      : '…'

  const releaseUrl = version?.availableVersion
    ? `https://github.com/jpcranford/sonneck/releases/tag/${version.availableVersion}`
    : undefined

  return (
    <SectionBlock id="version" title="Version">
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
          <span className="min-w-0 text-sm text-ink">
            {version?.runningFromSource ? (
              <>
                Running from source <span className="text-ink-soft">(not a packaged build)</span>
              </>
            ) : (
              <>
                Running <strong>{runningLabel}</strong>
              </>
            )}
          </span>
          {/* Same mobile-stacking convention as UserSettingsPage.tsx's own
              SettingsRow — self-end keeps this right-aligned even while
              stacked full-width below `sm`, sm:self-auto reverts to the
              row's own items-center once side-by-side. Without it, this
              long running-version line and the pill/button next to it
              wrapped into each other at in-between widths instead of
              cleanly stacking. */}
          <div className="shrink-0 self-end sm:self-auto">
            {version?.runningFromSource ? (
              <span className="text-sm text-ink-soft" title="No GitHub check runs against a build with no injected commit identity">
                Not applicable
              </span>
            ) : version?.checkStatus === 'behind' ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[#fbe9e7] px-2.5 py-1 text-sm text-[#b45309]">
                version {version.availableVersion} available
                {releaseUrl && (
                  <a href={releaseUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-inherit underline">
                    View release <IconExternalLink size={12} />
                  </a>
                )}
              </span>
            ) : version?.checkStatus === 'upToDate' || version?.checkStatus === 'ahead' ? (
              <span className="inline-flex items-center gap-1.5 text-sm text-[#3fa34d]">
                <IconCircleCheck size={14} className="text-[#3fa34d]" />
                {version.checkStatus === 'ahead' ? 'Ahead of the latest release' : 'Up to date'}
              </span>
            ) : (
              <button
                type="button"
                disabled={checkMutation.isPending}
                onClick={() => checkMutation.mutate()}
                className="cursor-pointer rounded-md border border-border bg-paper-raised px-3 py-1.5 text-sm text-ink hover:border-accent disabled:cursor-not-allowed disabled:opacity-50"
              >
                {checkMutation.isPending ? 'Checking…' : 'Check for updates'}
              </button>
            )}
          </div>
        </div>
        {version?.checkedAt && (
          <p className="text-xs text-ink-soft">Checked just now. Reload the page to check again.</p>
        )}
        <p className="text-xs text-ink-soft">
          Shows the build you're running and checks GitHub for anything newer — without falsely flagging a preview
          or dev build that's already ahead of the latest release.
        </p>
      </div>
    </SectionBlock>
  )
}

// QRCodeCanvas draws a real, genuinely-encoded QR code entirely client-side
// (the `qrcode` package's browser build, canvas output) — never a remote
// QR-generation API, per the locked design-Artifact decision
// (project_wails_native_app_investigation memory's Phase 4): sending a
// user's own LAN address to a third party just to render a code for
// something that only ever needs to work on that LAN is both a real
// privacy leak and a pointless internet dependency for a local-network
// feature. Fixed white background regardless of theme (CLAUDE.md's own
// documented exception for this control) — a QR code needs real
// dark-on-light contrast to stay scannable.
function QRCodeCanvas({ value, size }: { value: string; size: number }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  useEffect(() => {
    if (!canvasRef.current) return
    void QRCode.toCanvas(canvasRef.current, value, { width: size, margin: 0, color: { dark: '#1a1a1a', light: '#ffffff' } })
  }, [value, size])
  return <canvas ref={canvasRef} width={size} height={size} className="block" />
}

// ShareOnNetworkSection is a real build of the approved design Artifact's
// Option C (project_wails_native_app_investigation memory's Phase 4) —
// status pill in the header, restart-required toggle, primary LAN address
// + real QR code once live. shareOnNetwork/libraryPath are the persisted
// choice (what a restart will apply); appliedShareOnNetwork is what this
// running process actually booted with — only a real restart
// (handleRestartNow, POST /api/native/restart) ever moves the latter, so
// the status pill and address/QR panel both track *applied*, never the
// pending toggle value, exactly like the mockup's own locked reasoning.
function ShareOnNetworkSection() {
  const { data: settings } = useQuery({ queryKey: ['native-settings'], queryFn: getNativeSettings })
  const queryClient = useQueryClient()
  const patchMutation = useMutation({
    mutationFn: updateNativeSettings,
    onSuccess: (updated) => queryClient.setQueryData(['native-settings'], updated),
  })
  const restartMutation = useMutation({ mutationFn: restartNativeApp })

  const [showAllAddresses, setShowAllAddresses] = useState(false)
  const [showRestartBanner, setShowRestartBanner] = useState(false)
  const restartBannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function clearRestartBannerTimer() {
    if (restartBannerTimerRef.current !== null) {
      clearTimeout(restartBannerTimerRef.current)
      restartBannerTimerRef.current = null
    }
  }

  if (!settings) return null

  const restartPending = settings.shareOnNetwork !== settings.appliedShareOnNetwork
  // Still live, but about to turn off once restarted — the one direction
  // that actually has something to fade (the reverse, pending-*on*, has no
  // address/QR panel showing yet at all, since that stays gated on the
  // applied value below).
  const imminentSwitchOff = restartPending && !settings.shareOnNetwork

  function toggleShareOnNetwork() {
    const next = !settings!.shareOnNetwork
    clearRestartBannerTimer()
    patchMutation.mutate({ shareOnNetwork: next })
    if (next === settings!.appliedShareOnNetwork) {
      setShowRestartBanner(false)
    } else {
      restartBannerTimerRef.current = setTimeout(() => setShowRestartBanner(true), RESTART_BANNER_DELAY_MS)
    }
  }

  function handleRestartNow() {
    clearRestartBannerTimer()
    setShowRestartBanner(false)
    restartMutation.mutate()
  }

  const primaryAddress = settings.localIPs[0] ? `http://${settings.localIPs[0]}:${settings.port}` : null

  return (
    <SectionBlock
      id="share-network"
      title="Share on Network"
      headerExtra={
        settings.appliedShareOnNetwork ? (
          <span className="ml-2.5 inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-2.5 py-0.5 text-xs font-semibold text-accent">
            <IconWifi size={12} />
            Shared on this network
          </span>
        ) : (
          <span className="ml-2.5 inline-flex items-center gap-1.5 rounded-full bg-paper-sunken px-2.5 py-0.5 text-xs font-semibold text-ink-soft">
            <IconWifiOff size={12} />
            Private to this device
          </span>
        )
      }
    >
      <div className="flex items-center justify-between gap-4 py-1">
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink">Share on network</p>
          <p className="mt-0.5 text-xs text-ink-soft">Off by default — turn on to reach Sonneck from another device.</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={settings.shareOnNetwork}
          onClick={toggleShareOnNetwork}
          className={`relative h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors ${
            settings.shareOnNetwork ? 'bg-accent' : 'bg-border'
          }`}
        >
          <span
            className={`absolute top-0.5 size-5 rounded-full bg-white transition-all ${
              settings.shareOnNetwork ? 'left-5' : 'left-0.5'
            }`}
          />
        </button>
      </div>

      {showRestartBanner && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-md border border-dashed border-accent/40 bg-accent-soft/40 px-3.5 py-2.5">
          <p className="flex items-center gap-1.5 text-xs font-medium text-ink">
            <IconInfoCircle size={14} className="shrink-0 text-accent" />
            Restart Sonneck to {settings.shareOnNetwork ? 'start sharing on this network' : 'stop sharing on this network'}.
          </p>
          <button
            type="button"
            onClick={handleRestartNow}
            disabled={restartMutation.isPending}
            className="shrink-0 cursor-pointer rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {restartMutation.isPending ? 'Restarting…' : 'Restart Now'}
          </button>
        </div>
      )}

      {settings.appliedShareOnNetwork && primaryAddress && (
        <div
          className={`transition-opacity duration-300 ${imminentSwitchOff ? 'pointer-events-none opacity-40' : ''}`}
          aria-hidden={imminentSwitchOff}
        >
          <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg bg-paper-sunken p-3">
            <div className="flex min-w-0 flex-1 items-center justify-between gap-3 rounded-md bg-paper-raised px-3.5 py-2.5">
              <span className="truncate font-mono text-base font-semibold text-ink">{primaryAddress}</span>
              <button
                type="button"
                onClick={() => void copyToClipboard(primaryAddress)}
                className="flex shrink-0 cursor-pointer items-center gap-1 text-xs text-ink-soft hover:text-ink"
              >
                <IconCopy size={14} />
                Copy
              </button>
            </div>
            <div
              className="flex size-[4.25rem] shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-white"
              title={primaryAddress}
            >
              <QRCodeCanvas value={primaryAddress} size={60} />
            </div>
          </div>
          {settings.localIPs.length > 1 && (
            <div className="mt-2">
              {showAllAddresses ? (
                <ul className="flex flex-col gap-1">
                  {settings.localIPs.slice(1).map((ip) => (
                    <li key={ip} className="font-mono text-xs text-ink-soft">
                      http://{ip}:{settings.port}
                    </li>
                  ))}
                </ul>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowAllAddresses(true)}
                  className="cursor-pointer text-xs text-accent underline underline-offset-2 hover:text-accent/80"
                >
                  +{settings.localIPs.length - 1} more address
                </button>
              )}
            </div>
          )}
          <p className="mt-2 text-xs text-ink-soft">
            Scan with a phone camera, or open the address above from another device on this network.
          </p>
        </div>
      )}
    </SectionBlock>
  )
}

// LibraryLocationModal is a real build of the approved mockup's own
// "Change library location" modal — the fixture-cycling "Choose a
// different folder…" button is now a real native OS folder dialog
// (chooseNativeFolder), and "Save changes" persists via PATCH
// /api/native/settings rather than updating local-only state, since
// DATA_DIR can't change without a real restart (see FirstLaunchFlow.tsx's
// own header comment for the identical underlying reason). The
// move-vs-point choice is real too: moveExisting true physically moves the
// current library's contents at the next restart
// (nativeconfig.ApplyPendingLibraryMove, cmd/sonneck-desktop/main.go),
// false just repoints. Neither happens synchronously here — this modal's
// own "Save changes" only ever records the pending choice; LibraryField's
// own restart-pending row (LibrarySettingsSection below) is what actually
// triggers the move via a real restart.
function LibraryLocationModal({
  open,
  onClose,
  currentPath,
}: {
  open: boolean
  onClose: () => void
  currentPath: string
}) {
  const queryClient = useQueryClient()
  const [candidatePath, setCandidatePath] = useState(currentPath)
  const [moveExisting, setMoveExisting] = useState(true)

  const chooseMutation = useMutation({
    mutationFn: chooseNativeFolder,
    onSuccess: ({ path }) => {
      if (path) setCandidatePath(path)
    },
  })

  const saveMutation = useMutation({
    mutationFn: () => updateNativeSettings({ libraryPath: candidatePath, moveExisting }),
    onSuccess: (updated) => {
      queryClient.setQueryData(['native-settings'], updated)
      onClose()
    },
  })

  return (
    <Modal
      open={open}
      onClose={onClose}
      labelledBy="library-location-modal-title"
      footer={
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-md border border-border bg-paper-raised px-4 py-2 text-sm text-ink hover:bg-paper"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={candidatePath === currentPath || saveMutation.isPending}
            onClick={() => saveMutation.mutate()}
            className="cursor-pointer rounded-md bg-accent px-4 py-2 text-sm text-white enabled:hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {saveMutation.isPending ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      }
    >
      <h2 id="library-location-modal-title" className="font-display text-lg font-medium text-ink">
        Change library location
      </h2>
      <p className="mt-1 text-sm text-ink-soft">Choose a new folder for Sonneck's library.</p>

      <div className="mt-4 flex items-center gap-3 rounded-md border border-border bg-paper-sunken px-3.5 py-2.5">
        <span className="min-w-0 flex-1 truncate font-mono text-sm text-ink">{candidatePath}</span>
        <button
          type="button"
          onClick={() => chooseMutation.mutate()}
          disabled={chooseMutation.isPending}
          className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md border border-border bg-paper-raised px-2.5 py-1 text-xs text-ink hover:border-accent disabled:cursor-not-allowed disabled:opacity-60"
        >
          <IconFolderOpen size={14} />
          Choose a different folder…
        </button>
      </div>

      <div className="mt-4 flex flex-col gap-2" role="radiogroup" aria-label="What happens to your current library">
        <label className="flex cursor-pointer items-start gap-2.5 rounded-md border border-border p-3 has-checked:border-accent has-checked:bg-accent-soft">
          <input
            type="radio"
            name="move-existing"
            checked={moveExisting}
            onChange={() => setMoveExisting(true)}
            className="mt-0.5 accent-accent"
          />
          <span>
            <span className="block text-sm font-medium text-ink">Move everything here</span>
            <span className="block text-xs text-ink-soft">
              Your books, pieces, and database move from {currentPath} to the new folder.
            </span>
          </span>
        </label>
        <label className="flex cursor-pointer items-start gap-2.5 rounded-md border border-border p-3 has-checked:border-accent has-checked:bg-accent-soft">
          <input
            type="radio"
            name="move-existing"
            checked={!moveExisting}
            onChange={() => setMoveExisting(false)}
            className="mt-0.5 accent-accent"
          />
          <span>
            <span className="block text-sm font-medium text-ink">Just use this folder going forward</span>
            <span className="block text-xs text-ink-soft">
              Nothing moves — point Sonneck at the new folder as-is (useful for an already-populated or empty folder).
            </span>
          </span>
        </label>
      </div>

      {saveMutation.isError && (
        <p className="mt-3 text-xs text-red-700">
          {saveMutation.error instanceof ApiError ? saveMutation.error.message : 'Something went wrong.'}
        </p>
      )}
      <p className="mt-3 flex items-start gap-1.5 text-xs text-ink-soft">
        <IconInfoCircle size={14} className="mt-0.5 shrink-0" />
        Takes effect after a restart — you'll get a "Restart Now" button once this is saved.
      </p>
    </Modal>
  )
}

function LibrarySettingsSection() {
  const { data: settings } = useQuery({ queryKey: ['admin', 'library-settings'], queryFn: getLibrarySettings })
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: updateLibrarySettings,
    onSuccess: (updated) => queryClient.setQueryData(['admin', 'library-settings'], updated),
  })

  const [securityModalOpen, setSecurityModalOpen] = useState(false)
  const { data: config } = useQuery({ queryKey: ['config'], queryFn: getConfig })
  const me = useAuth()
  const isNative = config?.buildTarget === 'native'

  const { data: nativeSettings } = useQuery({
    queryKey: ['native-settings'],
    queryFn: getNativeSettings,
    enabled: isNative,
  })
  const [libraryLocationModalOpen, setLibraryLocationModalOpen] = useState(false)
  const restartMutation = useMutation({ mutationFn: restartNativeApp })

  function patch(partial: Partial<UpdateLibrarySettingsRequest>) {
    if (!settings) return
    mutation.mutate({
      backupCron: settings.backupCron,
      backupRetentionDays: settings.backupRetentionDays,
      logLevel: settings.logLevel,
      copyrightRegion: settings.copyrightRegion,
      ...partial,
    })
  }

  if (!settings) return null

  return (
    <SectionBlock id="library-settings" title="Library Settings">
      <div className="divide-y divide-border">
        <LibraryField
          label="Backup schedule"
          help="Standard cron expression"
          envSet={settings.backupCronSetByEnv}
          envVarName="BACKUP_CRON"
          control={
            <input
              defaultValue={settings.backupCron}
              onBlur={(event) => event.target.value.trim() && patch({ backupCron: event.target.value.trim() })}
              className="w-40 rounded-md border border-border bg-paper-raised px-2.5 py-1.5 text-sm text-ink"
            />
          }
        />
        <LibraryField
          label="Backup retention"
          help="Days before an old backup is pruned"
          envSet={settings.backupRetentionDaysSetByEnv}
          envVarName="BACKUP_RETENTION_DAYS"
          control={
            <input
              type="number"
              min={1}
              defaultValue={settings.backupRetentionDays}
              onBlur={(event) => {
                const n = Number(event.target.value)
                if (n > 0) patch({ backupRetentionDays: n })
              }}
              className="w-20 rounded-md border border-border bg-paper-raised px-2.5 py-1.5 text-sm text-ink"
            />
          }
        />
        <LibraryField
          label="Log level"
          envSet={settings.logLevelSetByEnv}
          envVarName="LOG_LEVEL"
          control={
            <select
              value={settings.logLevel}
              onChange={(event) => patch({ logLevel: event.target.value as UpdateLibrarySettingsRequest['logLevel'] })}
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
          envSet={settings.copyrightRegionSetByEnv}
          envVarName="COPYRIGHT_REGION"
          control={
            <select
              value={settings.copyrightRegion}
              onChange={(event) => patch({ copyrightRegion: event.target.value })}
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
          help={`Currently: ${me.authMethod === 'none' ? 'No login' : me.authMethod === 'singlepass' ? 'Password' : 'Sign in with identity provider'}`}
          envSet={(config?.authMethodSetByEnv ?? false) || me.authMethod === 'oidc'}
          envVarName="AUTH_METHOD"
          control={
            <button
              type="button"
              onClick={() => setSecurityModalOpen(true)}
              className="cursor-pointer rounded-md border border-border bg-paper-raised px-3 py-1.5 text-sm text-ink hover:border-accent"
            >
              Change…
            </button>
          }
        />
        {isNative && nativeSettings && (
          <div className="flex items-center justify-between gap-4 py-2.5">
            <div className="min-w-0">
              <p className="text-sm font-medium text-ink">Library location</p>
              <p className="mt-0.5 truncate font-mono text-xs text-ink-soft">{nativeSettings.libraryPath}</p>
            </div>
            <div className="shrink-0">
              <button
                type="button"
                onClick={() => setLibraryLocationModalOpen(true)}
                className="cursor-pointer rounded-md border border-border bg-paper-raised px-3 py-1.5 text-sm text-ink hover:border-accent"
              >
                Change…
              </button>
            </div>
          </div>
        )}
      </div>

      {isNative && nativeSettings?.pendingLibraryPath && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-md border border-dashed border-accent/40 bg-accent-soft/40 px-3.5 py-2.5">
          <p className="flex items-center gap-1.5 text-xs font-medium text-ink">
            <IconInfoCircle size={14} className="shrink-0 text-accent" />
            Restart Sonneck to switch to {nativeSettings.pendingLibraryPath}.
          </p>
          <button
            type="button"
            onClick={() => restartMutation.mutate()}
            disabled={restartMutation.isPending}
            className="shrink-0 cursor-pointer rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {restartMutation.isPending ? 'Restarting…' : 'Restart Now'}
          </button>
        </div>
      )}

      <SecurityChangeModal open={securityModalOpen} onClose={() => setSecurityModalOpen(false)} currentMethod={me.authMethod} />
      {isNative && nativeSettings && (
        <LibraryLocationModal
          open={libraryLocationModalOpen}
          onClose={() => setLibraryLocationModalOpen(false)}
          currentPath={nativeSettings.libraryPath}
        />
      )}
    </SectionBlock>
  )
}

function LibrarySection() {
  const { data: counts } = useQuery({ queryKey: ['admin', 'library-counts'], queryFn: getLibraryCounts })
  return (
    <SectionBlock id="library" title="Library">
      <div className="flex gap-3">
        {[
          { label: 'Pieces', value: counts?.pieces ?? 0 },
          { label: 'Books', value: counts?.books ?? 0 },
          { label: 'People', value: counts?.people ?? 0 },
        ].map((stat) => (
          <div key={stat.label} className="flex-1 rounded-md border border-border py-3 text-center">
            <p className="font-display text-2xl font-bold text-ink">{stat.value}</p>
            <p className="mt-0.5 text-xs tracking-wide text-ink-soft uppercase">{stat.label}</p>
          </div>
        ))}
      </div>
    </SectionBlock>
  )
}

export function AdminPage() {
  usePageTitle('Admin Settings')
  const me = useAuth()
  const { data: config } = useQuery({ queryKey: ['config'], queryFn: getConfig })
  const isNative = config?.buildTarget === 'native'
  if (!me.permissions.includes('admin')) {
    return <Navigate to="/" replace />
  }

  return (
    <div className="flex flex-1 flex-col gap-4 p-6 md:p-8">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
        <h1 className="font-display text-xl font-medium text-ink">Admin Settings</h1>

        <div className="flex flex-wrap gap-1.5 rounded-lg border border-border bg-paper-raised p-4">
          {JUMP_LINKS.filter((link) => !link.nativeOnly || isNative).map((link) => (
            <a key={link.id} href={`#${link.id}`} className="rounded-full bg-paper-sunken px-2.5 py-1 text-xs text-ink-soft hover:bg-accent-soft hover:text-accent">
              {link.label}
            </a>
          ))}
        </div>

        {isNative && <ShareOnNetworkSection />}
        <LibrarySettingsSection />
        <LibrarySection />
        <VersionSection />
        <UsersSection />
        <LookupTablesSection />
      </div>
    </div>
  )
}
