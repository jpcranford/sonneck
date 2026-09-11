package netinfo_test

import (
	"net"
	"strconv"
	"testing"

	"github.com/jpcranford/sonneck/internal/netinfo"
)

func TestListenAddress(t *testing.T) {
	cases := []struct {
		name           string
		buildTarget    string
		shareOnNetwork bool
		want           string
	}{
		{"docker always binds every interface", "docker", false, ":8080"},
		{"docker ignores shareOnNetwork", "docker", true, ":8080"},
		{"native defaults to loopback-only", "native", false, "127.0.0.1:8080"},
		{"native binds every interface once shared", "native", true, ":8080"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := netinfo.ListenAddress(tc.buildTarget, "8080", tc.shareOnNetwork)
			if got != tc.want {
				t.Errorf("ListenAddress(%q, %q, %v) = %q, want %q", tc.buildTarget, "8080", tc.shareOnNetwork, got, tc.want)
			}
		})
	}
}

func TestListenWithFallback_DockerMakesExactlyOneAttempt(t *testing.T) {
	// Occupy a real port on every interface first (matching what
	// ListenAddress("docker", ...) itself binds to, ":"+port) — a specific
	// 127.0.0.1-only occupant doesn't reliably conflict with a wildcard
	// bind attempt on every platform, but the exact same wildcard bind
	// always does. Then confirm Docker fails outright rather than trying
	// the next port up — Docker's whole port story is the operator's own
	// docker-compose.yml mapping; silently rebinding elsewhere would
	// desync from it with no way for the operator to notice.
	taken, err := net.Listen("tcp", ":0")
	if err != nil {
		t.Fatalf("occupying a port: %v", err)
	}
	defer taken.Close()
	port := taken.Addr().(*net.TCPAddr).Port

	_, err = netinfo.ListenWithFallback("docker", strconv.Itoa(port), false)
	if err == nil {
		t.Error("ListenWithFallback(docker, taken port) = nil error, want a bind failure")
	}
}

func TestListenWithFallback_NativeFallsBackToNextPort(t *testing.T) {
	taken, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("occupying a port: %v", err)
	}
	defer taken.Close()
	port := taken.Addr().(*net.TCPAddr).Port

	ln, err := netinfo.ListenWithFallback("native", strconv.Itoa(port), false)
	if err != nil {
		t.Fatalf("ListenWithFallback(native, taken port): %v", err)
	}
	defer ln.Close()

	got := ln.Addr().(*net.TCPAddr).Port
	if got == port {
		t.Errorf("ListenWithFallback bound the already-taken port %d instead of falling back", port)
	}
	if got <= port || got > port+9 {
		t.Errorf("fallback port %d not within the expected +1..+9 range of %d", got, port)
	}
}

func TestLocalIPs_NoLoopbackOrLinkLocal(t *testing.T) {
	ips, err := netinfo.LocalIPs()
	if err != nil {
		t.Fatalf("LocalIPs: %v", err)
	}
	for _, s := range ips {
		ip := net.ParseIP(s)
		if ip == nil {
			t.Errorf("LocalIPs returned unparseable address %q", s)
			continue
		}
		if ip.IsLoopback() {
			t.Errorf("LocalIPs returned loopback address %q", s)
		}
		if ip.IsLinkLocalUnicast() {
			t.Errorf("LocalIPs returned link-local address %q", s)
		}
		if ip.To4() == nil {
			t.Errorf("LocalIPs returned non-IPv4 address %q", s)
		}
	}
}
