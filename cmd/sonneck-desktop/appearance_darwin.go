package main

import (
	"os/exec"
	"strings"
)

// osPrefersDark reports whether macOS is currently in dark mode. The global
// AppleInterfaceStyle default reads "Dark" while it is (including when
// "Auto" has switched it), and doesn't exist at all in light mode, which
// makes `defaults read` exit non-zero.
func osPrefersDark() bool {
	out, err := exec.Command("defaults", "read", "-g", "AppleInterfaceStyle").Output()
	return err == nil && strings.TrimSpace(string(out)) == "Dark"
}
