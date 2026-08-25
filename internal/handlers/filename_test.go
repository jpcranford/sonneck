package handlers

import "testing"

// TestDetectImslpNumber_StripsPrefix covers a real bug: detectImslpNumber
// used to return the whole regex match ("IMSLP04154"), not just the
// digits, so a freshly detected value carried a redundant "IMSLP" label
// that then doubled up wherever the app renders its own "IMSLP #{number}"
// citation prefix (buildCitation's stripImslpPrefix) — inconsistent with
// EditBookModal.tsx/EditPieceModal.tsx, which already strip on every
// manual save.
func TestDetectImslpNumber_StripsPrefix(t *testing.T) {
	got := detectImslpNumber("IMSLP04154-Chopin-Ballade.pdf")
	if got == nil || *got != "04154" {
		t.Errorf("detectImslpNumber = %v, want \"04154\" (no IMSLP prefix)", got)
	}
}

func TestDetectImslpNumber_NoMatch(t *testing.T) {
	got := detectImslpNumber("Chopin-Ballade.pdf")
	if got != nil {
		t.Errorf("detectImslpNumber = %v, want nil for a filename with no IMSLP number", *got)
	}
}
