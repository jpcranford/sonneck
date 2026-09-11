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
// 2026-09-11). ListenWithFallback is real and wired into
// cmd/sonneck/main.go's actual listen call — Docker's own behavior is
// unchanged (one attempt, every interface) since buildTarget stays
// "docker" there. ListenAddress/LocalIPs otherwise stay groundwork: no
// native entry point exists yet (Phase 6) to ever pass buildTarget ==
// "native" or shareOnNetwork == true, and no endpoint surfaces LocalIPs to
// the frontend yet (Phase 7's Admin Settings "Share on Network" section,
// still mid-design — Phase 4).
package netinfo

import (
	"net"
	"strconv"
)

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

// maxFallbackAttempts bounds how far ListenWithFallback climbs above the
// configured port before giving up — 26163 (native's own default port,
// see internal/config.defaultPort) through 26172, a small, clearly-related
// range rather than scanning arbitrarily far.
const maxFallbackAttempts = 9

// ListenWithFallback binds an HTTP listener for port, retrying on the next
// port up (bounded by maxFallbackAttempts) only for native builds, and
// only when the configured port is already taken — Phase 3 addendum,
// project_wails_native_app_investigation memory, locked 2026-09-11. Docker
// (buildTarget != "native") always makes exactly one attempt, identical to
// this app's behavior before this function existed: a Docker deploy's
// whole port story is the operator's own docker-compose.yml mapping, and
// silently rebinding to some other port here would desync from it with no
// way for the operator to even notice. Native has no operator standing by
// to read a log line and fix a config file — a musician just wants the
// app to open — so it's worth the extra attempts, especially since 8080
// (Docker's own default, the same PORT env var either build reads) is a
// genuinely common port elsewhere on a real machine, unlike native's own
// default (see defaultPort's own comment for why 26163 specifically).
func ListenWithFallback(buildTarget, port string, shareOnNetwork bool) (net.Listener, error) {
	ln, err := net.Listen("tcp", ListenAddress(buildTarget, port, shareOnNetwork))
	if err == nil || buildTarget != "native" {
		return ln, err
	}

	basePort, convErr := strconv.Atoi(port)
	if convErr != nil {
		return nil, err // the original bind error is more meaningful than a bad port string
	}
	for i := 1; i <= maxFallbackAttempts; i++ {
		candidate := strconv.Itoa(basePort + i)
		ln, err = net.Listen("tcp", ListenAddress(buildTarget, candidate, shareOnNetwork))
		if err == nil {
			return ln, nil
		}
	}
	return nil, err
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
