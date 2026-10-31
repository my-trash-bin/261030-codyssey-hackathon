package regeneration

import (
	"context"
	"errors"
	"io/fs"
	demodata "safehandoff.local/poc/fixtures/demo"
	"strings"
)

type Scenario struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Input Input  `json:"input"`
}

var scenarioNames = map[string]string{
	"operations":    "운영 자문 · 중복 입력 줄이기",
	"vendor":        "공급사 문의 · timeout과 재시도",
	"oss-streamcsv": "OSS · 스트리밍 CSV 청크 경계 오류",
	"b2b-webhook":   "B2B · 배송 웹훅 중복과 순서 역전",
}

func Scenarios() []Scenario {
	out := []Scenario{}
	for _, id := range []string{"operations", "vendor", "oss-streamcsv", "b2b-webhook"} {
		purpose, recipient := "공급사 기술지원 문의", "지정 가상 공급사"
		if id == "operations" {
			purpose, recipient = "운영 개선 자문", "가상 운영 자문사"
		}
		if id == "oss-streamcsv" {
			purpose, recipient = "오픈소스 버그 제보", "가상 StreamCSV-Demo 공개 이슈"
		}
		input := Input{Scenario: id, Purpose: purpose, Recipient: recipient, Sources: []Source{}}
		entries, _ := fs.ReadDir(demodata.Files, id)
		for _, entry := range entries {
			b, _ := demodata.Files.ReadFile(id + "/" + entry.Name())
			input.Sources = append(input.Sources, Source{ID: id + "/" + entry.Name(), Name: entry.Name(), Text: string(b)})
		}
		out = append(out, Scenario{ID: id, Name: scenarioNames[id], Input: input})
	}
	return out
}

// Demo is an explicitly scripted interaction simulator, with no model calls.
type Demo struct{}

func (Demo) Mode() string { return "demo" }
func (Demo) Analyze(ctx context.Context, v Input) (Analysis, error) {
	if err := ctx.Err(); err != nil {
		return Analysis{}, err
	}
	if err := validateInput(v); err != nil {
		return Analysis{}, err
	}
	var original *Input
	for _, s := range Scenarios() {
		if s.ID == v.Scenario {
			copy := s.Input
			original = &copy
		}
	}
	if original == nil || Hash(original.Sources) != Hash(v.Sources) {
		return Analysis{}, errors.New("DEMO_REQUIRES_UNMODIFIED_SAMPLE")
	}
	texts := demoFacts(v.Scenario)
	candidates := []Candidate{}
	ids := []string{}
	for _, s := range v.Sources {
		ids = append(ids, s.ID)
	}
	for i, text := range texts {
		candidates = append(candidates, Candidate{ID: string(rune('a' + i)), Text: text, Reason: "시연용으로 준비한 공개 후보입니다. 근거와 표현을 확인하고 직접 승인하세요.", SourceIDs: ids})
	}
	return Analysis{Mode: "demo", InputHash: Hash(v), Candidates: candidates}, nil
}
func (Demo) Generate(ctx context.Context, v GenerateInput) (Result, error) {
	if err := ctx.Err(); err != nil {
		return Result{}, err
	}
	if err := validateFacts(v); err != nil {
		return Result{}, err
	}
	var body strings.Builder
	body.WriteString("## 공유 목적\n\n" + v.Purpose + "\n\n## 전달할 내용\n\n")
	for _, f := range v.Facts {
		body.WriteString("- " + f.Text + "\n")
	}
	body.WriteString("\n## 확인 요청\n\n위 관찰과 제약을 바탕으로 다음 조사 항목과 권장 대응을 안내해 주세요. 확인하지 않은 원인과 실행 결과는 단정하지 않습니다.\n")
	doc := Document{Title: v.Purpose, Body: body.String()}
	rev, _ := (Demo{}).Review(ctx, ReviewInput{GenerateInput: v, Document: doc})
	return Result{Mode: "demo", InputHash: Hash(v), Document: doc, Review: rev}, nil
}
func (Demo) Review(ctx context.Context, v ReviewInput) (Review, error) {
	if err := ctx.Err(); err != nil {
		return Review{}, err
	}
	if err := validateFacts(v.GenerateInput); err != nil {
		return Review{}, err
	}
	issues := []string{}
	for _, f := range v.Facts {
		if !strings.Contains(v.Document.Body, f.Text) {
			issues = append(issues, "승인한 정보가 편집본에 그대로 남아 있지 않습니다: "+f.ID)
		}
	}
	if strings.TrimSpace(v.Document.Title) == "" || strings.TrimSpace(v.Document.Body) == "" {
		issues = append(issues, "제목과 본문을 입력하세요")
	}
	return Review{Pass: len(issues) == 0, Issues: issues}, nil
}
