// Run with: mise exec -- go run ./scripts/generate-contracts.go
package main

import (
	"encoding/json"
	"os"
	"reflect"
	"safehandoff.local/poc/internal/domain"
	"safehandoff.local/poc/internal/llm"
	"safehandoff.local/poc/internal/runner"
	"safehandoff.local/poc/internal/tools"
	"strings"
)

type disclosure struct {
	Schema         string                `json:"schema_version"`
	Status         string                `json:"status"`
	CandidateID    string                `json:"candidate_id"`
	Representation domain.Representation `json:"representation"`
	Clarify        bool                  `json:"requires_clarification"`
}
type toolRequest struct {
	ID        string   `json:"tool_id"`
	Version   string   `json:"tool_version"`
	TaskID    string   `json:"task_id"`
	Revision  int      `json:"revision"`
	GrantIDs  []string `json:"grant_ids"`
	Arguments struct {
		Seed  int `json:"seed"`
		Count int `json:"codepoint_count"`
	} `json:"arguments"`
}
type reproRequest struct {
	Pair        string `json:"target_pair_id"`
	Digest      string `json:"target_pair_digest"`
	InputID     string `json:"synthetic_input_set_id"`
	InputDigest string `json:"input_set_digest"`
	Oracle      string `json:"oracle_id"`
}
type evalCase struct {
	Schema     string   `json:"schema_version"`
	ID         string   `json:"case_id"`
	Required   []string `json:"required_semantics"`
	Forbidden  []string `json:"forbidden_semantics"`
	Literals   []string `json:"forbidden_literals"`
	Disclosure struct {
		Volume    string `json:"volume"`
		Time      string `json:"time"`
		Operation string `json:"operation_id"`
		Attempt   string `json:"attempt_id"`
	} `json:"expected_disclosure"`
	Repro domain.ReproResult `json:"expected_reproduction"`
}

func main() {
	types := map[string]any{"task.v1": domain.Task{}, "artifact.v1": domain.Artifact{}, "job.v1": domain.Job{}, "rule.v1": domain.Rule{}, "disclosure_preview.v1": domain.Preview{}, "candidate_proposals.v1": llm.Analysis{}, "disclosure_proposal.v1": llm.Disclosure{}, "decision.v1": domain.Decision{}, "fact_pack.v1": domain.FactPack{}, "draft.v1": domain.Draft{}, "review.v1": llm.Review{}, "tool_request.v1": toolRequest{}, "context_check.v1": tools.ContextResult{}, "context_check_request.v1": tools.ContextRequest{}, "target_run.v1": runner.TargetRun{}, "repro_request.v1": reproRequest{}, "repro_result.v1": runner.Repro{}, "evaluation_case.v1": evalCase{}}
	for name, v := range types {
		s := schema(reflect.TypeOf(v))
		s["$schema"] = "https://json-schema.org/draft/2020-12/schema"
		s["title"] = name
		if props, ok := s["properties"].(map[string]any); ok {
			if _, ok := props["schema_version"]; ok {
				props["schema_version"] = map[string]any{"const": name}
			}
		}
		b, _ := json.MarshalIndent(s, "", "  ")
		if e := os.WriteFile("contracts/"+name+".schema.json", append(b, '\n'), 0644); e != nil {
			panic(e)
		}
	}
}
func schema(t reflect.Type) map[string]any {
	if t.Kind() == reflect.Pointer {
		v := schema(t.Elem())
		return map[string]any{"anyOf": []any{v, map[string]any{"type": "null"}}}
	}
	if t.String() == "time.Time" {
		return map[string]any{"type": "string", "format": "date-time"}
	}
	if t == reflect.TypeOf(json.RawMessage{}) {
		return schema(reflect.TypeOf(tools.ConfigExample{}))
	}
	switch t.Kind() {
	case reflect.Struct:
		p := map[string]any{}
		required := []string{}
		for i := 0; i < t.NumField(); i++ {
			f := t.Field(i)
			parts := strings.Split(f.Tag.Get("json"), ",")
			if parts[0] == "-" {
				continue
			}
			name := parts[0]
			if name == "" {
				name = f.Name
			}
			p[name] = schema(f.Type)
			if t.Name() == "Job" && name == "result" {
				p[name] = map[string]any{"anyOf": []any{schema(reflect.TypeOf(llm.Disclosure{})), map[string]any{"type": "null"}}}
			}
			if values := enums(t.Name(), name); len(values) > 0 {
				p[name].(map[string]any)["enum"] = values
			}
			if name == "blocks" {
				p[name].(map[string]any)["maxItems"] = 60
			}
			if name == "candidates" {
				p[name].(map[string]any)["maxItems"] = 30
			}
			if len(parts) == 1 {
				required = append(required, name)
			}
			if name == "parameters" {
				p[name] = map[string]any{"type": "object", "additionalProperties": false, "properties": map[string]any{"decimal_places": map[string]any{"type": "integer", "minimum": 0, "maximum": 4}, "include_observation": map[string]any{"type": "integer", "minimum": 0, "maximum": 1}, "include_count": map[string]any{"type": "integer", "minimum": 0, "maximum": 1}, "include_unit": map[string]any{"type": "integer", "minimum": 0, "maximum": 1}, "start_row": map[string]any{"type": "integer", "minimum": 0}, "end_row": map[string]any{"type": "integer", "minimum": 1}, "base_epoch_seconds": map[string]any{"type": "integer"}}, "maxProperties": 5}
			}
		}
		return map[string]any{"type": "object", "additionalProperties": false, "properties": p, "required": required}
	case reflect.String:
		return map[string]any{"type": "string", "maxLength": 8192}
	case reflect.Bool:
		return map[string]any{"type": "boolean"}
	case reflect.Uint64, reflect.Uint, reflect.Uint32:
		return map[string]any{"type": "integer", "minimum": 0}
	case reflect.Int, reflect.Int64:
		return map[string]any{"type": "integer"}
	case reflect.Slice:
		if t.Elem().Kind() == reflect.Uint8 {
			return map[string]any{"type": "string", "contentEncoding": "base64", "maxLength": 349528}
		}
		return map[string]any{"type": []string{"array", "null"}, "items": schema(t.Elem()), "maxItems": 100}
	case reflect.Map:
		return map[string]any{"type": "object", "additionalProperties": schema(t.Elem())}
	case reflect.Interface:
		return map[string]any{"type": "object", "additionalProperties": false, "properties": map[string]any{"status": map[string]any{"type": "string"}, "reason_code": map[string]any{"type": "string"}}, "required": []string{"status", "reason_code"}}
	}
	panic(t.String())
}

func enums(parent, key string) []string {
	m := map[string]string{
		"Representation.kind":         "fact_summary derived_table selected_fields exact_value approved_excerpt",
		"Representation.transform_id": " series_direction_only.v1 series_index_base100.v1 timeline_sequence_only.v1 timeline_relative_intervals.v1 timeline_shifted_absolute.v1 timeline_synthetic_schedule.v1",
		"Decision.disposition":        "allow exclude defer",
		"Proposal.kind":               "observation constraint unknown identifier",
		"Proposal.uncertainty":        "observed reported inferred unknown",
		"Proposal.relevance":          "required optional",
		"Block.type":                  "heading paragraph list table_ref excerpt_ref asset_ref",
		"Review.result":               "pass needs_changes needs_decision error",
		"Issue.reason_code":           "UNAPPROVED_DISCLOSURE UNSUPPORTED_CAUSAL_CLAIM MISSING_REQUIRED_FACT SOURCE_CONFLICT UNCERTAINTY_REMOVED INCORRECT_PROJECTION UNAPPROVED_REFERENCE NEEDS_DISCLOSURE_DECISION",
		"Target.kind":                 "block document file",
		"TargetRun.status":            "ok domain_error execution_error",
		"TargetRun.stage":             "parse validate encode persist",
		"ContextResult.status":        "allowed denied unknown error",
		"Repro.status":                "not_requested not_run running reproduced not_reproduced inconclusive error",
		"ReproResult.status":          "not_requested not_run running reproduced not_reproduced inconclusive error",
		"Disclosure.status":           "supported ambiguous unsupported",
		"Scope.audience":              "public named_external",
		"Scope.purpose_id":            "oss_issue vendor_support operations_advice",
	}
	if v, ok := m[parent+"."+key]; ok {
		return strings.Split(v, " ")
	}
	return nil
}
