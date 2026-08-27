package imslp

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// Fixtures below are trimmed-down copies of real rendered HTML pulled
// live from imslp.org (2026-08-27) — not hand-invented shapes — for the
// Tosti/Ricordi file (101781), a Schumann/Schuberth file, and a Schumann
// holograph-manuscript file (971830, genuinely has no publisher/plate on
// record).
const tostiFixtureHTML = `<div id="IMSLP101781" class="we_file_first we_fileblock_1">
<div class="we_file_download plainlinks"><p><b><a href="x">Complete Score</a></b></p></div>
</div><table class="we_edition_info gainlayout"><tr><td class="we_edition_info_i gainlayout">
<table border="0" style="border-collapse:collapse">
<tr>
<th>Pub<span class="mh555">lisher</span><span class="ms555">.</span> Info.
</th>
<td>Milan: <a href="/wiki/Ricordi" title="Ricordi">Ricordi</a>, 1897. Plate 49939.
</td></tr>
<tr>
<th>Reprinted
</th>
<td><i>Edizione completa</i><br />Milan: <a href="/wiki/Ricordi" title="Ricordi">Ricordi</a>, 1991. Plate 135603.
</td></tr>
<tr>
<th>Copyright
</th>
<td>Public Domain</td></tr>
</table>
</td></tr></table>`

const schumannPublishedFixtureHTML = `<div id="IMSLP102111" class="we_file_first we_fileblock_2">
<div class="we_file_download plainlinks"><p><b><a href="x">Complete Score</a></b></p></div>
</div><table class="we_edition_info gainlayout"><tr><td class="we_edition_info_i gainlayout">
<table border="0" style="border-collapse:collapse">
<tr>
<th>Pub<span class="mh555">lisher</span><span class="ms555">.</span> Info.
</th>
<td>Hamburg: <a href="/wiki/Schuberth_%26_Co." title="Schuberth &amp; Co.">Schuberth &amp; Co.</a><!--ASL0-->, n.d.[1848?].  Plate 1232.
</td></tr>
<tr>
<th>Copyright
</th>
<td>Public Domain</td></tr>
</table>
</td></tr></table>`

const schumannManuscriptFixtureHTML = `<div id="IMSLP971830" class="we_file_first we_fileblock_9">
<div class="we_file_download plainlinks"><p><b><a href="x">Complete Score</a></b></p></div>
</div><table class="we_edition_info gainlayout"><tr><td class="we_edition_info_i gainlayout">
<table border="0" style="border-collapse:collapse">
<tr>
<th>Pub<span class="mh555">lisher</span><span class="ms555">.</span> Info.
</th>
<td>Holograph manuscript, 1848.
</td></tr>
<tr>
<th>Copyright
</th>
<td>Public Domain</td></tr>
</table>
</td></tr></table>
<div id="IMSLP102111" class="we_file_first we_fileblock_10">
<table class="we_edition_info"><tr><td><table><tr><th>Publisher Info.</th><td>Should Not Be Reached: <a href="x">Wrong Publisher</a>, Plate 99999.</td></tr></table></td></tr></table>`

func TestParseEditionInfo(t *testing.T) {
	cases := []struct {
		name            string
		html            string
		number          string
		wantPublisher   string
		wantPublisherID string
	}{
		{
			name:            "real example: Tosti/Ricordi",
			html:            tostiFixtureHTML,
			number:          "101781",
			wantPublisher:   "Ricordi",
			wantPublisherID: "49939",
		},
		{
			name:            "real example: Schumann/Schuberth, with an HTML comment inside the cell",
			html:            schumannPublishedFixtureHTML,
			number:          "102111",
			wantPublisher:   "Schuberth & Co.",
			wantPublisherID: "1232",
		},
		{
			name:            "real example: unpublished manuscript has neither",
			html:            schumannManuscriptFixtureHTML,
			number:          "971830",
			wantPublisher:   "",
			wantPublisherID: "",
		},
		{
			name:            "doesn't bleed into the next file entry's own edition info",
			html:            schumannManuscriptFixtureHTML,
			number:          "971830",
			wantPublisher:   "",
			wantPublisherID: "",
		},
		{
			name:            "number not present in the HTML at all",
			html:            tostiFixtureHTML,
			number:          "000000",
			wantPublisher:   "",
			wantPublisherID: "",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			publisher, publisherID := parseEditionInfo(tc.html, tc.number)
			if publisher != tc.wantPublisher {
				t.Errorf("publisher = %q, want %q", publisher, tc.wantPublisher)
			}
			if publisherID != tc.wantPublisherID {
				t.Errorf("publisherID = %q, want %q", publisherID, tc.wantPublisherID)
			}
		})
	}
}

func TestParseWorkTitleFromLocation(t *testing.T) {
	cases := []struct {
		name     string
		location string
		want     string
		wantErr  bool
	}{
		{
			name:     "real example: Tosti",
			location: "//imslp.org/wiki/Povera_Maria!_(Tosti,_Francesco_Paolo)#IMSLP101781",
			want:     "Povera Maria! (Tosti, Francesco Paolo)",
		},
		{
			name:     "real example: Schumann, with a comma in the opus segment",
			location: "//imslp.org/wiki/Album_f%C3%BCr_die_Jugend%2C_Op.68_(Schumann%2C_Robert)#IMSLP04154",
			want:     "Album für die Jugend, Op.68 (Schumann, Robert)",
		},
		{
			name:     "no fragment",
			location: "//imslp.org/wiki/Some_Work_(Composer,_Name)",
			want:     "Some Work (Composer, Name)",
		},
		{
			name:     "not a /wiki/ path at all",
			location: "//imslp.org/friendlyredirect.html#/wiki/Special:ImagefromIndex/04154",
			wantErr:  true,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := parseWorkTitleFromLocation(tc.location)
			if tc.wantErr {
				if err == nil {
					t.Fatalf("expected an error, got title %q", got)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got != tc.want {
				t.Errorf("parseWorkTitleFromLocation(%q) = %q, want %q", tc.location, got, tc.want)
			}
		})
	}
}

func TestParseWorkInfo(t *testing.T) {
	t.Run("real example: Schumann Album für die Jugend", func(t *testing.T) {
		wikitext := "some preamble\n" +
			"|Work Title=Album für die Jugend\n" +
			"|Opus/Catalogue Number=Op.68\n" +
			"|Dedication=\n" +
			"|Year/Date of Composition=1848\n" +
			"|Year of First Publication=1849\n" +
			"|Piece Style=Romantic\n"
		info := parseWorkInfo("Album für die Jugend, Op.68 (Schumann, Robert)", wikitext)
		if info.Composer != "Robert Schumann" {
			t.Errorf("Composer = %q, want %q", info.Composer, "Robert Schumann")
		}
		if info.WorkOpusNumber != "Op.68" {
			t.Errorf("WorkOpusNumber = %q, want %q", info.WorkOpusNumber, "Op.68")
		}
		if info.YearWritten != "1848" {
			t.Errorf("YearWritten = %q, want %q (composition year should win over first-publication)", info.YearWritten, "1848")
		}
	})

	t.Run("falls back to first-publication year when composition year is blank", func(t *testing.T) {
		wikitext := "|Opus/Catalogue Number=\n|Year/Date of Composition=\n|Year of First Publication=1849\n"
		info := parseWorkInfo("Some Work (Composer, A)", wikitext)
		if info.YearWritten != "1849" {
			t.Errorf("YearWritten = %q, want %q", info.YearWritten, "1849")
		}
	})

	t.Run("real example: title with no comma in the composer name (single name)", func(t *testing.T) {
		info := parseWorkInfo("Some Work (Anonymous, )", "")
		if info.Composer != "Anonymous" {
			t.Errorf("Composer = %q, want %q", info.Composer, "Anonymous")
		}
	})

	t.Run("missing fields stay blank, not an error", func(t *testing.T) {
		info := parseWorkInfo("Untitled Work With No Composer Suffix", "|Opus/Catalogue Number=\n")
		if info.Composer != "" || info.WorkOpusNumber != "" || info.YearWritten != "" {
			t.Errorf("expected an all-blank WorkInfo, got %+v", info)
		}
	})

	t.Run("doesn't mistake an unrelated parenthetical earlier in the title for the composer suffix", func(t *testing.T) {
		info := parseWorkInfo("Sonata (arr. for guitar) (Composer, Real)", "")
		if info.Composer != "Real Composer" {
			t.Errorf("Composer = %q, want %q", info.Composer, "Real Composer")
		}
	})
}

// TestLookup_Integration drives the full Lookup() flow against a fake
// IMSLP built with httptest — real HTTP round-trips, just not the real
// imslp.org — covering the redirect-based resolution step and the
// wikitext-fetch step together, not just the pure parsing functions
// above in isolation.
func TestLookup_Integration(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/index.php", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("indexsearch") != "101781" {
			w.WriteHeader(http.StatusOK) // IMSLP's own "No Results" shape
			return
		}
		w.Header().Set("Location", "//imslp.org/wiki/Povera_Maria!_(Tosti,_Francesco_Paolo)#IMSLP101781")
		w.WriteHeader(http.StatusFound)
	})
	mux.HandleFunc("/api.php", func(w http.ResponseWriter, r *http.Request) {
		page := r.URL.Query().Get("page")
		if page != "Povera Maria! (Tosti, Francesco Paolo)" {
			w.Write([]byte(`{"error":{"info":"page not found"}}`))
			return
		}
		if r.URL.Query().Get("prop") == "text" {
			body, _ := json.Marshal(map[string]any{
				"parse": map[string]any{"text": map[string]string{"*": tostiFixtureHTML}},
			})
			w.Write(body)
			return
		}
		w.Write([]byte(`{"parse":{"wikitext":{"*":"|Opus/Catalogue Number=\n|Year/Date of Composition=\n|Year of First Publication=\n"}}}`))
	})
	server := httptest.NewServer(mux)
	defer server.Close()

	origReverse, origAction := reverseLookupBaseURL, actionAPIBaseURL
	reverseLookupBaseURL = server.URL + "/index.php"
	actionAPIBaseURL = server.URL + "/api.php"
	defer func() {
		reverseLookupBaseURL, actionAPIBaseURL = origReverse, origAction
	}()

	info, err := Lookup(context.Background(), "101781")
	if err != nil {
		t.Fatalf("Lookup returned an error: %v", err)
	}
	if info.Composer != "Francesco Paolo Tosti" {
		t.Errorf("Composer = %q, want %q", info.Composer, "Francesco Paolo Tosti")
	}
	if info.Publisher != "Ricordi" {
		t.Errorf("Publisher = %q, want %q", info.Publisher, "Ricordi")
	}
	if info.PublisherID != "49939" {
		t.Errorf("PublisherID = %q, want %q", info.PublisherID, "49939")
	}

	t.Run("not found", func(t *testing.T) {
		_, err := Lookup(context.Background(), "999999")
		if err != ErrNotFound {
			t.Errorf("err = %v, want ErrNotFound", err)
		}
	})

	t.Run("rejects a non-digit number without making a request", func(t *testing.T) {
		_, err := Lookup(context.Background(), "IMSLP101781")
		if err != ErrInvalidNumber {
			t.Errorf("err = %v, want ErrInvalidNumber", err)
		}
	})
}

func TestParseWorkTitleFromLocation_RejectsBadPercentEscape(t *testing.T) {
	if _, err := parseWorkTitleFromLocation("//imslp.org/wiki/Bad%ZZEscape"); err == nil {
		t.Error("expected an error for an invalid percent-escape, got none")
	}
}
