package llm

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
)

type transport func(*http.Request) (*http.Response, error)

func (f transport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func TestLiveAdapterTextOptionsAndNoToolExecution(t *testing.T) {
	t.Setenv("SAFEHANDOFF_LLM_BASE_URL", "http://127.0.0.1:8000/v1")
	t.Setenv("SAFEHANDOFF_LLM_MODEL", "internal")
	cfg := DefaultConfig()
	cfg.AllowHTTP = true
	cfg.SupportsSystem = false
	cfg.SendTemperature = false
	cfg.OutputField = "omit"
	p, e := NewLive(cfg)
	if e != nil {
		t.Fatal(e)
	}
	p.Client.Transport = transport(func(r *http.Request) (*http.Response, error) {
		if r.URL.Path != "/v1/chat/completions" {
			t.Fatal(r.URL)
		}
		b, _ := io.ReadAll(r.Body)
		var body map[string]json.RawMessage
		json.Unmarshal(b, &body)
		if body["temperature"] != nil || body["max_tokens"] != nil {
			t.Fatal(string(b))
		}
		var m []Message
		json.Unmarshal(body["messages"], &m)
		if len(m) != 1 || m[0].Role != "user" {
			t.Fatal(m)
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"choices":[{"finish_reason":"stop","message":{"content":"{}"}}]}`)), Header: http.Header{}}, nil
	})
	res, e := p.Generate(context.Background(), Request{Role: "writer", Messages: []Message{{"system", "policy"}, {"user", "pack"}}})
	if e != nil || res.Text != "{}" || res.InputTokens != nil {
		t.Fatal(res, e)
	}
	p.Client.Transport = transport(func(*http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"choices":[{"finish_reason":"stop","message":{"content":"{}","tool_calls":[{"id":"shell"}]}}]}`))}, nil
	})
	if _, e = p.Generate(context.Background(), Request{}); e == nil {
		t.Fatal("tool response accepted")
	}
}
func TestTruncationAndNoFixtureFallback(t *testing.T) {
	t.Setenv("SAFEHANDOFF_LLM_BASE_URL", "https://internal.invalid/v1")
	t.Setenv("SAFEHANDOFF_LLM_MODEL", "m")
	p, e := NewLive(DefaultConfig())
	if e != nil {
		t.Fatal(e)
	}
	p.Client.Transport = transport(func(*http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"choices":[{"finish_reason":"length","message":{"content":"{\"cut\":"}}]}`))}, nil
	})
	if _, e = p.Generate(context.Background(), Request{}); e == nil || e.Error() != "OUTPUT_TRUNCATED" {
		t.Fatal(e)
	}
	p.Config.MaxInput = 1
	if _, e = p.Generate(context.Background(), Request{}); e == nil || e.Error() != "CONTEXT_BUDGET_EXCEEDED" {
		t.Fatal(e)
	}
}
