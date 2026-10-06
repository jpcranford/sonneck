package main

import (
	"context"
	"database/sql"

	"github.com/jpcranford/sonneck/internal/repo"
	"github.com/wailsapp/wails/v2/pkg/options"
)

// The page color in each theme (index.css's --color-paper), painted as the
// window's background before the page loads. Wails' own default is white,
// which flashes before a dark page appears. Same two values as
// frontend/src/lib/theme.ts's BROWSER_BAR_COLOR and index.html's no-flash
// script; keep the copies in step.
var (
	windowColorLight = &options.RGBA{R: 0xf8, G: 0xf6, B: 0xf3, A: 0xff}
	windowColorDark  = &options.RGBA{R: 0x23, G: 0x1e, B: 0x1a, A: 0xff}
)

// launchWindowColor picks the window's starting background from the saved
// theme. A native install only ever has the one account (id 1) outside
// OIDC, so its preference is the one the window will open on; "system"
// asks the OS. Any read failure falls back to light, today's behavior.
// Once the page is running, lib/theme.ts keeps the window color in step
// through the Wails runtime.
func launchWindowColor(ctx context.Context, conn *sql.DB) *options.RGBA {
	settings, err := repo.GetUserSettings(ctx, conn, 1)
	if err != nil {
		return windowColorLight
	}
	dark := settings.ThemePreference == "dark" ||
		(settings.ThemePreference == "system" && osPrefersDark())
	if dark {
		return windowColorDark
	}
	return windowColorLight
}
