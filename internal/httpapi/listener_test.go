package httpapi

import (
	"net"
	"net/http/httptest"
	"slices"
	"testing"
)

func TestWildcardListenerUsesInterfaceAddressesAndExplicitHosts(t *testing.T) {
	hosts, err := listenerHosts("0.0.0.0:8080", []string{"demo.internal:8080"}, []net.IP{net.ParseIP("192.0.2.15"), net.ParseIP("::1")})
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"127.0.0.1:8080", "localhost:8080", "192.0.2.15:8080", "demo.internal:8080"} {
		if !slices.Contains(hosts, want) {
			t.Fatal("missing browser host", want)
		}
	}
	if slices.Contains(hosts, "0.0.0.0:8080") || slices.Contains(hosts, "[::1]:8080") {
		t.Fatal("IPv4 wildcard must use reachable IPv4 host addresses")
	}
	for _, invalid := range []string{"*:8080", "https://demo.internal:8080", "demo.internal", "0.0.0.0:8080"} {
		if _, err := listenerHosts("0.0.0.0:8080", []string{invalid}, nil); err == nil {
			t.Fatal("invalid allowed host accepted")
		}
	}
}

func TestNetworkHostRequiresSameOriginAndRetainsCSRF(t *testing.T) {
	h := newHarness(t)
	s := New(h.svc, "0.0.0.0:8080", "192.0.2.15:8080", "demo.internal:8080")
	for _, tc := range []struct {
		host   string
		origin string
		code   int
	}{
		{"192.0.2.15:8080", "", 200},
		{"192.0.2.15:8080", "http://192.0.2.15:8080", 200},
		{"demo.internal:8080", "http://demo.internal:8080", 200},
		{"untrusted.invalid:8080", "", 403},
		{"192.0.2.15:8080", "http://untrusted.invalid:8080", 403},
		{"192.0.2.15:8080", "http://demo.internal:8080", 403},
	} {
		r := httptest.NewRequest("GET", "http://"+tc.host+"/api/v1/session", nil)
		if tc.origin != "" {
			r.Header.Set("Origin", tc.origin)
		}
		w := httptest.NewRecorder()
		s.ServeHTTP(w, r)
		if w.Code != tc.code {
			t.Fatalf("host=%s origin=%s got=%d want=%d", tc.host, tc.origin, w.Code, tc.code)
		}
	}
	r := httptest.NewRequest("POST", "http://192.0.2.15:8080/api/v1/tasks", nil)
	w := httptest.NewRecorder()
	s.ServeHTTP(w, r)
	if w.Code != 403 {
		t.Fatal("network binding bypassed session/CSRF")
	}
}
