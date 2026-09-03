package handlers_test

import (
	"net/http"
	"testing"
)

// US renewal follow-up — covers repo.ResolveCopyrightStatus's own mapping
// from ComputeLikelyPublicDomain's LowConfidence flag to the
// "possiblyPublicDomain" vs. "likelyPublicDomain" effective status. See
// internal/copyright/copyright_test.go for the calculation's own unit
// tests (28-vs-95-year term math); these cover the status string the API
// actually returns.

func copyrightEffectiveStatus(t *testing.T, h http.Handler, pieceID int64) string {
	t.Helper()
	rec := doJSON(t, h, http.MethodGet, apiPiecesURL(pieceID), nil)
	var resp struct {
		CopyrightStatus struct {
			Effective string `json:"effective"`
		} `json:"copyrightStatus"`
	}
	decodeData(t, rec, &resp)
	return resp.CopyrightStatus.Effective
}

// No explicit status, no explicit renewal answer, a 1923-1963 copyright
// year whose unrenewed 28-year term has long since elapsed — public domain,
// but only via the unconfirmed-non-renewal default, so "possibly" not
// "likely".
func TestCopyrightStatus_PossiblyPublicDomainWhenRenewalUnconfirmed(t *testing.T) {
	h := newTestServer(t)
	dir := t.TempDir()
	path := dir + "/piece.pdf"
	writeFixturePDF(t, path, 1)
	rec := recordRequest(h, multipartUpload(t, "/api/pieces", "piece.pdf", readAll(t, path)))
	var uploaded pieceResponse
	decodeData(t, rec, &uploaded)

	decodeData(t, doJSON(t, h, http.MethodPatch, apiPiecesURL(uploaded.ID), map[string]any{
		"title":         "Solo",
		"composers":     []string{"Someone"},
		"copyrightYear": 1962, // 1962+28=1990, long elapsed
	}), nil)

	got := copyrightEffectiveStatus(t, h, uploaded.ID)
	if got != "possiblyPublicDomain" {
		t.Errorf("effective status = %q, want %q", got, "possiblyPublicDomain")
	}
}

// Same year, but explicitly marked NOT renewed — same effective status as
// the unconfirmed case above, since this app deliberately treats "actively
// said no" and "never answered" identically (a plain boolean, not
// tri-state, by direct product decision — see
// repo.ResolveCopyrightStatus's own comment).
func TestCopyrightStatus_PossiblyPublicDomainWhenExplicitlyNotRenewed(t *testing.T) {
	h := newTestServer(t)
	dir := t.TempDir()
	path := dir + "/piece.pdf"
	writeFixturePDF(t, path, 1)
	rec := recordRequest(h, multipartUpload(t, "/api/pieces", "piece.pdf", readAll(t, path)))
	var uploaded pieceResponse
	decodeData(t, rec, &uploaded)

	decodeData(t, doJSON(t, h, http.MethodPatch, apiPiecesURL(uploaded.ID), map[string]any{
		"title":            "Solo",
		"composers":        []string{"Someone"},
		"copyrightYear":    1962,
		"copyrightRenewed": false,
	}), nil)

	got := copyrightEffectiveStatus(t, h, uploaded.ID)
	if got != "possiblyPublicDomain" {
		t.Errorf("effective status = %q, want %q", got, "possiblyPublicDomain")
	}
}

// A confirmed renewal whose full 95-year term has since elapsed —
// genuinely "likely" (the real, higher-confidence status), not "possibly",
// since the term length here isn't resting on an assumption.
func TestCopyrightStatus_LikelyPublicDomainWhenRenewalConfirmedAndExpired(t *testing.T) {
	h := newTestServer(t)
	dir := t.TempDir()
	path := dir + "/piece.pdf"
	writeFixturePDF(t, path, 1)
	rec := recordRequest(h, multipartUpload(t, "/api/pieces", "piece.pdf", readAll(t, path)))
	var uploaded pieceResponse
	decodeData(t, rec, &uploaded)

	decodeData(t, doJSON(t, h, http.MethodPatch, apiPiecesURL(uploaded.ID), map[string]any{
		"title":            "Solo",
		"composers":        []string{"Someone"},
		"copyrightYear":    1925, // 1925+95=2020, elapsed
		"copyrightRenewed": true,
	}), nil)

	got := copyrightEffectiveStatus(t, h, uploaded.ID)
	if got != "likelyPublicDomain" {
		t.Errorf("effective status = %q, want %q", got, "likelyPublicDomain")
	}
}

// A confirmed renewal whose 95-year term hasn't elapsed yet stays in
// copyright, unaffected by the renewal follow-up entirely.
func TestCopyrightStatus_InCopyrightWhenRenewalConfirmedAndNotYetExpired(t *testing.T) {
	h := newTestServer(t)
	dir := t.TempDir()
	path := dir + "/piece.pdf"
	writeFixturePDF(t, path, 1)
	rec := recordRequest(h, multipartUpload(t, "/api/pieces", "piece.pdf", readAll(t, path)))
	var uploaded pieceResponse
	decodeData(t, rec, &uploaded)

	decodeData(t, doJSON(t, h, http.MethodPatch, apiPiecesURL(uploaded.ID), map[string]any{
		"title":            "Solo",
		"composers":        []string{"Someone"},
		"copyrightYear":    1950, // renewed: 1950+95=2045, not yet elapsed
		"copyrightRenewed": true,
	}), nil)

	got := copyrightEffectiveStatus(t, h, uploaded.ID)
	if got != "inCopyright" {
		t.Errorf("effective status = %q, want %q", got, "inCopyright")
	}
}

// Outside the renewal window entirely (1970) — the renewal follow-up must
// never produce "possiblyPublicDomain" here, confirming the new status is
// scoped exactly to the 1923-1963 window and doesn't leak into ordinary
// fixed-term public-domain conclusions.
func TestCopyrightStatus_LikelyPublicDomainOutsideRenewalWindow(t *testing.T) {
	h := newTestServer(t)
	dir := t.TempDir()
	path := dir + "/piece.pdf"
	writeFixturePDF(t, path, 1)
	rec := recordRequest(h, multipartUpload(t, "/api/pieces", "piece.pdf", readAll(t, path)))
	var uploaded pieceResponse
	decodeData(t, rec, &uploaded)

	decodeData(t, doJSON(t, h, http.MethodPatch, apiPiecesURL(uploaded.ID), map[string]any{
		"title":         "Solo",
		"composers":     []string{"Someone"},
		"copyrightYear": 1900, // pre-window, always the plain 95-year rule
	}), nil)

	got := copyrightEffectiveStatus(t, h, uploaded.ID)
	if got != "likelyPublicDomain" {
		t.Errorf("effective status = %q, want %q", got, "likelyPublicDomain")
	}
}
