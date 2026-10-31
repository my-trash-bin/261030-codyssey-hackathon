package llm

import "errors"

type configError struct {
	field  string
	reason string
}

func (*configError) Error() string { return "PROVIDER_CONFIG_UNSUPPORTED" }

func invalidConfig(field, reason string) error {
	return &configError{field: field, reason: reason}
}

// ConfigurationDiagnostic adds safe field-specific guidance, never configured values.
// The error code remains stable for workflow and API callers.
func ConfigurationDiagnostic(err error) string {
	var config *configError
	if errors.As(err, &config) {
		return config.Error() + ": provider." + config.field + ": " + config.reason
	}
	return "PROVIDER_CONFIG_UNSUPPORTED: provider 설정을 확인하세요"
}
