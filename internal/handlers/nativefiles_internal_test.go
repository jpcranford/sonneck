package handlers

import (
	"mime"
	"net/http"
	"testing"
)

// Open PDF joins the download name onto a folder of its own, so it must
// never carry a folder or climb out with "..".
func TestDownloadName_StaysAPlainFileName(t *testing.T) {
	disposition := func(name string) http.Header {
		return http.Header{"Content-Disposition": {mime.FormatMediaType("attachment", map[string]string{"filename": name})}}
	}
	cases := []struct {
		header http.Header
		target string
		want   string
	}{
		{disposition("Bach - Prelude (1722).pdf"), "/api/pieces/1/file", "Bach - Prelude (1722).pdf"},
		{disposition("../../evil.pdf"), "/api/pieces/1/file", "evil.pdf"},
		{disposition(".."), "/api/pieces/1/file", "file.pdf"},
		{http.Header{}, "/api/books/2/file?x=1", "file.pdf"},
		{http.Header{}, "/api/..", "download.pdf"},
		{http.Header{}, "/", "download.pdf"},
	}
	for _, c := range cases {
		if got := downloadName(c.header, c.target); got != c.want {
			t.Errorf("downloadName(%v, %q) = %q, want %q", c.header, c.target, got, c.want)
		}
	}
}
