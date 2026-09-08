import { useEffect, useRef, useState, type ComponentType } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  IconDeviceDesktop,
  IconLogout,
  IconMoon,
  IconSelector,
  IconSettings,
  IconShieldLock,
  IconSun,
  IconUserFilled,
} from '@tabler/icons-react'
import { logout } from '../api/auth'
import { useAuth } from '../lib/AuthContext'

// Real build of the approved Sidebar User Menu mockup (Option 2, "identity
// card, dark popup" — /mockup/sidebar-user-menu, master plan Phases 4/7),
// wired to real GET /api/auth/me data via AuthContext instead of the
// mockup's own IDENTITIES fixture. Master plan Phase 11. Shared between
// Sidebar.tsx (desktop rail) and MobileNav.tsx (mobile drawer) — same
// trigger + popup either side, the drawer just sits in a wider column
// (collapsed is always false there).
//
// One deliberate simplification vs. the mockup, confirmed directly this
// session: no identity "sub" line (the mockup's email/description text —
// real AuthMe carries no such field yet; OIDC, the only mode that would
// have a real email, isn't built until Phase 14). The authMethod-derived
// blurb below stands in for that line using data that already exists.
const AUTH_METHOD_BLURB: Record<string, string> = {
  none: 'No login required',
  singlepass: 'Shared password',
  oidc: 'Signed in via identity provider',
}

// Ported from the mockup's own ThemeSwitcher (SidebarUserMenuMockup.tsx) —
// local-only state, not persisted, same as the mockup: no dark-mode CSS
// exists anywhere in the app yet, and no HTTP endpoint backs
// user_settings.theme_preference yet either (the real column exists as of
// migration 00025, repo.GetUserSettings/UpdateUserSettings too, but nothing
// wires them to a route — that's User Settings' own job, master plan Phase
// 12). Dark stays disabled for the same reason the mockup disabled it; this
// control is honest UI chrome for a real feature two phases away, not a
// working switch yet.
type ThemePreview = 'light' | 'dark' | 'system'

const THEME_OPTIONS: { key: ThemePreview; icon: ComponentType<{ size?: number; className?: string }>; label: string }[] = [
  { key: 'light', icon: IconSun, label: 'Light' },
  { key: 'dark', icon: IconMoon, label: 'Dark' },
  { key: 'system', icon: IconDeviceDesktop, label: 'System' },
]

// Compact icon-only sliding-pill toggle — deliberately not a re-skin of the
// full-width, text-labeled ThemeControl row planned for User/Admin
// Settings (Phase 12/13); this popup control is small enough that the
// active option's highlight is a real absolute-positioned pill that slides
// between icons (translateX by index × button width) rather than each
// button flipping its own background independently.
function ThemeSwitcher({ theme, onChange }: { theme: ThemePreview; onChange: (theme: ThemePreview) => void }) {
  const activeIndex = THEME_OPTIONS.findIndex((option) => option.key === theme)
  return (
    <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
      <span className="text-[0.78rem] text-sidebar-text-dim">Theme</span>
      <div className="relative flex gap-0.5 rounded-full border border-sidebar-border bg-sidebar-bg p-0.5">
        <span
          aria-hidden
          className="absolute top-0.5 left-0.5 size-6 rounded-full bg-sidebar-panel shadow-sm transition-transform duration-150 ease-out"
          style={{ transform: `translateX(${activeIndex * 26}px)` }}
        />
        {THEME_OPTIONS.map(({ key, icon: Icon, label }) => {
          const disabled = key === 'dark'
          return (
            <button
              key={key}
              type="button"
              disabled={disabled}
              onClick={() => onChange(key)}
              title={disabled ? `${label} — coming soon` : label}
              aria-label={label}
              aria-pressed={theme === key}
              className={`relative z-10 flex size-6 items-center justify-center rounded-full transition-colors ${
                disabled
                  ? 'cursor-not-allowed text-sidebar-text-dim/35'
                  : `cursor-pointer ${theme === key ? 'text-sidebar-text' : 'text-sidebar-text-dim hover:text-sidebar-text'}`
              }`}
            >
              <Icon size={13} />
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function UserMenuButton({ collapsed }: { collapsed: boolean }) {
  const me = useAuth()
  const [open, setOpen] = useState(false)
  // 'system' — matches user_settings.theme_preference's own real DEFAULT
  // 'system' (migration 00025), not the mockup's own arbitrary 'light'
  // preview starting point (that useState('light') was just a demo
  // starting value, never a deliberate default-behavior decision).
  const [theme, setTheme] = useState<ThemePreview>('system')
  const wrapRef = useRef<HTMLDivElement>(null)
  const queryClient = useQueryClient()

  const logoutMutation = useMutation({
    mutationFn: logout,
    onSuccess: () => {
      setOpen(false)
      // AuthGate (App.tsx) holds the same ['auth', 'me'] query and swaps to
      // LoginScreen on its own once this refetch lands 401 — same pattern
      // FirstLaunchFlow/LoginScreen use against their own gating query.
      void queryClient.invalidateQueries({ queryKey: ['auth', 'me'] })
    },
  })

  // Closes on outside click/Escape, same dismiss convention as
  // ContextMenu.tsx (and the mockup this was built from).
  useEffect(() => {
    if (!open) return
    function onPointerDown(event: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setOpen(false)
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const isAdmin = me.permissions.includes('admin')
  // Hidden entirely in `none` mode (master plan's Frontend surfaces
  // section) — there's no session to log out of, since every request there
  // resolves to the same implicit id=1 user with zero session overhead.
  const showLogout = me.authMethod !== 'none'

  return (
    <div ref={wrapRef} className={`relative m-2 ${collapsed ? 'flex justify-center' : ''}`}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={collapsed ? me.displayName : undefined}
        className={`flex w-full cursor-pointer items-center gap-2 rounded-lg border border-sidebar-border bg-sidebar-panel p-2 transition-colors hover:border-sidebar-text-dim ${
          open ? 'border-sidebar-text-dim bg-sidebar-bg' : ''
        } ${collapsed ? 'justify-center' : ''}`}
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-sidebar-border bg-sidebar-bg text-sidebar-text">
          <IconUserFilled size={16} />
        </span>
        {!collapsed && (
          <>
            <span className="min-w-0 flex-1 truncate text-left text-[0.95rem] text-sidebar-text">
              {me.displayName}
            </span>
            <IconSelector size={15} className="shrink-0 text-sidebar-text-dim" />
          </>
        )}
      </button>

      {/* Opens upward (bottom-full) since the trigger sits at the bottom of
          both the rail and the drawer; left-0 keeps it flush with the
          trigger's own left edge in both the collapsed (narrow rail) and
          expanded states. No overflow:hidden on any ancestor between here
          and the viewport-sized shell, so nothing clips it. */}
      <div
        role="menu"
        className={`absolute bottom-full left-0 z-20 mb-2 w-60 origin-bottom-left overflow-hidden rounded-lg border border-sidebar-border bg-sidebar-panel shadow-xl transition-[opacity,transform] duration-100 ${
          open ? 'pointer-events-auto translate-y-0 opacity-100' : 'pointer-events-none translate-y-1 opacity-0'
        }`}
      >
        <div className="flex items-center gap-2.5 px-3.5 py-3">
          <span className="flex size-[34px] shrink-0 items-center justify-center rounded-full border border-sidebar-border bg-sidebar-bg text-sidebar-text">
            <IconUserFilled size={17} />
          </span>
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 truncate text-[0.92rem] font-medium text-sidebar-text">
              <span className="truncate">{me.displayName}</span>
              {isAdmin && (
                <span className="shrink-0 rounded-full bg-accent px-1.5 py-px text-[0.62rem] font-bold tracking-wide text-white uppercase">
                  Admin
                </span>
              )}
            </p>
            <p className="truncate text-[0.76rem] text-sidebar-text-dim">{AUTH_METHOD_BLURB[me.authMethod]}</p>
          </div>
        </div>
        <div className="h-px bg-sidebar-border" />
        <ThemeSwitcher theme={theme} onChange={setTheme} />
        <div className="h-px bg-sidebar-border" />
        <div className="p-1.5">
          <Link
            to="/settings"
            onClick={() => setOpen(false)}
            role="menuitem"
            className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[0.85rem] text-sidebar-text hover:bg-white/5"
          >
            <IconSettings size={16} className="opacity-85" />
            User Settings
          </Link>
          {isAdmin && (
            <Link
              to="/admin"
              onClick={() => setOpen(false)}
              role="menuitem"
              className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[0.85rem] text-sidebar-text hover:bg-white/5"
            >
              <IconShieldLock size={16} className="opacity-85" />
              Admin Settings
            </Link>
          )}
        </div>
        {showLogout && (
          <>
            <div className="h-px bg-sidebar-border" />
            <div className="p-1.5">
              <button
                type="button"
                onClick={() => logoutMutation.mutate()}
                disabled={logoutMutation.isPending}
                role="menuitem"
                className="flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[0.85rem] text-[#e2a29a] hover:bg-[rgba(226,162,154,0.12)] disabled:opacity-60"
              >
                <IconLogout size={16} className="opacity-85" />
                {logoutMutation.isPending ? 'Logging out…' : 'Log Out'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
