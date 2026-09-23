package setlistpdf

import (
	"bytes"
	"io"
	"strings"
)

func toUpper(s string) string { return strings.ToUpper(s) }

func bytesReader(b []byte) io.Reader { return bytes.NewReader(b) }
