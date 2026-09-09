import { useRef, useState } from 'react'
import {
  IconBan,
  IconCircleCheckFilled,
  IconCircleDashed,
  IconCircleDashedPlus,
  IconCircleHalf2,
  IconDeviceDesktop,
  IconHourglassEmpty,
  IconMoon,
  IconSun,
  IconTrash,
} from '@tabler/icons-react'
import { Modal } from '../components/Modal'
import { Toggle } from '../components/Toggle'
import { useMockupTitle } from '../lib/useMockupTitle'

// User Settings — multi-user support, Phase 8 of the plan (memory
// project_multiuser_build.md). Real build of the approved Phase 5 artifact:
// Option 2 ("separate cards per section" — switched over from Option 1
// after direct feedback that the single-divided-card build didn't read the
// same as the artifact) — Account/Appearance/Library each get their own
// bordered card with a serif heading, rather than one shared card split by
// eyebrow labels. Reached from the sidebar's account menu (Phase 7's
// Option 2 identity-card popup) — not built as a real route destination
// there yet, this is a standalone mockup like every other /mockup/* page.
//
// Applies the relabel noted when Phase 5 was approved: "Infinite scroll" →
// "Paginated views." **Corrected 2026-09-07, during an audit**: this was
// first built on the wrong premise that `content_view_mode` defaults to
// `'paginated'` (checked = paginated = "the default"). It doesn't — the
// real, already-shipped `PieceBrowseView.tsx` has no pagination at all,
// only infinite scroll (a real `useInfiniteQuery` + `IntersectionObserver`
// sentinel), unconditionally, so migration 00024's column now correctly
// defaults to `'infinite'` (Data model section, precious-kindling-pretzel.md).
// "Paginated views" is still the right label — it names the genuinely
// opt-in, not-yet-built action, same pattern as "Hide Books in sidebar"
// below — it just needed the default flipped: unchecked = infinite = the
// real default, checked = paginated = the opt-in feature.
//
// "Show Books in sidebar" was relabeled to "Hide Books in sidebar" per
// direct feedback — same "label names the opt-in *action*, not the
// default state" pattern "Paginated views" now also follows: checked =
// hidden = NOT the default, default is unchecked/false (books shown).
//
// Reuses the real Toggle.tsx component directly (not hand-copied) — one of
// the few pre-existing components stable enough to share into a mockup
// (same exception CLAUDE.md's mockup-first rule already carves out for
// pure presentational logic; Toggle has no page-specific markup of its own
// to drift from). The Theme segmented control is hand-built instead, since
// no equivalent shared component exists yet.
//
// Your Tags / Practice Status, added per direct feedback: the same
// create/delete/merge pattern just built for Admin Settings' Lookup Tables
// (a per-item delete button opening a real modal to merge into another
// entry or delete outright, plus a circular dashed-plus "add" button),
// scoped here instead of there because both lists are genuinely per-user
// data, not shared/library-wide — Tags per CLAUDE.md's own Concurrency
// section ("userTags is confirmed to become a fully private per-user
// vocabulary," which this migration is), Practice Status because making it
// renameable/creatable at all is a **new, per-user** capability (see this
// file's own header note below on the real schema this needs). The footer
// note below ("lookup renames" are admin-only) still refers only to Sheet
// Types/Instruments — those stay global/admin-owned; nothing here
// contradicts that.
//
// Combined into one "Your Tags & Practice Status" card, same day, per
// direct feedback to match Admin Settings' own Lookup Tables layout: one
// bordered card, a `grid grid-cols-1 gap-6 sm:grid-cols-2` two-column
// interior (1 column on mobile, 2 from `sm` up), each column keeping its
// own uppercase label + explanatory paragraph above its `EditableList`
// (unlike Lookup Tables, whose two columns share one card-level
// description — Tags/Practice Status genuinely need different copy, so
// each column keeps its own). Previously two separate `SettingsCard`s.
//
// Real schema implication noted here at the time, since resolved: a real
// `practice_statuses` table (id/name/owner_user_id, same shape as
// `user_tags`) shipped in Phase 10, and the sidebar's Want to
// Learn/Currently Practicing/Learned nav items' own fixed-name assumption
// (this comment's original "bigger open question") was resolved in Phase
// 11 — kept as fixed English names, since a rename/delete degrades
// gracefully to that view's normal empty state rather than needing a new
// "pin to sidebar" mechanism (memory project_multiuser_build.md's own
// Phase 11 section has the full reasoning).
//
// **Practice Status create is disabled — corrected 2026-09-08**: a same-day
// edit briefly re-enabled it on the mistaken belief that the only reason it
// was ever off was the schema not existing yet. Wrong — the schema gap
// was real back when `canAdd={false}` first shipped, but the reason that
// still holds today, direct feedback confirmed, is independent of schema:
// each row renders a fixed hardcoded icon (`PRACTICE_STATUS_ICON_BY_ID`
// below), and creating a genuinely new status raises a real, still-open
// product question — how does a user pick or get assigned an icon for one?
// — that hasn't been decided. `canAdd={false}` stays until that's resolved,
// same muted-icon-plus-"Soon"-pill treatment as any other not-yet-real
// control in this file. Rename/delete/merge on the 5 existing rows (each
// already has a fixed, known icon) are unaffected — only *creating a new
// row* is blocked, since only that path has no icon to assign yet.

type IdentityKey = 'none' | 'singlepass' | 'oidc-admin' | 'oidc-member'

interface Identity {
  label: string
  name: string
  idLine: string
  showChangePassword: boolean
}

const IDENTITIES: Record<IdentityKey, Identity> = {
  none: { label: 'No login', name: 'Admin', idLine: 'No login required for this server.', showChangePassword: false },
  singlepass: { label: 'Password', name: 'Admin', idLine: 'Shared password', showChangePassword: true },
  'oidc-admin': {
    label: 'OIDC — Admin',
    name: 'Jamie Chen',
    idLine: 'Signed in via Authelia as jamie@example.com',
    showChangePassword: false,
  },
  'oidc-member': {
    label: 'OIDC — Member',
    name: 'Alex Rivera',
    idLine: 'Signed in via Authelia as alex@example.com',
    showChangePassword: false,
  },
}

type Theme = 'light' | 'system'

type UserListKey = 'Tags' | 'Practice Status'

interface ListItem {
  id: number
  name: string
}

const INITIAL_USER_LISTS: Record<UserListKey, ListItem[]> = {
  Tags: [
    { id: 1, name: 'Recital' },
    { id: 2, name: 'Wedding' },
    { id: 3, name: 'Christmas' },
  ],
  'Practice Status': [
    { id: 10, name: 'Want to Learn' },
    { id: 11, name: 'Learning' },
    { id: 12, name: 'Learned' },
    { id: 13, name: 'Stalled' },
    { id: 14, name: 'Dropped' },
  ],
}

// Same icon-per-status assignment as the real, already-shipped
// components/PracticeStatusIcon.tsx (an empty→half→full progression across
// the first three, an emptied hourglass for Stalled, a plain ban circle for
// Dropped) — hand-copied rather than imported, since that component renders
// its own markup and mockups only ever share pure presentational
// logic/data with no markup of its own. Keyed by the fixed row id (not the
// live text value), since renaming a row shouldn't make its icon drift —
// only meaningful while item creation stays "coming soon" below (this
// file's own header comment): there's no icon-assignment UX yet for a row
// beyond these five known ids.
const PRACTICE_STATUS_ICON_BY_ID: Record<number, typeof IconCircleDashed> = {
  10: IconCircleDashed,
  11: IconCircleHalf2,
  12: IconCircleCheckFilled,
  13: IconHourglassEmpty,
  14: IconBan,
}

function IdentityStateToggle({
  state,
  onChange,
}: {
  state: IdentityKey
  onChange: (state: IdentityKey) => void
}) {
  return (
    <div className="fixed top-3 right-3 z-30 flex max-w-[min(92vw,560px)] flex-wrap items-center gap-2 rounded-md border border-dashed border-border bg-paper-raised px-2.5 py-1.5 text-xs text-ink-soft shadow-sm">
      <span>Identity state</span>
      <div className="flex flex-wrap overflow-hidden rounded border border-border">
        {(Object.keys(IDENTITIES) as IdentityKey[]).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => onChange(key)}
            className={`cursor-pointer px-2 py-1 ${
              state === key ? 'bg-accent text-white' : 'bg-paper hover:bg-paper-sunken'
            }`}
          >
            {IDENTITIES[key].label}
          </button>
        ))}
      </div>
    </div>
  )
}

function SettingsCard({ title, children }: { title: string; children: React.ReactNode }) {
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
  control: React.ReactNode
  // Neither field behind this row has a real backend yet — migration
  // 00024's user_settings.show_books_in_sidebar/content_view_mode columns
  // are planned but not built until Phase 10 (backend)/12 (this page's own
  // real build). The control stays visible and genuinely toggleable in this
  // mockup (so the two states can still be previewed), but muted + tagged,
  // same "Soon" pill ThemeControl's own Dark option already uses — pointer-
  // events aren't actually blocked, unlike a real disabled control, since
  // there's no live-app consequence to prevent here yet.
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

function ThemeControl({ theme, onChange }: { theme: Theme; onChange: (theme: Theme) => void }) {
  // Corner radius lives on the first/last buttons themselves, not
  // `overflow-hidden` on this wrapper — the Dark button's "Soon" badge
  // pokes up above the row (negative -top offset) and overflow-hidden here
  // clipped it, the same ancestor-clips-descendant gotcha CLAUDE.md already
  // documents elsewhere in this codebase.
  return (
    <div className="flex rounded-md border border-border">
      <button
        type="button"
        onClick={() => onChange('light')}
        className={`flex cursor-pointer items-center gap-1.5 rounded-l-md border-r border-border px-2.5 py-1.5 text-sm ${
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
        onClick={() => onChange('system')}
        className={`flex cursor-pointer items-center gap-1.5 rounded-r-md px-2.5 py-1.5 text-sm ${
          theme === 'system' ? 'bg-accent text-white' : 'bg-paper-raised text-ink-soft hover:bg-paper-sunken'
        }`}
      >
        <IconDeviceDesktop size={14} />
        System
      </button>
    </div>
  )
}

// Shared shape for both Your Tags and Practice Status — same create/
// delete-or-merge interaction `AdminSettingsMockup.tsx`'s Lookup Tables
// section already built, factored into one local component here since
// both cards in *this* file render the identical list shape (unlike
// across separate mockup files, which stay independently hand-copied per
// this codebase's own mockup convention).
function EditableList({
  listKey,
  items,
  onDelete,
  onAdd,
  onBlurItem,
  lastAddedIdRef,
  iconForId,
  canAdd = true,
}: {
  listKey: UserListKey
  items: ListItem[]
  onDelete: (item: ListItem) => void
  onAdd: () => void
  onBlurItem: (id: number, value: string) => void
  lastAddedIdRef: React.RefObject<number | null>
  // Practice Status only — see PRACTICE_STATUS_ICON_BY_ID above.
  iconForId?: Record<number, typeof IconCircleDashed>
  // Practice Status only, for now — each row has a fixed hardcoded icon,
  // and creating a genuinely new status has no icon-assignment UX decided
  // yet (this file's own header comment) — the add control is muted +
  // tagged "Soon" rather than removed, matching the same pattern
  // SettingsRow/ThemeControl already use for a not-yet-real control.
  canAdd?: boolean
}) {
  const noun = listKey === 'Tags' ? 'tag' : 'status'

  // Enter commits (blur triggers the real onBlurItem save/create/cancel
  // logic — see handleListBlur); Escape reverts the DOM value to the
  // item's own current name first — a no-op rename for an existing row, or
  // a cancel for a freshly-added still-blank one (handleListBlur already
  // drops a row blurred blank with no prior name), since this input is
  // uncontrolled and onBlurItem reads event.target.value directly.
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
        const Icon = iconForId?.[item.id]
        return (
          <div key={item.id} className="flex items-center gap-1">
            {Icon && <Icon size={16} className="shrink-0 text-ink-soft" />}
            <input
              defaultValue={item.name}
              placeholder={`New ${noun}`}
              ref={(el) => {
                if (el && lastAddedIdRef.current === item.id) {
                  el.focus()
                  lastAddedIdRef.current = null
                }
              }}
              onKeyDown={(event) => handleEditKeyDown(event, item.name)}
              onBlur={(event) => onBlurItem(item.id, event.target.value)}
              className="min-w-0 flex-1 rounded-md border border-transparent px-2 py-1.5 text-sm text-ink hover:border-border focus:border-border focus:bg-paper-raised focus:outline-none"
            />
            <button
              type="button"
              onClick={() => onDelete(item)}
              aria-label={`Delete ${item.name || 'this entry'}`}
              className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-ink-soft hover:bg-red-50 hover:text-red-700"
            >
              <IconTrash size={14} />
            </button>
          </div>
        )
      })}
      {canAdd ? (
        <button
          type="button"
          onClick={onAdd}
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

export function UserSettingsMockup() {
  useMockupTitle('User Settings')
  const [identityKey, setIdentityKey] = useState<IdentityKey>('none')
  const [names, setNames] = useState<Record<IdentityKey, string>>(() => {
    const initial = {} as Record<IdentityKey, string>
    for (const key of Object.keys(IDENTITIES) as IdentityKey[]) initial[key] = IDENTITIES[key].name
    return initial
  })
  const [theme, setTheme] = useState<Theme>('light')
  // Default false (not hidden — books shown, the real default) — see this
  // file's own header comment: this used to be "showBooksInSidebar",
  // default true, before the label flipped to "Hide Books in sidebar".
  const [hideBooksInSidebar, setHideBooksInSidebar] = useState(false)
  // Default false (not paginated — infinite scroll shown, the real
  // default) — corrected 2026-09-07, see this file's own header comment.
  // Migration 00024's user_settings.content_view_mode defaults to
  // 'infinite', matching PieceBrowseView.tsx's actual current behavior.
  const [paginatedViews, setPaginatedViews] = useState(false)

  const [userLists, setUserLists] = useState<Record<UserListKey, ListItem[]>>(INITIAL_USER_LISTS)
  const nextListIdRef = useRef(100)
  // Set right before a new row's own first render, read (and cleared) by
  // that row's own input ref — a plain ref, not state, since nothing needs
  // to re-render off this, just the one input to focus itself once.
  const lastAddedListIdRef = useRef<number | null>(null)

  const [listDeleteTarget, setListDeleteTarget] = useState<{
    listKey: UserListKey
    id: number
    name: string
  } | null>(null)
  const [listDeleteMode, setListDeleteMode] = useState<'merge' | 'outright'>('merge')
  const [mergeTargetId, setMergeTargetId] = useState<number | null>(null)

  const listOtherItems = listDeleteTarget
    ? userLists[listDeleteTarget.listKey].filter((item) => item.id !== listDeleteTarget.id)
    : []

  function addListItem(listKey: UserListKey) {
    const id = nextListIdRef.current++
    lastAddedListIdRef.current = id
    setUserLists((prev) => ({ ...prev, [listKey]: [...prev[listKey], { id, name: '' }] }))
  }

  function handleListBlur(listKey: UserListKey, id: number, rawValue: string) {
    const value = rawValue.trim()
    setUserLists((prev) => {
      const current = prev[listKey]
      const existing = current.find((item) => item.id === id)
      if (!existing) return prev
      // A freshly-added row left blank on blur — drop it rather than keep
      // a stray unnamed entry around.
      if (!value && existing.name === '') {
        return { ...prev, [listKey]: current.filter((item) => item.id !== id) }
      }
      return { ...prev, [listKey]: current.map((item) => (item.id === id ? { ...item, name: value } : item)) }
    })
  }

  function openListDelete(listKey: UserListKey, item: ListItem) {
    const others = userLists[listKey].filter((i) => i.id !== item.id)
    setListDeleteTarget({ listKey, id: item.id, name: item.name || '(untitled)' })
    setListDeleteMode(others.length > 0 ? 'merge' : 'outright')
    setMergeTargetId(others[0]?.id ?? null)
  }

  function confirmListDelete() {
    if (!listDeleteTarget) return
    const { listKey, id } = listDeleteTarget
    // Both paths remove the original entry either way — a real backend
    // would additionally reassign every piece already using it to
    // `mergeTargetId` first when merging (same reasoning as Admin
    // Settings' own Lookup Tables delete/merge).
    setUserLists((prev) => ({ ...prev, [listKey]: prev[listKey].filter((item) => item.id !== id) }))
    setListDeleteTarget(null)
  }

  const identity = IDENTITIES[identityKey]

  return (
    <div className="flex flex-1 flex-col gap-4 p-6 md:p-8">
      <IdentityStateToggle state={identityKey} onChange={setIdentityKey} />

      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
        <div className="rounded-md border border-dashed border-accent/40 bg-accent-soft/40 px-4 py-2 text-sm text-ink-soft">
          Reference sample — <span className="font-medium text-ink">User Settings, Option 2 (separate cards per
          section)</span>. Reached from the sidebar's account menu. Switch the identity state above to see the
          Account card's identity line and Change Password action adapt — everything else stays identical across
          states.
        </div>

        <h1 className="font-display text-xl font-medium text-ink">User Settings</h1>

        <SettingsCard title="Account">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <input
                value={names[identityKey]}
                onChange={(event) => setNames((prev) => ({ ...prev, [identityKey]: event.target.value }))}
                disabled={identityKey.startsWith('oidc')}
                className="w-full rounded-md border border-border bg-paper-raised px-2.5 py-1.5 text-sm text-ink disabled:cursor-not-allowed disabled:bg-paper-sunken disabled:text-ink-soft"
              />
              <p className="mt-1.5 text-xs text-ink-soft">{identity.idLine}</p>
            </div>
            {identity.showChangePassword && (
              <button
                type="button"
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
            control={<ThemeControl theme={theme} onChange={setTheme} />}
          />
        </SettingsCard>

        <SettingsCard title="Library">
          <SettingsRow
            label='Hide "Books" in sidebar'
            help="Books stay reachable from a piece's own Edit menu even when hidden here."
            soon
            control={
              <Toggle checked={hideBooksInSidebar} onChange={setHideBooksInSidebar} label="" id="hide-books" />
            }
          />
          <SettingsRow
            label="Paginated views"
            help="When off, library views scroll continuously instead of using page controls."
            soon
            control={<Toggle checked={paginatedViews} onChange={setPaginatedViews} label="" id="paginated-views" />}
          />
        </SettingsCard>

        <SettingsCard title="Your Tags & Practice Status">
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <div>
              <p className="mb-1.5 text-xs font-semibold tracking-wide text-ink-soft uppercase">Tags</p>
              <p className="mb-3 text-sm text-ink-soft">
                Private to your account — not shared with anyone else, even other people using this
                library.
              </p>
              <EditableList
                listKey="Tags"
                items={userLists.Tags}
                onDelete={(item) => openListDelete('Tags', item)}
                onAdd={() => addListItem('Tags')}
                onBlurItem={(id, value) => handleListBlur('Tags', id, value)}
                lastAddedIdRef={lastAddedListIdRef}
              />
            </div>

            <div>
              <p className="mb-1.5 text-xs font-semibold tracking-wide text-ink-soft uppercase">
                Practice Status
              </p>
              <p className="mb-3 text-sm text-ink-soft">
                The stages a piece moves through as you learn it. Sonneck ships with these five by
                default — rename them to fit your own workflow. Adding your own statuses is coming
                soon.
              </p>
              <EditableList
                listKey="Practice Status"
                items={userLists['Practice Status']}
                onDelete={(item) => openListDelete('Practice Status', item)}
                onAdd={() => addListItem('Practice Status')}
                onBlurItem={(id, value) => handleListBlur('Practice Status', id, value)}
                lastAddedIdRef={lastAddedListIdRef}
                iconForId={PRACTICE_STATUS_ICON_BY_ID}
                canAdd={false}
              />
            </div>
          </div>
        </SettingsCard>
      </div>

      <Modal
        open={listDeleteTarget !== null}
        onClose={() => setListDeleteTarget(null)}
        labelledBy="list-delete-title"
        footer={
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setListDeleteTarget(null)}
              className="cursor-pointer rounded-md border border-border bg-paper-raised px-4 py-2 text-sm text-ink hover:bg-paper"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={listDeleteMode === 'merge' && mergeTargetId === null}
              onClick={confirmListDelete}
              className="cursor-pointer rounded-md bg-red-700 px-4 py-2 text-sm text-white hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {listDeleteMode === 'merge' ? 'Merge and delete' : 'Delete outright'}
            </button>
          </div>
        }
      >
        {listDeleteTarget && (
          <>
            <h2 id="list-delete-title" className="font-display text-lg font-medium text-ink">
              Delete "{listDeleteTarget.name}"?
            </h2>
            <p className="mt-1 text-sm text-ink-soft">
              {listDeleteTarget.listKey === 'Tags'
                ? 'Choose what happens to pieces already tagged with it.'
                : 'Choose what happens to pieces already set to this status.'}
            </p>

            <div className="mt-4 flex flex-col gap-3" role="radiogroup" aria-label="Delete or merge">
              {listOtherItems.length > 0 && (
                <label
                  className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3.5 ${
                    listDeleteMode === 'merge'
                      ? 'border-accent bg-accent-soft'
                      : 'border-border bg-paper-raised hover:border-accent/50'
                  }`}
                >
                  <input
                    type="radio"
                    checked={listDeleteMode === 'merge'}
                    onChange={() => setListDeleteMode('merge')}
                    className="mt-1 accent-accent"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="font-display font-medium text-ink">
                      Merge into another {listDeleteTarget.listKey === 'Tags' ? 'tag' : 'status'}
                    </p>
                    <p className="text-sm text-ink-soft">
                      Every piece {listDeleteTarget.listKey === 'Tags' ? 'tagged' : 'set to'} "
                      {listDeleteTarget.name}" will be moved to this one instead.
                    </p>
                    {listDeleteMode === 'merge' && (
                      <select
                        value={mergeTargetId ?? ''}
                        onChange={(event) => setMergeTargetId(Number(event.target.value))}
                        onClick={(event) => event.stopPropagation()}
                        className="mt-2 rounded-md border border-border bg-paper-raised px-2.5 py-1.5 text-sm text-ink"
                      >
                        {listOtherItems.map((item) => (
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
                  listDeleteMode === 'outright'
                    ? 'border-accent bg-accent-soft'
                    : 'border-border bg-paper-raised hover:border-accent/50'
                }`}
              >
                <input
                  type="radio"
                  checked={listDeleteMode === 'outright'}
                  onChange={() => setListDeleteMode('outright')}
                  className="mt-1 accent-accent"
                />
                <div className="min-w-0 flex-1">
                  <p className="font-display font-medium text-ink">Delete outright</p>
                  <p className="text-sm text-ink-soft">
                    {listDeleteTarget.listKey === 'Tags'
                      ? `Pieces tagged "${listDeleteTarget.name}" will just lose that tag — nothing else is affected.`
                      : `Pieces set to "${listDeleteTarget.name}" will just have no practice status — nothing else is affected.`}
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
