package workflow

import (
	"context"
	"errors"
	"safehandoff.local/poc/internal/domain"
	"safehandoff.local/poc/internal/llm"
	"safehandoff.local/poc/prompts"
	"safehandoff.local/poc/skills"
	"strings"
	"time"
)

func (s *Service) modelCaller(t domain.Task, j domain.Job, traces *[]domain.Trace) func(string, any, any) error {
	calls := 0
	return func(role string, payload any, out any) error {
		var last error
		for attempt := 0; attempt < s.Attempts; attempt++ {
			if calls >= s.MaxCalls {
				return errors.New("MODEL_CALL_BUDGET_EXCEEDED")
			}
			calls++
			r := llm.Request{Role: role, PromptVersion: role + ".v1", Messages: []llm.Message{{Role: "system", Content: prompts.Get(role) + "\n" + skills.RoleDocs(t.Scope.PurposeID, role)}, {Role: "user", Content: string(domain.Canonical(payload))}}}
			if len(domain.Canonical(r)) > s.MaxInput {
				return errors.New("CONTEXT_BUDGET_EXCEEDED")
			}
			callStarted := time.Now()
			res, err := s.Provider.Generate(s.ctx, r)
			elapsed := time.Since(callStarted).Milliseconds()
			trace := domain.Trace{InputTokens: res.InputTokens, OutputTokens: res.OutputTokens, JobID: j.ID, Role: role, Mode: s.Provider.Mode(), Request: domain.Canonical(r), Response: res.Text, ElapsedMS: elapsed}
			if live, ok := s.Provider.(*llm.Live); ok {
				trace.Model = live.Model
				trace.ProviderConfigHash = domain.Hash(domain.Canonical(map[string]any{"config": live.Config, "base_url": live.Base, "model": live.Model}))
			}
			if err == nil {
				err = llm.Parse(res.Text, out)
			}
			if err != nil {
				trace.Error = safeCode(err)
			}
			*traces = append(*traces, trace)
			if err == nil {
				return nil
			}
			last = err
			if strings.Contains(err.Error(), "AUTH") || strings.Contains(err.Error(), "CONFIG") || strings.Contains(err.Error(), "CONTEXT") || strings.Contains(err.Error(), "CANCELLED") {
				break
			}
		}
		return last
	}
}

func safeCode(e error) string {
	if errors.Is(e, context.Canceled) {
		return "CANCELLED"
	}
	if errors.Is(e, context.DeadlineExceeded) {
		return "PROVIDER_TIMEOUT"
	}
	allowed := "INSUFFICIENT_OBSERVATIONS NEEDS_SCOPE_REDUCTION CANDIDATE_LIMIT INPUT_TOO_LARGE INVALID_REQUEST SCHEMA_INVALID INVALID_JSON SOURCE_CONFLICT REFERENCE_INVALID INVALID_DECISION BROKEN_EVIDENCE_REFERENCE SCOPE_MISMATCH APPROVAL_EXPIRED NO_SOURCES NO_SUPPORTED_CANDIDATES NEEDS_DECISIONS NEEDS_DISCLOSURE_DECISION NO_PUBLIC_FACTS MODEL_CALL_BUDGET_EXCEEDED CONTEXT_BUDGET_EXCEEDED OUTPUT_TRUNCATED PROVIDER_UNAVAILABLE PROVIDER_AUTH_FAILED PROVIDER_CONFIG_UNSUPPORTED PROVIDER_TIMEOUT CANCELLED INTERRUPTED REVIEW_UNRESOLVED ARTIFACT_STALE FINALIZATION_BLOCKED UNAPPROVED_DISCLOSURE UNAPPROVED_REFERENCE MISSING_REQUIRED_FACT INCORRECT_PROJECTION EXPORT_TOO_LARGE TOOL_TIMEOUT TOOL_SCHEMA_INVALID TOOL_ENVIRONMENT_UNAVAILABLE TARGET_DIGEST_MISMATCH"
	for _, code := range strings.Fields(allowed) {
		if e.Error() == code {
			return code
		}
	}
	return "SCHEMA_INVALID"
}
