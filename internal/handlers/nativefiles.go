package handlers

import (
	"bytes"
	"io"
	"mime"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"

	"github.com/jpcranford/sonneck/internal/api"
	"github.com/jpcranford/sonneck/internal/models"
)

// The desktop app's web view (WKWebView on macOS) has no download handling
// and no PDF window of its own, so a Download PDF link and Book Details'
// "Open PDF" did nothing there. frontend/src/lib/nativeLinks.ts sends those
// clicks here instead, with the link's own same-origin URL:
//
//   - POST /api/native/save-file fetches the file, asks where to save it
//     (a native Save dialog, the file's usual download name filled in) and
//     writes it there.
//   - POST /api/native/open-file fetches the file into a temporary folder
//     and opens it in the system's default app for it.
//
// The file is fetched by re-running the request through the app's own
// handler (s.root) with the caller's cookie, so every permission and
// sign-in check a normal download gets still applies; these endpoints add
// none of their own beyond requiring a signed-in user.

type nativeFileRequest struct {
	URL string `json:"url"`
}

type nativeSaveFileResponse struct {
	Saved bool   `json:"saved"`
	Path  string `json:"path,omitempty"`
}

func (s *Server) handleNativeSaveFile(w http.ResponseWriter, r *http.Request) {
	target, ok := s.nativeFileTarget(w, r)
	if !ok {
		return
	}
	tmp, name, ok := s.fetchToTemp(w, r, target)
	if !ok {
		return
	}
	defer os.Remove(tmp)

	dest, err := s.Native.SaveFile(name)
	if err != nil {
		s.writeError(w, err)
		return
	}
	if dest == "" {
		api.WriteData(w, http.StatusOK, nativeSaveFileResponse{Saved: false})
		return
	}
	if err := moveFile(tmp, dest); err != nil {
		s.writeError(w, err)
		return
	}
	api.WriteData(w, http.StatusOK, nativeSaveFileResponse{Saved: true, Path: dest})
}

func (s *Server) handleNativeOpenFile(w http.ResponseWriter, r *http.Request) {
	target, ok := s.nativeFileTarget(w, r)
	if !ok {
		return
	}
	tmp, name, ok := s.fetchToTemp(w, r, target)
	if !ok {
		return
	}
	// Under its real download name, so the viewer's window title reads
	// "Bach - Prelude (1722).pdf" rather than a random temp name. Left in
	// the system's temp folder afterwards, for the viewer to keep open.
	dir := filepath.Join(os.TempDir(), "Sonneck")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		os.Remove(tmp)
		s.writeError(w, err)
		return
	}
	dest := filepath.Join(dir, name)
	if err := moveFile(tmp, dest); err != nil {
		os.Remove(tmp)
		s.writeError(w, err)
		return
	}
	if err := s.Native.OpenPath(dest); err != nil {
		s.writeError(w, err)
		return
	}
	api.WriteData(w, http.StatusOK, map[string]bool{"ok": true})
}

// nativeFileTarget checks this is the desktop app and a signed-in user, and
// returns the requested file's app-relative URL — only ever a GET of one of
// this app's own /api/ paths, never another host.
func (s *Server) nativeFileTarget(w http.ResponseWriter, r *http.Request) (string, bool) {
	if s.BuildTarget != "native" || s.Native == nil || s.Native.SaveFile == nil || s.Native.OpenPath == nil {
		api.WriteError(w, http.StatusNotFound, api.CodeNotFound, "no such endpoint")
		return "", false
	}
	if _, ok := s.requirePermission(w, r, models.PermissionRead); !ok {
		return "", false
	}
	var req nativeFileRequest
	if err := decodeJSON(r, &req); err != nil {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "invalid request body: "+err.Error())
		return "", false
	}
	u, err := url.Parse(req.URL)
	if err != nil || u.Scheme != "" || u.Host != "" || !strings.HasPrefix(u.Path, "/api/") {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "url must be one of this app's own /api/ paths")
		return "", false
	}
	return u.RequestURI(), true
}

// fetchToTemp runs a GET for target through the app's own handler as the
// calling user, streaming the body into a temp file. On any non-200 answer
// it relays that answer (already the usual {error} shape) and returns false.
func (s *Server) fetchToTemp(w http.ResponseWriter, r *http.Request, target string) (path, name string, ok bool) {
	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, target, nil)
	if err != nil {
		s.writeError(w, err)
		return "", "", false
	}
	req.Header.Set("Cookie", r.Header.Get("Cookie"))
	req.RemoteAddr = r.RemoteAddr

	f, err := os.CreateTemp("", "sonneck-*")
	if err != nil {
		s.writeError(w, err)
		return "", "", false
	}
	fw := &fileResponseWriter{file: f, header: http.Header{}}
	s.root.ServeHTTP(fw, req)
	closeErr := f.Close()

	if fw.status != http.StatusOK {
		body, _ := os.ReadFile(f.Name())
		os.Remove(f.Name())
		for k, v := range fw.header {
			w.Header()[k] = v
		}
		w.WriteHeader(fw.status)
		_, _ = io.Copy(w, bytes.NewReader(body))
		return "", "", false
	}
	if fw.err != nil || closeErr != nil {
		os.Remove(f.Name())
		if fw.err != nil {
			s.writeError(w, fw.err)
		} else {
			s.writeError(w, closeErr)
		}
		return "", "", false
	}
	return f.Name(), downloadName(fw.header, target), true
}

// downloadName is the file's usual download name, from the response's
// Content-Disposition (downloadFilename, filename.go), else the URL's last
// segment. Open PDF writes it into a folder of its own, so it is cut down
// to a plain file name: no folders, never "..".
func downloadName(h http.Header, target string) string {
	name := ""
	if _, params, err := mime.ParseMediaType(h.Get("Content-Disposition")); err == nil {
		name = plainFileName(params["filename"])
	}
	if name == "" {
		name = plainFileName(strings.SplitN(target, "?", 2)[0])
		if name != "" && !strings.HasSuffix(strings.ToLower(name), ".pdf") {
			name += ".pdf"
		}
	}
	if name == "" {
		return "download.pdf"
	}
	return name
}

// plainFileName is the last segment of name, or "" when there is none.
// Cleaning it as an absolute path first resolves every ".." against the
// root, so the segment can't climb out of whatever folder it is joined to.
func plainFileName(name string) string {
	base := filepath.Base(filepath.Clean("/" + name))
	if base == "/" || base == "." || base == string(filepath.Separator) {
		return ""
	}
	return base
}

// moveFile renames src to dst, falling back to a copy when they're on
// different drives (the temp folder vs. a chosen USB stick).
func moveFile(src, dst string) error {
	if err := os.Rename(src, dst); err == nil {
		return nil
	}
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		return err
	}
	if err := out.Close(); err != nil {
		return err
	}
	return os.Remove(src)
}

// fileResponseWriter is an http.ResponseWriter that streams the body into
// a file, so a large book PDF never sits whole in memory.
type fileResponseWriter struct {
	file   *os.File
	header http.Header
	status int
	err    error
}

func (fw *fileResponseWriter) Header() http.Header { return fw.header }

func (fw *fileResponseWriter) WriteHeader(status int) {
	if fw.status == 0 {
		fw.status = status
	}
}

func (fw *fileResponseWriter) Write(p []byte) (int, error) {
	if fw.status == 0 {
		fw.status = http.StatusOK
	}
	n, err := fw.file.Write(p)
	if err != nil && fw.err == nil {
		fw.err = err
	}
	return n, err
}
