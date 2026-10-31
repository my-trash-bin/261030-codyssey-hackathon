package labweb

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestWebIndependentOfEngine(t *testing.T) {
	handler, err := New("http://127.0.0.1:1", "127.0.0.1:8081")
	if err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{"/", "/app.js", "/state.js", "/style.css", "/health"} {
		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, httptest.NewRequest("GET", "http://127.0.0.1:8081"+path, nil))
		if recorder.Code != 200 {
			t.Fatal(path, recorder.Code)
		}
	}
}
func TestGatewayBoundary(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/generate" || r.Header.Get("Origin") != "" || r.Header.Get("Authorization") != "" {
			t.Errorf("unexpected forwarded request: %s", r.URL.Path)
		}
		b, _ := io.ReadAll(r.Body)
		w.Header().Set("Content-Type", "application/json")
		w.Write(b)
	}))
	defer upstream.Close()
	handler, err := New(upstream.URL, "127.0.0.1:8081")
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		host, origin, header string
		status               int
	}{
		{"127.0.0.1:8081", "http://127.0.0.1:8081", "1", 200},
		{"127.0.0.1:8081", "http://evil.invalid", "1", 403},
		{"evil.invalid", "", "1", 403},
		{"127.0.0.1:8081", "", "", 403},
	} {
		req := httptest.NewRequest("POST", "http://"+tc.host+"/api/v1/generate", strings.NewReader(`{"facts":[]}`))
		req.Header.Set("Origin", tc.origin)
		req.Header.Set("X-Safehandoff-UI", tc.header)
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "must-not-forward")
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != tc.status {
			t.Fatal(tc, rec.Code, rec.Body.String())
		}
	}
	for _, target := range []string{"https://example.com", "http://10.0.0.1:8091", "http://127.0.0.1:8091/path", "http://user@127.0.0.1:8091"} {
		if _, err := New(target, "127.0.0.1:8081"); err == nil {
			t.Fatal("accepted", target)
		}
	}
}
