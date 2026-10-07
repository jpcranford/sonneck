package main

import "golang.org/x/sys/windows/registry"

// osPrefersDark reports whether Windows' app mode is dark (Settings ›
// Personalization › Colors): AppsUseLightTheme is 0 then. A missing key
// (older Windows) means light.
func osPrefersDark() bool {
	k, err := registry.OpenKey(registry.CURRENT_USER,
		`Software\Microsoft\Windows\CurrentVersion\Themes\Personalize`, registry.QUERY_VALUE)
	if err != nil {
		return false
	}
	defer k.Close()
	v, _, err := k.GetIntegerValue("AppsUseLightTheme")
	return err == nil && v == 0
}
