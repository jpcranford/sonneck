import { useEffect, useState, type ReactNode } from 'react'
import { useMockupTitle } from '../lib/useMockupTitle'

// Phase 1 of project_responsive_device_plan (memory) — a diagnostic
// reference page, not a screen mockup, same "reference tool" category
// CitationLogicMockup.tsx already established. Built to have a running,
// live source of truth for exactly what a given real device/window
// actually reports, while working through the rest of that plan's phases,
// rather than trusting a screenshot's apparent size or a device's marketing
// spec sheet.

// Mirrors this app's real, load-bearing breakpoint (AppShell.tsx's sidebar
// vs. MobileNav swap happens at md:768) plus the rest of Tailwind's default
// scale (sm/lg/xl/2xl), so this page can show which tier is *actually*
// active right now, not just the raw pixel width.
const BREAKPOINTS = [
  { name: '2xl', min: 1536 },
  { name: 'xl', min: 1280 },
  { name: 'lg', min: 1024 },
  { name: 'md', min: 768 },
  { name: 'sm', min: 640 },
] as const

function currentBreakpoint(width: number): string {
  const match = BREAKPOINTS.find((b) => width >= b.min)
  return match ? match.name : '<sm'
}

interface Snapshot {
  innerWidth: number
  innerHeight: number
  outerWidth: number
  outerHeight: number
  screenWidth: number
  screenHeight: number
  availWidth: number
  availHeight: number
  devicePixelRatio: number
  orientation: 'portrait' | 'landscape'
  coarsePointer: boolean
  touchCapable: boolean
}

function takeSnapshot(): Snapshot {
  return {
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    outerWidth: window.outerWidth,
    outerHeight: window.outerHeight,
    screenWidth: window.screen.width,
    screenHeight: window.screen.height,
    availWidth: window.screen.availWidth,
    availHeight: window.screen.availHeight,
    devicePixelRatio: window.devicePixelRatio,
    orientation: window.matchMedia('(orientation: portrait)').matches ? 'portrait' : 'landscape',
    coarsePointer: window.matchMedia('(pointer: coarse)').matches,
    touchCapable: 'ontouchstart' in window || navigator.maxTouchPoints > 0,
  }
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col rounded-lg border border-border bg-paper-raised">
      <h2 className="border-b border-border px-4 py-2.5 font-display text-sm font-medium text-ink">
        {title}
      </h2>
      <div className="divide-y divide-border px-4">{children}</div>
    </div>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    // Stacked (label above value) below sm, side-by-side above it — several
    // of these labels ("Available screen size (excl. OS taskbar/dock)") are
    // long enough that forcing them onto one line with their value at
    // iPhone-13-mini width wrapped the value itself onto two lines (found
    // live, 2026-09-05, testing this page against its own target viewports).
    <div className="flex flex-col gap-0.5 py-2 text-sm sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
      <span className="shrink-0 text-ink-soft">{label}</span>
      <span className="font-mono text-ink tabular-nums sm:text-right">{children}</span>
    </div>
  )
}

export function DeviceInfoMockup() {
  useMockupTitle('Device Info')

  const [snap, setSnap] = useState<Snapshot>(() => takeSnapshot())

  useEffect(() => {
    const update = () => setSnap(takeSnapshot())
    // resize covers window-size and zoom changes; orientationchange fires
    // on rotate even on the rare device/browser combo where that doesn't
    // also trigger a resize. matchMedia's own 'change' listener is the
    // reliable way to catch an orientation flip specifically, since
    // resize's own timing relative to the OS rotation animation isn't
    // consistent across browsers.
    const orientationQuery = window.matchMedia('(orientation: portrait)')
    window.addEventListener('resize', update)
    orientationQuery.addEventListener('change', update)
    return () => {
      window.removeEventListener('resize', update)
      orientationQuery.removeEventListener('change', update)
    }
  }, [])

  const sidebarMode = snap.innerWidth >= 768 ? 'Sidebar (desktop)' : 'Mobile nav (drawer)'

  return (
    <div className="flex flex-1 flex-col gap-6 p-6 md:p-8">
      <div>
        <h1 className="font-display text-xl font-medium text-ink">Device Info</h1>
        <p className="max-w-3xl text-sm text-ink-soft">
          Live diagnostic reference for the responsive-layout pass (see memory
          project_responsive_device_plan) — not a screen mockup. Everything below updates as you
          resize or rotate this window, so a screenshot from a real device is self-describing
          rather than relying on a marketing spec sheet.
        </p>
      </div>

      <Section title="Window / Viewport">
        <Row label="Inner size (viewport)">
          {snap.innerWidth} × {snap.innerHeight}
        </Row>
        <Row label="Outer size (incl. browser chrome)">
          {snap.outerWidth} × {snap.outerHeight}
        </Row>
        <Row label="Screen size">
          {snap.screenWidth} × {snap.screenHeight}
        </Row>
        <Row label="Available screen size (excl. OS taskbar/dock)">
          {snap.availWidth} × {snap.availHeight}
        </Row>
      </Section>

      <Section title="Device characteristics">
        <Row label="devicePixelRatio">{snap.devicePixelRatio}</Row>
        <Row label="Orientation">{snap.orientation}</Row>
        <Row label="Coarse pointer (matchMedia)">{snap.coarsePointer ? 'yes' : 'no'}</Row>
        <Row label="Touch capable">{snap.touchCapable ? 'yes' : 'no'}</Row>
      </Section>

      <Section title="App breakpoint status">
        <Row label="Current Tailwind tier">{currentBreakpoint(snap.innerWidth)}</Row>
        <Row label="Active nav mode">{sidebarMode}</Row>
      </Section>

      <Section title="User agent">
        <Row label="navigator.userAgent">
          <span className="font-mono text-xs break-all whitespace-normal">
            {navigator.userAgent}
          </span>
        </Row>
      </Section>
    </div>
  )
}
