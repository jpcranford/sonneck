package handlers

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"image/png"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"sync"
	"time"

	"golang.org/x/sync/singleflight"

	"github.com/jpcranford/sonneck/internal/api"
	"github.com/jpcranford/sonneck/internal/models"
	"github.com/jpcranford/sonneck/internal/pdf"
	"github.com/jpcranford/sonneck/internal/repo"
	"github.com/jpcranford/sonneck/internal/storage"
)

// The Sheet Viewer's full-size pages: 8-bit grayscale PNGs at PageDPI,
// rendered the first time a piece opens in the viewer and cached apart from
// thumbnails, so browsing the library never pays for them.
//
// The cache is keyed by file hash, not piece id —
// DATA_DIR/cache/pages/v<pageRenderVersion>/<hash>/<page>.png — so a
// replaced file simply has no pages yet, and two pieces sharing one file
// share its pages.
const (
	PageDPI = 300
	// pageRenderVersion names the cache's subfolder and is part of every
	// page URL: bump it when the render pipeline changes, and every page
	// renders afresh under a new address.
	pageRenderVersion = "1"
	// pageRenderTimeout bounds one page's render (a 300ppi page takes well
	// under a second; a huge color scan a few).
	pageRenderTimeout = 2 * time.Minute
)

// pageRenderer is the Server's page-render bookkeeping. Its zero value is
// ready to use.
type pageRenderer struct {
	// group joins concurrent requests for the same not-yet-rendered page
	// into one render: the page being opened and the background render of
	// the whole piece often ask for it at once.
	group singleflight.Group

	mu sync.Mutex
	// preparing holds the file hashes whose background render is running,
	// so opening a piece twice doesn't start a second one.
	preparing map[string]bool
	jobs      sync.WaitGroup
}

func (s *Server) pagesRoot() string {
	return filepath.Join(s.Cfg.DataDir, "cache", "pages")
}

func (s *Server) pageDir(hash string) string {
	return filepath.Join(s.pagesRoot(), "v"+pageRenderVersion, hash)
}

func (s *Server) pagePath(hash string, page int) string {
	return filepath.Join(s.pageDir(hash), strconv.Itoa(page)+".png")
}

// cachedPage returns the path of page of p's file, rendering it on a miss.
func (s *Server) cachedPage(ctx context.Context, p *models.Piece, page int) (string, error) {
	path := s.pagePath(p.FileHash, page)
	if _, err := os.Stat(path); err == nil {
		return path, nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return "", err
	}
	// One render serves every waiting request, so it mustn't stop when the
	// request that started it goes away.
	_, err, _ := s.pages.group.Do(path, func() (any, error) {
		if _, err := os.Stat(path); err == nil {
			return nil, nil
		}
		rctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), pageRenderTimeout)
		defer cancel()
		return nil, s.renderPage(rctx, p.FilePath, p.FileHash, page)
	})
	if err != nil {
		return "", err
	}
	return path, nil
}

// renderPage renders one page into the cache: engraved pages through
// pdftocairo, scans through pdftoppm (pdf.RenderPageGray), encoded as
// grayscale PNG here, written to a temp file and renamed into place so a
// reader never sees half a file.
func (s *Server) renderPage(ctx context.Context, src, hash string, page int) error {
	dir := s.pageDir(hash)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	scanned, err := pdf.IsScannedPage(ctx, s.Cfg.PDFBinDir, src, page)
	if err != nil {
		return err
	}
	// The renderer's temp file (an 8MB uncompressed TIFF for an engraved
	// page) goes in the system's temp folder, not under DATA_DIR: /data is
	// often a network share or, on a Mac, Docker's slow shared folder, where
	// writing and reading it back cost more than the render itself (~600ms a
	// page measured). Only the finished PNG lands in the cache.
	img, err := pdf.RenderPageGray(ctx, s.Cfg.PDFBinDir, src, page, PageDPI, scanned, os.TempDir())
	if err != nil {
		return err
	}
	tmp, err := os.CreateTemp(dir, strconv.Itoa(page)+"-*.tmp")
	if err != nil {
		return err
	}
	w := bufio.NewWriter(tmp)
	encErr := png.Encode(w, img)
	if encErr == nil {
		encErr = w.Flush()
	}
	if closeErr := tmp.Close(); encErr == nil {
		encErr = closeErr
	}
	if encErr != nil {
		os.Remove(tmp.Name())
		return encErr
	}
	if err := storage.MoveIntoPlace(tmp.Name(), s.pagePath(hash, page)); err != nil {
		os.Remove(tmp.Name())
		return err
	}
	return nil
}

// preparePages renders every page of p not yet cached, one after another,
// in the background — started when a piece opens in the viewer, so later
// pages are ready before they're turned to. The page on screen never waits
// for it: its own request renders it straight away, joining this render if
// it's the same page.
func (s *Server) preparePages(p *models.Piece) {
	s.pages.mu.Lock()
	if s.pages.preparing[p.FileHash] {
		s.pages.mu.Unlock()
		return
	}
	if s.pages.preparing == nil {
		s.pages.preparing = map[string]bool{}
	}
	s.pages.preparing[p.FileHash] = true
	s.pages.jobs.Add(1)
	s.pages.mu.Unlock()

	go func() {
		defer func() {
			s.pages.mu.Lock()
			delete(s.pages.preparing, p.FileHash)
			s.pages.mu.Unlock()
			s.pages.jobs.Done()
		}()
		for page := 1; page <= p.PageCount; page++ {
			if _, err := s.cachedPage(context.Background(), p, page); err != nil {
				s.Logger.Warn("rendering sheet viewer page failed", "pieceId", p.ID, "page", page, "error", err)
				return
			}
		}
	}()
}

// WaitForPageRenders blocks until every background page render has
// finished — for tests, which must not leave one writing into a removed
// temp directory.
func (s *Server) WaitForPageRenders() {
	s.pages.jobs.Wait()
}

// removePageCache deletes every cached page of the file with hash, in any
// render version — called wherever a piece's file is deleted.
func (s *Server) removePageCache(hash string) {
	dirs, err := filepath.Glob(filepath.Join(s.pagesRoot(), "*", hash))
	if err != nil {
		return
	}
	for _, dir := range dirs {
		if err := os.RemoveAll(dir); err != nil {
			s.Logger.Error("failed to remove cached sheet viewer pages", "error", err, "dir", dir)
		}
	}
}

// pieceForPages loads the piece a page request names, after the Sheet
// Viewer's permission check: read, then practice (the whole viewer is
// practice-gated).
func (s *Server) pieceForPages(w http.ResponseWriter, r *http.Request) (*models.Piece, bool) {
	if _, ok := s.requirePermission(w, r, models.PermissionRead); !ok {
		return nil, false
	}
	if _, ok := s.requirePermission(w, r, models.PermissionPractice); !ok {
		return nil, false
	}
	id, ok := pathID(r, "id")
	if !ok {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "invalid piece id")
		return nil, false
	}
	p, err := repo.GetPieceByID(r.Context(), s.DB, id)
	if err != nil {
		s.writeError(w, err)
		return nil, false
	}
	return p, true
}

// handlePiecePage serves one full-size page: GET /api/pieces/{id}/pages/{page}.
func (s *Server) handlePiecePage(w http.ResponseWriter, r *http.Request) {
	p, ok := s.pieceForPages(w, r)
	if !ok {
		return
	}
	page, err := strconv.Atoi(r.PathValue("page"))
	if err != nil || page < 1 || page > p.PageCount {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError,
			fmt.Sprintf("page must be 1 to %d", p.PageCount))
		return
	}
	path, err := s.cachedPage(r.Context(), p, page)
	if err != nil {
		s.Logger.Error("rendering sheet viewer page failed", "pieceId", p.ID, "page", page, "error", err)
		s.writeError(w, err)
		return
	}
	w.Header().Set("Content-Type", "image/png")
	imageCacheHeaders(w, r)
	http.ServeFile(w, r, path)
}

// handlePreparePiecePages starts rendering every page of a piece in the
// background: POST /api/pieces/{id}/pages/prepare, sent when the piece
// opens in the Sheet Viewer.
func (s *Server) handlePreparePiecePages(w http.ResponseWriter, r *http.Request) {
	p, ok := s.pieceForPages(w, r)
	if !ok {
		return
	}
	s.preparePages(p)
	api.WriteData(w, http.StatusAccepted, map[string]int{"pageCount": p.PageCount})
}

// pagesRedrawnMarker is touched by the regenerate-pages command, like
// thumbnailsRedrawnMarker, so a redraw gives every page a new URL.
func (s *Server) pagesRedrawnMarker() string {
	return filepath.Join(s.Cfg.DataDir, "cache", "pages-redrawn")
}

// pagesVersion is the version part of every page URL (GET /api/config's
// pagesVersion): the render version, plus when pages were last redrawn.
func (s *Server) pagesVersion() string {
	v := pageRenderVersion
	if info, err := os.Stat(s.pagesRedrawnMarker()); err == nil {
		v += "." + strconv.FormatInt(info.ModTime().Unix(), 10)
	}
	return v
}

func (s *Server) markPagesRedrawn() error {
	path := s.pagesRedrawnMarker()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	now := time.Now()
	if err := os.Chtimes(path, now, now); err == nil {
		return nil
	}
	return os.WriteFile(path, nil, 0o644)
}

// RegeneratePages re-renders Sheet Viewer pages from scratch — the
// regenerate-pages command. With ids, every page of those pieces; without,
// every piece that already has pages (a piece never opened in the viewer
// stays unrendered, as it would be anyway). Returns the pages rendered.
func (s *Server) RegeneratePages(ctx context.Context, ids []int64) (int, error) {
	var pieces []*models.Piece
	if len(ids) > 0 {
		for _, id := range ids {
			p, err := repo.GetPieceByID(ctx, s.DB, id)
			if errors.Is(err, repo.ErrNotFound) {
				return 0, fmt.Errorf("no piece with ID %d", id)
			}
			if err != nil {
				return 0, fmt.Errorf("piece %d: %w", id, err)
			}
			pieces = append(pieces, p)
		}
	} else {
		all, err := repo.AllPieceIDs(ctx, s.DB)
		if err != nil {
			return 0, err
		}
		seen := map[string]bool{}
		for _, id := range all {
			p, err := repo.GetPieceByID(ctx, s.DB, id)
			if err != nil {
				return 0, fmt.Errorf("piece %d: %w", id, err)
			}
			if seen[p.FileHash] {
				continue
			}
			if _, err := os.Stat(s.pageDir(p.FileHash)); err == nil {
				seen[p.FileHash] = true
				pieces = append(pieces, p)
			}
		}
	}

	count := 0
	for _, p := range pieces {
		if err := os.RemoveAll(s.pageDir(p.FileHash)); err != nil {
			return count, err
		}
		for page := 1; page <= p.PageCount; page++ {
			rctx, cancel := context.WithTimeout(ctx, pageRenderTimeout)
			err := s.renderPage(rctx, p.FilePath, p.FileHash, page)
			cancel()
			if err != nil {
				return count, fmt.Errorf("piece %d page %d: %w", p.ID, page, err)
			}
			count++
		}
	}
	return count, s.markPagesRedrawn()
}

var cachedPageName = regexp.MustCompile(`^(\d+)\.png$`)

// staleTempAge is how old a leftover temp file must be before cleanup-pages
// removes it, so a render in progress on a live server is never touched.
const staleTempAge = time.Hour

// CleanupPages removes Sheet Viewer pages nothing can use any more — the
// cleanup-pages command: older render versions, files no piece has now,
// pages past a file's page count, unreadable PNGs (they render again when
// next opened) and leftover temp files from an interrupted render. Anything
// else is left alone. Returns the files removed.
func (s *Server) CleanupPages(ctx context.Context) (int, error) {
	root := s.pagesRoot()
	versions, err := os.ReadDir(root)
	if errors.Is(err, os.ErrNotExist) {
		return 0, nil
	}
	if err != nil {
		return 0, err
	}
	removed := 0
	removeAll := func(dir string) error {
		n := 0
		filepath.WalkDir(dir, func(_ string, d os.DirEntry, err error) error {
			if err == nil && !d.IsDir() {
				n++
			}
			return nil
		})
		if err := os.RemoveAll(dir); err != nil {
			return err
		}
		removed += n
		return nil
	}

	current := "v" + pageRenderVersion
	for _, v := range versions {
		if !v.IsDir() {
			continue
		}
		if v.Name() != current {
			if err := removeAll(filepath.Join(root, v.Name())); err != nil {
				return removed, err
			}
			continue
		}
		hashes, err := os.ReadDir(filepath.Join(root, current))
		if err != nil {
			return removed, err
		}
		for _, h := range hashes {
			if !h.IsDir() {
				continue
			}
			dir := filepath.Join(root, current, h.Name())
			pageCount, exists, err := repo.PageCountForFileHash(ctx, s.DB, h.Name())
			if err != nil {
				return removed, err
			}
			if !exists {
				if err := removeAll(dir); err != nil {
					return removed, err
				}
				continue
			}
			files, err := os.ReadDir(dir)
			if err != nil {
				return removed, err
			}
			for _, f := range files {
				path := filepath.Join(dir, f.Name())
				if m := cachedPageName.FindStringSubmatch(f.Name()); m != nil {
					page, _ := strconv.Atoi(m[1])
					if page >= 1 && page <= pageCount && pngReadable(path) {
						continue
					}
				} else if info, err := f.Info(); err != nil || time.Since(info.ModTime()) < staleTempAge ||
					(filepath.Ext(f.Name()) != ".tmp" && filepath.Ext(f.Name()) != ".tif") {
					continue
				}
				if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
					return removed, err
				}
				removed++
			}
		}
	}
	return removed, nil
}

func pngReadable(path string) bool {
	f, err := os.Open(path)
	if err != nil {
		return false
	}
	defer f.Close()
	_, err = png.DecodeConfig(bufio.NewReader(f))
	return err == nil
}
