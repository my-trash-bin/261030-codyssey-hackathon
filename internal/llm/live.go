package llm

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

type Config struct {
	Type            string `json:"type"`
	BaseURLEnv      string `json:"base_url_env"`
	ModelEnv        string `json:"model_env"`
	KeyEnv          string `json:"api_key_env"`
	ResponseMode    string `json:"response_mode"`
	SupportsSystem  bool   `json:"supports_system_role"`
	SendTemperature bool   `json:"send_temperature"`
	OutputField     string `json:"output_limit_field"`
	AllowHTTP       bool   `json:"allow_plain_http"`
	Temperature     int    `json:"temperature"`
	MaxOutput       int    `json:"max_output_tokens"`
	MaxInput        int    `json:"max_input_bytes"`
	Timeout         int    `json:"request_timeout_seconds"`
	MaxAttempts     int    `json:"max_attempts_per_step"`
	Concurrency     int    `json:"global_concurrency"`
}

func DefaultConfig() Config {
	return Config{Type: "openai_compatible", BaseURLEnv: "SAFEHANDOFF_LLM_BASE_URL", ModelEnv: "SAFEHANDOFF_LLM_MODEL", KeyEnv: "SAFEHANDOFF_LLM_API_KEY", ResponseMode: "text", SupportsSystem: true, SendTemperature: true, OutputField: "max_tokens", MaxOutput: 2048, MaxInput: 24576, Timeout: 120, MaxAttempts: 2, Concurrency: 1}
}

type Live struct {
	Config Config
	Client *http.Client
	Base   string
	Model  string
	Key    string
}

func NewLive(c Config) (*Live, error) {
	if c.Type != "openai_compatible" {
		return nil, invalidConfig("type", "openai_compatible만 지원합니다")
	}
	if c.ResponseMode != "text" {
		return nil, invalidConfig("response_mode", "text만 지원합니다")
	}
	if c.Concurrency != 1 {
		return nil, invalidConfig("global_concurrency", "1이어야 합니다")
	}
	base := os.Getenv(c.BaseURLEnv)
	if base == "" {
		return nil, invalidConfig("base_url_env", "지정한 환경 변수에 endpoint 주소가 없습니다; .env 또는 실행 환경을 확인하세요")
	}
	u, e := url.Parse(base)
	if e != nil {
		return nil, invalidConfig("base_url_env", "환경 변수 값은 올바른 http:// 또는 https:// URL이어야 합니다")
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return nil, invalidConfig("base_url_env", "endpoint 주소 앞에 http:// 또는 https://가 필요합니다")
	}
	if u.Hostname() == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return nil, invalidConfig("base_url_env", "호스트가 있는 API root를 지정하고 URL 인증정보·query·fragment는 제거하세요")
	}
	if u.Scheme == "http" && !c.AllowHTTP {
		return nil, invalidConfig("allow_plain_http", "HTTP endpoint는 allow_plain_http=true 설정이 필요합니다; HTTPS가 기본입니다")
	}
	if strings.TrimSpace(os.Getenv(c.ModelEnv)) == "" {
		return nil, invalidConfig("model_env", "지정한 환경 변수에 모델 ID가 없습니다; .env 또는 실행 환경을 확인하세요")
	}
	if c.OutputField != "max_tokens" && c.OutputField != "max_completion_tokens" && c.OutputField != "omit" {
		return nil, invalidConfig("output_limit_field", "max_tokens, max_completion_tokens, omit 중 하나여야 합니다")
	}
	if c.Timeout < 1 {
		return nil, invalidConfig("request_timeout_seconds", "1 이상이어야 합니다")
	}
	if c.MaxInput < 1 {
		return nil, invalidConfig("max_input_bytes", "1 이상이어야 합니다")
	}
	if c.MaxOutput < 1 {
		return nil, invalidConfig("max_output_tokens", "1 이상이어야 합니다")
	}
	if c.MaxAttempts < 1 || c.MaxAttempts > 2 {
		return nil, invalidConfig("max_attempts_per_step", "1 또는 2여야 합니다")
	}
	return &Live{Config: c, Client: &http.Client{Timeout: time.Duration(c.Timeout) * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}, Base: strings.TrimRight(u.String(), "/"), Model: os.Getenv(c.ModelEnv), Key: os.Getenv(c.KeyEnv)}, nil
}
func (*Live) Mode() string { return "live" }
func (p *Live) Generate(ctx context.Context, r Request) (Response, error) {
	start := time.Now()
	messages := r.Messages
	if !p.Config.SupportsSystem {
		var parts []string
		for _, m := range messages {
			parts = append(parts, m.Content)
		}
		messages = []Message{{Role: "user", Content: strings.Join(parts, "\n\n")}}
	}
	body := map[string]any{"model": p.Model, "messages": messages, "stream": false}
	if p.Config.SendTemperature {
		body["temperature"] = p.Config.Temperature
	}
	if p.Config.OutputField != "omit" {
		body[p.Config.OutputField] = p.Config.MaxOutput
	}
	b, _ := json.Marshal(body)
	if len(b) > p.Config.MaxInput {
		return Response{}, errors.New("CONTEXT_BUDGET_EXCEEDED")
	}
	req, e := http.NewRequestWithContext(ctx, "POST", p.Base+"/chat/completions", bytes.NewReader(b))
	if e != nil {
		return Response{}, errors.New("PROVIDER_CONFIG_UNSUPPORTED")
	}
	req.Header.Set("Content-Type", "application/json")
	if p.Key != "" {
		req.Header.Set("Authorization", "Bearer "+p.Key)
	}
	resp, e := p.Client.Do(req)
	if e != nil {
		if ctx.Err() != nil {
			return Response{}, errors.New("CANCELLED")
		}
		var networkError net.Error
		if errors.As(e, &networkError) && networkError.Timeout() {
			return Response{}, errors.New("PROVIDER_TIMEOUT")
		}
		return Response{}, errors.New("PROVIDER_UNAVAILABLE")
	}
	defer resp.Body.Close()
	if resp.StatusCode == 401 || resp.StatusCode == 403 {
		return Response{}, errors.New("PROVIDER_AUTH_FAILED")
	}
	if resp.StatusCode == 400 {
		return Response{}, errors.New("PROVIDER_CONFIG_UNSUPPORTED")
	}
	if resp.StatusCode != 200 {
		return Response{}, errors.New("PROVIDER_UNAVAILABLE")
	}
	b, e = io.ReadAll(io.LimitReader(resp.Body, 262145))
	if e != nil || len(b) > 262144 {
		return Response{}, errors.New("OUTPUT_TRUNCATED")
	}
	var wire struct {
		Choices []struct {
			Finish  string `json:"finish_reason"`
			Message struct {
				Content   string            `json:"content"`
				ToolCalls []json.RawMessage `json:"tool_calls"`
			} `json:"message"`
		} `json:"choices"`
		Usage *struct {
			Input  *int `json:"prompt_tokens"`
			Output *int `json:"completion_tokens"`
		} `json:"usage"`
	}
	if json.Unmarshal(b, &wire) != nil || len(wire.Choices) != 1 {
		return Response{}, errors.New("SCHEMA_INVALID")
	}
	choice := wire.Choices[0]
	if choice.Finish == "length" {
		return Response{}, errors.New("OUTPUT_TRUNCATED")
	}
	if len(choice.Message.ToolCalls) > 0 || choice.Message.Content == "" {
		return Response{}, errors.New("SCHEMA_INVALID")
	}
	result := Response{Text: choice.Message.Content, ElapsedMS: time.Since(start).Milliseconds()}
	if wire.Usage != nil {
		result.InputTokens = wire.Usage.Input
		result.OutputTokens = wire.Usage.Output
	}
	return result, nil
}
