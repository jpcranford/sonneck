import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  HOLD_MS,
  PILL_DELAY_MS,
  shortcutRegistrations,
  useShortcutHold,
  type ReferenceRow,
  type ShortcutSection,
} from '../lib/shortcuts'

// The shortcut help (design D, /mockup/shortcut-help): hold / or ? for a
// second — not while typing, not with a window open — and a card in the
// bottom-right corner lists this page's shortcuts until the key is let go.
// While the key is held, a "Keep holding" pill fills first, centered on
// the content area (right of the sidebar). Keys the viewer can't use are
// left off; the page's edit window keys are listed for reference; the
// sidebar's number keys fold into one "1–N" line, with the app-wide keys
// (full screen) beside it. Rendered once in
// AppShell, and by the Sheet Viewer (outside AppShell) for itself; the
// lists come from lib/shortcuts.ts's registry.

function Key({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-[5px] border border-b-2 border-border bg-paper-raised px-1.5 font-sans text-xs font-semibold text-ink">
      {children}
    </kbd>
  )
}

function Keys({ keys }: { keys: string[] }) {
  if (keys.length === 1) return <Key>{keys[0]}</Key>
  // ← → read as a pair, numbers as a range ("1–9"); a modifier combo gets
  // a "+".
  const joiner =
    keys[0] === '←' ? null : (
      <span className="text-ink-faint">{/^\d+$/.test(keys[0]) ? '–' : '+'}</span>
    )
  return (
    <span className="inline-flex shrink-0 items-center gap-[3px]">
      {keys.map((key, i) => (
        <span key={key} className="inline-flex items-center gap-[3px]">
          {i > 0 && joiner}
          <Key>{key}</Key>
        </span>
      ))}
    </span>
  )
}

function KeyRow({ keys, label, or }: ReferenceRow) {
  return (
    <div className="flex items-center gap-2.5 py-0.5 text-sm text-ink">
      <span className="inline-flex shrink-0 flex-wrap items-center gap-[3px]">
        <Keys keys={keys} />
        {or?.map((alt) => (
          <span key={alt.join('+')} className="inline-flex items-center gap-[3px]">
            <span className="text-ink-faint">/</span>
            <Keys keys={alt} />
          </span>
        ))}
      </span>
      <span>{label}</span>
    </div>
  )
}

function Section({ section, first }: { section: ShortcutSection; first: boolean }) {
  return (
    <>
      <p className={`${SECTION} ${first ? '' : 'mt-2.5'}`}>{section.title}</p>
      {section.rows.map((row) => (
        <KeyRow key={row.label} {...row} />
      ))}
    </>
  )
}

const SECTION = 'mb-1.5 text-[0.7rem] tracking-[0.08em] text-ink-muted uppercase'

// A page with no shortcuts of its own (Settings, Admin, Upload) is named
// by its tab title.
function titleFromDocument(): string {
  return document.title.replace(/^Sonneck - (MOCKUP - )?/, '')
}

function ShortcutCard({ heldKey }: { heldKey: string }) {
  const registrations = shortcutRegistrations()
  const sidebar = registrations.filter((r) => r.options.sidebar)
  const page = registrations.filter((r) => !r.options.sidebar && !r.options.global)
  const global = registrations
    .filter((r) => r.options.global)
    .flatMap((r) => r.shortcuts)
    .filter((s) => s.enabled !== false)
    .map((s) => ({ keys: [s.key.toUpperCase()], label: s.label }))
  const title = page.findLast((r) => r.options.title)?.options.title ?? titleFromDocument()
  const rows = page
    .flatMap((r) => r.shortcuts)
    .filter((s) => s.enabled !== false)
    .map((s) => ({ keys: [s.key.toUpperCase()], label: s.label }))
  const reference = page.findLast((r) => r.options.reference)?.options.reference
  const sections = page.findLast((r) => r.options.sections)?.options.sections ?? []
  const before = sections.filter((s) => s.before)
  const after = sections.filter((s) => !s.before)
  const wide = page.some((r) => r.options.wide)
  const sidebarCount = sidebar.flatMap((r) => r.shortcuts).length
  return (
    <div
      role="dialog"
      aria-label="Keyboard shortcuts"
      className={`pointer-events-none fixed right-4 bottom-4 z-[70] max-h-[calc(100dvh-2rem)] overflow-hidden rounded-lg border border-border bg-paper-raised p-4 shadow-lg ${wide ? 'w-[min(340px,calc(100vw-2rem))]' : 'w-[270px]'}`}
    >
      {before.map((section, i) => (
        <Section key={section.title} section={section} first={i === 0} />
      ))}
      <p className={`${SECTION} ${before.length ? 'mt-2.5' : ''}`}>{title}</p>
      {rows.map((row) => (
        <KeyRow key={row.keys[0]} {...row} />
      ))}
      {reference && (
        <>
          <p className={`${SECTION} mt-2.5`}>{reference.title}</p>
          {reference.rows.map((row) => (
            <KeyRow key={row.label} {...row} />
          ))}
        </>
      )}
      {after.map((section) => (
        <Section key={section.title} section={section} first={false} />
      ))}
      {(sidebarCount > 0 || global.length > 0) && (
        <div className="mt-1.5 border-t border-border pt-2">
          {sidebarCount > 0 && (
            <KeyRow keys={['1', String(sidebarCount)]} label="Sidebar, top to bottom" />
          )}
          {global.map((row) => (
            <KeyRow key={row.keys[0]} {...row} />
          ))}
        </div>
      )}
      <p className="mt-2 flex items-center gap-1.5 text-xs text-ink-muted">
        Let go of <Key>{heldKey}</Key> to close
      </p>
    </div>
  )
}

// Shown while the key is held, before the card: a ring fills over the
// second so it's clear holding is doing something. For / (a tap of which
// is itself a shortcut) it waits PILL_DELAY_MS, so a quick tap never
// flashes it; its ring then starts that far along, still filling right as
// the card appears. For ? it shows at once.
function HoldPill({ delayed }: { delayed: boolean }) {
  const [visible, setVisible] = useState(!delayed)
  useEffect(() => {
    if (!delayed) return
    const timer = window.setTimeout(() => setVisible(true), PILL_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [delayed])
  if (!visible) return null
  const elapsed = delayed ? PILL_DELAY_MS : 0
  const startOffset = 50.3 * (1 - elapsed / HOLD_MS)
  const content = document.getElementById('app-scroll-container')?.getBoundingClientRect()
  const centerX = content ? content.left + content.width / 2 : window.innerWidth / 2
  return (
    <div
      style={{ left: centerX }}
      className="pointer-events-none fixed bottom-6 z-[70] flex -translate-x-1/2 items-center gap-2 rounded-full bg-scrim/95 py-1.5 pr-3 pl-2.5 text-xs text-white"
    >
      <svg viewBox="0 0 20 20" className="size-4" aria-hidden="true">
        <circle
          cx="10"
          cy="10"
          r="8"
          fill="none"
          stroke="rgb(255 255 255 / 0.3)"
          strokeWidth="2.5"
        />
        <circle
          cx="10"
          cy="10"
          r="8"
          fill="none"
          stroke="#fff"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray="50.3"
          strokeDashoffset={startOffset}
          transform="rotate(-90 10 10)"
        >
          <animate
            attributeName="stroke-dashoffset"
            from={startOffset}
            to="0"
            dur={`${HOLD_MS - elapsed}ms`}
            fill="freeze"
          />
        </circle>
      </svg>
      Keep holding for shortcuts
    </div>
  )
}

// Portaled to <body>, so it sits over everything: inside the Sheet Viewer
// (its own fixed layer) it otherwise fell under the viewer's portaled
// menus.
export function ShortcutHelp() {
  const hold = useShortcutHold()
  if (!hold) return null
  return createPortal(
    hold.shown ? <ShortcutCard heldKey={hold.key} /> : <HoldPill delayed={hold.key === '/'} />,
    document.body,
  )
}
