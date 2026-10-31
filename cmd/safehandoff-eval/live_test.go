package main

import (
	"os"
	"strings"
	"testing"

	"safehandoff.local/poc/internal/llm"
)

func TestLiveProviderAutomaticallyLoadsDotenv(t *testing.T) {
	t.Chdir(t.TempDir())
	for _, name := range []string{"SAFEHANDOFF_LLM_BASE_URL", "SAFEHANDOFF_LLM_MODEL", "SAFEHANDOFF_LLM_API_KEY"} {
		t.Setenv(name, "")
		if err := os.Unsetenv(name); err != nil {
			t.Fatal(err)
		}
	}
	writePrivate := func(name, text string) {
		t.Helper()
		if err := os.WriteFile(name, []byte(text), 0600); err != nil {
			t.Fatal(err)
		}
	}
	writePrivate(".env", "SAFEHANDOFF_LLM_BASE_URL=https://internal.invalid/v1\nSAFEHANDOFF_LLM_MODEL=internal\nSAFEHANDOFF_LLM_API_KEY=private-sentinel\n")
	provider, err := liveProvider("missing-config.json")
	if err != nil {
		t.Fatal(err)
	}
	p := provider.(*llm.Live)
	if p.Base != "https://internal.invalid/v1" || p.Model != "internal" || p.Key != "private-sentinel" {
		t.Fatal("dotenv values were not loaded")
	}
	t.Setenv("SAFEHANDOFF_LLM_BASE_URL", "internal.invalid/v1")
	_, err = liveProvider("missing-config.json")
	if err == nil || !strings.Contains(err.Error(), "provider.base_url_env") || !strings.Contains(err.Error(), "http:// 또는 https://") {
		t.Fatal("invalid endpoint did not produce the specific diagnostic")
	}
	writePrivate("config.json", `{"provider":{"unexpected_key":"private-sentinel"}}`)
	_, err = liveProvider("config.json")
	if err == nil || !strings.Contains(err.Error(), "CONFIG_INVALID") || strings.Contains(err.Error(), "sentinel") {
		t.Fatal("invalid config must return a safe diagnostic")
	}
}
