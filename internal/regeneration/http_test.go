package regeneration

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestEngineTransport(t *testing.T) {
	handler := Handler(Demo{})
	for _, tc := range []struct {
		method, path, body, origin string
		status                     int
	}{
		{"GET", "/health", "", "", 200},
		{"GET", "/v1/scenarios", "", "", 200},
		{"POST", "/v1/generate", `{"purpose":"support","recipient":"vendor","facts":[{"id":"a","text":"observed timeout"}]}`, "", 200},
		{"POST", "/v1/generate", `{"purpose":"support","recipient":"vendor","facts":[],"sources":[]}`, "", 400},
		{"POST", "/v1/generate", `{} {}`, "", 400},
		{"POST", "/v1/generate", `{}`, "", 422},
		{"POST", "/v1/generate", `{}`, "http://evil.invalid", 403},
	} {
		request := httptest.NewRequest(tc.method, tc.path, bytes.NewBufferString(tc.body))
		request.Header.Set("Origin", tc.origin)
		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, request)
		if recorder.Code != tc.status {
			t.Fatalf("%s: %d %s", tc.path, recorder.Code, recorder.Body.String())
		}
	}
	b, _ := json.Marshal(Scenarios()[0].Input)
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, "/v1/analyze", bytes.NewReader(b)))
	if recorder.Code != 200 {
		t.Fatal(recorder.Body.String())
	}
}
