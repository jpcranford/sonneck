import { useEffect, useState, type ReactNode } from 'react'
import {
  IconAlertTriangle,
  IconArrowLeft,
  IconCloudOff,
  IconEye,
  IconLoader2,
  IconRefresh,
  IconSearch,
} from '@tabler/icons-react'
import { useMockupTitle } from '../lib/useMockupTitle'

// Every empty, error and loading state in the app on one page, for
// reviewing them side by side (they only appear in special moments, so
// they're easy to miss when going page by page). A frozen, hand-maintained
// copy of each real state's markup, like every other mockup; the label
// above each one says where the real one lives.

type Kind = 'empty' | 'error' | 'loading'
type PreviewTheme = 'light' | 'dark'

const KINDS: { key: Kind; label: string }[] = [
  { key: 'empty', label: 'Empty' },
  { key: 'error', label: 'Error' },
  { key: 'loading', label: 'Loading' },
]

// Sets <html data-theme> while this page is open and puts back whatever
// was there when it closes (the Style Sampler does the same).
function usePreviewTheme(theme: PreviewTheme) {
  useEffect(() => {
    const root = document.documentElement
    const previous = root.dataset.theme
    root.dataset.theme = theme
    return () => {
      if (previous) root.dataset.theme = previous
      else delete root.dataset.theme
    }
  }, [theme])
}

function Switch<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: { key: T; label: string }[]
  value: T
  onChange: (value: T) => void
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="flex items-center gap-0.5 rounded-md border border-border p-0.5 text-sm"
    >
      {options.map(({ key, label: optionLabel }) => (
        <button
          key={key}
          type="button"
          aria-pressed={value === key}
          onClick={() => onChange(key)}
          className={`cursor-pointer rounded px-3 py-1 ${
            value === key
              ? 'bg-accent-soft font-medium text-accent'
              : 'text-ink-soft hover:text-ink'
          }`}
        >
          {optionLabel}
        </button>
      ))}
    </div>
  )
}

// One specimen: where it appears, then the state in a stand-in for its
// surroundings (the page itself, a card, a window, the sidebar).
function Specimen({
  where,
  note,
  surface = 'page',
  children,
}: {
  where: string
  note?: string
  surface?: 'page' | 'card' | 'sidebar'
  children: ReactNode
}) {
  const surfaceClass =
    surface === 'card'
      ? 'rounded-lg border border-border bg-paper-raised p-4'
      : surface === 'sidebar'
        ? 'rounded-lg bg-sidebar-bg p-3'
        : 'rounded-lg border border-dashed border-border bg-paper p-4'
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <p className="text-xs font-medium tracking-wide text-ink-soft uppercase">{where}</p>
      {note && <p className="text-xs text-ink-muted">{note}</p>}
      <div className={surfaceClass}>{children}</div>
    </div>
  )
}

function EmptyStates() {
  return (
    <>
      <Specimen where="Library — no pieces at all" note="PieceBrowseView, emptyMessage">
        <p className="p-8 text-center text-ink-muted">
          Your library is empty — upload a piece to get started.
        </p>
      </Specimen>
      <Specimen
        where="Library — search with no matches"
        note="Same line on Books and People: “No books match your search.”, “No people match these filters.”"
      >
        <p className="p-8 text-center text-ink-muted">No pieces match your search.</p>
      </Specimen>
      <Specimen
        where="Favorites / Want to Learn / Currently Practicing / Learned"
        note="Each view's own emptyMessage"
      >
        <p className="p-8 text-center text-ink-muted">You haven't favorited any pieces yet.</p>
      </Specimen>
      <Specimen where="Books — no books at all">
        <div className="p-8 text-center">
          <p className="font-display font-medium text-ink-muted">No books yet</p>
          <p className="mt-1 text-sm text-ink-muted italic">
            Books are created via the import wizard or the New Book button above.
          </p>
        </div>
      </Specimen>
      <Specimen where="Book Details / Person Details — no pieces">
        <div className="py-6 text-center">
          <p className="font-display font-medium text-ink-muted">No pieces yet</p>
          <p className="mt-1 text-sm text-ink-muted italic">
            Pieces added to this book will appear here, sorted by their start page.
          </p>
        </div>
      </Specimen>
      <Specimen where="Setlists Library — no setlists">
        <div className="flex flex-col gap-3">
          <h2 className="font-display text-lg font-medium text-ink">Active</h2>
          <p className="text-sm text-ink-muted italic">No active setlists.</p>
          <h2 className="font-display text-lg font-medium text-ink">Archived</h2>
          <p className="text-sm text-ink-muted italic">No archived setlists.</p>
        </div>
      </Specimen>
      <Specimen where="Setlist Details — empty program">
        <p className="py-6 text-center text-sm text-ink-muted italic">
          No entries yet — use Edit Program to add some.
        </p>
      </Specimen>
      <Specimen where="Sidebar — Upcoming Sets with none" surface="sidebar">
        <p className="px-2 text-xs tracking-wide text-sidebar-text-dim uppercase">Upcoming sets</p>
        <p className="mt-1 px-2 py-1.5 text-sm text-sidebar-text-dim/60 italic">No upcoming sets</p>
      </Specimen>
      <Specimen where="Add to Setlist picker — no setlists" surface="card">
        <div className="relative">
          <IconSearch
            size={14}
            className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-ink-faint"
          />
          <div className="w-full rounded-md border border-border bg-paper-raised py-1.5 pr-3 pl-8 text-sm text-ink-faint">
            Search setlists…
          </div>
        </div>
        <div className="mt-2 border-t border-border pt-1">
          <p className="px-3 py-3 text-center text-sm text-ink-soft/60 italic">No upcoming sets</p>
        </div>
      </Specimen>
      <Specimen where="Edit Setlist — piece search with no matches" surface="card">
        <p className="px-2 py-4 text-center text-sm text-ink-muted italic">No matches</p>
      </Specimen>
    </>
  )
}

// Copy of components/ServerUnreachable.tsx's two resting states.
function ServerUnreachableSample({ gaveUp }: { gaveUp: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-8 text-center">
      <IconCloudOff size={48} stroke={1.5} className="text-ink-soft" />
      <h1 className="font-display text-xl font-medium text-ink">Can't reach Sonneck</h1>
      <p className="max-w-xs text-ink-soft">
        {gaveUp
          ? "The server didn't answer. Check that it's running, then try again."
          : 'Trying again in 8 seconds…'}
      </p>
      <span
        className={`mt-2 flex cursor-pointer items-center gap-2 rounded-md px-4 py-2 font-display font-medium ${
          gaveUp ? 'bg-accent-fill text-white' : 'border border-border bg-paper-raised text-ink'
        }`}
      >
        <IconRefresh size={16} />
        {gaveUp ? 'Try again' : 'Try now'}
      </span>
    </div>
  )
}

function ErrorStates() {
  return (
    <>
      <Specimen
        where="Piece / Book / Person / Setlist not found"
        note="Each says its own noun; Person reads “They may have been deleted.”"
      >
        <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
          <h1 className="font-display text-3xl font-medium text-ink">Piece not found</h1>
          <p className="text-ink-soft">It may have been deleted or moved.</p>
        </div>
      </Specimen>
      <Specimen where="Any unknown address">
        <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
          <h1 className="font-display text-3xl font-medium text-ink">Page not found</h1>
          <p className="text-ink-soft">There's nothing at this address.</p>
          <span className="mt-4 cursor-pointer text-accent underline">Back to Library</span>
        </div>
      </Specimen>
      <Specimen
        where="Server unreachable at start-up — retrying"
        note="components/ServerUnreachable.tsx. Retries by itself after 5, 10, 20, 30 and 30 seconds; Try now or pulling down skips the wait."
      >
        <ServerUnreachableSample gaveUp={false} />
      </Specimen>
      <Specimen
        where="Server unreachable at start-up — gave up"
        note="After the fifth automatic try fails it stops and waits for Try again (or a pull)."
      >
        <ServerUnreachableSample gaveUp />
      </Specimen>
      <Specimen
        where="A page that couldn't load"
        note="Library, Books, People, Piece Details… (the server's own message when it sends one)"
      >
        <p className="p-8 text-center text-ink-soft">Could not load these pieces.</p>
      </Specimen>
      <Specimen
        where="A window that couldn't save"
        note="Edit Piece, Edit Book, Edit Person, New Book…"
        surface="card"
      >
        <div className="flex flex-col gap-3">
          <p className="flex items-center gap-2 text-sm text-danger">
            <IconAlertTriangle size={16} />
            Could not save. Please try again.
          </p>
          <div className="flex justify-end gap-2">
            <span className="rounded-md border border-border bg-paper-raised px-4 py-2 font-display font-medium text-ink">
              Cancel
            </span>
            <span className="rounded-md bg-accent-fill px-4 py-2 font-display font-medium text-white">
              Save
            </span>
          </div>
        </div>
      </Specimen>
      <Specimen
        where="A missing required field"
        note="Upload book › Name each piece"
        surface="card"
      >
        <label className="mb-1 block text-sm text-ink-soft">
          Title <span className="text-danger">*</span>
        </label>
        <div className="w-full rounded-md border border-danger bg-paper-raised px-2.5 py-[11px] text-sm text-ink">
          &nbsp;
        </div>
        <span className="mt-0.5 flex items-center gap-1 text-xs text-danger">
          <IconAlertTriangle size={10} />
          Required
        </span>
      </Specimen>
      <Specimen where="Login — wrong password">
        <div className="mx-auto flex w-full max-w-sm flex-col items-center gap-5">
          <div className="relative w-full">
            <div className="w-full rounded-md border border-danger bg-paper-raised px-3 py-2 pr-9 text-base tracking-wide text-ink">
              ••••••••
            </div>
            <IconEye
              size={16}
              className="absolute top-1/2 right-2 -translate-y-1/2 text-ink-soft"
            />
          </div>
          <p className="-mt-3 flex items-center justify-center gap-1.5 text-xs font-medium text-danger">
            <IconAlertTriangle size={14} />
            Incorrect password.
          </p>
        </div>
      </Specimen>
      <Specimen where="Upload — a file that couldn't upload" note="Upload page, Book Upload Wizard">
        <p className="flex items-center gap-2 text-sm text-danger">
          <IconAlertTriangle size={16} />
          Upload failed. Please try again.
        </p>
      </Specimen>
    </>
  )
}

function LoadingStates() {
  return (
    <>
      <Specimen
        where="A page loading"
        note="Piece / Book / Person / Setlist Details. A not-found link shows this for ~7s (three automatic retries) before “not found”."
      >
        <span className="mb-3 flex items-center gap-1.5 text-sm text-ink-soft">
          <IconArrowLeft size={16} />
          Back to Library
        </span>
        <p className="text-ink-soft">Loading…</p>
      </Specimen>
      <Specimen where="Library / Books loading">
        <p className="p-8 text-center text-ink-soft">Loading…</p>
      </Specimen>
      <Specimen where="Thumbnails still loading" note="Grid cards before each page image arrives">
        <div className="grid grid-cols-3 gap-3">
          {['Allegro', 'Trio', 'Lento'].map((title) => (
            <div
              key={title}
              className="flex flex-col overflow-hidden rounded-lg border border-border bg-paper-raised"
            >
              <div className="aspect-[180/132] w-full border-b border-border bg-border" />
              <div className="p-2.5">
                <p className="truncate font-display text-sm font-medium text-ink">{title}</p>
                <p className="truncate text-xs text-ink-soft">Charles Villiers Stanford</p>
              </div>
            </div>
          ))}
        </div>
      </Specimen>
      <Specimen
        where="A window saving"
        note="Edit Book, Edit Person (striped button)"
        surface="card"
      >
        <div className="flex justify-end">
          <span className="relative flex min-w-[190px] items-center justify-center overflow-hidden rounded-md bg-accent-fill px-4 py-2 font-display font-medium whitespace-nowrap text-white">
            <span
              aria-hidden="true"
              className="absolute inset-y-0 -left-14 w-[calc(100%+56px)] animate-stripe-move bg-[length:56px_56px] [background-image:repeating-linear-gradient(45deg,rgba(255,255,255,0.3)_0,rgba(255,255,255,0.3)_10px,transparent_10px,transparent_20px)] will-change-transform motion-reduce:animate-none motion-reduce:opacity-60"
            />
            <span className="relative z-10">Updating 10 pieces…</span>
          </span>
        </div>
      </Specimen>
      <Specimen where="Looking something up" note="IMSLP autofill, Wikipedia search" surface="card">
        <div className="flex items-center gap-2 rounded-md border border-border bg-paper-raised px-3 py-2 text-ink">
          <span className="flex-1">972987</span>
          <IconLoader2 size={16} className="animate-spin text-ink-soft" />
        </div>
      </Specimen>
      <Specimen where="Auth Change — updating the library">
        <div className="flex flex-col items-center py-8 text-center">
          <IconLoader2 size={44} className="animate-spin text-ink" />
          <h1 className="mt-4 font-display text-2xl font-medium text-ink">Updating your library</h1>
          <p className="mt-2 text-sm text-ink-soft">This will only take a moment.</p>
        </div>
      </Specimen>
      <Specimen
        where="Desktop app — switching libraries"
        note="First launch / Admin Settings › Library location"
      >
        <div className="flex flex-col items-center gap-4 py-8 text-center">
          <div className="size-8 animate-spin rounded-full border-2 border-border border-t-accent" />
          <h1 className="font-display text-2xl font-medium text-ink">Switching libraries…</h1>
          <p className="text-sm text-ink-soft">Sonneck is restarting to use your new folder.</p>
        </div>
      </Specimen>
      <Specimen where="Phone — pull to refresh">
        <div className="flex justify-center py-3">
          <IconLoader2 size={22} className="animate-spin text-accent" />
        </div>
      </Specimen>
    </>
  )
}

export function StatesMockup() {
  useMockupTitle('Empty, Error & Loading States')
  const [kind, setKind] = useState<Kind>('empty')
  const [theme, setTheme] = useState<PreviewTheme>('light')
  usePreviewTheme(theme)

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-8">
      <h1 className="font-display text-3xl font-medium text-ink">
        Empty, Error &amp; Loading States
      </h1>
      <p className="mt-2 max-w-3xl text-sm text-ink-soft">
        What screens show when there's nothing to show, when something goes wrong, and while
        waiting. Copies of the real markup; each label says where the real one lives.
      </p>
      <div className="sticky top-0 z-10 -mx-4 mt-5 flex flex-wrap items-center gap-3 bg-paper/95 px-4 py-3 backdrop-blur-sm sm:-mx-8 sm:px-8">
        <Switch label="State" options={KINDS} value={kind} onChange={setKind} />
        <div className="ml-auto">
          <Switch
            label="Preview theme"
            options={[
              { key: 'light', label: 'Light' },
              { key: 'dark', label: 'Dark' },
            ]}
            value={theme}
            onChange={setTheme}
          />
        </div>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-6 md:grid-cols-2">
        {kind === 'empty' && <EmptyStates />}
        {kind === 'error' && <ErrorStates />}
        {kind === 'loading' && <LoadingStates />}
      </div>
    </div>
  )
}
