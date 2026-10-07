//go:build !darwin && !windows

package main

// osPrefersDark: the native app ships for macOS and Windows only; elsewhere
// (a Linux CI vet or build) "system" opens light.
func osPrefersDark() bool { return false }
