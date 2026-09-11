// Package netinfo answers two related questions a native (Wails) build
// needs that Docker never does — what address should the HTTP server
// actually bind to, and what LAN address(es) should a user be told to type
// into another device's browser. Docker's own port mapping already is the
// access-control decision an operator made (CLAUDE.md > Docker/build) and
// its host/IP is whatever they configured outside this app entirely, so
// neither question is meaningful there — both functions below only branch
// on buildTarget so a Docker caller gets today's unchanged behavior for
// free rather than needing its own separate code path.
//
// project_wails_native_app_investigation memory's Phase 3 (locked
// 2026-09-11) — groundwork only. Nothing calls ListenAddress or LocalIPs
// yet; no native entry point exists (Phase 6) to bind a listener from, and
// no endpoint surfaces LocalIPs to the frontend yet (Phase 7's Admin
// Settings "Share on Network" section, not yet designed — Phase 4).
package netinfo

import "net"

// ListenAddress returns the address main() should bind its HTTP listener
// to. Docker (buildTarget != "native") always binds every interface,
// unconditionally — its own port mapping already is the access-control
// decision an operator made, so there's nothing for this app to gate.
// Native binds loopback-only by default (the standing decision: a native
// build shouldn't be reachable from another device until the user
// consciously opts in) and only every interface once shareOnNetwork is
// true — the "Share on Network" toggle's real effect once it exists.
func ListenAddress(buildTarget, port string, shareOnNetwork bool) string {
	if buildTarget != "native" || shareOnNetwork {
		return ":" + port
	}
	return "127.0.0.1:" + port
}

// LocalIPs returns this machine's own non-loopback IPv4 addresses — the
// candidate(s) to show a user for "type this into another device's
// browser on the same network." A machine can genuinely have more than
// one (Wi-Fi + Ethernet, multiple adapters), so this returns every
// plausible candidate rather than picking one; the caller decides how to
// present multiple. Link-local addresses (169.254.0.0/16 — auto-assigned
// when a device gets no real DHCP lease) are excluded: never a usable LAN
// address to hand someone. IPv6 is out of scope for the same reason it's
// out of scope everywhere else a human types an address by hand — far
// less commonly usable/predictable for this purpose.
func LocalIPs() ([]string, error) {
	addrs, err := net.InterfaceAddrs()
	if err != nil {
		return nil, err
	}

	var ips []string
	for _, addr := range addrs {
		ipNet, ok := addr.(*net.IPNet)
		if !ok || ipNet.IP.IsLoopback() || ipNet.IP.IsLinkLocalUnicast() {
			continue
		}
		if v4 := ipNet.IP.To4(); v4 != nil {
			ips = append(ips, v4.String())
		}
	}
	return ips, nil
}
