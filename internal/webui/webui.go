// Package webui embeds the built frontend (frontend/dist, copied into this
// package's own dist/ directory by the Docker build stage before `go build`
// runs) so the Go binary can serve it directly — design doc §9's "single
// image, embed via //go:embed" — no separate frontend process, no reverse
// proxy, no CORS in production.
//
// dist/ only ever holds a committed placeholder index.html outside of a
// Docker build; go:embed fails to compile against an empty directory, and
// local `go run`/`go build` never actually needs the real frontend here —
// local dev serves the frontend via Vite on :5173 instead (CLAUDE.md > Live
// browser verification / README > Running locally), so this path is
// exercised only by the container image.
package webui

import (
	"embed"
	"io/fs"
)

//go:embed all:dist
var distFS embed.FS

// FS returns the embedded frontend build output, rooted so callers see
// index.html at the root rather than dist/index.html.
func FS() (fs.FS, error) {
	return fs.Sub(distFS, "dist")
}
