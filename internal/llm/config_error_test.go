package llm

import (
	"strings"
	"testing"
)

func TestConfigurationDiagnosticsDistinguishInvalidSettings(t *testing.T) {
	for _, tc := range []struct {
		name   string
		base   string
		model  string
		mutate func(*Config)
		field  string
		hint   string
	}{
		{"missing endpoint", "", "model", nil, "base_url_env", "endpoint 주소가 없습니다"},
		{"missing scheme", "private-sentinel.invalid/v1", "model", nil, "base_url_env", "http:// 또는 https://"},
		{"http opt-in", "http://private-sentinel.invalid/v1", "model", nil, "allow_plain_http", "true"},
		{"missing model", "https://private-sentinel.invalid/v1", "", nil, "model_env", "모델 ID"},
		{"invalid URL", "https://private-sentinel.invalid:bad/v1", "model", nil, "base_url_env", "URL"},
		{"URL credentials", "https://secret-sentinel@private-sentinel.invalid/v1", "model", nil, "base_url_env", "인증정보"},
		{"provider type", "https://private-sentinel.invalid/v1", "model", func(c *Config) { c.Type = "invalid" }, "type", "openai_compatible"},
		{"token option", "https://private-sentinel.invalid/v1", "model", func(c *Config) { c.OutputField = "invalid" }, "output_limit_field", "max_tokens"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("SAFEHANDOFF_LLM_BASE_URL", tc.base)
			t.Setenv("SAFEHANDOFF_LLM_MODEL", tc.model)
			cfg := DefaultConfig()
			if tc.mutate != nil {
				tc.mutate(&cfg)
			}
			_, err := NewLive(cfg)
			if err == nil || err.Error() != "PROVIDER_CONFIG_UNSUPPORTED" {
				t.Fatal("expected stable configuration error")
			}
			diagnostic := ConfigurationDiagnostic(err)
			if !strings.Contains(diagnostic, "provider."+tc.field+":") || !strings.Contains(diagnostic, tc.hint) {
				t.Fatal(diagnostic)
			}
			if strings.Contains(diagnostic, "sentinel") {
				t.Fatal("configuration value leaked")
			}
		})
	}
}
