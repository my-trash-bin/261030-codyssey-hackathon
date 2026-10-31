package main

import (
	"encoding/json"
	"errors"
	"os"
	"safehandoff.local/poc/internal/domain"
	"safehandoff.local/poc/internal/envfile"
	"safehandoff.local/poc/internal/llm"
)

func liveProvider(configPath string) (llm.Provider, error) {
	if err := envfile.Load(".env"); err != nil {
		return nil, err
	}
	cfg := llm.DefaultConfig()
	b, err := os.ReadFile(configPath)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return nil, errors.New("CONFIG_READ_FAILED: 설정 파일을 읽을 수 없습니다")
	}
	if err == nil {
		var root map[string]json.RawMessage
		if json.Unmarshal(b, &root) != nil {
			return nil, errors.New("CONFIG_INVALID: 설정 파일 JSON 형식을 확인하세요")
		}
		if raw, ok := root["provider"]; ok {
			if domain.Strict(raw, &cfg) != nil {
				return nil, errors.New("CONFIG_INVALID: provider의 키·타입·JSON 형식을 확인하세요")
			}
		}
	}
	p, err := llm.NewLive(cfg)
	if err != nil {
		return nil, errors.New(llm.ConfigurationDiagnostic(err))
	}
	return p, nil
}
