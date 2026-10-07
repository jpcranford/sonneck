package main

import (
	"context"
	"database/sql"

	"github.com/jpcranford/sonneck/internal/repo"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
)

// launchTheme is the saved theme as the window opens: the preference
// itself, and whether it resolves to dark right now.
type launchTheme struct {
	preference string // light, dark or system
	dark       bool
}

// readLaunchTheme reads the saved theme before the window opens. A native
// install only ever has the one account (id 1) outside OIDC, so its
// preference is the one the window will open on; "system" asks the OS.
// Any read failure falls back to following the system, as the page does
// when nothing is saved.
func readLaunchTheme(ctx context.Context, conn *sql.DB) launchTheme {
	pref := "system"
	if settings, err := repo.GetUserSettings(ctx, conn, 1); err == nil {
		pref = settings.ThemePreference
	}
	return launchTheme{
		preference: pref,
		dark:       pref == "dark" || (pref == "system" && osPrefersDark()),
	}
}

// The page color in each theme (index.css's --color-paper), painted as the
// window's background before the page loads. Wails' own default is white,
// which flashes before a dark page appears. Same two values as
// frontend/src/lib/theme.ts's BROWSER_BAR_COLOR and WINDOW_COLOR and
// index.html's no-flash script; keep the copies in step.
var (
	windowColorLight = &options.RGBA{R: 0xf8, G: 0xf6, B: 0xf3, A: 0xff}
	windowColorDark  = &options.RGBA{R: 0x23, G: 0x1e, B: 0x1a, A: 0xff}
)

// launchWindowColor is the window's starting background. Once the page is
// running, lib/theme.ts keeps it in step through the Wails runtime.
func launchWindowColor(t launchTheme) *options.RGBA {
	if t.dark {
		return windowColorDark
	}
	return windowColorLight
}

// launchWindowsTheme sets the Windows title bar's starting theme from the
// saved one rather than Windows' app mode; "system" keeps following
// Windows. lib/theme.ts switches it live after a theme change.
func launchWindowsTheme(t launchTheme) windows.Theme {
	switch t.preference {
	case "dark":
		return windows.Dark
	case "light":
		return windows.Light
	default:
		return windows.SystemDefault
	}
}

// windowsTitleBarColors tints the Windows title bar with the page's own
// colors (index.css's paper, ink, ink-faint and border, light and dark)
// instead of Windows' white and black. Windows 11 only; Windows 10 keeps
// its plain light or dark bar, still following the theme.
var windowsTitleBarColors = &windows.ThemeSettings{
	LightModeTitleBar:          windows.RGB(0xf8, 0xf6, 0xf3),
	LightModeTitleBarInactive:  windows.RGB(0xf8, 0xf6, 0xf3),
	LightModeTitleText:         windows.RGB(0x1c, 0x18, 0x15),
	LightModeTitleTextInactive: windows.RGB(0x9a, 0x94, 0x8d),
	LightModeBorder:            windows.RGB(0xe4, 0xe0, 0xd8),
	LightModeBorderInactive:    windows.RGB(0xe4, 0xe0, 0xd8),
	DarkModeTitleBar:           windows.RGB(0x23, 0x1e, 0x1a),
	DarkModeTitleBarInactive:   windows.RGB(0x23, 0x1e, 0x1a),
	DarkModeTitleText:          windows.RGB(0xee, 0xe7, 0xdc),
	DarkModeTitleTextInactive:  windows.RGB(0x8a, 0x81, 0x75),
	DarkModeBorder:             windows.RGB(0x42, 0x39, 0x31),
	DarkModeBorderInactive:     windows.RGB(0x42, 0x39, 0x31),
}
