package llm

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
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
	u, e := url.Parse(os.Getenv(c.BaseURLEnv))
	if e != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Scheme != "https" && !(u.Scheme == "http" && c.AllowHTTP)) || os.Getenv(c.ModelEnv) == "" {
		return nil, errors.New("PROVIDER_CONFIG_UNSUPPORTED")
	}
	if c.OutputField != "max_tokens" && c.OutputField != "max_completion_tokens" && c.OutputField != "omit" {
		return nil, errors.New("PROVIDER_CONFIG_UNSUPPORTED")
	}
	if c.Timeout < 1 || c.MaxInput < 1 || c.MaxOutput < 1 || c.MaxAttempts < 1 || c.MaxAttempts > 2 {
		return nil, errors.New("PROVIDER_CONFIG_UNSUPPORTED")
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
