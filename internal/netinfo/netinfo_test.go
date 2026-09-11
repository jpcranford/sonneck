package netinfo_test

import (
	"net"
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
