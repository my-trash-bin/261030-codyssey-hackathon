package llm

import (
	"context"
	"encoding/json"
	"errors"
	"safehandoff.local/poc/internal/domain"
	"strings"
	"time"
)

type Message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}
type Request struct {
	Role          string    `json:"role"`
	PromptVersion string    `json:"prompt_version"`
	Messages      []Message `json:"messages"`
}
type Response struct {
	Text         string
	ElapsedMS    int64
	InputTokens  *int
	OutputTokens *int
}
type Provider interface {
	Generate(context.Context, Request) (Response, error)
	Mode() string
}
type Proposal struct {
	LocalKey         string   `json:"local_key"`
	Kind             string   `json:"kind"`
	Uncertainty      string   `json:"uncertainty"`
	Statement        string   `json:"statement"`
	EvidenceIDs      []string `json:"evidence_ids"`
	Relevance        string   `json:"relevance"`
	PurposeRelevance string   `json:"purpose_relevance"`
}
type Analysis struct {
	Schema     string     `json:"schema_version"`
	Candidates []Proposal `json:"candidates"`
	Conflicts  []Conflict `json:"conflicts"`
}
type Conflict struct {
	Keys   []string `json:"local_keys"`
	Reason string   `json:"reason"`
}
type Target struct {
	Kind    string `json:"kind"`
	BlockID string `json:"block_id,omitempty"`
	FileID  string `json:"artifact_file_id,omitempty"`
}
type Issue struct {
	Target      Target   `json:"target"`
	Reason      string   `json:"reason_code"`
	Action      *string  `json:"action"`
	Facts       []string `json:"approved_fact_ids"`
	Candidates  []string `json:"candidate_ids"`
	Explanation string   `json:"internal_explanation"`
}
type Review struct {
	Schema string  `json:"schema_version"`
	Result string  `json:"result"`
	Issues []Issue `json:"issues"`
}

func Parse(text string, dst any) error {
	s := strings.TrimSpace(text)
	if strings.HasPrefix(s, "```json\n") && strings.HasSuffix(s, "\n```") {
		s = strings.TrimSuffix(strings.TrimPrefix(s, "```json\n"), "\n```")
	}
	if e := domain.Strict([]byte(s), dst); e != nil {
		return e
	}
	return domain.Required([]byte(s), dst)
}

type Fixture struct{}

func (Fixture) Mode() string { return "fixture" }
func (Fixture) Generate(ctx context.Context, r Request) (Response, error) {
	if e := ctx.Err(); e != nil {
		return Response{}, e
	}
	start := time.Now()
	var result any
	switch r.Role {
	case "disclosure":
		var input struct {
			Candidate domain.Candidate `json:"candidate"`
			Text      string           `json:"user_input"`
		}
		if json.Unmarshal([]byte(r.Messages[len(r.Messages)-1].Content), &input) != nil {
			return Response{}, errors.New("SCHEMA_INVALID")
		}
		proposal := Disclosure{Schema: "disclosure_proposal.v1", Status: "unsupported", CandidateID: input.Candidate.ID}
		if input.Candidate.Kind == "series" {
			if input.Text == "첫 관찰을 100으로 한 비율만 공개" {
				proposal.Status = "supported"
				proposal.Representation = &domain.Representation{Kind: "derived_table", TransformID: "series_index_base100.v1", Parameters: map[string]int{"decimal_places": 2}}
			}
			if input.Text == "방향만 공개" {
				proposal.Status = "supported"
				proposal.Representation = &domain.Representation{Kind: "derived_table", TransformID: "series_direction_only.v1", Parameters: map[string]int{}}
			}
		}
		result = proposal
	case "check":
		result = map[string]bool{"ok": true}
	case "analyst":
		var payload struct {
			Sources  []domain.ModelSource `json:"sources"`
			Evidence []domain.Evidence    `json:"evidence"`
		}
		if json.Unmarshal([]byte(r.Messages[len(r.Messages)-1].Content), &payload) != nil {
			return Response{}, errors.New("SCHEMA_INVALID")
		}
		a := Analysis{Schema: "candidate_proposals.v1", Candidates: []Proposal{}, Conflicts: []Conflict{}}
		add := func(statement, kind string, ev []string, required bool) {
			rel := "optional"
			if required {
				rel = "required"
			}
			a.Candidates = append(a.Candidates, Proposal{LocalKey: domain.ID("local"), Kind: kind, Uncertainty: "observed", Statement: statement, EvidenceIDs: ev, Relevance: rel, PurposeRelevance: "조사를 위한 관찰 정보"})
		}
		for _, s := range payload.Sources {
			if !s.Included || s.Format == "csv" {
				continue
			}
			evs := []string{}
			for _, ev := range payload.Evidence {
				if ev.SourceVersionID == s.ID {
					evs = append(evs, ev.ID)
				}
			}
			raw := string([]byte(s.Content))
			if strings.Contains(raw, "response_timeout") {
				add("첫 요청에서 클라이언트 응답 대기 시간이 초과됐습니다.", "observation", evs, true)
				if strings.Contains(raw, "status=200") {
					add("재시도에는 성공 응답을 받았습니다.", "observation", evs, true)
				}
				add("최초 요청의 서버 완료 여부와 중복 처리 여부는 확인하지 못했습니다. 요청량 변화와 오류의 인과관계도 확인하지 못했습니다. 공급사에 처리 결과와 안전한 재시도 조건을 문의합니다.", "unknown", evs, true)
				for _, prefix := range []string{"operation_id=", "attempt_id="} {
					vals := []string{}
					for _, word := range strings.Fields(raw) {
						if strings.HasPrefix(word, prefix) {
							v := strings.TrimPrefix(word, prefix)
							found := false
							for _, x := range vals {
								if x == v {
									found = true
								}
							}
							if !found {
								vals = append(vals, v)
							}
						}
					}
					if len(vals) > 0 {
						add(strings.TrimSuffix(prefix, "=")+" (관찰 순서): "+strings.Join(vals, ", "), "identifier", evs, false)
					}
				}
			}
			if strings.Contains(raw, "toyrecord 0.1.0-demo") {
				add("가상 공개 제품 toyrecord 0.1.0-demo이며 입력 계약은 1–8 코드포인트입니다.", "constraint", evs, true)
			}
			if strings.Contains(raw, "E_ENCODE_SHORT_BUFFER") {
				add("다중 바이트 입력에서 encode 단계 E_ENCODE_SHORT_BUFFER 오류를 관찰했습니다. 근본 원인은 아직 조사 중입니다.", "observation", evs, true)
				add("ASCII 입력의 저장은 성공했습니다.", "observation", evs, true)
			}
			if strings.Contains(raw, "중복 입력") {
				add("같은 요청을 접수표와 처리 시스템에 중복 입력하고 사람이 상태를 대조합니다.", "observation", evs, true)
			}

			if strings.Contains(raw, "충돌 자료:") {
				key := ""
				for _, candidate := range a.Candidates {
					if candidate.Kind == "unknown" {
						key = candidate.LocalKey
						break
					}
				}
				add("별도 메모는 최초 요청의 완료를 주장하지만 확인이 필요합니다.", "observation", evs, true)
				a.Candidates[len(a.Candidates)-1].Uncertainty = "reported"
				if key != "" {
					a.Conflicts = append(a.Conflicts, Conflict{Keys: []string{key, a.Candidates[len(a.Candidates)-1].LocalKey}, Reason: "완료 여부에 관한 원자료 주장 충돌"})
				}
			}
			if strings.Contains(raw, "채널을 유지") {
				add("기존 메일·메신저 접수 채널을 유지해야 합니다.", "constraint", evs, true)
			}
		}
		result = a
	case "writer":
		var p domain.FactPack
		if e := json.Unmarshal([]byte(r.Messages[len(r.Messages)-1].Content), &p); e != nil {
			return Response{}, e
		}
		d := domain.Draft{Schema: "draft.v1", Blocks: []domain.Block{}}
		if len(p.Facts) > 0 {
			title := map[string]string{"vendor_support.v1": "저장 요청 시간 초과 문의", "oss_issue.v1": "문자열 저장 오류 제보", "operations_advice.v1": "운영 흐름 개선 자문 요청"}[p.TemplateID]
			if title != "" {
				d.Blocks = append(d.Blocks, domain.Block{Type: "heading", Level: 1, Text: title, FactIDs: []string{p.Facts[0].ID}})
			}
		}
		for _, f := range p.Facts {
			d.Blocks = append(d.Blocks, domain.Block{Type: "paragraph", Text: f.Statement, FactIDs: []string{f.ID}})
		}
		for _, tb := range p.Tables {
			d.Blocks = append(d.Blocks, domain.Block{Type: "table_ref", TableID: tb.ID})
		}
		for _, slot := range p.Excerpts {
			d.Blocks = append(d.Blocks, domain.Block{Type: "excerpt_ref", ExcerptID: slot.ID})
		}
		for _, slot := range p.Assets {
			d.Blocks = append(d.Blocks, domain.Block{Type: "asset_ref", AssetID: slot.ID})
		}
		if len(p.Facts) > 0 {
			question := "관찰된 현상과 미확인 사항에 대해 확인을 부탁드립니다."
			if p.TemplateID == "vendor_support.v1" {
				hasIDs := false
				for _, fact := range p.Facts {
					hasIDs = hasIDs || fact.Kind == "identifier"
				}
				if !hasIDs {
					question = "조회에 필요한 최소 진단 항목과 안전한 재시도 조건을 알려 주세요."
				}
			}
			if p.TemplateID == "operations_advice.v1" {
				question = "기존 채널 유지 제약을 지키면서 중복 입력과 상태 대조를 줄일 개선 방안을 제안해 주세요."
			}
			d.Blocks = append(d.Blocks, domain.Block{Type: "paragraph", Text: question, FactIDs: []string{p.Facts[0].ID}})
		}
		result = d
	case "reviewer":
		result = Review{Schema: "review.v1", Result: "pass", Issues: []Issue{}}
	default:
		return Response{}, errors.New("UNSUPPORTED_ROLE")
	}
	b, e := json.Marshal(result)
	return Response{Text: string(b), ElapsedMS: time.Since(start).Milliseconds()}, e
}
